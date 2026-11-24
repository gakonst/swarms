import { useState } from 'react'
import type { Config } from '../shared/Api.ts'
import type * as Tree from '../shared/Tree.ts'
import { Alert } from './Alert.tsx'
import * as Api from './api.ts'
import { cash } from './Branches.tsx'
import { asked, dollars, Fuel } from './Contribute.tsx'
import * as Pay from './pay.ts'
import { Mark } from './Tree.tsx'

export function Compose(props: { config: Config | undefined; full?: boolean; heading?: string | undefined; onMade?: ((nid: string) => void) | undefined; onSent?: (() => void) | undefined; parent: Tree.Node; said?: string | undefined; swarm: string }) {
  const [title, setTitle] = useState(() => (props.said ? titled(props.said) : ''))
  const [spec, setSpec] = useState(props.said ?? '')
  const [statement, setStatement] = useState('')
  const [form, setForm] = useState<Tree.Form>(props.said ? 'idea' : 'lemma')
  const [prefill] = useState(() => ({ ...asked(), amount: '1' }))
  const slot = Pay.proposing(props.swarm, props.parent.id)
  const busy = Pay.busy(Pay.useFlow(slot))
  const under = props.parent.form === 'goal' ? 'the whole swarm' : props.parent.title
  return (
    <div className="compose" data-full={props.full || undefined}>
      <h3>{props.heading ?? `Add under ${under}`}</h3>
      <label className="compose-field">
        <span className="sr-only">Title</span>
        <input autoFocus className="compose-title" disabled={busy} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Its title" value={title} />
      </label>
      <label className="compose-field">
        <span className="sr-only">What and why</span>
        <textarea className="compose-detail" disabled={busy} maxLength={2000} onChange={(event) => setSpec(event.target.value)} placeholder="What and why (optional)" rows={2} value={spec} />
      </label>
      {props.full && (
        <>
          <label className="node-field"><span>Lean statement (optional)</span><textarea className="mono" disabled={busy} maxLength={2000} onChange={(event) => setStatement(event.target.value)} placeholder="theorem parity_not_ac0 : ..." rows={2} value={statement} /></label>
          <label className="node-field"><span>Kind</span>
            <select disabled={busy} onChange={(event) => setForm(event.target.value as Tree.Form)} value={form}>
              <option value="lemma">Lemma</option>
              <option value="approach">Approach</option>
              <option value="idea">Idea</option>
            </select>
          </label>
        </>
      )}
      <Fuel
        compact
        config={props.config}
        creates
        least="1"
        locked={!title.trim()}
        note=""
        onDone={() => {}}
        onNote={() => {}}
        onSent={() => {
          setTitle('')
          setSpec('')
          setStatement('')
          props.onSent?.()
        }}
        prefill={prefill}
        slot={slot}
        steers={false}
        target={async () => {
          const named = title.trim()
          const made = await Api.propose(props.swarm, { form, parent: props.parent.id, spec: spec.trim() || named, title: named, ...(statement.trim() ? { statement: statement.trim() } : {}), ...(props.said ? { said: props.said } : {}) })
          props.onMade?.(made.nid)
          return { id: props.swarm, node: made.nid, parent: props.parent.id, title: named }
        }}
        verb="Add it"
        wants="Give it a title first"
      />
    </div>
  )
}

export function titled(text: string) {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= 120) return line
  const cut = line.slice(0, 119)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60)).trimEnd()}…`
}

function said(act: Pay.Act) {
  if (act.at === 'counting') return 'Counting…'
  if (act.at === 'owed') return act.tries < Pay.retries.length ? 'Sent, not counted yet. Trying again…' : 'Sent, not counted yet.'
  if (act.at === 'refused') return `Sent, but not counted: ${act.error}`
  return ''
}

export function Pending(props: { act: Pay.Act; owed: Pay.Owed }) {
  const owed = props.owed
  const at = Pay.slot(owed.swarm, owed.node)
  const live = Pay.useFlow(at)
  const act = Pay.sent(live) ? live : props.act
  return (
    <div className="bud ghost" data-at={act.at}>
      <Mark status="proposed" />
      <span className="bud-title">{owed.title ?? 'Your new item'}</span>
      <span className="bud-meta"><span className="bud-money">{cash(owed.amount)}</span></span>
      <span className="bud-doing ghost-line" role="status">
        {said(act)}
        {act.at === 'owed' && <button className="ghost-go" onClick={() => void Pay.retry(at)} type="button">Try again</button>}
        {act.at === 'refused' && <button className="ghost-go" onClick={() => Pay.forget(at)} type="button">Dismiss</button>}
      </span>
    </div>
  )
}

export function Pendings(props: { nodes: Readonly<Record<string, Tree.Node>>; parent: string; swarm: string }) {
  const ghosts = Pay.useGhosts(props.swarm, props.parent).filter((ghost) => !ghost.owed.node || !props.nodes[ghost.owed.node])
  if (!ghosts.length) return null
  return (
    <div className="node-part node-pending">
      {ghosts.map((ghost) => <Alert key={ghost.owed.hash} title={`${ghost.owed.title ?? 'Your new item'} · ${dollars(ghost.owed.amount)}`} tone={ghost.act.at === 'refused' ? 'bad' : 'warn'}>{said(ghost.act)}</Alert>)}
    </div>
  )
}
