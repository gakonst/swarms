import { useEffect, useMemo, useRef, useState } from 'react'
import type { Entry, Hand, Lent } from '../shared/Api.ts'
import { fleet, readable, type Line, type Listed, type Machine, type Shown } from '../shared/Fleet.ts'
import * as Api from './api.ts'
import { ago, clock, duration, usd } from './format.ts'
import { useNow, usePoll } from './hooks.ts'
import * as Wire from './wire.ts'

const lentMs = { down: 15_000, live: 60_000 }

const servedMs = { idle: 60_000, working: 10_000 }

const kinds = { browser: 'Browser', hand: 'Lent machine', sandbox: 'Sandbox' } as const

const streams = ['all', 'system', 'stdout', 'stderr'] as const

function summary(machine: Machine) {
  if (machine.kind === 'hand') return machine.label ? `Lent · ${machine.label}` : 'Lent by a backer'
  const pick = (name: string) => machine.config.find(([key]) => key === name)?.[1]
  return [pick('Image'), pick('CPU') && `${pick('CPU')} CPU`, pick('Memory'), pick('GPU'), pick('Minutes') && `${pick('Minutes')} min`].filter(Boolean).join(' · ') || kinds[machine.kind]
}

function took(ms: number) {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return duration(ms)
}

function failure(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function Command(props: { run: Machine['commands'][number] }) {
  const [open, setOpen] = useState(false)
  const run = props.run
  return (
    <li className="run" data-failed={run.failed} data-open={open}>
      <button disabled={!run.output} onClick={() => setOpen(!open)} type="button">
        <time>{clock(run.at)}</time>
        <code>{run.text.startsWith('$ ') ? run.text : `› ${run.text}`}</code>
        {run.who && <span className="run-who">{run.who}</span>}
      </button>
      {open && run.output && <pre>{readable(run.output)}</pre>}
    </li>
  )
}

function Job(props: { machine: string; seq: number; swarm: string }) {
  const [job, setJob] = useState<Awaited<ReturnType<typeof Api.job>>>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const load = () => {
    setBusy(true)
    Api.job(props.swarm, props.machine, props.seq)
      .then((found) => {
        setJob(found)
        setError(undefined)
      })
      .catch((caught: unknown) => setError(failure(caught)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="run-job">
      <button className="machine-link" disabled={busy} onClick={load} type="button">
        {busy ? 'Reading the job log…' : job ? 'Read it again' : "Read this job's log"}
      </button>
      {error && <p className="run-note">{error}</p>}
      {job && (
        <>
          <p className="run-note">
            {job.log} · {job.done ? (job.exit === null ? 'finished' : `exited ${job.exit}`) : 'still running'}
            {job.error ? ` · ${job.error}` : ''}
          </p>
          <pre>{job.data || 'Nothing logged yet.'}</pre>
        </>
      )}
    </div>
  )
}

function Ran(props: { machine: string; run: Listed; swarm: string }) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<Shown>()
  const [error, setError] = useState<string>()
  const run = props.run
  const toggle = () => {
    setOpen(!open)
    if (open || shown) return
    Api.command(props.swarm, props.machine, run.seq)
      .then(setShown)
      .catch((caught: unknown) => setError(failure(caught)))
  }
  const ms = shown?.ms ?? run.ms
  return (
    <li className="run" data-failed={run.failed} data-open={open}>
      <button onClick={toggle} type="button">
        <time>{clock(run.at)}</time>
        <code>{run.text.startsWith('$ ') ? run.text : `› ${run.text}`}</code>
        <span className="run-meta">
          {run.who && <span className="run-who">{run.who}</span>}
          {run.exit !== null && <span className="run-exit" data-failed={run.exit !== 0}>exit {run.exit}</span>}
          {ms !== null && <span className="run-ms">{took(ms)}</span>}
        </span>
      </button>
      {open && (
        <div className="run-open">
          {error && <p className="run-note">{error}</p>}
          {!shown && !error && <p className="run-note">Loading its output…</p>}
          {shown && (
            <>
              <pre>{shown.output ? readable(shown.output) : 'No output.'}</pre>
              {shown.truncated && <p className="run-note">The feed kept the first 2,000 characters of this output, and the agent's session no longer has the rest.</p>}
              {shown.source === 'gateway' && run.clipped && <p className="run-note">Whole output, from the agent's session at the gateway.</p>}
            </>
          )}
          {run.log && <Job machine={props.machine} seq={run.seq} swarm={props.swarm} />}
        </div>
      )}
    </li>
  )
}

function Commands(props: { count: number; machine: string; swarm: string }) {
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest')
  const [runs, setRuns] = useState<Listed[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const asked = useRef(0)
  const load = (cursor: number | undefined, kept: Listed[]) => {
    const ask = ++asked.current
    setBusy(true)
    Api.commands(props.swarm, props.machine, { cursor, order })
      .then((page) => {
        if (ask !== asked.current) return
        setRuns([...kept, ...page.commands])
        setNext(page.next)
        setError(undefined)
      })
      .catch((caught: unknown) => ask === asked.current && setError(failure(caught)))
      .finally(() => ask === asked.current && setBusy(false))
  }
  useEffect(() => {
    load(undefined, [])
  }, [order, props.count])
  if (!props.count) return <p className="machine-none">Nothing has run here yet.</p>
  return (
    <>
      <div className="machine-bar">
        <span>{props.count} command{props.count === 1 ? '' : 's'}</span>
        <button className="machine-link" onClick={() => setOrder(order === 'newest' ? 'oldest' : 'newest')} type="button">
          {order === 'newest' ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
      {error && <p className="run-note">{error}</p>}
      <ol className="runs">
        {runs.map((run) => (
          <Ran key={run.seq} machine={props.machine} run={run} swarm={props.swarm} />
        ))}
      </ol>
      {next !== null && (
        <button className="machine-more" disabled={busy} onClick={() => load(next, runs)} type="button">
          {busy ? 'Loading…' : `Show more (${props.count - runs.length} left)`}
        </button>
      )}
    </>
  )
}

function Logs(props: { machine: string; sandboxes: string[]; swarm: string }) {
  const [open, setOpen] = useState(false)
  const [sandbox, setSandbox] = useState(props.sandboxes.at(-1))
  const [lines, setLines] = useState<Line[]>([])
  const [state, setState] = useState<{ complete: boolean; error: string | null; fetchedAt: number | null; next: string | null }>()
  const [stream, setStream] = useState<(typeof streams)[number]>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const load = (before: string | undefined, kept: Line[], picked = sandbox) => {
    setBusy(true)
    Api.machineLogs(props.swarm, props.machine, { before, sandbox: picked })
      .then((found) => {
        setLines([...found.lines, ...kept])
        setState({ complete: found.complete, error: found.error, fetchedAt: found.fetchedAt, next: found.next })
        setError(undefined)
      })
      .catch((caught: unknown) => setError(failure(caught)))
      .finally(() => setBusy(false))
  }
  if (!open)
    return (
      <button
        className="machine-link"
        onClick={() => {
          setOpen(true)
          load(undefined, [])
        }}
        type="button"
      >
        Show the machine's log
      </button>
    )
  const shown = stream === 'all' ? lines : lines.filter((line) => line.stream === stream)
  return (
    <div className="machine-log">
      <div className="machine-bar">
        <span>Machine log</span>
        {props.sandboxes.length > 1 && (
          <select
            aria-label="Sandbox"
            onChange={(event) => {
              setSandbox(event.target.value)
              load(undefined, [], event.target.value)
            }}
            value={sandbox}
          >
            {props.sandboxes.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
        {streams.map((name) => (
          <button aria-pressed={stream === name} className="machine-link" key={name} onClick={() => setStream(name)} type="button">
            {name}
          </button>
        ))}
        <button className="machine-link" disabled={busy} onClick={() => load(undefined, [])} type="button">
          {busy ? 'Reading…' : 'Refresh'}
        </button>
      </div>
      {error && <p className="run-note">{error}</p>}
      {state?.next && (
        <button className="machine-more" disabled={busy} onClick={() => load(state.next ?? undefined, lines)} type="button">
          Show older lines
        </button>
      )}
      <pre className="machine-lines">{shown.length ? shown.map((line) => `${clock(line.at)} ${line.stream === 'system' ? '·' : line.stream === 'stderr' ? '!' : ' '} ${line.text.replace(/^\n+|\n+$/g, '')}`).join('\n') : busy ? 'Reading the log from the gateway…' : 'The gateway has no log lines for this machine.'}</pre>
      {state && (
        <p className="run-note">
          {state.complete ? 'This is the whole log; it will not change.' : state.fetchedAt ? `Read from the gateway ${ago(state.fetchedAt)}; the gateway keeps it 7 days after the machine ends.` : ''}
          {state.error ? ` The gateway answered: ${state.error}` : ''}
        </p>
      )}
    </div>
  )
}

function Row(props: { machine: Machine; now: number; onPick: () => void; open: boolean; served: boolean; swarm: string }) {
  const machine = props.machine
  const state = machine.connected ? 'on' : machine.failed ? 'failed' : machine.ended ? 'off' : 'idle'
  const up = machine.started ? (machine.ended ?? (machine.connected ? props.now : machine.started)) - machine.started : 0
  const runs = machine.runs?.count ?? machine.commands.length
  const status = machine.connected ? 'Online' : machine.failed ? 'Did not start' : machine.ended ? 'Stopped' : 'Offline'
  const earned = machine.kind === 'hand' && machine.charged && Number(machine.charged) > 0 ? `earned ${usd(machine.charged)}` : null
  return (
    <li data-open={props.open}>
      <button aria-expanded={props.open} className="tile-swarm machine-row" onClick={props.onPick} type="button">
        <i aria-hidden="true" className="machine-glyph" data-kind={machine.kind} data-state={state}>{machine.kind === 'browser' ? '◎' : machine.kind === 'hand' ? '⌂' : '▣'}</i>
        <span className="tile-title">{machine.name}</span>
        <span className="tile-raised machine-state" data-state={state}>{status}</span>
        <span className="machine-sub">{[summary(machine), machine.kind === 'hand' ? (machine.price ?? 'free') : null, earned, runs ? `${runs} command${runs === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</span>
      </button>
      {props.open && (
        <div className="machine-open">
          <dl className="machine-facts">
            <div><dt>Kind</dt><dd>{kinds[machine.kind]}</dd></div>
            <div><dt>State</dt><dd>{machine.connected ? 'Connected' : machine.failed ? `Did not start: ${machine.failed}` : machine.ended ? `Stopped ${ago(machine.ended, props.now)}` : 'Offline'}</dd></div>
            {machine.started && !machine.failed ? <div><dt>{machine.connected ? 'Up for' : 'Ran for'}</dt><dd>{duration(up)}</dd></div> : null}
            {machine.by && <div><dt>Started by</dt><dd>{machine.by}</dd></div>}
            {machine.config.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
            {machine.kind === 'hand' && <div><dt>Price</dt><dd>{machine.price ?? 'Free'}</dd></div>}
            {machine.kind === 'hand' && <div><dt>Paid to its owner</dt><dd>{usd(machine.charged ?? '0')}</dd></div>}
            {machine.requests !== null && <div><dt>Requests</dt><dd>{machine.requests}</dd></div>}
            {machine.runs && machine.runs.failed > 0 ? <div><dt>Failed commands</dt><dd>{machine.runs.failed}</dd></div> : null}
          </dl>
          {props.served && (
            <div className="machine-bar">
              {machine.sandboxes.length > 0 && <Logs machine={machine.name} sandboxes={machine.sandboxes} swarm={props.swarm} />}
              <a className="machine-link" download href={Api.exported(props.swarm, machine.name)}>
                Download everything about this machine
              </a>
            </div>
          )}
          {props.served && machine.runs ? (
            <Commands count={machine.runs.count} machine={machine.name} swarm={props.swarm} />
          ) : runs ? (
            <ol className="runs">{machine.commands.map((run) => <Command key={run.seq} run={run} />)}</ol>
          ) : (
            <p className="machine-none">Nothing has run here yet.</p>
          )}
        </div>
      )}
    </li>
  )
}

export function Machines(props: { entries: readonly Entry[]; hands: readonly Hand[]; live: boolean; swarm: string }) {
  const now = useNow(1000)
  const wired = Wire.useWire(props.swarm, 'room', (signal) => {
    if (!Wire.stirred(signal, 'hands')) return
    relend()
    reserve()
  })
  const mark = useMemo(() => props.entries.reduce((most, entry) => (entry.kind === 'machine' || entry.kind === 'tool' || entry.kind === 'output' ? Math.max(most, entry.seq) : most), 0), [props.entries])
  const read = useRef(mark)
  const [lent, relend] = usePoll(() => Api.hands(props.swarm), wired === 'down' ? lentMs.down : lentMs.live, `hands:${props.swarm}`)
  const [served, reserve] = usePoll(
    () => {
      read.current = mark
      return Api.machines(props.swarm)
    },
    wired === 'down' ? (props.live ? servedMs.working : servedMs.idle) : mark > read.current ? servedMs.working : null,
    `machines:${props.swarm}`,
  )
  const local = useMemo(() => fleet(props.entries, props.hands, lent.data?.hands ?? ([] as Lent[])), [props.entries, props.hands, lent.data])
  const remote = !!served.data?.machines.length
  const machines = remote ? (served.data?.machines ?? []) : local
  const [picked, setPicked] = useState<string>()

  if (!machines.length)
    return (
      <p className="machine-none">No machines yet. The agent starts them as it needs them, and anyone can lend one below.</p>
    )

  return (
    <>
      {remote && (
        <div className="machine-bar machine-all">
          <span>{machines.length} machine{machines.length === 1 ? '' : 's'} over the swarm's life</span>
          <a className="machine-link" download href={Api.exported(props.swarm)}>
            Download every machine's commands, outputs and logs
          </a>
        </div>
      )}
      <ol className="tiles-swarm machines-list">
        {machines.map((machine) => (
          <Row key={machine.name} machine={machine} now={now} onPick={() => setPicked(picked === machine.name ? undefined : machine.name)} open={picked === machine.name} served={remote} swarm={props.swarm} />
        ))}
      </ol>
    </>
  )
}
