import { useMemo, useRef, useState } from 'react'
import type { Entry, Hand, Lent } from '../shared/Api.ts'
import { fleet, type Machine } from '../shared/Fleet.ts'
import * as Api from './api.ts'
import { ago, clock, duration, usd } from './format.ts'
import { useNow, usePoll } from './hooks.ts'
import * as Wire from './wire.ts'

const lentMs = { down: 15_000, live: 60_000 }

const servedMs = { idle: 60_000, working: 10_000 }

const kinds = { browser: 'Browser', hand: 'Lent machine', sandbox: 'Sandbox' } as const

function summary(machine: Machine) {
  if (machine.kind === 'hand') return machine.label ? `Lent · ${machine.label}` : 'Lent by a backer'
  const pick = (name: string) => machine.config.find(([key]) => key === name)?.[1]
  return [pick('Image'), pick('CPU') && `${pick('CPU')} CPU`, pick('Memory'), pick('GPU'), pick('Minutes') && `${pick('Minutes')} min`].filter(Boolean).join(' · ') || kinds[machine.kind]
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
      {open && run.output && <pre>{run.output}</pre>}
    </li>
  )
}

function Row(props: { machine: Machine; now: number; onPick: () => void; open: boolean }) {
  const machine = props.machine
  const state = machine.connected ? 'on' : machine.failed ? 'failed' : machine.ended ? 'off' : 'idle'
  const up = machine.started ? (machine.ended ?? (machine.connected ? props.now : machine.started)) - machine.started : 0
  const runs = machine.commands.length
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
          </dl>
          {runs ? <ol className="runs">{machine.commands.map((run) => <Command key={run.seq} run={run} />)}</ol> : <p className="machine-none">Nothing has run here yet.</p>}
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
  const machines = served.data?.machines.length ? served.data.machines : local
  const [picked, setPicked] = useState<string>()

  if (!machines.length)
    return (
      <p className="machine-none">No machines yet. The agent starts them as it needs them, and anyone can lend one below.</p>
    )

  return (
    <ol className="tiles-swarm machines-list">
      {machines.map((machine) => (
        <Row key={machine.name} machine={machine} now={now} onPick={() => setPicked(picked === machine.name ? undefined : machine.name)} open={picked === machine.name} />
      ))}
    </ol>
  )
}
