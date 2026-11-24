import { useEffect, useRef, useState } from 'react'
import type { Config, NodeView } from '../shared/Api.ts'
import { maxNote } from '../shared/Memo.ts'
import type * as Tree from '../shared/Tree.ts'
import { Alert, explain } from './Alert.tsx'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Compose, Pendings } from './Compose.tsx'
import { asked, Fuel, valid } from './Contribute.tsx'
import { ago, duration, short, stamp, usd } from './format.ts'
import * as Grove from './grove.ts'
import { message, useWallet } from './hooks.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { Overlay } from './Overlay.tsx'
import * as Pay from './pay.ts'
import { Link, useBase, useQuery } from './router.tsx'
import { Mark, word } from './Tree.tsx'
import * as Wallet from './wallet.ts'

const ends: Record<Tree.End['kind'], string> = { barrier: 'Ruled out by a barrier', exhausted: 'Exhausted', merged: 'Merged', refuted: 'Refuted', rejected: 'Rejected', withdrawn: 'Withdrawn' }

export function why(node: Tree.Node, nodes: Readonly<Record<string, Tree.Node>>) {
  if (node.status === 'proven') return node.proof ? `Checked by Lean ${stamp(node.proof.at)}` : 'Checked by Lean'
  if (node.status === 'dead end') return node.end ? `${ends[node.end.kind]}: ${node.end.why}` : 'Ended'
  if (node.paused !== null && node.status !== 'in flight') return `Paused: ${node.paused} runs without a result`
  if (node.status === 'in flight') return node.run?.checking ? 'A worker says proved. The verifier is building it; proven only once it checks.' : node.run ? `Run ${node.run.k} is working: ${usd(node.run.spent)} of ${usd(node.run.budget)} spent` : 'Working'
  const waits = node.needs.map((need) => nodes[need]).filter((need): need is Tree.Node => !!need && need.status !== 'proven')
  if (waits.length) return `Waits on ${waits.map((need) => need.title).join(', ')}`
  if (node.status === 'funded') return 'Money is committed. It starts when a worker is free.'
  return Number(node.money.spent) > 0 ? 'Its money ran out. Ride it to keep it going.' : 'Needs $0.50 to start. Ride it, or wait for the swarm to approve it.'
}

