import { type KeyboardEvent, memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Config, Detail, Me, Member, Reaction, Replies, Room as RoomState, Said } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Chatter from '../shared/Chatter.ts'
import { maxNote, units } from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Api from './api.ts'
import { seeded } from './boot.ts'
import * as Local from './local.ts'
import * as Outbox from './outbox.ts'
import { code } from './pay.ts'
import { ago, day, minute, usd } from './format.ts'
import { message as reason, useNow, useVisible, useWallet } from './hooks.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { Acts, Chips, flip, held, Picker, send } from './Reactions.tsx'
import { Link } from './router.tsx'
import { gate as gated, steerer, useRoster } from './Steering.tsx'
import { Mark, word } from './Tree.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'
import * as Wire from './wire.ts'

const roomMs = { closed: 15_000, open: 60_000 }

const seatSteer = '1'

const kept = new Map<string, { members: readonly Member[]; messages: readonly Said[] }>()

const draftKey = (id: string) => `swarms_draft:${id}`

export function draft(id: string) {
  try {
    return localStorage.getItem(draftKey(id)) ?? ''
  } catch {
    return ''
  }
}

export function keepDraft(id: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(draftKey(id), text)
    else localStorage.removeItem(draftKey(id))
  } catch {}
}

export function typist() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches
}

function idle(element: Element | null) {
  return !element || element === document.body || !!element.closest('.servers, .tabs')
}

function say(draft: Outbox.Draft) {
  const swarm = draft.place.split(':')[1] ?? ''
  return Api.say(swarm, { text: draft.text.trim(), ...(draft.parent !== undefined ? { parent: draft.parent } : {}), ...(draft.steer ? { steer: draft.steer.amount } : {}) }).then(
    (posted) => posted.message,
    (error: unknown) => {
      if (code(error) === 'username_required') void Wallet.identify()
      throw error
    },
  )
}

Outbox.define('room', say)

Outbox.define('thread', say)

export function steered(amount: string, note: string): Said['steer'] {
  return { amount, backers: 1, live: true, note, noteId: '', share: 0, weight: '0' }
}

export function Unsent(props: { client: string; error: string | undefined }) {
  return (
    <p className="msg-unsent" role="alert">
      <span>Not sent{props.error ? `: ${props.error}` : '.'}</span>
      <button onClick={() => Outbox.retry(props.client)} type="button">Retry</button>
      <button onClick={() => Outbox.forget(props.client)} type="button">Discard</button>
    </p>
  )
}

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
  if (behind) return `${behind[1]} put ${behind[2]} behind "${behind[3]}"`
  const backed = /^(\S+) backed "(.+)" with (\$[\d.,]+)$/.exec(line)
  if (backed) return `${backed[1]} put ${backed[3]} behind "${backed[2]}"`
  const sent = /^(\S+) (?:pledged|sent|funded it with|backed it with) (\$[\d.,]+)(:.*)?$/.exec(line)
  if (sent) return `${sent[1]} rode in with ${sent[2]}${sent[3] ?? ''}`
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
  | { at: number; count: number; item: Outbox.Shown; key: string; kind: 'ai'; artifact: Said['artifact']; text: string }
  | { at: number; count: number; key: string; kind: 'idle'; text: string }
  | { at: number; key: string; kind: 'backed'; note: string | undefined; text: string }
  | { at: number; first: boolean; item: Outbox.Shown; key: string; kind: 'said'; last: boolean }

