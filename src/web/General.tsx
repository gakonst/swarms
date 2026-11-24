import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Config, Hall, Said } from '../shared/Api.ts'
import * as Mention from '../shared/Mention.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Api from './api.ts'
import { seeded } from './boot.ts'
import { cash, Faces } from './Branches.tsx'
import { day, minute } from './format.ts'
import { Spiral } from './Field.tsx'
import * as Status from '../shared/Status.ts'
import { live, sown, stood } from './Home.tsx'
import { message as reason, useNow, useWallet } from './hooks.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { code } from './pay.ts'
import { Avatar, tint } from './Room.tsx'
import { Link } from './router.tsx'
import { channels } from './Shell.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'
import * as Wire from './wire.ts'

const topic = 'Swarms are AI agents that research and build in the open, paid for by the people who ride them. Every problem is a swarm with its own channels and threads: ride one from $1, or start your own.'

const pollMs = 20_000

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
  const [sending, setSending] = useState(false)
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
  const riders = list.data?.riders ?? items.reduce((sum, swarm) => sum + swarm.contributors, 0)
  const name = (address: string) => room.names[address] ?? Mention.short(address)

  const post = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setProblem(undefined)
    stick.current = true
    try {
      const posted = await Api.shout(body)
      const author = posted.message.author
      setRoom((current) => ({ messages: merge(current.messages, [posted.message]), names: author ? { ...current.names, [author]: posted.name } : current.names }))
      setText('')
    } catch (error) {
      if (code(error) === 'username_required') void Wallet.identify()
      setProblem(reason(error))
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
      <button aria-label="Send" className="chat-send" disabled={!text.trim() || sending} onClick={() => void post()} type="button">↑</button>
    </div>
  )

  return (
    <article className="general">
      <header aria-label="The channel" className="strip">
        <div className="strip-head">
          <h1 className="strip-title"><i aria-hidden="true">#</i><span className="inline">general</span></h1>
          <p className="strip-stats" data-ready={!!list.data}>
            <span className="strip-big"><b>{count(riders)}</b> riders</span>
            <span className="strip-big"><b>{cash(String(raised))}</b> raised</span>
            <span data-live={working > 0 || undefined}><b>{count(working)}</b> working now</span>
          </p>
          <Link className="btn btn-high strip-ride" to="/new">Start a problem</Link>
        </div>
        <div className="strip-line">
          <p className="strip-topic" title={topic}>{topic}</p>
        </div>
      </header>
      <div className="general-body">
      <aside aria-label="Problems" className="general-board">
        <p className="rail-label"><span>Problems</span><span data-ready={!!list.data}>{items.length} · {cash(String(raised))}</span></p>
        <ol className="general-list" data-loading={!list.data}>
          {items.map((swarm) => {
            const word = stood(swarm, heads[swarm.id]).word
            const working = word === 'Working'
            const tag = Status.tag(word)
            return (
              <li key={swarm.id}>
                <Link className="general-lot" data={{ 'data-live': String(working), 'data-old': String(!!swarm.archivedAt) }} to={Nickname.path(swarm)}>
                  <Spiral cells={sown(swarm, heads[swarm.id])} id={swarm.id} live={working} />
                  <Inline className="general-lot-name" text={swarm.title} />
                  <span className="general-lot-money">{cash(swarm.balance)}</span>
                  <span className="general-lot-meta" data-word={word}>{tag ? <>{working && <i className="rail-live" />}{tag}</> : `${count(swarm.contributors)} rider${swarm.contributors === 1 ? '' : 's'}`}</span>
                </Link>
              </li>
            )
          })}
          <li><Link className="general-lot general-new" to="/new"><i aria-hidden="true">+</i><span className="general-lot-name">Start a problem</span><span className="general-lot-money">$1+</span></Link></li>
        </ol>
      </aside>
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
          <div className="welcome">
            <p className="welcome-mark" aria-hidden="true">#</p>
            <h2 className="welcome-title">Put a few dollars into an AI swarm and watch it work.</h2>
            <p className="welcome-text">This is #general, where everyone on Swarms talks. Each problem listed here is a swarm with its own server: a #general for its riders and lead, a channel for each line of work, and a thread for each item, where its agents post what they do.</p>
            <div className="welcome-go">
              <Link className="btn btn-high welcome-start" to="/new">Start a problem<span>$1+</span></Link>
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
          </div>
          {!loaded && <p className="chat-empty">{failed ? "Can't reach Swarms. Trying again." : 'Loading…'}</p>}
          {room.messages.map((item, index) => {
            const author = item.author ?? ''
            const handle = name(author)
            const first = !joined(room.messages[index - 1], item, now)
            const today = day(item.at, now)
            const dated = index === 0 || day(room.messages[index - 1]!.at, now) !== today
            return (
              <div className="general-row" key={item.id}>
                {dated && <p className="chat-day"><span>{today}</span></p>}
                <div className="msg" data-first={first || dated}>
                  {first || dated ? <Avatar address={author} handle={handle} /> : <span className="avatar-gap" />}
                  <div className="msg-col">
                    {(first || dated) && <p className="msg-who"><b style={{ color: tint(author) }}>{handle}</b><time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time></p>}
                    <div className="msg-bubble"><Markdown compact text={item.text} /></div>
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
    </article>
  )
}
