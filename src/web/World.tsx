import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import * as Api from './api.ts'
import { ago } from './format.ts'
import { usePoll } from './hooks.ts'
import { area, areas, type Area } from './research.ts'
import { Link } from './router.tsx'
import { Bar, Status } from './Visual.tsx'

const priority = { running: 0, funding: 1, paused: 2, done: 3 } as const

function Habitat(props: { swarm: Summary; selected: boolean }) {
  const swarm = props.swarm
  return (
    <svg aria-hidden="true" className="habitat" viewBox="0 0 160 110">
      <path className="habitat-shadow" d="M80 47 139 77 80 107 21 77Z" />
      <path className="habitat-base" d="M24 62 80 33 136 62 136 73 80 102 24 73Z" />
      <path className="habitat-ground" d="M80 33 136 62 80 91 24 62Z" />
      <path className="habitat-grid" d="M52 48 108 77M38 55 94 84M66 41 122 70M52 77 108 48M38 70 94 41M66 84 122 55" />
      <ellipse className="habitat-ring" cx="80" cy="62" rx="28" ry="14" />
      <path className="habitat-tower" d="M80 28 94 35 94 60 80 67 66 60 66 35Z" />
      <path className="habitat-roof" d="M80 28 94 35 80 42 66 35Z" />
      <path className="habitat-seam" d="M80 42V67" />
      <circle className="habitat-signal" cx="80" cy="20" r="3" />
      {Array.from({ length: Math.min(swarm.workers, 12) }, (_, index) => {
        const angle = (index / Math.max(swarm.workers, 1)) * Math.PI * 2 - Math.PI / 2
        return <circle className="habitat-explorer" cx={80 + Math.cos(angle) * 39} cy={61 + Math.sin(angle) * 20} key={index} r="3.5" style={{ animationDelay: `${index * -0.7}s` }} />
      })}
      {Array.from({ length: Math.min(swarm.machines, 8) }, (_, index) => (
        <rect className="habitat-machine" height="6" key={index} width="6" x={48 + index * 8} y="84" />
      ))}
      {props.selected && <path className="habitat-selection" d="M16 57V48L30 41M130 41 144 48V57M16 78V85L30 92M130 92 144 85V78" />}
    </svg>
  )
}

function Observatory(props: { now: number; swarm: Summary }) {
  const swarm = props.swarm
  const [detail] = usePoll(() => Api.swarm(swarm.id), 5000, swarm.id)
  const events = detail.data?.feed.filter((entry) => entry.kind !== 'thinking').slice(-3).reverse() ?? []
  return (
    <aside aria-label="Selected research swarm" className="observatory">
      <div aria-atomic="true" aria-live="polite" className="observatory-selection">
        <p className="label">{area(swarm).label} / {swarm.id.slice(0, 6)}</p>
        <h3>{swarm.title}</h3>
        <p className="meta"><Status status={swarm.status} /><span>Updated {ago(swarm.updatedAt, props.now)}</span></p>
      </div>
      <p className="observatory-goal">{swarm.goal}</p>
      <dl className="figures">
        <div><dt>Explorers</dt><dd>{swarm.workers}</dd></div>
        <div><dt>Machines</dt><dd>{swarm.machines}</dd></div>
        <div><dt>Backers</dt><dd>{swarm.contributors}</dd></div>
        <div><dt>Rounds</dt><dd>{swarm.rounds}</dd></div>
      </dl>
      <Bar swarm={swarm} />
      <div className="observatory-finding">
        <p className="label">{swarm.answer ? `Latest findings / round ${swarm.answer.round}` : 'Research record'}</p>
        <p>{swarm.answer ? Answer.excerpt(swarm.answer.text, 260) : swarm.status === 'running' ? 'Research is underway. The first round report will appear here when it is published.' : 'No round report published yet.'}</p>
      </div>
      <div className="world-events">
        <p className="label">Recent activity</p>
        {detail.error && <p className="fine">Activity unavailable. Retrying…</p>}
        {!detail.data && !detail.error && <p className="fine">Loading activity…</p>}
        {detail.data && events.length === 0 && <p className="fine">No activity recorded yet.</p>}
        {events.map((entry) => <div className="world-event" key={entry.seq}><span>{entry.kind}</span><p>{entry.text}</p><time dateTime={new Date(entry.at).toISOString()}>{ago(entry.at, props.now)}</time></div>)}
      </div>
      <p className="actions">
        <Link className="btn btn-high" to={`/s/${swarm.id}`}>{swarm.status === 'done' ? 'Read the research' : 'Fund this swarm'} <span aria-hidden="true">↗</span></Link>
        {swarm.status !== 'done' && <Link className="btn btn-low" to={`/s/${swarm.id}`}>Full research record</Link>}
      </p>
    </aside>
  )
}