function rows(messages: readonly Outbox.Shown[], now: number): Row[] {
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
      if (item.artifact) out.push({ artifact: item.artifact, at: item.at, count: 1, item, key: Outbox.key(item), kind: 'ai', text: item.text.replace(/^New artifact: /, '') })
      else if (item.text.startsWith('Update: ')) {
        const text = item.text.slice(8)
        const before = out.at(-1)
        if (before && before.kind === 'idle' && Chatter.gist(before.text) === Chatter.gist(text)) out[out.length - 1] = { ...before, at: item.at, count: before.count + 1, text }
        else if (before && before.kind === 'ai' && !before.artifact && !before.item.reactions && !before.item.replies && !item.reactions && !item.replies && Chatter.gist(before.text) === Chatter.gist(text)) out[out.length - 1] = { ...before, at: item.at, count: before.count + 1, item, text }
        else out.push(Chatter.idle(text) ? { at: item.at, count: 1, key: `m${item.id}`, kind: 'idle', text } : { artifact: null, at: item.at, count: 1, item, key: `m${item.id}`, kind: 'ai', text })
      } else out.push({ at: item.at, key: `m${item.id}`, kind: 'backed', note: noted(item.text), text: friendly(item.text) })
      return
    }
    const previous = shown[index - 1]
    const next = shown[index + 1]
    const joined = (a: Said | undefined, b: Said | undefined) => !!a && !!b && a.author === b.author && b.at - a.at < 5 * 60_000 && day(a.at, now) === day(b.at, now) && !directed(a) && !directed(b)
    out.push({ at: item.at, first: !joined(previous, item), item, key: Outbox.key(item), kind: 'said', last: !joined(item, next) })
  })
  return out
}

export function directed(item: Said) {
  return !!item.node || !!item.steer || Mention.steers(item.text)
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

export function marked(text: string, handles: ReadonlySet<string>, me: ReadonlySet<string>) {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, index) =>
      index % 2
        ? part
        : Mention.pieces(part)
            .map((piece) => {
              const name = piece.slice(1).toLowerCase()
              if (!piece.startsWith('@') || (name !== 'swarm' && !handles.has(name))) return piece
              return `<mark class="mention" data-me="${me.has(name)}" data-swarm="${name === 'swarm'}">${name === 'swarm' ? '@AI' : piece}</mark>`
            })
            .join(''),
    )
    .join('')
}

export type Items = { nodes: Readonly<Record<string, Tree.Node>>; path: (nid: string) => string }

export function Item(props: { items: Items; node: string }) {
  const node = props.items.nodes[props.node]
  return (
    <Link className="msg-item" keep to={props.items.path(props.node)}>
      {node ? <Mark checking={node.run?.checking} status={node.status} /> : <Mark status="proposed" />}
      <span className="msg-item-title">{node ? <Inline text={node.title} /> : 'Board item'}</span>
      <span className="msg-item-open">{node ? word(node.status) : 'Open'} ›</span>
    </Link>
  )
}

export function ThreadLink(props: { lit: boolean; name: (address: string) => string; now: number; onOpen: () => void; onWarm?: () => void; replies: Replies }) {
  const replies = props.replies
  return (
    <button aria-pressed={props.lit} className="msg-thread" onClick={props.onOpen} onFocus={props.onWarm} onPointerEnter={props.onWarm} onTouchStart={props.onWarm} type="button">
      <span className="msg-thread-faces">
        {replies.who.map((address, index) =>
          address === null ? (
            <span aria-hidden="true" className="avatar avatar-ai" data-size="small" key={`ai${index}`}>✦</span>
          ) : (
            <Avatar address={address} handle={props.name(address).replace(/^@/, '')} key={address} size="small" />
          ),
        )}
      </span>
      <b>{replies.count} {replies.count === 1 ? 'reply' : 'replies'}</b>
      <time dateTime={new Date(replies.at).toISOString()}>{ago(replies.at, props.now)}</time>
    </button>
  )
}

