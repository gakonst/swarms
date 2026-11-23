import { useState } from 'react'
import type { Config, NodeView } from '../shared/Api.ts'
import { maxNote } from '../shared/Memo.ts'
import type * as Tree from '../shared/Tree.ts'
import { Alert, explain } from './Alert.tsx'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { asked, Fuel, valid } from './Contribute.tsx'
import { ago, duration, short, stamp, usd } from './format.ts'
import * as Grove from './grove.ts'
import { message, useWallet } from './hooks.ts'
import { Markdown } from './Markdown.tsx'
import * as Pay from './pay.ts'
import { Back, Link, navigate, useBase } from './router.tsx'
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

function Ride(props: { config: Config | undefined; node: Tree.Node; onClose: () => void; onDone: () => void; swarm: string }) {
  const [note, setNote] = useState('')
  const [prefill] = useState(() => asked())
  const root = props.node.form === 'goal'
  return (
    <div className="sheet" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div aria-label="Ride" className="sheet-card ride" role="dialog">
        <button aria-label="Close" className="sheet-close" onClick={props.onClose} type="button">×</button>
        <h3>{root ? 'Ride the whole swarm' : props.node.form === 'lemma' ? 'Ride this lemma' : `Ride ${noun(props.node)}`}</h3>
        <p className="ride-what">{root ? 'Your dollars serve every program, split by what is runnable.' : `Your dollars run ${noun(props.node)} first, then what grows under it.`} Workers spend it only through the gateway; what is left stays yours to move.</p>
        <Fuel ask="A note for its worker" config={props.config} note={note} onDone={props.onDone} onNote={setNote} prefill={prefill} slot={Pay.slot(props.swarm, props.node.id)} target={() => Promise.resolve({ id: props.swarm, node: props.node.id })} verb="Ride it" />
      </div>
    </div>
  )
}

