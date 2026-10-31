import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import * as Api from './api.ts'
import { usd } from './format.ts'
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

function Observatory(props: { swarm: Summary }) {
  const swarm = props.swarm
  return (
    <aside aria-label="Selected research swarm" className="observatory">
      <div aria-atomic="true" aria-live="polite" className="observatory-selection">
        <p className="label">{area(swarm).label}</p>
        <h3>{swarm.title}</h3>
        <p className="meta"><Status status={swarm.status} /></p>
      </div>
      <dl className="game-metrics">
        <div><dt>Round</dt><dd>{swarm.rounds}</dd></div>
        <div><dt>Researchers</dt><dd>{swarm.workers}</dd></div>
        <div><dt>Fuel left</dt><dd>{usd(swarm.remaining)}</dd></div>
      </dl>
      <div className="observatory-finding">
        <p className="label">{swarm.answer ? `Field note · round ${swarm.answer.round}` : 'Next discovery'}</p>
        <p>{swarm.answer ? Answer.excerpt(swarm.answer.text, 140) : swarm.status === 'running' ? 'The team is on the case.' : 'A little fuel starts the adventure.'}</p>
      </div>
      <p className="actions">
        <Link className="btn btn-high" to={`/s/${swarm.id}`}>Enter quest <span aria-hidden="true">→</span></Link>
        {swarm.status !== 'done' && <Link className="btn btn-low" to={`/s/${swarm.id}?view=fund`}>Add fuel</Link>}
      </p>
      <details className="game-details"><summary>The question</summary><p>{swarm.goal}</p><Bar swarm={swarm} /></details>
    </aside>
  )
}

export function World(props: { error: string | undefined; loading: boolean; swarms: Summary[] }) {
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
        <h2 className="block-head" id="world-heading">Swarm World</h2>
        <nav aria-label="World view" className="filters">
          <button aria-pressed={scope === 'active'} className="filter" onClick={() => setScope('active')} type="button">Exploring <span>{props.swarms.filter((swarm) => swarm.status !== 'done').length}</span></button>
          <button aria-pressed={scope === 'done'} className="filter" onClick={() => setScope('done')} type="button">Completed <span>{props.swarms.filter((swarm) => swarm.status === 'done').length}</span></button>
        </nav>
      </div>
      <div className="world-toolbar">
        <p className="world-caption">Pick an expedition.</p>
        <label className="world-area"><select aria-label="Research area" onChange={(event) => setDomain(event.target.value as Area | 'all')} value={domain}><option value="all">All fields</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
      {props.error && <p className="error" role="status">{props.loading ? 'Could not load the world. ' : 'Showing the last received state. '}{props.error} Retrying…</p>}
      <div className="world-layout">
        <div className="world-landscape">
          <div className="world-coordinates"><span>{scope === 'active' ? 'THE FRONTIER' : 'THE ARCHIVE'}</span><span>{props.error ? 'RECONNECTING' : props.loading ? 'CONNECTING' : Api.fixture ? 'DEMO WORLD' : 'LIVE WORLD'}</span></div>
          {props.loading && !props.error && <p className="world-empty" role="status">Connecting to the research world…</p>}
          {!props.loading && shown.length === 0 && <div className="world-empty"><p>{domain !== 'all' ? 'No swarms in this area yet.' : scope === 'active' ? 'The next open question starts here.' : 'Completed research will appear here.'}</p><Link className="btn btn-high" to="/new">Start a research swarm</Link></div>}
          <div aria-label={`${shown.length} research swarms`} className="world-habitats" role="group">
            {shown.map((swarm) => <button aria-controls="world-observatory" aria-label={`${swarm.title}, ${swarm.status}, ${swarm.workers} explorers, ${swarm.machines} machines`} aria-pressed={current?.id === swarm.id} className="world-habitat" data-area={area(swarm).id} data-status={swarm.status} key={swarm.id} onClick={() => select(swarm.id)} type="button"><span className="outpost-round">{swarm.status === 'done' ? '✓' : `R${swarm.rounds || 1}`}</span><Habitat selected={current?.id === swarm.id} swarm={swarm} /><span className="habitat-name">{swarm.title}</span><Status status={swarm.status} /></button>)}
          </div>
          <div className="world-legend"><span><i className="legend-explorer" /> Explorer</span><span><i className="legend-machine" /> Machine</span><span>{shown.length} swarms in view</span></div>
        </div>
        <div id="world-observatory">{current ? <Observatory key={current.id} swarm={current} /> : <aside className="observatory observatory-empty"><p className="label">Your next quest</p><h3>Every discovery starts with a question.</h3><Link className="btn btn-high" to="/new">Start exploring →</Link></aside>}</div>
      </div>
      <details className="game-details world-about"><summary>How to play</summary><p>Pick a question. Fund the team. Follow what they find.</p><p>Fuel pays for real research. Completed means the team reported a result; findings remain open to review. Fields are inferred from the brief.</p></details>
    </section>
  )
}
