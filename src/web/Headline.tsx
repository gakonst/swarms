import { useEffect, useState } from 'react'
import type * as Tree from '../shared/Tree.ts'
import { scene } from './stage.ts'
import { fixture } from './api.ts'
import { ago, usd } from './format.ts'
import * as Grove from './grove.ts'
import { Link } from './router.tsx'

export type Last = { check: Tree.Check; node: string; title: string }

function count(value: number) {
  return value.toLocaleString('en-US')
}

function dollars(value: string) {
  const number = Number(value)
  return number >= 100 ? `$${Math.round(number).toLocaleString('en-US')}` : usd(value)
}

export function Spark(props: { burn: Tree.Burn | undefined; proven: number; now: number }) {
  const points = [...(props.burn ?? [])]
  const tail = points.at(-1)
  if (!tail || props.proven > tail.proven) points.push({ at: Math.max(props.now, (tail?.at ?? 0) + 1), deadEnds: tail?.deadEnds ?? 0, proven: props.proven, spent: tail?.spent ?? '0' })
  const first = points[0]?.at ?? 0
  const span = Math.max(1, (points.at(-1)?.at ?? 1) - first)
  const top = Math.max(1, ...points.map((point) => point.proven))
  const line = points.map((point) => `${((point.at - first) / span) * 116 + 2},${26 - (point.proven / top) * 22}`).join(' ')
  return (
    <svg aria-label={`${props.proven} proven over time`} className="spark" role="img" viewBox="0 0 120 28">
      <polyline points={points.length > 1 ? line : '2,26 118,26'} />
    </svg>
  )
}

export function Headline(props: { burn: Tree.Burn | undefined; headline: Tree.Headline; id: string; last: Last | undefined; now: number }) {
  const head = props.headline
  return (
    <header className="headline" aria-label="Progress">
      <div className="headline-line">
        <p className="headline-stats">
          <span><b>{count(head.proven)}</b> proven</span>
          <span><b>{count(head.frontier)}</b> on the frontier</span>
          <span data-live={head.inFlight > 0 || undefined}><b>{count(head.inFlight)}</b> in flight</span>
          <span><b>{count(head.deadEnds)}</b> dead ends</span>
          <span><b>{dollars(head.spent)}</b> spent{head.perProven && <>, {dollars(head.perProven)} a proof</>}</span>
        </p>
        <Spark burn={props.burn} now={props.now} proven={head.proven} />
      </div>
      <p className="headline-last">
        {props.last ? (
          <>
            Last proven <Link keep to={`/s/${encodeURIComponent(props.id)}/n/${props.last.node}`}>{props.last.title}</Link> · {ago(props.last.check.at, props.now)} · <a href={props.last.check.url} rel="noreferrer" target="_blank">checked record ↗</a>
          </>
        ) : head.proven > 0 ? 'Checked by Lean' : 'Nothing proven yet. Lean decides what is proven.'}
      </p>
    </header>
  )
}

export function Program(props: { id: string; node: Tree.Node; nodes: Readonly<Record<string, Tree.Node>>; now: number; selected: boolean }) {
  const node = props.node
  const state = Grove.state(props.nodes, node.id)
  return (
    <Link className="program" data={{ 'data-selected': String(props.selected) }} keep to={`/s/${encodeURIComponent(props.id)}/n/${node.id}`}>
      <b className="program-title">{node.title}</b>
      <span className="program-counts">{node.counts.proven} proven · {node.counts['in flight']} in flight · {node.counts['dead end']} dead ends</span>
      <span className="program-line" title={state.last ? state.last.node.title : undefined}><i>Last</i>{state.last ? `${state.last.word}: ${state.last.node.title}, ${ago(state.last.at, props.now)}` : 'Nothing settled yet'}</span>
      <span className="program-line" title={state.blocker ?? undefined}><i>Blocker</i>{state.blocker ?? 'None'}</span>
      <span className="program-line"><i>{state.working ? 'Working' : 'Next'}</i>{state.working?.title ?? state.next ?? 'Propose a lemma'}</span>
    </Link>
  )
}

export function Programs(props: { id: string; nodes: Readonly<Record<string, Tree.Node>>; now: number; selected: string }) {
  const programs = (props.nodes['root']?.children ?? []).flatMap((child) => {
    const node = props.nodes[child]
    return node && node.form === 'program' ? [node] : []
  })
  if (!programs.length) return null
  return (
    <nav aria-label="Programs" className="programs">
      {programs.map((node) => <Program id={props.id} key={node.id} node={node} nodes={props.nodes} now={props.now} selected={props.selected === node.id} />)}
    </nav>
  )
}

function visited(id: string) {
  return `swarms.visit${fixture ? '.fixture' : ''}.${id}`
}

export function Since(props: { id: string; nodes: Readonly<Record<string, Tree.Node>>; now: number }) {
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
          <li key={node.id}><Link keep to={`/s/${encodeURIComponent(props.id)}/n/${node.id}`}>{node.status === 'proven' ? '● ' : '⊘ '}{node.title}</Link></li>
        ))}
      </ul>
      <button className="since-close" onClick={dismiss} type="button">Got it</button>
    </aside>
  )
}
