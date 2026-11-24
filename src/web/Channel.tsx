import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { Branch, Config, NodeView, Said } from '../shared/Api.ts'
import * as Crew from '../shared/Crew.ts'
import * as Mention from '../shared/Mention.ts'
import { maxNote } from '../shared/Memo.ts'
import type * as Tree from '../shared/Tree.ts'
import { cash, Faces } from './Branches.tsx'
import { Compose } from './Compose.tsx'
import { crewMarks } from './channels.ts'
import { ago, day, minute, usd } from './format.ts'
import * as Grove from './grove.ts'
import { message, useWallet } from './hooks.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { why } from './Node.tsx'
import { Overlay } from './Overlay.tsx'
import { ChannelMenu } from './ChannelMenu.tsx'
import { Avatar, tint } from './Room.tsx'
import { Link } from './router.tsx'
import { Mark, word } from './Tree.tsx'
import * as Wallet from './wallet.ts'

export type Line = { at: number; id: string; text: string; who: { address: string | null; bot: boolean; name: string }; tag?: string | undefined }

const worker = new Set<Tree.Delta['event']>(['started', 'progress', 'checking', 'proven', 'ended', 'doing'])

const outcomes: Record<NonNullable<NodeView['runs'][number]['outcome']>, string> = { progress: 'made progress', proved: 'proved it', refuted: 'refuted it', split: 'split it', stuck: 'got stuck' }

function rider(who: Tree.Who) {
  return { address: who.address, bot: !!who.agent, name: who.agent ? 'AI' : `@${who.handle}` }
}

export function lines(node: Tree.Node, view: NodeView | undefined, updates: readonly Tree.Delta[] | undefined): Line[] {
  const out: Line[] = []
  const summed = new Set((view?.runs ?? []).flatMap((run) => (run.outcome ? [run.summary.trim()] : [])))
  for (const delta of updates ?? []) {
    if (delta.event === 'funded' || delta.event === 'steered' || delta.event === 'moved' || out.some((line) => line.id === `d${delta.seq}:${delta.event}`)) continue
    if (worker.has(delta.event) && summed.has(delta.text.trim())) continue
    out.push({ at: delta.at, id: `d${delta.seq}:${delta.event}`, text: delta.text, who: { address: null, bot: true, name: worker.has(delta.event) ? 'AI' : 'Swarm' } })
  }
  for (const run of view?.runs ?? []) {
    if (!run.outcome) continue
    out.push({ at: run.until ?? run.since, id: `r${run.k}`, tag: `Run ${run.k} ${outcomes[run.outcome]} · ${usd(run.spent)} of ${usd(run.budget)}${run.commit ? ` · ${run.commit.slice(0, 7)}` : ''}`, text: run.summary, who: { address: null, bot: true, name: 'AI' } })
  }
  for (const steer of view?.steers ?? []) out.push({ at: steer.at, id: `s${steer.at}:${steer.who.handle}`, tag: `Rode it with ${usd(steer.amount)}`, text: steer.note, who: rider(steer.who) })
  for (const idea of view?.suggestions ?? []) out.push({ at: idea.at, id: `i${idea.id}`, text: idea.text, who: rider(idea.who) })
  if (!out.length && node.by.agent !== 'seed') out.push({ at: node.createdAt, id: 'posted', text: node.title, who: rider(node.by) })
  return out.sort((a, b) => a.at - b.at)
}

function joined(a: Line | undefined, b: Line, now: number) {
  return !!a && a.who.name === b.who.name && b.at - a.at < 10 * 60_000 && day(a.at, now) === day(b.at, now)
}

export function Face(props: { who: Line['who'] }) {
  if (props.who.bot) return <span aria-hidden="true" className="avatar avatar-ai">✦</span>
  return <Avatar address={props.who.address ?? props.who.name} handle={props.who.name.replace(/^@/, '')} />
}

function Spoken(props: { first: boolean; line: Line; now: number }) {
  const line = props.line
  const first = props.first
  return (
    <li className="msg" data-first={first}>
      {first ? <Face who={line.who} /> : <span className="avatar-gap" />}
      <div className="msg-col">
        {first && <p className="msg-who"><b style={line.who.bot ? undefined : { color: tint(line.who.address ?? line.who.name) }}>{line.who.name}</b>{line.at > 1e9 && <time dateTime={new Date(line.at).toISOString()}>{day(line.at, props.now) === day(props.now, props.now) ? minute(line.at) : `${day(line.at, props.now)} ${minute(line.at)}`}</time>}</p>}
        {line.tag && <span className="talk-tag">{line.tag}</span>}
        {line.text && <div className="msg-bubble"><Markdown compact text={line.text} /></div>}
      </div>
    </li>
  )
}