export const Room = memo(function Room(props: {
  config: Config | undefined
  items?: Items | undefined
  onArtifact: (slug: string) => void
  onBack: (note: string) => void
  onSwarm?: ((text: string, anchor: HTMLElement | null, sent: () => void) => void) | undefined
  onThread?: ((id: number) => void) | undefined
  onMessages?: (messages: readonly Said[], me: Me | null, members: readonly Member[], online: readonly string[], watching: number) => void
  onResults?: () => void
  steer?: false
  swarm: Detail
  thread?: number | undefined
  visible: boolean
}) {
  const id = props.swarm.id
  const wallet = useWallet()
  const token = wallet.session?.token
  const [seed] = useState(() => kept.get(id) ?? Local.value<RoomState>(`room:${id}`) ?? seeded<RoomState>(`room:${id}`))
  const [messages, setMessages] = useState<readonly Said[]>(() => seed?.messages ?? [])
  const [members, setMembers] = useState<readonly Member[]>(() => seed?.members ?? [])
  const [me, setMe] = useState<Me | null>(null)
  const [loaded, setLoaded] = useState(!!seed)
  const [failed, setFailed] = useState<string>()
  const [misses, setMisses] = useState(0)
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
  const [signing, setSigning] = useState(false)
  const [problem, setProblem] = useState<{ short?: boolean; text: string }>()
  const [fresh, setFresh] = useState(0)
  const [far, setFar] = useState(false)
  const [picking, setPicking] = useState<{ anchor: HTMLElement; id: number }>()
  const list = useRef<HTMLDivElement>(null)
  const sender = useRef<HTMLButtonElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const last = useRef(0)
  const typed = useRef(0)
  const fetched = useRef(0)

  const setReactions = (message: number, reactions: Reaction[]) => setMessages((previous) => (previous.some((item) => item.id === message) ? previous.map((item) => (item.id === message ? { ...item, reactions: held(id, message, reactions) } : item)) : previous))

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
        setMisses(0)
        fetched.current = Date.now()
        if (token && !room.me) Wallet.signOut()
      } catch (error) {
        setFailed(reason(error))
        setMisses((count) => count + 1)
      }
    },
    [id, token],
  )

  useEffect(() => {
    if (!misses || !token) return
    const timer = setTimeout(() => void load(last.current), Math.min(30_000, 2000 * 2 ** (misses - 1)))
    return () => clearTimeout(timer)
  }, [misses, load, token])

  useEffect(() => {
    last.current = messages.at(-1)?.id ?? 0
    kept.set(id, { members, messages })
    Local.change<RoomState>(`room:${id}`, (room) => (room && room.messages === messages && room.members === members ? room : { me: null, next: 0, ...room, members: [...members], messages: [...messages] }))
  }, [id, members, messages])

  const [connected, setConnected] = useState(() => Wire.connected(id))
  const wired = Wire.useWire(id, 'room', (signal) => {
    if (signal.type === 'open' || signal.type === 'closed') setConnected(signal.type === 'open')
    if (signal.type === 'open') Outbox.resume()
    if (signal.type === 'said' && signal.message.parent === undefined) setMessages((previous) => merge(previous, [signal.message]))
    if (signal.type === 'reacted') setReactions(signal.id, signal.reactions)
    if (signal.type === 'replies') setMessages((previous) => (previous.some((item) => item.id === signal.id) ? previous.map((item) => (item.id === signal.id ? { ...item, replies: signal.replies } : item)) : previous))
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

  const drafts = Outbox.useDrafts(`room:${id}`)
  const outbox = Outbox.shown(`room:${id}`, messages, drafts)
  const landed = outbox.landed.join()
  useEffect(() => {
    for (const client of outbox.landed) Outbox.forget(client)
  }, [landed])
  const tail = outbox.shown.at(-1)
  const newest = tail ? Outbox.key(tail) : undefined

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

  const restored = useRef(false)
  useLayoutEffect(() => {
    if (!restored.current) {
      restored.current = true
      const kept = draft(id)
      if (kept) return setText(kept)
    }
    keepDraft(id, text)
  }, [id, text])

  const [ready, setReady] = useState(false)
  const placed = useCallback((element: HTMLTextAreaElement | null) => {
    area.current = element
    setReady(!!element)
  }, [])
  useEffect(() => {
    const element = area.current
    if (!element || !props.visible || !typist() || !idle(document.activeElement)) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
  }, [id, props.visible, ready])

  const roster = useRoster(id, props.swarm.steering)
  const called = new Map([...(roster?.seats ?? []).map((seat) => [seat.address, seat.handle] as const), ...members.map((member) => [member.address, member.handle] as const)])
  const handleOf = (address: string) => called.get(address as `0x${string}`) ?? Mention.short(address)
  const handles = new Set(members.flatMap((member) => [member.handle, Mention.handle(member.address)]))
  const myNames = new Set(me ? [me.handle, Mention.handle(me.address)] : [])
  const policy = roster?.steering ?? props.swarm.steering
  const door = gated(wallet, policy, roster, { me })
  const mine = typeof door === 'object' && door.at === 'open' ? (me ?? undefined) : undefined
  const helm = props.steer !== false && typeof door === 'object' && door.at === 'open' && door.from !== null
  const steers = props.steer !== false && steerer(policy, roster, wallet.session?.address ?? wallet.address)
  const asks = !!props.onSwarm && !!mine
  const query = mine && !closed ? /(^|\s)@([a-z0-9_-]*)$/i.exec(text.slice(0, caret)) : null
  const options = query
    ? [
        ...(helm || asks ? [{ handle: 'swarm', hint: asks ? 'make it a board item' : 'tell the AI what to try' }] : []),
        ...members.filter((member) => !member.handle.startsWith('0x') && member.address !== me?.address).map((member) => ({ handle: member.handle, hint: '' })),
      ]
        .filter((option) => option.handle.startsWith((query[2] ?? '').toLowerCase()))
        .slice(0, 6)
    : []
  const steering = (props.steer !== false || asks) && (ai || Mention.steers(text))
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

  const post = (body: string, steer?: Said['steer']) => {
    if (!mine) return
    setProblem(undefined)
    stick.current = true
    setFresh(0)
    setText('')
    setCaret(0)
    setAi(false)
    Outbox.send(`room:${id}`, { after: last.current, author: mine.address, steer: steer ?? undefined, text: body })
  }

  const tell = (note: string, left: string | null) => {
    const amount = left !== null && units(left) >= Mention.smallestSteer && units(left) < units(seatSteer) ? left : seatSteer
    post(`@swarm ${note}`, steered(amount, note))
  }

  const told = drafts.filter((draft) => draft.steer && draft.state === 'sent').length
  useEffect(() => {
    if (told) void load(last.current)
  }, [told])

  const submit = () => {
    const body = text.trim()
    if (!body || !mine) return
    if (steering && asks) {
      if (idea.length < 3) return setProblem({ text: 'Say what the swarm should do.' })
      setProblem(undefined)
      return props.onSwarm?.(idea, sender.current, () => {
        setText('')
        setCaret(0)
        setAi(false)
      })
    }
    if (steering) {
      if (!helm) return setProblem({ text: 'Only the riders who steer this swarm tell the AI what to do.' })
      if (idea.length < 3) return setProblem({ text: 'Say what the AI should try.' })
      if (idea.length > maxNote) return setProblem({ text: `Keep it under ${maxNote} characters.` })
      if (typeof door === 'object' && door.at === 'open' && door.from === 'team') return tell(idea, door.left)
      setProblem(undefined)
      setText('')
      setCaret(0)
      setAi(false)
      return props.onBack(idea)
    }
    post(body)
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

  const listed = rows(outbox.shown, now)
  const named = (address: string) => {
    const handle = handleOf(address)
    return handle.startsWith('0x') ? Mention.short(address) : `@${handle}`
  }
  const react = mine ? (item: Outbox.Shown) => (item.sending ? undefined : (anchor: HTMLElement) => setPicking({ anchor, id: item.id })) : undefined
  const reply = props.onThread ? (item: Outbox.Shown) => (item.sending ? undefined : () => props.onThread?.(item.id)) : undefined
  const toggle = (item: Said, emoji: string, on: boolean) => {
    if (!mine) return
    const before = item.reactions ?? []
    setReactions(item.id, flip(before, emoji, mine.address, on))
    send(id, item.id, emoji, on, mine.address).then(
      (reactions) => setReactions(item.id, reactions),
      (error: unknown) => {
        setReactions(item.id, before)
        setProblem({ text: reason(error) })
      },
    )
  }
  const under = (item: Outbox.Shown) => (
    <>
      {item.sending === 'failed' && item.client && <Unsent client={item.client} error={item.error} />}
      {item.node && props.items && <Item items={props.items} node={item.node} />}
      <Chips me={mine?.address} name={named} onAdd={react?.(item)} onToggle={mine ? (emoji, on) => toggle(item, emoji, on) : undefined} reactions={item.reactions} />
      {item.replies && props.onThread && <ThreadLink lit={props.thread === item.id} name={named} now={now} onOpen={() => props.onThread?.(item.id)} onWarm={() => Local.warm(`replies:${id}:${item.id}`, () => Api.replies(id, item.id))} replies={item.replies} />}
    </>
  )
  const picked = picking ? messages.find((item) => item.id === picking.id) : undefined

  let foot: ReactNode
  if (door === 'checking')
    foot = (
      <div aria-busy="true" className="chat-bar chat-bar-wait">
        <textarea aria-label="Message #general" disabled placeholder={failed ? "Can't reach the chat. Trying again…" : 'Message #general'} rows={1} />
      </div>
    )
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
        Ride it to chat
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
        {(helm || asks) && (
          <button
            aria-label={ai ? 'Talk to people' : asks ? 'Ask the swarm' : 'Tell the AI'}
            aria-pressed={ai}
            className="chat-ai"
            onClick={() => {
              setAi(!ai)
              area.current?.focus()
            }}
            title={ai ? 'Talk to people' : asks ? 'Ask the swarm: it becomes a board item' : 'Tell the AI what to try'}
            type="button"
          >
            ✦
          </button>
        )}
        <textarea
          aria-label={steering ? (asks ? 'What should the swarm do?' : 'What should the AI try?') : 'Message'}
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
          placeholder={ai ? (asks ? 'What should the swarm do? It becomes a board item' : 'What should the AI try?') : 'Message #general'}
          ref={placed}
          rows={1}
          value={text}
        />
        <button aria-label={steering ? (asks ? 'Add it to the board' : 'Steer it') : 'Send'} className="chat-send" data-ai={steering} disabled={!text.trim()} onClick={submit} ref={sender} type="button">
          {steering ? (asks ? 'Add it' : 'Steer it') : '↑'}
        </button>
      </div>
    )

  return (
    <section aria-label="Chat" className="chat">
      <header className="chat-here">
        <p className="chat-channel"><i aria-hidden="true">#</i>general</p>
        {here.length > 0 && <span className="chat-faces">{here.map((member) => <Avatar address={member.address} handle={member.handle} key={member.address} size="small" />)}</span>}
        {watching > 0 && <span className="chat-live"><i />{watching} here</span>}
      </header>
      <div
        aria-live="polite"
        className="chat-list"
        onScroll={(event) => {
          const element = event.currentTarget
          const gap = element.scrollHeight - element.scrollTop - element.clientHeight
          stick.current = gap < 60
          setFar(gap > element.clientHeight)
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
                {row.note && steers && <button onClick={() => props.onBack(row.note ?? '')} type="button">+ Steer this</button>}
              </div>
            )
          if (row.kind === 'idle')
            return (
              <div className="chat-event chat-idle" key={row.key}>
                <p>
                  <span aria-hidden="true">✦</span> {Chatter.clause(row.text)}
                  {row.count > 1 && <b>×{row.count}</b>}
                  <time dateTime={new Date(row.at).toISOString()}>{minute(row.at)}</time>
                </p>
              </div>
            )
          if (row.kind === 'ai')
            return (
              <div className="msg msg-ai" data-first="true" data-last="true" data-lit={props.thread === row.item.id || undefined} key={row.key} tabIndex={-1}>
                <span aria-hidden="true" className="avatar avatar-ai">✦</span>
                <div className="msg-col">
                  <p className="msg-who"><b>AI</b><time dateTime={new Date(row.at).toISOString()}>{minute(row.at)}</time>{row.count > 1 && <small className="msg-count">×{row.count}</small>}</p>
                  {row.artifact ? (
                    <button className="msg-card" onClick={() => row.artifact && props.onArtifact(row.artifact.slug)} type="button">
                      <small>New result</small>
                      <b><Inline text={row.artifact.title} /></b>
                      <span>Open →</span>
                    </button>
                  ) : (
                    <button className="msg-bubble msg-update" disabled={!props.onThread && !props.onResults} onClick={props.onThread ? () => props.onThread?.(row.item.id) : props.onResults} type="button">
                      <Inline text={Answer.brief(row.text, 320)} />
                      <small>{props.onThread ? 'Open thread →' : 'See results →'}</small>
                    </button>
                  )}
                  {under(row.item)}
                </div>
                <Acts onReact={react?.(row.item)} onReply={reply?.(row.item)} />
              </div>
            )
          const item = row.item
          const author = item.author ?? ''
          const handle = handleOf(author)
          const self = !!author && author.toLowerCase() === (me?.address ?? mine?.address ?? '').toLowerCase()
          const aimed = directed(item)
          return (
            <div className="msg" data-directed={aimed || undefined} data-first={row.first} data-last={row.last} data-lit={props.thread === item.id || undefined} data-me={self} data-mentioned={!!me && item.mentions.includes(me.address)} data-sending={item.sending} key={row.key} tabIndex={-1}>
              {row.first ? <Avatar address={author} handle={handle} /> : <span className="avatar-gap" />}
              <div className="msg-col">
                {row.first && <p className="msg-who"><b style={{ color: tint(author) }}>{handle.startsWith('0x') ? Mention.short(author) : handle}</b><time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>{aimed && <span className="msg-aimed">{item.node ? '✦ On the board' : '✦ To the AI'}</span>}</p>}
                <div className="msg-bubble">
                  <Markdown compact marks text={marked(item.text, handles, myNames)} />
                </div>
                {item.steer && (
                  <p className="msg-steer">
                    <span>✦ Told the AI · {usd(item.steer.amount)}</span>
                    {steers && <button onClick={() => props.onBack(item.steer?.note ?? '')} type="button">+ Steer this</button>}
                  </p>
                )}
                {under(item)}
              </div>
              <Acts onReact={react?.(item)} onReply={reply?.(item)} />
            </div>
          )
        })}
      </div>
      {(fresh > 0 || far) && (
        <button
          className="chat-jump"
          onClick={() => {
            list.current?.scrollTo({ behavior: 'smooth', top: list.current.scrollHeight })
            stick.current = true
            setFresh(0)
            setFar(false)
          }}
          type="button"
        >
          {fresh > 0 ? 'New messages ↓' : 'Jump to latest ↓'}
        </button>
      )}
      <footer className="chat-foot">
        <p className="chat-typing" data-on={typers.length > 0}>{typers.length ? <><i /><i /><i /> {typers.slice(0, 2).join(', ')} {typers.length === 1 ? 'is' : 'are'} typing</> : null}</p>
        {problem && (
          <p className="chat-error" role="alert">
            {problem.text}
            {problem.short && <button onClick={() => props.onBack(idea)} type="button">Steer it →</button>}
          </p>
        )}
        {foot}
      </footer>
      {picking && picked && mine && <Picker anchor={picking.anchor} onClose={() => setPicking(undefined)} onPick={(emoji) => toggle(picked, emoji, !(picked.reactions ?? []).some((each) => each.emoji === emoji && each.who.some((address) => address.toLowerCase() === mine.address.toLowerCase())))} />}
    </section>
  )
})
