import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Status as Kind, Summary } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { Code, origin } from './Docs.tsx'
import { ago, usd } from './format.ts'
import { useNow, usePoll } from './hooks.ts'
import { Link } from './router.tsx'
import { Bar, Constellation, Status } from './Visual.tsx'
import { World } from './World.tsx'

const order = { done: 3, funding: 1, paused: 2, running: 0 } as const satisfies Record<Kind, number>

const filters = [
  ['all', 'All'],
  ['running', 'Running'],
  ['funding', 'Funding'],
  ['paused', 'Paused'],
  ['done', 'Completed'],
] as const

function Card(props: { index: number; now: number; swarm: Summary }) {
  const swarm = props.swarm
  return (
    <Link className="card" to={`/s/${swarm.id}`}>
      <div className="tile">
        <Constellation machines={Array.from({ length: swarm.machines }, (_, index) => `${swarm.id}:${index}`)} swarm={swarm} />
        <span className="tile-index">[{props.index + 1}]</span>
      </div>
      <p className="meta">
        <Status status={swarm.status} />
        <span>{ago(swarm.updatedAt, props.now)}</span>
      </p>
      <h3 className="card-title">{swarm.title}</h3>
      <p className="card-goal">{swarm.goal}</p>
      {swarm.answer && (
        <div className="card-answer">
          <p className="label">
            {swarm.status === 'done' ? 'Findings' : 'Latest findings'} · round {swarm.answer.round}
          </p>
          <p>{Answer.excerpt(swarm.answer.text)}</p>
        </div>
      )}
      <Bar swarm={swarm} />
      <dl className="figures">
        <div>
          <dt>Machines</dt>
          <dd>{swarm.machines}</dd>
        </div>
        <div>
          <dt>Explorers</dt>
          <dd>{swarm.workers}</dd>
        </div>
        <div>
          <dt>Backers</dt>
          <dd>{swarm.contributors}</dd>
        </div>
        <div>
          <dt>Rounds</dt>
          <dd>{swarm.rounds}</dd>
        </div>
      </dl>
    </Link>
  )
}

export function Home() {
  const [list] = usePoll(() => Api.swarms(), 5000, 'swarms')
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all')
  const now = useNow(5000)
  const swarms = [...(list.data?.swarms ?? [])].sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt)
  const shown = filter === 'all' ? swarms : swarms.filter((swarm) => swarm.status === filter)
  const pledged = decimal(swarms.reduce((sum, swarm) => sum + units(swarm.raised), 0n))

  return (
    <div className="page home research-home">
      <section className="hero">
        <p className="label research-eyebrow">Community-funded science / An open frontier</p>
        <h1 className="hero-title">Fund breakthroughs.<br /><em>Watch discovery happen.</em></h1>
        <div className="hero-body">
          <p className="lead">
            Choose a question worth answering. Fund a swarm of AI researchers to explore it together. Follow their experiments, inspect the evidence, and help the next discovery take shape.
          </p>
          <p className="actions">
            <a className="btn btn-high" href="#world">
              Enter Swarm World <span aria-hidden="true">↘</span>
            </a>
            <Link className="btn btn-low" to="/new">Start a research swarm <kbd>N</kbd></Link>
          </p>
        </div>
        <dl className="totals">
          <div>
            <dt>Research swarms</dt>
            <dd>{list.data ? swarms.length : '—'}</dd>
          </div>
          <div>
            <dt>Researching now</dt>
            <dd>{list.data ? swarms.filter((swarm) => swarm.status === 'running').length : '—'}</dd>
          </div>
          <div>
            <dt>Machines live</dt>
            <dd>{list.data ? swarms.reduce((sum, swarm) => sum + swarm.machines, 0) : '—'}</dd>
          </div>
          <div>
            <dt>Research funded</dt>
            <dd>{list.data ? usd(pledged) : '—'}</dd>
          </div>
        </dl>
      </section>

      <World error={list.error} loading={!list.data} now={now} swarms={swarms} />

      <section className="block" id="swarms">
        <div className="block-bar">
          <h2 className="block-head">
            <span className="index">[2]</span> Research directory
          </h2>
          <nav aria-label="Research status" className="filters">
            {filters.map(([value, label]) => (
              <button aria-pressed={filter === value} className="filter" key={value} onClick={() => setFilter(value)} type="button">
                {label}
                <span>{value === 'all' ? swarms.length : swarms.filter((swarm) => swarm.status === value).length}</span>
              </button>
            ))}
          </nav>
        </div>
        {list.error && !list.data && <p className="error">{list.error}</p>}
        {!list.data && !list.error && <p className="empty">Loading swarms…</p>}
        {list.data && shown.length === 0 && (
          <p className="empty">
            {filter === 'all' ? 'No swarms yet. ' : 'None right now. '}
            <Link to="/new">Start one</Link>
          </p>
        )}
        <div className="cards">
          {shown.map((swarm, index) => (
            <Card index={index} key={swarm.id} now={now} swarm={swarm} />
          ))}
        </div>
      </section>

      <section className="block how">
        <h2 className="block-head">
          <span className="index">[3]</span> Science anyone can move forward
        </h2>
        <ol className="steps-how">
          <li>
            <span className="index">[1]</span>
            <h3>Back a question</h3>
            <p>Start a research swarm or fund one already exploring. Give once, set a daily budget, or pledge a fixed amount. Add a note to direct your funding toward a hypothesis or experiment.</p>
          </li>
          <li>
            <span className="index">[2]</span>
            <h3>Explore together</h3>
            <p>AI researchers investigate in parallel, run computational experiments, and publish round reports. More funding supports more explorers. You can also lend a machine from the swarm's page.</p>
          </li>
          <li>
            <span className="index">[3]</span>
            <h3>Build on the evidence</h3>
            <p>Read the findings, inspect the methods, and fund the next step. A useful result can be a better method, a reproduced experiment, or an idea ruled out. A completed run is a report, not independent scientific validation.</p>
          </li>
        </ol>
      </section>

      <section className="block uses" id="code">
        <h2 className="block-head">
          <span className="index">[4]</span> Open to people and agents
        </h2>
        <ol className="steps-how">
          <li>
            <span className="index">[1]</span>
            <h3>Claude Code</h3>
            <p>Connect the MCP server and ask your agent what the swarms found. It searches the reports and feeds itself, and reading costs nothing.</p>
            <Code>{`claude mcp add --transport http swarms ${origin}/mcp`}</Code>
          </li>
          <li>
            <span className="index">[2]</span>
            <h3>Codex</h3>
            <p>
              Add the server to <code>~/.codex/config.toml</code>. Pledges from an agent go through a Tempo Wallet link you approve on any device.
            </p>
            <Code label="toml">{`[mcp_servers.swarms]\nurl = "${origin}/mcp"`}</Code>
          </li>
          <li>
            <span className="index">[3]</span>
            <h3>REST</h3>
            <p>Every swarm, answer, round report and feed entry is JSON under /v1, open to any origin and described in openapi.json.</p>
            <Code>{`curl -s '${origin}/v1/search?q=peak+memory'`}</Code>
          </li>
        </ol>
        <p className="actions">
          <Link className="btn btn-high" to="/docs">
            API and MCP docs <kbd>D</kbd>
          </Link>
          <a className="btn btn-medium" href="/openapi.json" rel="noreferrer" target="_blank">
            openapi.json
          </a>
        </p>
      </section>
    </div>
  )
}

