import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Config, Hall, Said } from '../shared/Api.ts'
import * as Mention from '../shared/Mention.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Api from './api.ts'
import * as Outbox from './outbox.ts'
import { seeded } from './boot.ts'
import { cash, Faces } from './Branches.tsx'
import { day, minute } from './format.ts'
import { live } from './Home.tsx'
import { message as reason, useNow, useWallet } from './hooks.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { code } from './pay.ts'
import { Divider } from './Divider.tsx'
import { useHello, Welcome } from './Hello.tsx'
import { Avatar, draft, keepDraft, tint, Unsent } from './Room.tsx'
import { Link } from './router.tsx'
import { channels } from './Shell.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'
import * as Wire from './wire.ts'

const topic = 'Swarms are AI agents that research and build in the open, paid for by the people who ride them. Every problem is a swarm with its own channels and threads: ride one from $1, or start your own.'

const pollMs = 20_000

const named = new Map<string, string>()

Outbox.define('general', (draft) =>
  Api.shout(draft.text.trim()).then(
    (posted) => {
      if (posted.message.author) named.set(posted.message.author.toLowerCase(), posted.name)
      return posted.message
    },
    (error: unknown) => {
      if (code(error) === 'username_required') void Wallet.identify()
      throw error
    },
  ),
)

type Room = { messages: readonly Said[]; names: Readonly<Record<string, string>> }