function words(spec: string) {
  return spec.replace(/^#[^\n]*\n+/, '').replace(/\`\`\`lean[\s\S]*?\`\`\`/g, '').trim()
}

function noun(node: Tree.Node) {
  return node.form === 'goal' ? 'the whole swarm' : node.form === 'triage' ? 'triage' : `this ${node.form}`
}

function Checked(props: { check: Tree.Check; title: string }) {
  const check = props.check
  const repo = `https://github.com/${check.repo}`
  return (
    <section className="node-part node-check">
      <h3>{props.title}</h3>
      <dl>
        <dt>Commit</dt><dd><a href={`${repo}/commit/${check.commit}`} rel="noreferrer" target="_blank">{check.commit.slice(0, 12)}</a></dd>
        <dt>Theorem</dt><dd><code>{check.theorem}</code></dd>
        <dt>Statement</dt><dd><code>{check.statement}</code></dd>
        <dt>Axioms</dt><dd>{check.axioms.join(', ')}</dd>
        <dt>Lean</dt><dd>{check.toolchain}</dd>
        <dt>Mathlib</dt><dd><code>{check.mathlib.slice(0, 12)}</code></dd>
        <dt>Checker</dt><dd>{check.checker}</dd>
        <dt>Command</dt><dd><code>{check.command}</code></dd>
        <dt>Exit code</dt><dd>{check.exitCode}</dd>
        <dt>Took</dt><dd>{duration(check.durationMs)}</dd>
        <dt>Content</dt><dd><code title={check.contentHash}>{short(check.contentHash)}</code></dd>
      </dl>
      <a className="node-run" href={check.url} rel="noreferrer" target="_blank">The checked run, {stamp(check.at)} ↗</a>
    </section>
  )
}

export function verb(node: Tree.Node) {
  return node.form === 'goal' ? 'Ride the whole swarm' : node.form === 'lemma' ? 'Ride this lemma' : `Ride ${noun(node)}`
}

export function RideFuel(props: { compact?: boolean; config: Config | undefined; focus?: number | undefined; node: Tree.Node; onDone: () => void; swarm: string }) {
  const [prefill] = useState(() => asked())
  return (
    <Fuel
      compact={props.compact}
      config={props.config}
      ended={Grove.closed(props.node) ? 'This item has ended. Ride the whole swarm instead.' : undefined}
      focus={props.focus}
      note=""
      onDone={props.onDone}
      onNote={() => {}}
      prefill={prefill}
      slot={Pay.slot(props.swarm, props.node.id)}
      steers={false}
      target={() => Promise.resolve({ id: props.swarm, node: props.node.id, ...(props.node.form === 'goal' ? {} : { title: props.node.title }) })}
      verb="Ride it"
    />
  )
}

export function Ride(props: { anchor?: HTMLElement | null | undefined; config: Config | undefined; node: Tree.Node; onClose: () => void; onDone: () => void; swarm: string }) {
  const root = props.node.form === 'goal'
  return (
    <Overlay anchor={props.anchor} className="ride" label={verb(props.node)} onClose={props.onClose}>
      <h3>{root ? 'Ride the whole swarm' : props.node.title}</h3>
      <p className="ride-what">{root ? 'Your dollars serve every program, split by what is runnable.' : `Your dollars run ${noun(props.node)} first, then what grows under it.`}</p>
      <RideFuel compact config={props.config} focus={1} node={props.node} onDone={() => { props.onDone(); props.onClose() }} swarm={props.swarm} />
    </Overlay>
  )
}

function Propose(props: { asked: boolean; config: Config | undefined; nodes: Readonly<Record<string, Tree.Node>>; parent: Tree.Node; swarm: string }) {
  const [shown, setShown] = useState(props.asked)
  const [spot, setSpot] = useState<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (props.asked) spot?.scrollIntoView({ block: 'nearest' })
  }, [props.asked, spot])
  return (
    <>
      <div className="node-part node-form">
        <button aria-expanded={shown} aria-haspopup="dialog" className="node-add" onClick={() => setShown(true)} ref={setSpot} type="button">Add a sub-item<span>$1+</span></button>
        {shown && (
          <Overlay anchor={spot} className="compose-card" label="Add a sub-item" onClose={() => setShown(false)}>
            <Compose config={props.config} full onSent={() => setShown(false)} parent={props.parent} swarm={props.swarm} />
          </Overlay>
        )}
      </div>
      <Pendings nodes={props.nodes} parent={props.parent.id} swarm={props.swarm} />
    </>
  )
}