export function Talk(props: { doing?: Tree.Doing | null | undefined; empty: string; lines: readonly Line[]; now: number }) {
  return (
    <ol aria-label="Messages" className="talk">
      {props.lines.length === 0 && !props.doing && <li className="talk-empty">{props.empty}</li>}
      {props.lines.map((line, index) => <Spoken first={!joined(props.lines[index - 1], line, props.now)} key={line.id} line={line} now={props.now} />)}
      {props.doing && (
        <li className="msg talk-doing" data-first="true" aria-live="polite">
          <span aria-hidden="true" className="avatar avatar-ai">✦</span>
          <div className="msg-col">
            <p className="msg-who"><b>AI</b><time>{props.doing.at > props.now - 5_000 ? 'working' : `working · ${ago(props.doing.at, props.now)}`}</time></p>
            <div className="msg-bubble"><i aria-hidden="true" className="talk-pulse" /><Inline text={props.doing.text} /></div>
          </div>
        </li>
      )}
    </ol>
  )
}

export function Composer(props: { config: Config | undefined; disabled?: string | undefined; fine?: string | undefined; label: string; onPost: (text: string) => Promise<void>; placeholder: string }) {
  const wallet = useWallet()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [signing, setSigning] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [sent, setSent] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`
  }, [text])

  const post = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setProblem(undefined)
    try {
      await props.onPost(body)
      setText('')
      setSent(true)
    } catch (error) {
      setProblem(message(error))
    } finally {
      setSending(false)
    }
  }

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {
      event.preventDefault()
      void post()
    }
  }

  const signIn = async () => {
    if (!props.config) return
    setSigning(true)
    setProblem(undefined)
    try {
      await Wallet.signIn(props.config)
    } catch (error) {
      setProblem(message(error))
    } finally {
      setSigning(false)
    }
  }

  return (
    <footer className="chat-foot talk-foot">
      {problem && <p className="chat-error" role="alert">{problem}</p>}
      {props.disabled ? (
        <p className="talk-closed">{props.disabled}</p>
      ) : !wallet.session ? (
        <button className="chat-gate" disabled={!props.config || signing || wallet.pending} onClick={() => void signIn()} type="button">{signing ? 'Signing in…' : 'Sign in to post'}</button>
      ) : (
        <>
          <div className="chat-bar">
            <textarea aria-label={props.label} enterKeyHint="send" maxLength={maxNote} onChange={(event) => { setText(event.target.value); setSent(false) }} onKeyDown={keys} placeholder={props.placeholder} ref={area} rows={1} value={text} />
            <button aria-label="Send" className="chat-send" disabled={!text.trim() || sending} onClick={() => void post()} type="button">↑</button>
          </div>
          {props.fine && <p className="talk-fine" role={sent ? 'status' : undefined}>{sent ? 'Posted.' : props.fine}</p>}
        </>
      )}
    </footer>
  )
}

export function Add(props: { asked?: boolean; config: Config | undefined; nodes: Readonly<Record<string, Tree.Node>>; parent: Tree.Node; swarm: string }) {
  const [spot, setSpot] = useState<HTMLButtonElement | null>(null)
  const [shown, setShown] = useState(!!props.asked)
  return (
    <>
      <button aria-expanded={shown} aria-haspopup="dialog" className="btn btn-medium channel-add" onClick={() => setShown(true)} ref={setSpot} type="button">Add a sub-item<span>$1+</span></button>
      {shown && (
        <Overlay anchor={spot} className="compose-card" label="Add a sub-item" onClose={() => setShown(false)}>
          <Compose config={props.config} full onSent={() => setShown(false)} parent={props.parent} swarm={props.swarm} />
        </Overlay>
      )}
    </>
  )
}

function Starter(props: { lit: boolean; node: Tree.Node; nodes: Readonly<Record<string, Tree.Node>>; now: number; path: (nid: string) => string }) {
  const node = props.node
  const said = node.status === 'in flight' && node.run?.doing?.text ? node.run.doing : null
  const who = rider(node.by)
  const seededBy = node.by.agent === 'seed'
  const kids = node.children.length
  return (
    <li className="msg starter" data-first="true" data-lit={props.lit || undefined}>
      {seededBy ? <span aria-hidden="true" className="avatar avatar-ai">✦</span> : <Face who={who} />}
      <div className="msg-col">
        <p className="msg-who"><b style={who.bot || seededBy ? undefined : { color: tint(who.address ?? who.name) }}>{seededBy ? 'Swarm' : who.name}</b><time>{ago(node.createdAt, props.now)}</time></p>
        <Link className="starter-card" data={{ 'data-status': node.status }} keep to={props.path(node.id)}>
          <span className="starter-title"><Mark checking={node.run?.checking} status={node.status} /><Inline text={node.title} /></span>
          <span className="starter-why"><b>{node.run?.checking ? 'Checking' : word(node.status)}</b> {why(node, props.nodes)}</span>
          {said && <span className="starter-doing"><i aria-hidden="true" className="talk-pulse" /><Inline text={said.text} /><time>{ago(said.at, props.now)}</time></span>}
          <span className="starter-foot">
            {Number(node.money.subtree.pledged) > 0 && <span className="starter-money">{cash(node.money.subtree.pledged)}</span>}
            <Faces funders={node.funders} riders={node.riders} />
            {kids > 0 && <span>{kids} sub-item{kids === 1 ? '' : 's'}</span>}
            <span className="starter-open">Open thread ›</span>
          </span>
        </Link>
      </div>
    </li>
  )
}

export function TreeChannel(props: { children?: ReactNode; config: Config | undefined; lines: readonly Line[]; node: Tree.Node; nodes: Readonly<Record<string, Tree.Node>>; now: number; onPost: (text: string) => Promise<void>; onRide: (anchor: HTMLElement) => void; path: (nid: string) => string; swarm: string; swarmTitle: string; thread: string | undefined }) {
  const node = props.node
  const kids = node.children.flatMap((nid) => props.nodes[nid] ?? []).sort((a, b) => a.createdAt - b.createdAt)
  const told = props.lines.filter((line) => line.id !== 'posted')
  const entries = [...kids.map((kid) => ({ at: kid.createdAt, kid, line: undefined })), ...told.map((line) => ({ at: line.at, kid: undefined, line }))].sort((a, b) => a.at - b.at)
  const open = !Grove.closed(node)
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [node.id, entries.length])
  const spec = node.spec.replace(/^#[^\n]*\n+/, '').replace(/```[\s\S]*?```/g, '').trim()
  const first = spec.split('\n', 1)[0] ?? ''
  const topic = first.trim() === node.title.trim() ? spec.slice(first.length).trim() : spec
  return (
    <section aria-label={`#${node.title}`} className="channel">
      <header className="channel-head">
        <div className="channel-top">
          <h1 className="channel-title"><ChannelMenu id={props.swarm} title={node.title} /></h1>
          <p className="channel-stats">
            {Number(node.money.subtree.pledged) > 0 && <span><b>{cash(node.money.subtree.pledged)}</b> ridden</span>}
            <span><b>{node.counts.proven}</b> proven</span>
            <span data-live={node.counts['in flight'] > 0 || undefined}><b>{node.counts['in flight']}</b> in flight</span>
          </p>
          <div className="channel-acts">
            {open && <Add config={props.config} nodes={props.nodes} parent={node} swarm={props.swarm} />}
            {open && <button className="btn btn-high channel-ride" onClick={(event) => props.onRide(event.currentTarget)} type="button">Ride it</button>}
          </div>
        </div>
        <p className="channel-topic"><Mark status={node.status} /><span>{word(node.status)}</span><i aria-hidden="true">·</i><Inline text={props.swarmTitle} /></p>
      </header>
      <div className="channel-list" ref={scroller}>
        <div className="channel-intro">
          <p className="welcome-mark" aria-hidden="true">#</p>
          <h2><Inline text={node.title} /></h2>
          {topic && <div className="channel-words"><Markdown compact text={topic} /></div>}
          <p className="channel-note">{kids.length ? `Each of its ${kids.length} item${kids.length === 1 ? ' is a thread' : 's is a thread'}: open one to read what its agents did and add a note.` : 'No items yet. Add one, or post a note for the swarm.'}</p>
        </div>
        <ol aria-label="Threads" className="talk">
          {entries.map((entry, index) => {
            if (entry.kid) return <Starter key={entry.kid.id} lit={props.thread === entry.kid.id} node={entry.kid} nodes={props.nodes} now={props.now} path={props.path} />
            const line = entry.line!
            const before = entries[index - 1]?.line
            return <Spoken first={!joined(before, line, props.now)} key={line.id} line={line} now={props.now} />
          })}
        </ol>
        {props.children}
      </div>
      <Composer config={props.config} disabled={open ? undefined : 'This program has ended.'} fine="A note on this program, free. Five a day; triage may turn it into an item." label={`Message #${node.title}`} onPost={props.onPost} placeholder={`Message #${node.title.length > 40 ? `${node.title.slice(0, 40)}…` : node.title}`} />
    </section>
  )
}