function merge(list: readonly Said[], more: readonly Said[]) {
  if (!more.length) return list
  const byId = new Map(list.map((item) => [item.id, item]))
  for (const item of more) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

function count(value: number) {
  return value.toLocaleString('en-US')
}

function joined(a: Said | undefined, b: Said | undefined, now: number) {
  return !!a && !!b && a.author === b.author && b.at - a.at < 5 * 60_000 && day(a.at, now) === day(b.at, now)
}

export function General(props: { config: Config | undefined }) {
  const list = Wire.useSwarms()
  const hello = useHello()
  const wallet = useWallet()
  const now = useNow(60_000)
  const [room, setRoom] = useState<Room>(() => {
    const seed = seeded<Hall>('general')
    return { messages: seed?.messages ?? [], names: seed?.names ?? {} }
  })
  const [loaded, setLoaded] = useState(() => seeded<Hall>('general') !== undefined)
  const [failed, setFailed] = useState(false)
  const [wired, setWired] = useState(false)
  const [text, setText] = useState('')
  const restored = useRef(false)
  useLayoutEffect(() => {
    if (!restored.current) {
      restored.current = true
      const kept = draft('general')
      if (kept) return setText(kept)
    }
    keepDraft('general', text)
  }, [text])
  const [signing, setSigning] = useState(false)
  const [problem, setProblem] = useState<string>()
  const scroller = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(false)
  const last = useRef(room.messages.at(-1)?.id ?? 0)

  const load = useCallback(async (after: number) => {
    try {
      const read = await Api.general(after ? { after } : {})
      setRoom((current) => ({ messages: merge(after ? current.messages : [], read.messages), names: { ...current.names, ...read.names } }))
      setLoaded(true)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    last.current = room.messages.at(-1)?.id ?? 0
  }, [room.messages])

  useEffect(() => {
    if (!seeded<Hall>('general')) void load(last.current)
    return Api.hall((event) => {
      if (event.type === 'open' || event.type === 'closed') setWired(event.type === 'open')
      if (event.type === 'welcome') void load(last.current)
      if (event.type === 'open') Outbox.resume()
      if (event.type === 'said') {
        const author = event.message.author
        setRoom((current) => ({ messages: merge(current.messages, [event.message]), names: author ? { ...current.names, [author]: event.name } : current.names }))
      }
    })
  }, [load])

  useEffect(() => {
    if (wired) return
    const timer = setInterval(() => void load(last.current), pollMs)
    return () => clearInterval(timer)
  }, [wired, load])

  const newest = room.messages.at(-1)?.id
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  }, [newest])

  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`
  }, [text])

  const items = channels(list.data)
  const heads = list.data?.heads ?? {}
  const open = items.filter((swarm) => !swarm.archivedAt)
  const hot = open.slice(0, 3)
  const working = open.filter((swarm) => live(swarm, heads[swarm.id])).length
  const raised = items.reduce((sum, swarm) => sum + Number(swarm.balance), 0)
  const spent = items.reduce((sum, swarm) => sum + Number(swarm.spent), 0)
  const left = items.reduce((sum, swarm) => sum + Math.max(0, Number(swarm.remaining)), 0)
  const proven = items.reduce((sum, swarm) => sum + (heads[swarm.id]?.proven ?? 0), 0)
  const riders = list.data?.riders ?? items.reduce((sum, swarm) => sum + swarm.contributors, 0)
  const name = (address: string) => room.names[address] ?? named.get(address.toLowerCase()) ?? Mention.short(address)

  const drafts = Outbox.useDrafts('general')
  const outbox = Outbox.shown('general', room.messages, drafts)
  const landed = outbox.landed.join()
  useEffect(() => {
    for (const client of outbox.landed) Outbox.forget(client)
  }, [landed])
  const shown = outbox.shown
  const tail = shown.at(-1)
  const bottom = tail ? Outbox.key(tail) : undefined
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  }, [bottom])

  const post = () => {
    const body = text.trim()
    const author = wallet.session?.address
    if (!body || !author) return
    setProblem(undefined)
    stick.current = true
    setText('')
    if (wallet.account?.name) named.set(author.toLowerCase(), wallet.account.name)
    Outbox.send('general', { after: last.current, author, text: body })
  }

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {
      event.preventDefault()
      post()
    }
  }

  const signIn = async () => {
    if (!props.config) return
    setSigning(true)
    setProblem(undefined)
    try {
      await Wallet.signIn(props.config)
    } catch (error) {
      setProblem(reason(error))
    } finally {
      setSigning(false)
    }
  }

  const foot = !wallet.session ? (
    <button className="chat-gate" disabled={!props.config || signing || wallet.pending} onClick={() => void signIn()} type="button">
      {signing ? 'Signing in…' : 'Sign in to chat'}
    </button>
  ) : wallet.account && !wallet.account.name ? (
    <Username why="Pick a name to chat." />
  ) : (
    <div className="chat-bar">
      <textarea aria-label="Message #general" enterKeyHint="send" maxLength={Mention.maxText} onChange={(event) => setText(event.target.value)} onKeyDown={keys} placeholder="Message #general" ref={area} rows={1} value={text} />
      <button aria-label="Send" className="chat-send" disabled={!text.trim()} onClick={post} type="button">↑</button>
    </div>
  )

  return (
    <article className="swarm-shell general">
      <header aria-label="The channel" className="strip">
        <div className="strip-head">
          <h1 className="strip-title"><i aria-hidden="true">#</i><span className="inline">general</span></h1>
          <p className="strip-stats" data-ready={!!list.data}>
            <span className="strip-big"><b>{count(riders)}</b> riders</span>
            <span className="strip-big"><b>{cash(String(raised))}</b> raised</span>
            <span data-live={working > 0 || undefined}><b>{count(working)}</b> working now</span>
          </p>
          <Link className="btn btn-high strip-ride" to="/new">Start a swarm</Link>
        </div>
        {hello !== 'new' && <div className="strip-line">
          <p className="strip-topic" title={topic}>{topic}</p>
        </div>}
      </header>
      <div className="panel panel-chat">
      <section aria-label="Chat" className="chat general-chat">
        <div
          aria-live="polite"
          className="chat-list"
          onScroll={(event) => {
            const element = event.currentTarget
            stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
          }}
          ref={scroller}
        >
          {hello === 'new' ? <Welcome /> : <div className="welcome">
            <p className="welcome-mark" aria-hidden="true">#</p>
            <h2 className="welcome-title">Put a few dollars into an AI swarm and watch it work.</h2>
            <p className="welcome-text">This is #general, where everyone on Swarms talks. Each problem listed here is a swarm with its own server: a #general for its riders and lead, a channel for each line of work, and a thread for each item, where its agents post what they do.</p>
            <div className="welcome-go">
              <Link className="btn btn-high welcome-start" to="/new">Start a swarm<span>$1+</span></Link>
              {hot[0] && <Link className="btn btn-medium welcome-ride" to={Nickname.path(hot[0])}>Ride #<Inline text={hot[0].title} /></Link>}
            </div>
            {hot.length > 0 && (
              <ol aria-label="Hot channels" className="welcome-hot">
                {hot.map((swarm) => (
                  <li key={swarm.id}>
                    <Link className="welcome-channel" data={{ 'data-live': String(live(swarm, heads[swarm.id])) }} to={Nickname.path(swarm)}>
                      <i aria-hidden="true">#</i>
                      <Inline className="welcome-name" text={swarm.title} />
                      <span className="welcome-money">{cash(swarm.balance)}</span>
                      <span className="welcome-faces"><Faces funders={list.data?.funders?.[swarm.id] ?? []} riders={swarm.contributors} /></span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>}
          {!loaded && <p className="chat-empty">{failed ? "Can't reach Swarms. Trying again." : 'Loading…'}</p>}
          {shown.map((item, index) => {
            const author = item.author ?? ''
            const handle = name(author)
            const first = !joined(shown[index - 1], item, now)
            const today = day(item.at, now)
            const dated = index === 0 || day(shown[index - 1]!.at, now) !== today
            return (
              <div className="general-row" data-sending={item.sending} key={Outbox.key(item)}>
                {dated && <p className="chat-day"><span>{today}</span></p>}
                <div className="msg" data-first={first || dated}>
                  {first || dated ? <Avatar address={author} handle={handle} /> : <span className="avatar-gap" />}
                  <div className="msg-col">
                    {(first || dated) && <p className="msg-who"><b style={{ color: tint(author) }}>{handle}</b><time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time></p>}
                    <div className="msg-bubble"><Markdown compact text={item.text} /></div>
                    {item.sending === 'failed' && item.client && <Unsent client={item.client} error={item.error} />}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <footer className="chat-foot">
          {problem && <p className="chat-error" role="alert">{problem}</p>}
          {foot}
        </footer>
      </section>
      </div>
      <Divider label="Resize the chat and the artifacts" name="swarm" />
      <section aria-label="About Swarms" className="pane general-pane">
        <nav aria-label="Artifacts" className="tabs"><span aria-current="page" className="tab">How it works</span></nav>
        <div className="panel panel-page general-about">
          <dl className="general-facts" data-ready={!!list.data}>
            <div><dt>Open problems</dt><dd>{count(open.length)}</dd></div>
            <div><dt>Results proven</dt><dd>{count(proven)}</dd></div>
            <div><dt>Spent by agents</dt><dd>{cash(String(spent))}</dd></div>
            <div><dt>Left to spend</dt><dd>{cash(String(left))}</dd></div>
          </dl>
          <ol className="general-how">
            <li><b>Start a swarm</b><span>Write the goal and put in $1 or more. A lead agent takes it on.</span></li>
            <li><b>Ride it</b><span>Anyone adds dollars to a swarm they want to see go further.</span></li>
            <li><b>Watch it work</b><span>Its agents post in its channels and threads while the money lasts. Everything it makes is public.</span></li>
          </ol>
          <p className="general-go">
            <Link className="btn btn-high" to="/new">Start a swarm</Link>
            <Link className="btn btn-medium" to="/faq">FAQ</Link>
          </p>
        </div>
      </section>
    </article>
  )
}