function Suggest(props: { config: Config | undefined; parent: Tree.Node; swarm: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<{ at: 'idle' } | { at: 'busy' } | { at: 'done' } | { at: 'failed'; error: string }>({ at: 'idle' })
  const wallet = useWallet()
  const submit = async () => {
    if (!text.trim() || state.at === 'busy') return
    setState({ at: 'busy' })
    try {
      if (!wallet.session && props.config) await Wallet.signIn(props.config)
      await Api.suggest(props.swarm, { parent: props.parent.id, text: text.trim() })
      setText('')
      setState({ at: 'done' })
      props.onDone()
    } catch (error) {
      setState({ at: 'failed', error: message(error) })
    }
  }
  return (
    <details className="node-part node-form">
      <summary>Suggest something, free</summary>
      <label className="node-field"><span>Your idea</span><textarea maxLength={maxNote} onChange={(event) => setText(event.target.value)} rows={2} value={text} /></label>
      <p className="fine">Signed in, five a day. Triage may make it a node credited to you, and anyone can ride it.</p>
      <button className="btn btn-medium" disabled={!text.trim() || state.at === 'busy'} onClick={() => void submit()} type="button">{state.at === 'busy' ? 'Sending…' : 'Suggest it'}</button>
      {state.at === 'done' && <Alert title="Suggested." tone="good">It shows under this node.</Alert>}
      {state.at === 'failed' && <Alert title={explain(state.error).title} tone="bad">{explain(state.error).detail}</Alert>}
    </details>
  )
}

function Move(props: { mine: Tree.Funder; node: Tree.Node; nodes: Readonly<Record<string, Tree.Node>>; onDone: () => void; swarm: string }) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState(props.mine.amount.replace(/\.?0+$/, ''))
  const [state, setState] = useState<{ at: 'idle' } | { at: 'busy' } | { at: 'failed'; error: string }>({ at: 'idle' })
  const targets = Object.values(props.nodes).filter((node) => node.id !== props.node.id && !Grove.closed(node) && node.form !== 'triage')
  const submit = async () => {
    setState({ at: 'busy' })
    try {
      await Api.moveNode(props.swarm, props.node.id, { amount: amount.trim(), to })
      setState({ at: 'idle' })
      props.onDone()
    } catch (error) {
      setState({ at: 'failed', error: message(error) })
    }
  }
  return (
    <details className="node-part node-form">
      <summary>Move your {usd(props.mine.amount)}</summary>
      <label className="node-field"><span>To</span>
        <select onChange={(event) => setTo(event.target.value)} value={to}>
          <option value="">Your free money in this swarm</option>
          {targets.map((node) => <option key={node.id} value={node.id}>{node.form === 'goal' ? 'The whole swarm' : node.title}</option>)}
        </select>
      </label>
      <label className="node-field"><span>Dollars</span><input inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(',', '.').replace('$', ''))} value={amount} /></label>
      <button className="btn btn-medium" disabled={!valid(amount) || state.at === 'busy'} onClick={() => void submit()} type="button">{state.at === 'busy' ? 'Moving…' : 'Move it'}</button>
      {state.at === 'failed' && <Alert title={explain(state.error).title} tone="bad">{explain(state.error).detail}</Alert>}
    </details>
  )
}

