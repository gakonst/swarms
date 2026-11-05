import { type KeyboardEvent, memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Config, Detail, Me, Member, Room as RoomState, Said, Way } from '../shared/Api.ts'
import { seeded } from './boot.ts'
import * as Answer from '../shared/Answer.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Api from './api.ts'
import { percent, usd, minute } from './format.ts'
import { message as reason, useNow, useVisible, useWallet } from './hooks.ts'
import { code } from './Pledge.tsx'
import { seated, Steering, useRoster } from './Steering.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'

const ways = { budget: 'daily budget', machine: 'machine', pledge: 'pledge', transfer: 'transfer' } as const satisfies Record<Way, string>

export function tint(address: string) {
  let value = 0
  for (const char of address.toLowerCase()) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${value % 360} 38% 36%)`
}

function arrived(text: string) {
  return /^(@[\w-]+|0x[0-9a-f]{4}…[0-9a-f]{4}) (pledged|sent|set a budget|funded|put|moved)\b/.test(text) || /^New artifact:/.test(text)
}

function merge(list: readonly Said[], more: readonly Said[]) {
  if (!more.length) return list
  const byId = new Map(list.map((item) => [item.id, item]))
  for (const item of more) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}


export function Avatar(props: { address: string; handle: string; size?: 'small' }) {
  return (
    <span aria-hidden className="avatar" data-size={props.size} style={{ background: tint(props.address) }}>
      {props.handle.startsWith('0x') ? '·' : props.handle.charAt(0).toUpperCase()}
    </span>
  )
}

function Words(props: { handles: ReadonlySet<string>; me: ReadonlySet<string>; text: string }) {
  return (
    <>
      {Mention.pieces(props.text).map((piece, index) => {
        const name = piece.slice(1).toLowerCase()
        if (!piece.startsWith('@') || (name !== 'swarm' && !props.handles.has(name))) return piece
        return (
          <span className="mention" data-me={props.me.has(name)} data-swarm={name === 'swarm'} key={index}>
            {piece}
          </span>
        )
      })}
    </>
  )
}

function Backed(props: { onBack: ((note: string) => void) | undefined; steer: NonNullable<Said['steer']> }) {
  const steer = props.steer
  return (
    <button className="said-backed" disabled={!props.onBack} onClick={() => props.onBack?.(steer.note)} type="button" title={`${usd(steer.weight)} in all behind this idea, ${percent(steer.share)} of the money. ${steer.live ? 'Reached the agent at once.' : 'Read when it resumes.'}`}>
      {usd(steer.amount)}{props.onBack && <b aria-hidden="true">+</b>}
    </button>
  )
}

export const Room = memo(function Room(props: {
  config: Config | undefined
  onArtifact: (slug: string) => void
  onBack: (note: string) => void
  onMessages?: (messages: readonly Said[], me: Me | null, members: readonly Member[], online: readonly string[], watching: number) => void
  onSteered: () => void
  onTranscript?: () => void
  onUnread: (count: number) => void
  swarm: Detail
  visible: boolean
}) {
  const id = props.swarm.id
  const done = props.swarm.status === 'done'
  const wallet = useWallet()
  const token = wallet.session?.token
  const [seed] = useState(() => seeded<RoomState>(`room:${props.swarm.id}`))
  const [messages, setMessages] = useState<readonly Said[]>(() => seed?.messages ?? [])
  const [members, setMembers] = useState<readonly Member[]>(() => seed?.members ?? [])
  const [me, setMe] = useState<Me | null>(null)
  const [loaded, setLoaded] = useState(!!seed)
  const [failed, setFailed] = useState<string>()
  const [earlier, setEarlier] = useState(() => (seed?.messages.length ?? 0) >= 100)
  const [online, setOnline] = useState<readonly string[]>([])
  const [watching, setWatching] = useState(0)
  const [typing, setTyping] = useState<Readonly<Record<string, number>>>({})
  const now = useNow(1000, Object.values(typing).some((until) => until > Date.now()))
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const [sending, setSending] = useState(false)
  const [signing, setSigning] = useState(false)
  const [problem, setProblem] = useState<{ short?: boolean; text: string }>()
  const [fresh, setFresh] = useState(0)
  const list = useRef<HTMLOListElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const line = useRef<Api.Line | undefined>(undefined)
  const stick = useRef(true)
  const last = useRef(0)
  const typed = useRef(0)

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
        if (token && !room.me) Wallet.signOut()
      } catch (error) {
        setFailed(reason(error))
      }
    },
    [id, token],
  )

  useEffect(() => {
    last.current = messages.at(-1)?.id ?? 0
  }, [messages])

  useEffect(() => {
    void load(0)
  }, [load])

  const shown = useVisible()
  const away = useRef(false)
  useEffect(() => {
    if (!shown) {
      away.current = true
      return
    }
    if (away.current) void load(last.current)
    away.current = false
    const timer = setInterval(() => void load(last.current), 15_000)
    return () => clearInterval(timer)
  }, [load, shown])

  const backers = useRef(props.swarm.contributors)
  useEffect(() => {
    if (backers.current === props.swarm.contributors) return
    backers.current = props.swarm.contributors
    if (loaded) void load(last.current)
  }, [props.swarm.contributors, loaded, load])

  useEffect(() => {
    const connection = Api.chatter(id, (event) => {
      if (event.type === 'open') void load(last.current)
      if (event.type === 'said') setMessages((previous) => merge(previous, [event.message]))
      if (event.type === 'presence') {
        setOnline(event.online)
        setWatching(event.watching)
      }
      if (event.type === 'typing') setTyping((previous) => ({ ...previous, [event.address]: Date.now() + 4000 }))
    })
    line.current = connection
    return () => {
      connection.close()
      line.current = undefined
    }
  }, [id, load])

  useEffect(() => {
    if (token) line.current?.hello()
  }, [token])

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

  useEffect(() => {
    const element = list.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const called = new Map(members.map((member) => [member.address, member.handle]))
  const handleOf = (address: string) => called.get(address as `0x${string}`) ?? Mention.short(address)
  const handles = new Set(members.flatMap((member) => [member.handle, Mention.handle(member.address)]))
  const myNames = new Set(me ? [me.handle, Mention.handle(me.address)] : [])
  const roster = useRoster(id, props.swarm.steering)
  const team = props.swarm.steering === 'team'
  const seat = seated(roster, me?.address)
  const unnamed = !!token && !!wallet.account && !wallet.account.name
  const mine = me && (me.member || seat) && !unnamed ? me : undefined
  const query = mine && !closed ? /(^|\s)@([a-z0-9_-]*)$/i.exec(text.slice(0, caret)) : null
  const options = query
    ? [
        { handle: 'swarm', hint: team ? (seat ? 'steer it from your team budget' : 'only its team steers it') : 'steer it with your backing' },
        ...members.filter((member) => !member.handle.startsWith('0x')).map((member) => ({ handle: member.handle, hint: member.address === me?.address ? 'you' : `${usd(member.backed)} in` })),
      ]
        .filter((option) => option.handle.startsWith((query[2] ?? '').toLowerCase()))
        .slice(0, 6)
    : []
  const steering = Mention.steers(text)
  const idea = Mention.idea(text)
  const typers = Object.entries(typing).filter(([address, until]) => until > now && address !== me?.address).map(([address]) => handleOf(address))

  const complete = (handle: string) => {
    if (!query) return
    const start = caret - (query[2]?.length ?? 0) - 1
    const next = `${text.slice(0, start)}@${handle} ${text.slice(caret)}`
    const at = start + handle.length + 2
    setText(next)
    setCaret(at)
    setPick(0)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(at, at)
    })
  }

  const mention = (handle: string) => {
    if (!mine) return
    const next = `${text}${text && !text.endsWith(' ') ? ' ' : ''}@${handle} `
    setText(next)
    setCaret(next.length)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(next.length, next.length)
    })
  }

  const post = async (body: string, amount?: string) => {
    setSending(true)
    setProblem(undefined)
    try {
      const posted = await Api.say(id, { text: body, ...(amount ? { steer: amount } : {}) })
      setMe(posted.me)
      setMessages((previous) => merge(previous, [posted.message]))
      stick.current = true
      setFresh(0)
      requestAnimationFrame(() => list.current?.scrollTo({ top: list.current.scrollHeight }))
      setText('')
      setCaret(0)
      if (amount) props.onSteered()
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
    if (Mention.steers(body)) {
      if (done) return setProblem({ text: 'This swarm is done, so @swarm no longer steers it.' })
      if (team && !seat) return setProblem({ text: "Only this swarm's team steers it. Ask one of its admins here to add you." })
      if (idea.length < 3) return setProblem({ text: 'Say what the swarm should do after @swarm.' })
      if (idea.length > maxNote) return setProblem({ text: `Keep the idea to ${maxNote} characters; it becomes a note the agent keeps reading.` })
      setProblem(undefined)
      setText('')
      setCaret(0)
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
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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

  const ranked = [...members].sort((a, b) => Number(units(b.backed) - units(a.backed)))
  const here = online.filter((address) => members.some((member) => member.address === address))

  let gate: ReactNode = null
  if (!token && wallet.pending) gate = <div aria-busy="true" className="room-gate room-gate-wait" />
  else if (!token)
    gate = (
      <div className="room-gate room-gate-one">
        <div className="room-cta">
          <button className="room-cta-main" disabled={!props.config || signing} onClick={() => void signIn()} type="button">{signing ? 'Approve in Tempo Wallet…' : 'Sign in to chat'}</button>
          {!done && <button className="room-cta-side" onClick={() => props.onBack('')} type="button">Fund to steer</button>}
        </div>
      </div>
    )
  else if (unnamed)
    gate = (
      <div className="room-gate room-gate-one">
        <Username why="Pick a username to talk here. People see it beside everything you say and steer." />
      </div>
    )
  else if (me && !mine)
    gate = (
      <div className="room-gate room-gate-one">
        {done ? (
          <p className="room-gate-title">It's finished, so the room is read only.</p>
        ) : (
          <div className="room-cta">
            <button className="room-cta-main" onClick={() => props.onBack('')} type="button">{team ? 'Fund it to talk here' : 'Fund $2 to steer'}</button>
            <button className="room-cta-side" onClick={() => props.onBack('')} type="button">Fund →</button>
          </div>
        )}
      </div>
    )

  return (
    <section aria-label="The swarm's room" className="room">
      <Steering onChange={props.onSteered} swarm={props.swarm} />
      <ol
        aria-live="polite"
        className="room-list"
        onScroll={(event) => {
          const element = event.currentTarget
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
          if (stick.current) setFresh(0)
        }}
        ref={list}
      >
        {earlier && (
          <li className="room-earlier">
            <button className="btn btn-minimal" onClick={() => void older()} type="button">Earlier messages</button>
          </li>
        )}
        {!loaded && <li className="room-empty">{failed ? `Could not load the room. ${failed}` : 'Opening the room…'}</li>}
        {loaded && !messages.some((item) => item.artifact || item.author || item.text.startsWith('Update: ') || arrived(item.text)) && <li className="room-empty">Quiet so far. Be the first to say hi.</li>}
        {messages.map((item, index) => {
          const author = item.author
          const shown = item.artifact
          if (shown)
            return (
              <li className="said said-system" data-artifact="true" key={item.id}>
                <button className="said-link" onClick={() => props.onArtifact(shown.slug)} type="button">
                  <Words handles={handles} me={myNames} text={item.text} /> <span aria-hidden="true">→</span>
                  <time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>
                </button>
              </li>
            )
          if (!author) {
            const update = item.text.startsWith('Update: ')
            if (update)
              return (
                <li className="said said-update" key={item.id}>
                  <button disabled={!props.onTranscript} onClick={props.onTranscript} type="button">
                    <span className="said-update-tag">Agent update</span>
                    <span className="said-update-text">{Answer.excerpt(item.text.slice(8), 160)}</span>
                    <time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>
                  </button>
                </li>
              )
            if (!arrived(item.text)) return null
            return (
              <li className="said said-system" key={item.id}>
                <p>
                  <Words handles={handles} me={myNames} text={Answer.amounts(item.text)} />
                  <time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>
                </p>
              </li>
            )
          }
          const previous = messages[index - 1]
          const follow = previous?.author === author && item.at - previous.at < 5 * 60_000 && !item.steer && !previous.steer
          const handle = handleOf(author)
          return (
            <li className="said" data-follow={follow} data-me={author === me?.address} data-mentioned={!!me && item.mentions.includes(me.address)} key={item.id}>
              {follow ? <span className="said-gap" /> : <Avatar address={author} handle={handle} />}
              <div className="said-body">
                {!follow && (
                  <p className="said-head">
                    <button className="said-who" disabled={!mine} onClick={() => mention(handle)} style={{ color: tint(author) }} type="button">
                      {Mention.at(handle)}
                    </button>
                    {author === me?.address && <span className="tag">you</span>}
                    <time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>
                    {item.steer && <Backed onBack={done ? undefined : props.onBack} steer={item.steer} />}
                  </p>
                )}
                <p className="said-text">
                  <Words handles={handles} me={myNames} text={item.text} />
                  {follow && item.steer && <> <Backed onBack={done ? undefined : props.onBack} steer={item.steer} /></>}
                </p>
              </div>
            </li>
          )
        })}
        {fresh > 0 && (
          <li className="room-jump">
            <button
              className="btn btn-medium"
              onClick={() => {
                list.current?.scrollTo({ behavior: 'smooth', top: list.current.scrollHeight })
                stick.current = true
                setFresh(0)
              }}
              type="button"
            >
              New messages ↓
            </button>
          </li>
        )}
      </ol>
      <footer className="room-foot">
        <p className="room-typing">{typers.length ? `${typers.slice(0, 2).map(Mention.at).join(', ')} ${typers.length === 1 ? 'is' : 'are'} typing…` : ''}</p>
        {gate}
        {mine && (
          <div className="composer">
            {options.length > 0 && (
              <ol className="mentions" role="listbox">
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
                      <b data-swarm={option.handle === 'swarm'}>@{option.handle}</b>
                      <span>{option.hint}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <textarea
              aria-label="Message the room"
              maxLength={Mention.maxText}
              onChange={(event) => {
                setText(event.target.value)
                setCaret(event.target.selectionStart)
                setPick(0)
                setClosed(false)
                if (Date.now() - typed.current > 3000) {
                  typed.current = Date.now()
                  line.current?.typing()
                }
              }}
              onKeyDown={keys}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
              placeholder={done ? 'Talk about what it found…' : 'Say something. @swarm to steer'}
              ref={area}
              rows={2}
              value={text}
            />
            <button aria-label="Send" className="room-send" disabled={!text.trim() || sending} onClick={submit} type="button">
              {steering && !done ? 'Steer…' : 'Send'}
            </button>
          </div>
        )}
        {problem && (
          <p className="error room-error" role="alert">
            {problem.text}
            {problem.short && (
              <>
                {' '}
                <button className="btn btn-minimal" onClick={() => props.onBack(idea)} type="button">
                  Fund it →
                </button>
              </>
            )}
          </p>
        )}
      </footer>
    </section>
  )
})