function Propose(props: { config: Config | undefined; parent: Tree.Node; swarm: string }) {
  const [title, setTitle] = useState('')
  const [spec, setSpec] = useState('')
  const [statement, setStatement] = useState('')
  const [form, setForm] = useState<Tree.Form>('lemma')
  const [sent, setSent] = useState(false)
  const [prefill] = useState(() => ({ ...asked(), amount: '1' }))
  const slot = `${props.swarm}/propose/${props.parent.id}`
  const base = useBase(props.swarm)
  return (
    <details className="node-part node-form">
      <summary>Propose a lemma: $1 or more makes it a node</summary>
      <label className="node-field"><span>Title</span><input maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Parity needs depth d circuits of size 2^n^(1/d)" value={title} /></label>
      <label className="node-field"><span>What and why</span><textarea maxLength={2000} onChange={(event) => setSpec(event.target.value)} rows={3} value={spec} /></label>
      <label className="node-field"><span>Lean statement (optional)</span><textarea className="mono" maxLength={2000} onChange={(event) => setStatement(event.target.value)} placeholder="theorem parity_not_ac0 : ..." rows={2} value={statement} /></label>
      <label className="node-field"><span>Kind</span>
        <select onChange={(event) => setForm(event.target.value as Tree.Form)} value={form}>
          <option value="lemma">Lemma</option>
          <option value="approach">Approach</option>
          <option value="idea">Idea</option>
        </select>
      </label>
      <p className="fine">Under {props.parent.form === 'goal' ? 'the whole swarm' : props.parent.title}. The same title under the same parent is the same node, so a duplicate adds money to it.</p>
      <Fuel
        config={props.config}
        least="1"
        locked={!title.trim()}
        note=""
        onDone={(target) => {
          setSent(false)
          if (target.node) navigate(`${base}/n/${target.node}`, { keep: true })
        }}
        onNote={() => {}}
        onSent={() => setSent(true)}
        prefill={prefill}
        slot={slot}
        steers={false}
        target={async () => {
          const made = await Api.propose(props.swarm, { form, parent: props.parent.id, spec: spec.trim() || title.trim(), title: title.trim(), ...(statement.trim() ? { statement: statement.trim() } : {}) })
          return { id: props.swarm, node: made.nid }
        }}
        verb="Propose it"
      />
      {sent && <Alert title="Sent. Counting it…" tone="warn">It becomes a node once the transfer is counted.</Alert>}
    </details>
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
  back: string | undefined
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
  const [riding, setRiding] = useState(() => here().searchParams.has('ride'))
  const wallet = useWallet()
  const known = props.nodes[props.nid]
  const view = props.view
  const node: Tree.Node | undefined = view ?? known
  const base = useBase(props.swarm)
  const path = (nid: string) => `${base}/n/${nid}`
  if (!node)
    return (
      <div className="node" aria-busy={!props.error}>
        {props.back && <Back className="node-back" to={props.back}>← Back</Back>}
        {props.error ? <p className="tree-empty">{/not.found|no node/i.test(props.error) ? 'No node has this id.' : props.error}</p> : <p className="tree-empty">Loading…</p>}
      </div>
    )
  const trail = Grove.trail(props.nodes, node.id)
  const mine = view?.funders.find((funder) => funder.who.address && funder.who.address.toLowerCase() === (wallet.session?.address ?? wallet.address))
  const text = words(node.spec)
  const open = !Grove.closed(node)
  return (
    <div className="node" data-status={node.status}>
      {props.back && <Back className="node-back" to={props.back}>← Back</Back>}
      {trail.length > 1 && (
        <nav aria-label="Where it sits" className="crumbs node-crumbs">
          {trail.slice(0, -1).map((step, index) => (
            <span key={step.id}>{index > 0 && <i aria-hidden="true">›</i>}<Link keep to={path(step.id)}>{step.title}</Link></span>
          ))}
        </nav>
      )}
      <h2 className="node-title">{node.title}</h2>
      <p className="node-status" data-status={node.status}><Mark checking={node.run?.checking} status={node.status} /><b>{node.run?.checking ? 'Checking' : word(node.status)}</b> {why(node, props.nodes)}</p>
      <p className="node-money">
        <b>{usd(node.money.pledged)}</b> ridden by {node.riders} rider{node.riders === 1 ? '' : 's'} · {usd(node.money.spent)} spent · {usd(node.money.left)} left
        {node.children.length > 0 && <> · subtree {usd(node.money.subtree.spent)} spent</>}
      </p>
      {open && node.form !== 'triage' && <button className="btn btn-high node-ride" onClick={() => setRiding(true)} type="button">{node.form === 'goal' ? 'Ride the whole swarm' : node.form === 'lemma' ? 'Ride this lemma' : `Ride ${noun(node)}`}</button>}
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
              return <li key={need}>{found ? <Link keep to={path(need)}><Mark status={found.status} /> {found.title}</Link> : <Link keep to={path(need)}>{need}</Link>}</li>
            })}
          </ul>
        </section>
      )}
      <section className="node-part">
        <h3>People</h3>
        <p>{node.by.agent === 'seed' ? "Seeded by the swarm's authors" : node.by.agent ? 'Split off by the worker on its parent' : <>Idea by <b>@{node.by.handle}</b></>}</p>
        {(view?.funders ?? node.funders).length > 0 && (
          <ul className="node-list node-riders">
            {(view?.funders ?? node.funders).map((funder) => <li key={`${funder.who.handle}:${funder.since}`}><span>@{funder.who.handle}</span><span>{usd(funder.amount)}</span></li>)}
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
                <span>{run.summary}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {props.updates && props.updates.length > 0 && (
        <section className="node-part">
          <h3>Updates</h3>
          <ol className="node-updates">
            {props.updates.slice(0, 12).map((delta) => <li key={`${delta.seq}:${delta.at}:${delta.event}`}><span>{delta.text}</span><time>{ago(delta.at, props.now)}</time></li>)}
          </ol>
        </section>
      )}
      {view && view.steers.length > 0 && (
        <section className="node-part">
          <h3>Notes to its worker</h3>
          <ol className="node-updates">
            {view.steers.map((steer) => <li key={`${steer.at}:${steer.who.handle}`}><span>"{steer.note}" · @{steer.who.handle}{Number(steer.amount) > 0 && <>, {usd(steer.amount)}</>}</span><time>{ago(steer.at, props.now)}</time></li>)}
          </ol>
        </section>
      )}
      {open && node.form !== 'triage' && <Propose config={props.config} parent={node} swarm={props.swarm} />}
      {open && <Suggest config={props.config} onDone={props.onChanged} parent={node} swarm={props.swarm} />}
      {view && view.suggestions.length > 0 && (
        <section className="node-part">
          <h3>Suggestions</h3>
          <ol className="node-updates">
            {view.suggestions.map((idea) => <li key={idea.id}><span>{idea.text} · @{idea.who.handle}</span><time>{ago(idea.at, props.now)}</time></li>)}
          </ol>
        </section>
      )}
      {mine && Number(mine.amount) > 0 && open && <Move mine={mine} node={node} nodes={props.nodes} onDone={props.onChanged} swarm={props.swarm} />}
      <p className="node-soon">Bring your own agent or machine · coming soon</p>
      {riding && <Ride config={props.config} node={node} onClose={() => setRiding(false)} onDone={props.onChanged} swarm={props.swarm} />}
    </div>
  )
}