export function NodePanel(props: {
  config: Config | undefined
  error: string | undefined
  nid: string
  nodes: Readonly<Record<string, Tree.Node>>
  now: number
  onChanged: () => void
  swarm: string
  updates: readonly Tree.Delta[] | undefined
  view: NodeView | undefined
}) {
  const [riding] = useState(() => (here().searchParams.has('ride') ? 1 : 0))
  const asked = useQuery('propose') !== null
  const wallet = useWallet()
  const ride = Pay.useFlow(Pay.slot(props.swarm, props.nid))
  const known = props.nodes[props.nid]
  const view = props.view
  const node: Tree.Node | undefined = view ?? known
  const base = useBase(props.swarm)
  const path = (nid: string) => `${base}/t/${nid}`
  if (!node)
    return (
      <div className="node" aria-busy={!props.error}>
        {props.error ? <p className="tree-empty">{/not.found|no node/i.test(props.error) ? 'No node has this id.' : props.error}</p> : <p className="tree-empty">Loading…</p>}
      </div>
    )
  const trail = Grove.trail(props.nodes, node.id)
  const mine = view?.funders.find((funder) => funder.who.address && funder.who.address.toLowerCase() === (wallet.session?.address ?? wallet.address))
  const text = words(node.spec)
  const open = !Grove.closed(node)
  const rides = node.form !== 'triage' && (open || ride.at !== 'idle')
  return (
    <div className="node" data-status={node.status}>
      {trail.length > 1 && (
        <nav aria-label="Where it sits" className="crumbs node-crumbs">
          {trail.slice(0, -1).map((step, index) => (
            <span key={step.id}>{index > 0 && <i aria-hidden="true">›</i>}<Link keep to={path(step.id)}><Inline text={step.title} /></Link></span>
          ))}
        </nav>
      )}
      <h2 className="node-title"><Inline text={node.title} /></h2>
      <p className="node-status" data-status={node.status}><Mark checking={node.run?.checking} status={node.status} /><b>{node.run?.checking ? 'Checking' : word(node.status)}</b> {why(node, props.nodes)}</p>
      {node.status === 'in flight' && !node.run?.checking && node.run?.doing && <p className="node-doing" aria-live="polite"><i aria-hidden="true" /><Inline text={node.run.doing.text} /></p>}
      <p className="node-money">
        <b>{usd(node.money.pledged)}</b> ridden by {node.riders} rider{node.riders === 1 ? '' : 's'} · {usd(node.money.spent)} spent · {usd(node.money.left)} left
        {node.children.length > 0 && <> · subtree {usd(node.money.subtree.spent)} spent</>}
      </p>
      {rides && (
        <section aria-label={verb(node)} className="node-part node-ride">
          <h3>{verb(node)}</h3>
          <RideFuel compact config={props.config} focus={riding} key={node.id} node={node} onDone={props.onChanged} swarm={props.swarm} />
        </section>
      )}
      {open && node.form !== 'triage' && <Propose asked={asked} config={props.config} key={`${node.id}:${asked}`} nodes={props.nodes} parent={node} swarm={props.swarm} />}
      {text && <section className="node-part node-words"><Markdown text={text} /></section>}
      {node.statement && (
        <section className="node-part">
          <h3>Lean statement{view?.review && <span className="node-review">statement under review</span>}</h3>
          <pre className="node-lean"><code>{node.statement}</code></pre>
          <p className="fine">Frozen when it was posted. Proven only when the verifier builds a proof of exactly this.</p>
        </section>
      )}
      {node.proof && <Checked check={node.proof} title="Checked record" />}
      {node.end?.check && <Checked check={node.end.check} title="Checked refutation" />}
      {node.needs.length > 0 && (
        <section className="node-part">
          <h3>Needs</h3>
          <ul className="node-list">
            {node.needs.map((need) => {
              const found = props.nodes[need]
              return <li key={need}>{found ? <Link keep to={path(need)}><Mark status={found.status} /> <Inline text={found.title} /></Link> : <Link keep to={path(need)}>{need}</Link>}</li>
            })}
          </ul>
        </section>
      )}
      <section className="node-part">
        <h3>People</h3>
        <p>{node.by.agent === 'seed' ? "Seeded by the swarm's authors" : node.by.agent ? 'Split off by the worker on its parent' : <>Idea by <Link className="node-who" to={`/u/${node.by.address ?? node.by.handle}`}>@{node.by.handle}</Link></>}</p>
        {(view?.funders ?? node.funders).length > 0 && (
          <ul className="node-list node-riders">
            {(view?.funders ?? node.funders).map((funder) => <li key={`${funder.who.handle}:${funder.since}`}><Link className="node-who" to={`/u/${funder.who.address ?? funder.who.handle}`}>@{funder.who.handle}</Link><span>{usd(funder.amount)}</span></li>)}
          </ul>
        )}
      </section>
      {view && view.runs.length > 0 && (
        <section className="node-part">
          <h3>Spend by run</h3>
          <ol className="node-runs">
            {view.runs.map((run) => (
              <li key={run.task}>
                <span className="node-run-head">Run {run.k} · {usd(run.spent)} of {usd(run.budget)}{run.outcome ? ` · ${run.outcome}` : ' · working'}{run.commit && <> · <code>{run.commit.slice(0, 7)}</code></>}</span>
                <Inline text={run.summary} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {props.updates && props.updates.length > 0 && (
        <section className="node-part">
          <h3>Updates</h3>
          <ol className="node-updates">
            {props.updates.slice(0, 12).map((delta) => <li key={`${delta.seq}:${delta.at}:${delta.event}`}><Inline text={delta.text} /><time>{ago(delta.at, props.now)}</time></li>)}
          </ol>
        </section>
      )}
      {open && <Suggest config={props.config} onDone={props.onChanged} parent={node} swarm={props.swarm} />}
      {view && view.suggestions.length > 0 && (
        <section className="node-part">
          <h3>Suggestions</h3>
          <ol className="node-updates">
            {view.suggestions.map((idea) => <li key={idea.id}><span><Inline text={idea.text} /> · @{idea.who.handle}</span><time>{ago(idea.at, props.now)}</time></li>)}
          </ol>
        </section>
      )}
      {mine && Number(mine.amount) > 0 && open && <Move mine={mine} node={node} nodes={props.nodes} onDone={props.onChanged} swarm={props.swarm} />}
      <p className="node-soon">Bring your own agent or machine · coming soon</p>
    </div>
  )
}
