import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Branch, Entry } from '../shared/Api.ts'
import * as Trace from '../shared/Trace.ts'
import * as Api from './api.ts'
import { clock, day } from './format.ts'
import { agent, speaker, useLive, useNow, useVisible } from './hooks.ts'

const first = 60

const far = 2_000_000_000

const marks = { error: '!', funds: '$', machine: '▣', message: '❯', output: '‹', status: '·', steer: '➤', thinking: '∴', tool: '›' } as const

function named(who: string | null) {
  return who ?? 'lead'
}

type Kept = { earlier: boolean; entries: readonly Entry[]; tip: number }

function Trail(props: { following: boolean; id: string; kept: Map<string, Kept>; stir: number; who: string | undefined }) {
  const { id, who } = props
  const held = props.kept.get(who ?? '')
  const [entries, setEntries] = useState<readonly Entry[] | undefined>(held?.entries)
  const [earlier, setEarlier] = useState(held?.earlier ?? false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<number>()
  const [tries, setTries] = useState(0)
  const now = useNow(60_000)
  const tip = useRef(held?.tip ?? 0)
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const anchor = useRef<number | undefined>(undefined)
  const filled = useRef(0)

  const merge = useCallback(
    (list: readonly Entry[]) => {
      for (const entry of list) tip.current = Math.max(tip.current, entry.seq)
      setEntries((held = []) => {
        const seen = new Set(held.map((entry) => entry.seq))
        const fresh = list.filter((entry) => entry.seq > 0 && !seen.has(entry.seq) && (who === undefined || speaker(entry.who) === who))
        return fresh.length ? [...held, ...fresh].sort((a, b) => a.seq - b.seq) : held
      })
    },
    [who],
  )

  useEffect(() => {
    let alive = true
    setFailed(false)
    const known = props.kept.get(who ?? '')
    const read = known
      ? Api.feed(id, known.tip, who === undefined ? {} : { who }).then((page) => merge(page.entries))
      : Promise.all([Api.feed(id, 0, { before: far, limit: first, ...(who === undefined ? {} : { who }) }), who === undefined ? undefined : Api.feed(id, 0, { before: far, limit: 1 })]).then(([page, newest]) => {
          if (!alive) return
          tip.current = Math.max(tip.current, page.next, newest?.next ?? 0)
          setEarlier(page.entries.length >= first)
          merge(page.entries)
        })
    read.catch(() => alive && !known && setFailed(true))
    return () => {
      alive = false
    }
  }, [id, who, tries])

  useEffect(() => {
    if (entries) props.kept.set(who ?? '', { earlier, entries, tip: tip.current })
  }, [entries, earlier])

  const loaded = entries !== undefined
  useEffect(() => {
    if (!props.stir || !loaded) return
    let alive = true
    Api.feed(id, tip.current, who === undefined ? {} : { who }).then(
      (page) => alive && merge(page.entries),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [props.stir, loaded])

  const live = useLive(id, props.following && loaded, (entry) => merge([entry]), () => tip.current)

  const back = useCallback(() => {
    const oldest = entries?.[0]?.seq
    if (busy || oldest === undefined) return
    setBusy(true)
    Api.feed(id, 0, { before: oldest, ...(who === undefined ? {} : { who }) })
      .then(
        (page) => {
          const element = box.current
          anchor.current = element ? element.scrollHeight - element.scrollTop : undefined
          setEarlier(page.entries.length >= 200)
          merge(page.entries)
        },
        () => undefined,
      )
      .finally(() => setBusy(false))
  }, [busy, entries, id, merge, who])

  const rows = useMemo(() => Trace.rows(entries ?? []), [entries])

  useEffect(() => {
    if (!loaded || busy || !earlier || rows.length >= 12 || filled.current >= 3) return
    filled.current += 1
    back()
  }, [loaded, busy, earlier, rows.length])

  const streams = live.at === 'live' ? Object.entries(live.streams).filter(([name, stream]) => (who === undefined || name === who) && (stream.thinking || stream.text || stream.input)) : []
  const writing = streams.map(([, stream]) => stream.thinking.length + stream.text.length + stream.input.length).join()

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    if (anchor.current !== undefined) {
      element.scrollTop = element.scrollHeight - anchor.current
      anchor.current = undefined
    } else if (pinned.current) element.scrollTop = element.scrollHeight
  }, [rows, writing, open])

  return (
    <div
      aria-busy={!loaded && !failed}
      className="traces-box"
      onScroll={(event) => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
      }}
      ref={box}
    >
      {failed ? (
        <button className="traces-note" onClick={() => setTries((count) => count + 1)} type="button">Can't load the traces. Try again ↻</button>
      ) : loaded && !rows.length && !streams.length ? (
        <p className="traces-note">{who === undefined ? 'Nothing yet. Every step the agents take shows up here.' : 'Nothing from this agent yet.'}</p>
      ) : null}
      {earlier && rows.length > 0 && <button className="traces-earlier" disabled={busy} onClick={back} type="button">{busy ? 'Loading…' : 'Earlier'}</button>}
      <ol className="trace-rows">
        {rows.map((row) => (
          <li data-kind={row.kind} data-open={open === row.seq || undefined} key={row.seq}>
            <button aria-expanded={open === row.seq} onClick={() => setOpen(open === row.seq ? undefined : row.seq)} title={`${day(row.at, now)} ${clock(row.at)}`} type="button">
              <time>{clock(row.at).slice(0, 5)}</time>
              <b>{named(row.who)}</b>
              <i aria-hidden="true">{marks[row.kind]}</i>
              <span>{row.text}</span>
              {row.count > 1 && <em>×{row.count.toLocaleString('en-US')}</em>}
            </button>
            {open === row.seq && <pre>{Trace.shown(row)}</pre>}
          </li>
        ))}
      </ol>
      {streams.map(([name, stream]) => (
        <p className="trace-live" data-channel={stream.thinking ? 'thinking' : stream.text ? 'text' : 'input'} key={name}>
          <b>{name === agent ? 'lead' : name}</b>
          <span>{stream.thinking || stream.text || stream.input}<i aria-hidden="true" className="trace-caret" /></span>
        </p>
      ))}
    </div>
  )
}

export function Traces(props: { branches: readonly Branch[] | undefined; id: string; running: boolean; stalled: boolean; stir: number; visible: boolean }) {
  const [who, setWho] = useState<string>()
  const kept = useRef(new Map<string, Kept>()).current
  const shown = useVisible()
  const crew = (props.branches ?? []).filter((branch) => branch.parent === null)
  const chip = (to: string | undefined, label: string, quiet = false) => (
    <button aria-pressed={who === to} data-quiet={quiet || undefined} key={to ?? ''} onClick={() => setWho(to)} type="button">{label}</button>
  )
  return (
    <section aria-labelledby="traces-title" className="traces">
      <header className="traces-head">
        <h2 id="traces-title">Traces</h2>
        <span className="traces-state" data-mood={props.running ? (props.stalled ? 'stalled' : 'live') : 'idle'}>{props.running ? (props.stalled ? 'Stalled' : 'Live') : 'Idle'}</span>
        {crew.length > 0 && (
          <nav aria-label="Agent" className="traces-who">
            {chip(undefined, 'All')}
            {chip(agent, 'lead')}
            {crew.map((branch) => chip(branch.who, branch.who, branch.state !== 'pending' && branch.state !== 'running'))}
          </nav>
        )}
      </header>
      <Trail following={props.running && props.visible && shown} id={props.id} kept={kept} key={who ?? ''} stir={props.stir} who={who} />
    </section>
  )
}
