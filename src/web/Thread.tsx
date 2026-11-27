import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Config, Reaction, Replied, Said } from '../shared/Api.ts'
import * as Mention from '../shared/Mention.ts'
import * as Api from './api.ts'
import * as Local from './local.ts'
import * as Outbox from './outbox.ts'
import { Composer } from './Channel.tsx'
import { day, minute } from './format.ts'
import { message as reason, useNow, useWallet } from './hooks.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { Acts, Chips, flip, held, Picker, send } from './Reactions.tsx'
import { Avatar, type Items, Item, marked, tint, Unsent } from './Room.tsx'
import * as Wire from './wire.ts'
import * as Limits from '../shared/Limits.ts'

type Loaded = { at: 'loading' } | { at: 'failed'; error: string } | { at: 'ready'; thread: Replied }

function merge(list: readonly Said[], more: readonly Said[]): Said[] {
  if (!more.length) return [...list]
  const byId = new Map(list.map((item) => [item.id, item]))
  for (const item of more) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

function stamped(at: number, now: number) {
  return day(at, now) === day(now, now) ? minute(at) : `${day(at, now)} ${minute(at)}`
}

function stored(swarm: string, id: number): Loaded {
  const thread = Local.value<Replied>(`replies:${swarm}:${id}`)
  return thread ? { at: 'ready', thread } : { at: 'loading' }
}

export function ChatThread(props: { config: Config | undefined; id: number; items?: Items | undefined; onClose: () => void; swarm: string }) {
  const id = props.id
  const swarm = props.swarm
  const wallet = useWallet()
  const now = useNow(Limits.Clock.minuteMs)
  const place = `thread:${swarm}:${id}`
  const [state, setState] = useState<Loaded>(() => stored(swarm, id))
  const [picking, setPicking] = useState<{ anchor: HTMLElement; id: number }>()
  const [problem, setProblem] = useState<string>()
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = useRef(0)

  const load = useCallback(
    async (after: number) => {
      try {
        const got = after ? await Api.replies(swarm, id, after) : await Local.load(`replies:${swarm}:${id}`, () => Api.replies(swarm, id, 0))
        setState((current) => (current.at === 'ready' && after ? { at: 'ready', thread: { ...got, replies: merge(current.thread.replies, got.replies) } } : { at: 'ready', thread: got }))
      } catch (error) {
        if (!after) setState({ at: 'failed', error: reason(error) })
      }
    },
    [id, swarm],
  )

  useEffect(() => {
    const kept = stored(swarm, id)
    setState(kept)
    stick.current = true
    void load(kept.at === 'ready' ? kept.thread.replies.at(-1)?.id ?? 0 : 0)
  }, [load])

  const update = (change: (thread: Replied) => Replied) => setState((current) => (current.at === 'ready' ? { at: 'ready', thread: change(current.thread) } : current))

  useEffect(() => {
    if (state.at === 'ready') Local.change<Replied>(`replies:${swarm}:${id}`, (current) => (current === state.thread ? current : state.thread))
  }, [state])

  const reacted = (message: number, reactions: Reaction[]) =>
    update((thread) => (thread.parent.id === message ? { ...thread, parent: { ...thread.parent, reactions: held(swarm, message, reactions) } } : { ...thread, replies: thread.replies.map((item) => (item.id === message ? { ...item, reactions: held(swarm, message, reactions) } : item)) }))

  Wire.useWire(swarm, 'room', (signal) => {
    if (signal.type === 'said' && signal.message.parent === id) update((thread) => ({ ...thread, next: Math.max(thread.next, signal.message.id), replies: merge(thread.replies, [signal.message]) }))
    if (signal.type === 'reacted') reacted(signal.id, signal.reactions)
    if (signal.type === 'replies' && signal.id === id) update((thread) => ({ ...thread, parent: { ...thread.parent, replies: signal.replies } }))
    if (signal.type === 'stir' && signal.cause === 'welcome') void load(last.current)
  })

  const thread = state.at === 'ready' ? state.thread : undefined
  const drafts = Outbox.useDrafts(place)
  const outbox = Outbox.shown(place, thread?.replies ?? [], drafts)
  const landed = outbox.landed.join()
  useEffect(() => {
    for (const client of outbox.landed) Outbox.forget(client)
  }, [landed])
  const count = outbox.shown.length
  last.current = thread?.replies.at(-1)?.id ?? 0

  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  }, [count, state.at, outbox.shown.at(-1)?.client])

  const me = wallet.session?.address
  const member = !!thread?.me?.member
  const called = new Map((thread?.members ?? []).map((each) => [each.address.toLowerCase(), each.handle] as const))
  const handleOf = (address: string) => called.get(address.toLowerCase()) ?? Mention.short(address)
  const named = (address: string) => {
    const handle = handleOf(address)
    return handle.startsWith('0x') ? Mention.short(address) : `@${handle}`
  }
  const handles = new Set((thread?.members ?? []).flatMap((each) => [each.handle, Mention.handle(each.address)]))
  const mine = new Set(thread?.me ? [thread.me.handle, Mention.handle(thread.me.address)] : [])

  const toggle = (message: Said, emoji: string, on: boolean) => {
    if (!me) return
    const before = message.reactions ?? []
    reacted(message.id, flip(before, emoji, me, on))
    setProblem(undefined)
    send(swarm, message.id, emoji, on, me).then(
      (reactions) => reacted(message.id, reactions),
      (error: unknown) => {
        reacted(message.id, before)
        setProblem(reason(error))
      },
    )
  }

  const line = (item: Outbox.Shown, lead: boolean) => {
    const author = item.author
    const react = member && !item.sending ? (anchor: HTMLElement) => setPicking({ anchor, id: item.id }) : undefined
    return (
      <li className="msg" data-first="true" data-lead={lead || undefined} data-sending={item.sending} key={lead ? 'lead' : Outbox.key(item)} tabIndex={-1}>
        {author ? <Avatar address={author} handle={handleOf(author)} /> : <span aria-hidden="true" className="avatar avatar-ai">✦</span>}
        <div className="msg-col">
          <p className="msg-who">
            <b style={author ? { color: tint(author) } : undefined}>{author ? named(author).replace(/^@/, '') : 'AI'}</b>
            <time dateTime={new Date(item.at).toISOString()}>{stamped(item.at, now)}</time>
          </p>
          <div className="msg-bubble">{author ? <Markdown compact marks text={marked(item.text, handles, mine)} /> : <Inline links text={item.text.replace(/^(Update|New artifact): /, '')} />}</div>
          {lead && item.node && props.items && <Item items={props.items} node={item.node} />}
          {item.sending === 'failed' && item.client && <Unsent client={item.client} error={item.error} />}
          <Chips me={me} name={named} onAdd={react} onToggle={member ? (emoji, on) => toggle(item, emoji, on) : undefined} reactions={item.reactions} />
        </div>
        <Acts onReact={react} />
      </li>
    )
  }

  const picked = picking && thread ? [thread.parent, ...thread.replies].find((item) => item.id === picking.id) : undefined

  return (
    <aside
      aria-label="Thread"
      className="chat-thread"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || picking || event.defaultPrevented) return
        event.preventDefault()
        props.onClose()
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.chat .chat-bar textarea')?.focus({ preventScroll: true }))
      }}
    >
      <header className="thread-head">
        <button aria-label="Close the thread" className="thread-close" onClick={props.onClose} type="button"><span aria-hidden="true" className="thread-x">×</span><span aria-hidden="true" className="thread-back">‹</span></button>
        <p><b>Thread</b><span>{count} {count === 1 ? 'reply' : 'replies'}{thread?.parent.node ? ' · board item' : ''}</span></p>
      </header>
      <div
        className="thread-body chat-thread-body"
        onScroll={(event) => {
          const element = event.currentTarget
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
        }}
        ref={scroller}
      >
        {state.at === 'loading' && <p className="chat-empty">Loading…</p>}
        {!thread && outbox.shown.length > 0 && <ol aria-label="Messages" className="talk chat-thread-list">{outbox.shown.map((item) => line(item, false))}</ol>}
        {state.at === 'failed' && <p className="chat-empty">Couldn't load the thread. {state.error}</p>}
        {thread && (
          <ol aria-label="Messages" className="talk chat-thread-list">
            {line(thread.parent, true)}
            <li aria-hidden="true" className="chat-thread-rule"><span>{count ? `${count} ${count === 1 ? 'reply' : 'replies'}` : 'No replies yet'}</span></li>
            {outbox.shown.map((item) => line(item, false))}
          </ol>
        )}
      </div>
      {problem && <p className="chat-error chat-thread-error" role="alert">{problem}</p>}
      <Composer
        autoFocus
        config={props.config}
        disabled={thread?.me && !member ? 'Ride this swarm to reply.' : undefined}
        label="Reply in thread"
        onPost={async (text) => {
          if (!me) return
          stick.current = true
          Outbox.send(place, { after: Math.max(id, last.current), author: me, parent: id, text })
        }}
        placeholder="Reply…"
      />
      {picking && picked && <Picker anchor={picking.anchor} onClose={() => setPicking(undefined)} onPick={(emoji) => toggle(picked, emoji, !(picked.reactions ?? []).some((each) => each.emoji === emoji && each.who.some((address) => address.toLowerCase() === me?.toLowerCase())))} />}
    </aside>
  )
}
