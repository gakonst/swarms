import { useEffect, useState } from 'react'
import type * as Tree from '../shared/Tree.ts'
import { scene } from './stage.ts'
import { fixture } from './api.ts'
import { ago, spent, usd } from './format.ts'
import * as Grove from './grove.ts'
import { Inline } from './Markdown.tsx'
import { Link, useBase } from './router.tsx'

export type Last = { check: Tree.Check; node: string; title: string }

function count(value: number) {
  return value.toLocaleString('en-US')
}

function dollars(value: string) {
  const number = Number(value)
  return number >= 100 ? `$${Math.round(number).toLocaleString('en-US')}` : usd(value)
}

export function Growth(props: { burn: Tree.Burn | undefined; headline: Tree.Headline; now: number }) {
  const head = props.headline
  const points = [...(props.burn ?? [])]
  const tail = points.at(-1)
  if (!tail || head.proven !== tail.proven || head.deadEnds !== tail.deadEnds) points.push({ at: Math.max(props.now, (tail?.at ?? 0) + 1), deadEnds: head.deadEnds, proven: head.proven, spent: tail?.spent ?? '0' })
  const first = points[0]?.at ?? 0
  const span = Math.max(1, (points.at(-1)?.at ?? 1) - first)
  const unit = Math.min(22 / Math.max(1, ...points.map((point) => point.proven)), 10 / Math.max(1, ...points.map((point) => point.deadEnds)))
  const x = (at: number) => 2 + ((at - first) / span) * 196
  const steps = (value: (point: Tree.Burn[number]) => number, sign: number) => points.map((point, index) => `${index ? 'H' : 'M'}${x(point.at).toFixed(1)}${index ? '' : ',24'}V${(24 - sign * value(point) * unit).toFixed(1)}`).join('') + 'H200'
  const up = steps((point) => point.proven, 1)
  const down = steps((point) => point.deadEnds, -1)
  return (
    <svg aria-label={`${head.proven} proven and ${head.deadEnds} dead ends over time, ${head.inFlight} in flight now`} className="growth" role="img" viewBox="0 0 208 36">
      <path className="growth-up" d={`${up}V24H2Z`} />
      <path className="growth-down" d={`${down}V24H2Z`} />
      <path className="growth-line" d={up} />
      <line className="growth-base" x1="2" x2="200" y1="24" y2="24" />
      {head.inFlight > 0 && <circle className="growth-now" cx="203" cy="24" r="3" />}
    </svg>
  )
}

export function Headline(props: { burn: Tree.Burn | undefined; headline: Tree.Headline; id: string; last: Last | undefined; now: number }) {
  const head = props.headline
  const base = useBase(props.id)
  return (
    <header className="headline" aria-label="Progress">
      <div className="headline-line">
        <p className="headline-stats">
          <span><b>{count(head.proven)}</b> proven</span>
          <span><b>{count(head.frontier)}</b> on the frontier</span>
          <span data-live={head.inFlight > 0 || undefined}><b>{count(head.inFlight)}</b> in flight</span>
          <span><b>{count(head.deadEnds)}</b> dead ends</span>
          <span><b>{spent(head.spent)}</b> spent{head.perProven && <>, {dollars(head.perProven)} a proof</>}</span>
        </p>
        <Growth burn={props.burn} headline={head} now={props.now} />
      </div>
      <p className="headline-last">
        {props.last ? (
          <>
            Last proven <Link keep to={`${base}/t/${props.last.node}`}><Inline text={props.last.title} /></Link> · {ago(props.last.check.at, props.now)} · <a href={props.last.check.url} rel="noreferrer" target="_blank">checked record ↗</a>
          </>
        ) : head.proven > 0 ? 'Checked by Lean' : 'Nothing proven yet. Lean decides what is proven.'}
      </p>
    </header>
  )
}

function visited(id: string) {
  return `swarms.visit${fixture ? '.fixture' : ''}.${id}`
}

export function Since(props: { id: string; nodes: Readonly<Record<string, Tree.Node>>; now: number }) {
  const base = useBase(props.id)
  const [last, setLast] = useState<number>()
  useEffect(() => {
    let before: number | undefined
    try {
      const saved = Number(localStorage.getItem(visited(props.id)))
      before = fixture && scene.has('visit') ? Date.now() - 26 * 3_600_000 : saved > 0 ? saved : undefined
    } catch {}
    setLast(before)
    const leave = () => {
      if (document.visibilityState === 'hidden')
        try {
          localStorage.setItem(visited(props.id), String(Date.now()))
        } catch {}
    }
    document.addEventListener('visibilitychange', leave)
    addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', leave)
      removeEventListener('pagehide', leave)
    }
  }, [props.id])
  if (last === undefined) return null
  const changed = Grove.since(props.nodes, last)
  if (!changed.proven.length && !changed.dead.length && !changed.posted.length) return null
  const dismiss = () => {
    try {
      localStorage.setItem(visited(props.id), String(Date.now()))
    } catch {}
    setLast(undefined)
  }
  return (
    <aside aria-label="Since your last visit" className="since">
      <p className="since-head"><b>Since your last visit</b> {ago(last, props.now)}</p>
      <p className="since-counts">{changed.proven.length} proven · {changed.dead.length} dead ends · {changed.posted.length} new</p>
      <ul>
        {[...changed.proven, ...changed.dead].slice(0, 3).map((node) => (
          <li key={node.id}><Link keep to={`${base}/t/${node.id}`}>{node.status === 'proven' ? '● ' : '⊘ '}<Inline text={node.title} /></Link></li>
        ))}
      </ul>
      <button className="since-close" onClick={dismiss} type="button">Got it</button>
    </aside>
  )
}