export function World(props: { error: string | undefined; loading: boolean; now: number; swarms: Summary[] }) {
  const [scope, setScope] = useState<'active' | 'done'>('active')
  const [domain, setDomain] = useState<Area | 'all'>('all')
  const [selected, setSelected] = useState<string>()
  const scoped = props.swarms.filter((swarm) => scope === 'active' ? swarm.status !== 'done' : swarm.status === 'done').sort((a, b) => priority[a.status] - priority[b.status] || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const shown = scoped.filter((swarm) => domain === 'all' || area(swarm).id === domain)
  const current = shown.find((swarm) => swarm.id === selected) ?? shown[0]
  const select = (id: string) => {
    setSelected(id)
    if (matchMedia('(max-width: 799px)').matches) requestAnimationFrame(() => document.getElementById('world-observatory')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }))
  }
  return (
    <section aria-labelledby="world-heading" className="block world" id="world">
      <div className="block-bar">
        <h2 className="block-head" id="world-heading"><span className="index">[1]</span> Swarm World</h2>
        <nav aria-label="World view" className="filters">
          <button aria-pressed={scope === 'active'} className="filter" onClick={() => setScope('active')} type="button">Active swarms <span>{props.swarms.filter((swarm) => swarm.status !== 'done').length}</span></button>
          <button aria-pressed={scope === 'done'} className="filter" onClick={() => setScope('done')} type="button">Completed research <span>{props.swarms.filter((swarm) => swarm.status === 'done').length}</span></button>
        </nav>
      </div>
      <div className="world-toolbar">
        <p className="world-caption">A living world of open questions. Choose a swarm to look inside.</p>
        <label className="world-area">Research area <select aria-label="Research area" onChange={(event) => setDomain(event.target.value as Area | 'all')} value={domain}><option value="all">All areas</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
      {props.error && <p className="error" role="status">{props.loading ? 'Could not load the world. ' : 'Showing the last received state. '}{props.error} Retrying…</p>}
      <div className="world-layout">
        <div className="world-landscape">
          <div className="world-coordinates"><span>OPEN RESEARCH / {scope === 'active' ? 'IN PROGRESS' : 'ARCHIVE'}</span><span>{props.error ? 'CONNECTION INTERRUPTED' : props.loading ? 'CONNECTING' : Api.fixture ? 'DEMO DATA / UPDATES EVERY 5 S' : 'REFRESHES EVERY 5 S'}</span></div>
          {props.loading && !props.error && <p className="world-empty" role="status">Connecting to the research world…</p>}
          {!props.loading && shown.length === 0 && <div className="world-empty"><p>{domain !== 'all' ? 'No swarms in this area yet.' : scope === 'active' ? 'The next open question starts here.' : 'Completed research will appear here.'}</p><Link className="btn btn-high" to="/new">Start a research swarm</Link></div>}
          <div aria-label={`${shown.length} research swarms`} className="world-habitats" role="group">
            {shown.map((swarm) => <button aria-controls="world-observatory" aria-label={`${swarm.title}, ${swarm.status}, ${swarm.workers} explorers, ${swarm.machines} machines`} aria-pressed={current?.id === swarm.id} className="world-habitat" data-area={area(swarm).id} data-status={swarm.status} key={swarm.id} onClick={() => select(swarm.id)} type="button"><Habitat selected={current?.id === swarm.id} swarm={swarm} /><span className="habitat-name">{swarm.title}</span><span className="habitat-label">{area(swarm).label}</span><Status status={swarm.status} /></button>)}
          </div>
          <div className="world-legend"><span><i className="legend-explorer" /> Explorer</span><span><i className="legend-machine" /> Machine</span><span>{shown.length} swarms in view</span></div>
        </div>
        <div id="world-observatory">{current ? <Observatory key={current.id} now={props.now} swarm={current} /> : <aside className="observatory observatory-empty"><p className="label">The observatory</p><h3>Follow a question into the unknown.</h3><p>Fund the work, contribute a machine, or read what others have found. Every swarm has its own public research record.</p></aside>}</div>
      </div>
      <p className="world-footnote">Areas are inferred from titles and briefs. Running describes execution; completed means the swarm reported it was done. Findings remain open to scrutiny.</p>
    </section>
  )
}