function backersOf(branch: Branch): Tree.Funder[] {
  return branch.funders.map((funder) => ({ amount: funder.amount, since: 0, who: { address: funder.address, agent: null, handle: funder.handle } }))
}

export function tagged(title: string) {
  return `**#${title}** `
}

const crewWords: Record<Crew.State, string> = { done: 'Done', failed: 'Failed', starved: 'Out of budget', stopped: 'Stopped', working: 'Working' }

export function BranchChannel(props: { base: string; branch: Branch; branches: readonly Branch[]; config: Config | undefined; names: ReadonlyMap<string, string>; now: number; onPost: (text: string) => Promise<void>; onRide: ((anchor: HTMLElement) => void) | undefined; said: readonly Said[]; swarm: string; swarmTitle: string }) {
  const branch = props.branch
  const member = Crew.member(branch)
  const status = crewMarks[member.state]
  const kids = props.branches.filter((each) => each.parent === branch.id).map(Crew.member)
  const prefix = tagged(member.title)
  const scroller = useRef<HTMLDivElement>(null)
  const posts: Line[] = props.said
    .filter((said) => said.text.startsWith(prefix))
    .map((said) => ({ at: said.at, id: `m${said.id}`, text: said.text.slice(prefix.length), who: { address: said.author, bot: false, name: said.author ? (props.names.get(said.author.toLowerCase()) ? `@${props.names.get(said.author.toLowerCase())}` : Mention.short(said.author)) : 'Someone' } }))
  const told: Line[] = [{ at: 0, id: 'task', tag: 'Task from the lead', text: branch.task, who: { address: null, bot: true, name: 'Lead' } }]
  if (branch.funders.length) told.push({ at: 1, id: 'riders', text: `Ridden by ${branch.funders.map((funder) => `@${funder.handle} ${cash(funder.amount)}`).join(', ')}`, who: { address: null, bot: true, name: 'Swarm' } })
  const result = member.told ?? (member.state === 'failed' ? branch.error : null)
  if (result && member.state !== 'working') told.push({ at: 2, id: 'result', tag: `${crewWords[member.state]}${member.metric ? ` · ${member.metric}` : ''} · ${cash(String(member.spent))} spent`, text: result, who: { address: null, bot: true, name: 'AI' } })
  if (member.blockers) told.push({ at: 3, id: 'blockers', tag: 'Blockers', text: member.blockers, who: { address: null, bot: true, name: 'AI' } })
  const lines = [...told, ...posts]
  useLayoutEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [branch.id, lines.length])
  return (
    <section aria-label={`#${member.title}`} className="channel">
      <header className="channel-head">
        <div className="channel-top">
          <h1 className="channel-title"><ChannelMenu id={props.swarm} title={member.title} /></h1>
          <p className="channel-stats">
            {member.metric && <span><b>{member.metric}</b> best</span>}
            <span><b>{cash(String(member.spent))}</b> spent</span>
            {kids.length > 0 && <span><b>{kids.length}</b> sub-branch{kids.length === 1 ? '' : 'es'}</span>}
          </p>
          {props.onRide && <div className="channel-acts"><button className="btn btn-high channel-ride" onClick={(event) => props.onRide?.(event.currentTarget)} type="button">Ride it</button></div>}
        </div>
        <p className="channel-topic"><Mark checking={member.state === 'starved'} status={status} /><span>{crewWords[member.state]}</span><i aria-hidden="true">·</i><Inline text={props.swarmTitle} /><Faces funders={backersOf(branch)} riders={branch.funders.length} /></p>
      </header>
      <div className="channel-list" ref={scroller}>
        <div className="channel-intro">
          <p className="welcome-mark" aria-hidden="true">#</p>
          <h2><Inline text={member.title} /></h2>
          <p className="channel-note">A branch of the swarm's work: its task, what its agent found and what riders said about it.</p>
        </div>
        <Talk doing={member.state === 'working' ? { at: props.now, text: `Working on it · ${cash(String(member.spent))} spent so far` } : null} empty="Nothing here yet." lines={lines} now={props.now} />
        {kids.length > 0 && (
          <ol aria-label="Threads" className="talk">
            {kids.map((kid) => (
              <li className="msg starter" data-first="true" key={kid.id}>
                <span aria-hidden="true" className="avatar avatar-ai">✦</span>
                <div className="msg-col">
                  <p className="msg-who"><b>AI</b><time>sub-branch</time></p>
                  <Link className="starter-card" keep to={`${props.base}/c/${kid.id}`}>
                    <span className="starter-title"><Mark status={crewMarks[kid.state]} /><Inline text={kid.title} /></span>
                    {kid.summary && <span className="starter-why"><b>{crewWords[kid.state]}</b> <Inline text={kid.summary} /></span>}
                    <span className="starter-foot"><span className="starter-money">{cash(String(kid.spent))}</span>{kid.metric && <span>{kid.metric}</span>}<span className="starter-open">Open ›</span></span>
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Composer config={props.config} disabled={undefined} fine={`Posts in the swarm's #general too, starting with #${member.title}.`} label={`Message #${member.title}`} onPost={props.onPost} placeholder={`Message #${member.title.length > 40 ? `${member.title.slice(0, 40)}…` : member.title}`} />
    </section>
  )
}
