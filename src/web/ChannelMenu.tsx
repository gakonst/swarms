import { createContext, useContext, useEffect, useRef, useState } from 'react'
import * as Prose from '../shared/Prose.ts'
import { cash } from './Branches.tsx'
import { type Channel as Room, holding, type Thread, useShape } from './channels.ts'
import { Inline } from './Markdown.tsx'
import { Link, useBase, usePath } from './router.tsx'
import { Mark } from './Tree.tsx'

export type Where = { general: boolean; room: string | undefined; thread: string | undefined }

const where = createContext<Where>({ general: true, room: undefined, thread: undefined })

export const Here = where.Provider

type Menu = { at: 'closed' } | { at: 'open'; path: string }

const shown = 4

function ThreadRow(props: { base: string; leaf: 't' | 'c'; lit: boolean; thread: Thread }) {
  const thread = props.thread
  return (
    <li>
      <Link className="rail-thread" data={{ 'data-live': String(thread.live) }} lit={props.lit} to={`${props.base}/${props.leaf}/${thread.id}`}>
        <Mark checking={thread.checking} status={thread.status} />
        <Inline className="rail-thread-name" text={thread.title} />
        {Number(thread.money) > 0 && <span className="rail-thread-money">{cash(thread.money)}</span>}
        {thread.doing && <Inline className="rail-thread-doing" text={thread.doing} />}
      </Link>
    </li>
  )
}

function ChannelRow(props: { base: string; channel: Room; leaf: 't' | 'c'; lit: boolean; open: boolean; thread: string | undefined }) {
  const channel = props.channel
  const threads = props.open ? channel.threads : channel.threads.slice(0, shown)
  const rest = channel.threads.length - threads.length
  return (
    <li>
      <Link className="rail-row rail-channel" data={{ 'data-live': String(channel.live) }} lit={props.lit} to={`${props.base}/c/${channel.id}`}>
        <i aria-hidden="true" className="rail-hash">#</i>
        <Inline className="rail-name" text={channel.title} />
        {Number(channel.money) > 0 && <span className="rail-money">{cash(channel.money)}</span>}
      </Link>
      {threads.length > 0 && (
        <ol aria-label="Threads" className="rail-threads">
          {threads.map((each) => <ThreadRow base={props.base} key={each.id} leaf={props.leaf} lit={props.thread === each.id} thread={each} />)}
          {rest > 0 && (
            <li>
              <Link className="rail-thread rail-thread-all" to={`${props.base}/c/${channel.id}`}>{rest} more</Link>
            </li>
          )}
        </ol>
      )}
    </li>
  )
}

export function ChannelMenu(props: { id: string; title: string }) {
  const here = useContext(where)
  const shape = useShape(props.id)
  const base = useBase(props.id)
  const path = usePath()
  const [menu, setMenu] = useState<Menu>({ at: 'closed' })
  const box = useRef<HTMLDivElement>(null)
  const open = menu.at === 'open' && menu.path === path
  const list = shape?.channels ?? []
  const held = (shape?.form === 'agent' ? holding(shape, here.room)?.id : here.room) ?? holding(shape, here.thread)?.id
  const inside = here.thread ?? (shape?.form === 'agent' ? here.room : undefined)
  const spent = list.reduce((sum, channel) => sum + Number(channel.money), 0)
  const leaf = shape?.form === 'tree' ? 't' : 'c'

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) setMenu({ at: 'closed' })
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu({ at: 'closed' })
    }
    addEventListener('pointerdown', outside, true)
    addEventListener('keydown', escape)
    return () => {
      removeEventListener('pointerdown', outside, true)
      removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="channel-menu" data-open={open || undefined} ref={box}>
      <button aria-controls={`channels-${props.id}`} aria-expanded={open} aria-label={`#${Prose.plain(props.title)}, switch channel`} className="channel-pick" onClick={() => setMenu(open ? { at: 'closed' } : { at: 'open', path })} type="button">
        <i aria-hidden="true">#</i>
        <Inline text={props.title} />
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 6.5 8 10.5 12 6.5" /></svg>
      </button>
      {open && (
        <nav aria-label="Channels" className="channel-drop" id={`channels-${props.id}`}>
          <Link className="rail-row rail-general" lit={here.general && !held && !here.thread} to={base}>
            <i aria-hidden="true" className="rail-hash">#</i>
            <span className="rail-name">general</span>
            <span className="rail-meta">Riders and the lead</span>
          </Link>
          {list.length > 0 && (
            <>
              <p className="rail-label">
                <span>{shape?.form === 'tree' ? 'Programs' : 'Branches'}</span>
                <span>{list.length}{spent > 0 && <> · {cash(String(spent))}{shape?.form === 'agent' ? ' spent' : ''}</>}</span>
              </p>
              <ol className="rail-list">
                {list.map((channel) => <ChannelRow base={base} channel={channel} key={channel.id} leaf={leaf} lit={held === channel.id && !channel.threads.some((each) => each.id === inside)} open={held === channel.id} thread={inside} />)}
              </ol>
            </>
          )}
        </nav>
      )}
    </div>
  )
}
