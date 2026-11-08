import { type KeyboardEvent, memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Config, Detail, Me, Member, Room as RoomState, Said } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import { maxNote } from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Api from './api.ts'
import { seeded } from './boot.ts'
import { code } from './Contribute.tsx'
import { day, minute, usd } from './format.ts'
import { message as reason, useNow, useVisible, useWallet } from './hooks.ts'
import { gate as gated, seated, useRoster } from './Steering.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'
import * as Wire from './wire.ts'

const roomMs = { closed: 15_000, open: 60_000 }

const kept = new Map<string, { members: readonly Member[]; messages: readonly Said[] }>()

export function tint(address: string) {
  let value = 0
  for (const char of address.toLowerCase()) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${value % 360} 38% 36%)`
}

export function Avatar(props: { address: string; handle: string; size?: 'small' }) {
  return (
    <span aria-hidden className="avatar" data-size={props.size} style={{ background: tint(props.address) }}>
      {props.handle.startsWith('0x') ? '·' : props.handle.charAt(0).toUpperCase()}
    </span>
  )
}

function backing(text: string) {
  return /^(@[\w-]+|0x[0-9a-f]{4}…[0-9a-f]{4}) (backed|pledged|sent|funded|put)\b/.test(text)
}

function friendly(text: string) {
  const line = dollars(text).replace(/\.$/, '')
  const behind = /^(\S+) (?:pledged|sent|put|put the) (\$[\d.,]+)(?: [A-Za-z.]+)?(?: they sent)? behind "(.+)"$/.exec(line)
  if (behind) return `${behind[1]} backed "${behind[3]}" with ${behind[2]}`
  const sent = /^(\S+) (?:pledged|sent|funded it with) (\$[\d.,]+)$/.exec(line)
  if (sent) return `${sent[1]} backed it with ${sent[2]}`
  return line
}

function dollars(text: string) {
  return Answer.amounts(text.replace(/(\d[\d,]*(?:\.\d+)?) (?:MACH|OUSD|USDC\.e|pathUSD|USDT0)\b/g, (_, amount: string) => `$${amount}`))
}

function noted(text: string) {
  return /"([^"]{3,})"/.exec(text)?.[1]
}

function merge(list: readonly Said[], more: readonly Said[]) {
  if (!more.length) return list
  const byId = new Map(list.map((item) => [item.id, item]))
  for (const item of more) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

type Row =
  | { at: number; key: string; kind: 'day'; label: string }
  | { at: number; key: string; kind: 'ai'; artifact: Said['artifact']; text: string }
  | { at: number; key: string; kind: 'backed'; note: string | undefined; text: string }
  | { at: number; first: boolean; item: Said; key: string; kind: 'said'; last: boolean }

function rows(messages: readonly Said[], now: number): Row[] {
  const shown = messages.filter((item) => item.author || item.artifact || item.text.startsWith('Update: ') || backing(item.text))
  const out: Row[] = []
  let label = ''
  shown.forEach((item, index) => {
    const today = day(item.at, now)
    if (today !== label) {
      label = today
      out.push({ at: item.at, key: `d${item.id}`, kind: 'day', label })
    }
    if (item.artifact || !item.author) {
      if (item.artifact || item.text.startsWith('Update: ')) out.push({ artifact: item.artifact, at: item.at, key: `m${item.id}`, kind: 'ai', text: item.artifact ? item.text.replace(/^New artifact: /, '') : item.text.slice(8) })
      else out.push({ at: item.at, key: `m${item.id}`, kind: 'backed', note: noted(item.text), text: friendly(item.text) })
      return
    }
    const previous = shown[index - 1]
    const next = shown[index + 1]
    const joined = (a: Said | undefined, b: Said | undefined) => !!a && !!b && a.author === b.author && b.at - a.at < 5 * 60_000 && day(a.at, now) === day(b.at, now) && !a.steer && !b.steer
    out.push({ at: item.at, first: !joined(previous, item), item, key: `m${item.id}`, kind: 'said', last: !joined(item, next) })
  })
  return out
}

function Words(props: { handles: ReadonlySet<string>; me: ReadonlySet<string>; text: string }) {
  return (
    <>
      {Mention.pieces(props.text).map((piece, index) => {
        const name = piece.slice(1).toLowerCase()
        if (!piece.startsWith('@') || (name !== 'swarm' && !props.handles.has(name))) return piece
        return (
          <span className="mention" data-me={props.me.has(name)} data-swarm={name === 'swarm'} key={index}>
            {name === 'swarm' ? '@AI' : piece}
          </span>
        )
      })}
    </>
  )
}

export const Room = memo(function Room(props: {
  config: Config | undefined
  onArtifact: (slug: string) => void
  onBack: (note: string) => void
  onMessages?: (messages: readonly Said[], me: Me | null, members: readonly Member[], online: readonly string[], watching: number) => void
  onResults?: () => void
  onUnread: (count: number) => void
  swarm: Detail
  visible: boolean
}) {
  const id = props.swarm.id
  const wallet = useWallet()
  const token = wallet.session?.token
  const [seed] = useState(() => kept.get(id) ?? seeded<RoomState>(`room:${id}`))
  const [messages, setMessages] = useState<readonly Said[]>(() => seed?.messages ?? [])
  const [members, setMembers] = useState<readonly Member[]>(() => seed?.members ?? [])
  const [me, setMe] = useState<Me | null>(null)
  const [loaded, setLoaded] = useState(!!seed)
  const [failed, setFailed] = useState<string>()
  const [earlier, setEarlier] = useState(() => (seed?.messages.length ?? 0) >= 100)
  const [online, setOnline] = useState<readonly string[]>([])
  const [watching, setWatching] = useState(0)
  const [typing, setTyping] = useState<Readonly<Record<string, number>>>({})
  const ticking = Object.values(typing).some((until) => until > Date.now())
  const now = useNow(ticking ? 1000 : 60_000)
  const [text, setText] = useState('')
  const [ai, setAi] = useState(false)
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const [sending, setSending] = useState(false)
  const [signing, setSigning] = useState(false)
  const [problem, setProblem] = useState<{ short?: boolean; text: string }>()
  const [fresh, setFresh] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const last = useRef(0)
  const typed = useRef(0)
  const fetched = useRef(0)

  const load = useCallback(
    async (after: number) => {
      try {
        const room = await Api.room(id, after ? { after } : {})
        setMessages((previous) => merge(after ? previous : [], room.messages))
        if (!after) setEarlier(room.messages.length >= 100)
        setMembers(room.members)
        setMe(room.me)
        setLoaded(true)
        setFailed(undefined)
        fetched.current = Date.now()
        if (token && !room.me) Wallet.signOut()
      } catch (error) {
        setFailed(reason(error))
      }
    },
    [id, token],
  )

  useEffect(() => {
    last.current = messages.at(-1)?.id ?? 0
    kept.set(id, { members, messages })
  }, [id, members, messages])

  const [connected, setConnected] = useState(() => Wire.connected(id))
  const wired = Wire.useWire(id, 'room', (signal) => {
    if (signal.type === 'open' || signal.type === 'closed') setConnected(signal.type === 'open')
    if (signal.type === 'said') setMessages((previous) => merge(previous, [signal.message]))
    if (signal.type === 'presence') {
      setOnline(signal.online)
      setWatching(signal.watching)
    }
    if (signal.type === 'typing') setTyping((previous) => ({ ...previous, [signal.address]: Date.now() + 4000 }))
    if (Wire.stirred(signal, 'members')) void load(last.current)
  })

  useEffect(() => {
    if (!seed || token || fetched.current) void load(seed || fetched.current ? last.current : 0)
  }, [load])

  const shown = useVisible()
  const away = useRef(false)
  useEffect(() => {
    if (!shown) {
      away.current = true
      return
    }
    if (wired !== 'down') return
    const every = connected ? roomMs.open : roomMs.closed
    if (away.current || Date.now() - fetched.current > every) void load(last.current)
    away.current = false
    const timer = setInterval(() => void load(last.current), every)
    return () => clearInterval(timer)
  }, [connected, load, shown, wired])

  const backers = useRef(props.swarm.contributors)
  useEffect(() => {
    if (backers.current === props.swarm.contributors) return
    backers.current = props.swarm.contributors
    if (loaded && wired !== 'live') void load(last.current)
  }, [props.swarm.contributors, loaded, load, wired])

  useEffect(() => {
    if (token) Wire.line(id)?.hello()
  }, [id, token])

  const onMessages = props.onMessages
  useEffect(() => {
    onMessages?.(messages, me, members, online, watching)
  }, [messages, me, members, online, watching, onMessages])

  const newest = messages.at(-1)?.id
  const seen = useRef<number | undefined>(undefined)
  const onUnread = props.onUnread
  const myself = me?.address
  useEffect(() => {
    if (newest === undefined) return
    if (seen.current === undefined || props.visible) seen.current = newest
    const after = seen.current
    onUnread(props.visible ? 0 : messages.filter((item) => item.id > after && item.author !== null && item.author !== myself).length)
  }, [messages, newest, props.visible, onUnread, myself])

  useLayoutEffect(() => {
    const element = list.current
    if (!element || newest === undefined) return
    if (stick.current) element.scrollTop = element.scrollHeight
    else setFresh((count) => count + 1)
  }, [newest])

  useLayoutEffect(() => {
    const element = list.current
    if (element && props.visible && stick.current) element.scrollTop = element.scrollHeight
  }, [props.visible])

  useEffect(() => {
    const element = list.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`
  }, [text])

  const called = new Map(members.map((member) => [member.address, member.handle]))
  const handleOf = (address: string) => called.get(address as `0x${string}`) ?? Mention.short(address)
  const handles = new Set(members.flatMap((member) => [member.handle, Mention.handle(member.address)]))
  const myNames = new Set(me ? [me.handle, Mention.handle(me.address)] : [])
  const roster = useRoster(id, props.swarm.steering)
  const team = props.swarm.steering === 'team'
  const seat = seated(roster, me?.address)
  const door = gated(wallet, props.swarm.steering, roster, { me })
  const mine = typeof door === 'object' && door.at === 'open' ? (me ?? undefined) : undefined
  const query = mine && !closed ? /(^|\s)@([a-z0-9_-]*)$/i.exec(text.slice(0, caret)) : null
  const options = query
    ? [
        { handle: 'swarm', hint: 'tell the AI what to try' },
        ...members.filter((member) => !member.handle.startsWith('0x') && member.address !== me?.address).map((member) => ({ handle: member.handle, hint: '' })),
      ]
        .filter((option) => option.handle.startsWith((query[2] ?? '').toLowerCase()))
        .slice(0, 6)
    : []
  const steering = ai || Mention.steers(text)
  const idea = ai ? text.replace(/\s+/g, ' ').trim() : Mention.idea(text)
  const typers = Object.entries(typing).filter(([address, until]) => until > now && address !== me?.address).map(([address]) => handleOf(address))
  const here = members.filter((member) => online.includes(member.address)).slice(0, 4)

  const focus = (at: number) =>
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(at, at)
    })

  const complete = (handle: string) => {
    if (!query) return
    const start = caret - (query[2]?.length ?? 0) - 1
    if (handle === 'swarm') {
      const next = `${text.slice(0, start)}${text.slice(caret)}`.trimStart()
      setText(next)
      setAi(true)
      setCaret(start)
      setPick(0)
      return focus(Math.min(start, next.length))
    }
    const next = `${text.slice(0, start)}@${handle} ${text.slice(caret)}`
    const at = start + handle.length + 2
    setText(next)
    setCaret(at)
    setPick(0)
    focus(at)
  }

  const post = async (body: string) => {
    setSending(true)
    setProblem(undefined)
    try {
      const posted = await Api.say(id, { text: body })
      setMe(posted.me)
      setMessages((previous) => merge(previous, [posted.message]))
      stick.current = true
      setFresh(0)
      setText('')
      setCaret(0)
    } catch (error) {
      if (code(error) === 'username_required') void Wallet.identify()
      setProblem({ short: code(error) === 'insufficient_balance', text: reason(error) })
    } finally {
      setSending(false)
    }
  }

  const submit = () => {
    const body = text.trim()
    if (!body || sending || !mine) return
    if (steering) {
      if (team && !seat) return setProblem({ text: 'Only its team can tell the AI what to do.' })
      if (idea.length < 3) return setProblem({ text: 'Say what the AI should try.' })
      if (idea.length > maxNote) return setProblem({ text: `Keep it under ${maxNote} characters.` })
      setProblem(undefined)
      setText('')
      setCaret(0)
      setAi(false)
      return props.onBack(idea)
    }
    void post(body)
  }

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setPick((index) => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        complete(options[Math.min(pick, options.length - 1)]?.handle ?? 'swarm')
        return
      }
      if (event.key === 'Escape') {
        setClosed(true)
        return
      }
    }
    if (event.key === 'Backspace' && ai && !text) {
      setAi(false)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {
      event.preventDefault()
      submit()
    }
  }

  const signIn = async () => {
    if (!props.config) return
    setSigning(true)
    setProblem(undefined)
    try {
      await Wallet.signIn(props.config)
    } catch (error) {
      setProblem({ text: reason(error) })
    } finally {
      setSigning(false)
    }
  }

  const older = async () => {
    const first = messages[0]
    const element = list.current
    if (!first || !element) return
    const height = element.scrollHeight
    const room = await Api.room(id, { before: first.id }).catch(() => undefined)
    if (!room) return
    setEarlier(room.messages.length >= 100)
    setMessages((previous) => merge(previous, room.messages))
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - height
    })
  }

  const listed = rows(messages, now)

  let foot: ReactNode
  if (door === 'checking') foot = <div aria-busy="true" className="chat-bar chat-bar-wait" />
  else if (door === 'signed-out')
    foot = (
      <button className="chat-gate" disabled={!props.config || signing} onClick={() => void signIn()} type="button">
        {signing ? 'Signing in…' : 'Sign in to chat'}
      </button>
    )
  else if (door === 'unnamed') foot = <Username why="Pick a name to chat." />
  else if (door.at === 'not-member')
    foot = (
      <button className="chat-gate" onClick={() => props.onBack('')} type="button">
        Back it to chat
      </button>
    )
  else
    foot = (
      <div className="chat-bar" data-ai={steering}>
        {options.length > 0 && (
          <ol className="chat-mentions" role="listbox">
            {options.map((option, index) => (
              <li key={option.handle}>
                <button
                  aria-selected={index === pick}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    complete(option.handle)
                  }}
                  role="option"
                  type="button"
                >
                  <b data-swarm={option.handle === 'swarm'}>{option.handle === 'swarm' ? '✦ AI' : `@${option.handle}`}</b>
                  {option.hint && <span>{option.hint}</span>}
                </button>
              </li>
            ))}
          </ol>
        )}
        <button
          aria-label={ai ? 'Talk to people' : 'Tell the AI'}
          aria-pressed={ai}
          className="chat-ai"
          onClick={() => {
            setAi(!ai)
            area.current?.focus()
          }}
          title={ai ? 'Talk to people' : 'Tell the AI what to try'}
          type="button"
        >
          ✦
        </button>
        <textarea
          aria-label={steering ? 'What should the AI try?' : 'Message'}
          enterKeyHint="send"
          maxLength={Mention.maxText}
          onChange={(event) => {
            setText(event.target.value)
            setCaret(event.target.selectionStart)
            setPick(0)
            setClosed(false)
            if (Date.now() - typed.current > 3000) {
              typed.current = Date.now()
              Wire.line(id)?.typing()
            }
          }}
          onKeyDown={keys}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          placeholder={ai ? 'What should the AI try?' : 'Message'}
          ref={area}
          rows={1}
          value={text}
        />
        <button aria-label={steering ? 'Back it' : 'Send'} className="chat-send" data-ai={steering} disabled={!text.trim() || sending} onClick={submit} type="button">
          {steering ? 'Back it' : '↑'}
        </button>
      </div>
    )

  return (
    <section aria-label="Chat" className="chat">
      <header className="chat-here">
        {here.length > 0 && <span className="chat-faces">{here.map((member) => <Avatar address={member.address} handle={member.handle} key={member.address} size="small" />)}</span>}
        <span>{props.swarm.contributors} backer{props.swarm.contributors === 1 ? '' : 's'}</span>
        {watching > 0 && <span className="chat-live"><i />{watching} here</span>}
      </header>
      <div
        aria-live="polite"
        className="chat-list"
        onScroll={(event) => {
          const element = event.currentTarget
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
          if (stick.current) setFresh(0)
        }}
        ref={list}
      >
        {earlier && <button className="chat-earlier" onClick={() => void older()} type="button">Earlier messages</button>}
        {!loaded && <p className="chat-empty">{failed ? `Couldn't load the chat. ${failed}` : 'Loading…'}</p>}
        {loaded && !listed.length && <p className="chat-empty">No messages yet. Say hi.</p>}
        {listed.map((row) => {
          if (row.kind === 'day') return <p className="chat-day" key={row.key}><span>{row.label}</span></p>
          if (row.kind === 'backed')
            return (
              <div className="chat-event" key={row.key}>
                <p>
                  <span aria-hidden="true">♥</span> <Words handles={handles} me={myNames} text={row.text} />
                </p>
                {row.note && <button onClick={() => props.onBack(row.note ?? '')} type="button">+ Back this</button>}
              </div>
            )
          if (row.kind === 'ai')
            return (
              <div className="msg msg-ai" data-first="true" data-last="true" key={row.key}>
                <span aria-hidden="true" className="avatar avatar-ai">✦</span>
                <div className="msg-col">
                  <p className="msg-who"><b>AI</b><time dateTime={new Date(row.at).toISOString()}>{minute(row.at)}</time></p>
                  {row.artifact ? (
                    <button className="msg-card" onClick={() => row.artifact && props.onArtifact(row.artifact.slug)} type="button">
                      <small>New result</small>
                      <b>{row.artifact.title}</b>
                      <span>Open →</span>
                    </button>
                  ) : (
                    <button className="msg-bubble msg-update" disabled={!props.onResults} onClick={props.onResults} type="button">
                      <span>{Answer.excerpt(row.text, 320)}</span>
                      <small>See results →</small>
                    </button>
                  )}
                </div>
              </div>
            )
          const item = row.item
          const author = item.author ?? ''
          const handle = handleOf(author)
          const self = author === me?.address
          return (
            <div className="msg" data-first={row.first} data-last={row.last} data-me={self} data-mentioned={!!me && item.mentions.includes(me.address)} key={row.key}>
              {!self && (row.last ? <Avatar address={author} handle={handle} /> : <span className="avatar-gap" />)}
              <div className="msg-col">
                {row.first && !self && <p className="msg-who"><b style={{ color: tint(author) }}>{handle.startsWith('0x') ? Mention.short(author) : handle}</b><time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time></p>}
                <p className="msg-bubble">
                  <Words handles={handles} me={myNames} text={item.text} />
                </p>
                {item.steer && (
                  <p className="msg-steer">
                    <span>✦ Told the AI · {usd(item.steer.amount)}</span>
                    <button onClick={() => props.onBack(item.steer?.note ?? '')} type="button">+ Back this</button>
                  </p>
                )}
                {self && row.last && <time className="msg-time" dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>}
              </div>
            </div>
          )
        })}
      </div>
      {fresh > 0 && (
        <button
          className="chat-jump"
          onClick={() => {
            list.current?.scrollTo({ behavior: 'smooth', top: list.current.scrollHeight })
            stick.current = true
            setFresh(0)
          }}
          type="button"
        >
          New messages ↓
        </button>
      )}
      <footer className="chat-foot">
        <p className="chat-typing" data-on={typers.length > 0}>{typers.length ? <><i /><i /><i /> {typers.slice(0, 2).join(', ')} {typers.length === 1 ? 'is' : 'are'} typing</> : null}</p>
        {problem && (
          <p className="chat-error" role="alert">
            {problem.text}
            {problem.short && <button onClick={() => props.onBack(idea)} type="button">Back it →</button>}
          </p>
        )}
        {foot}
      </footer>
    </section>
  )
})
