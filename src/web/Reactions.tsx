import { useState } from 'react'
import type { Reaction } from '../shared/Api.ts'
import * as Emoji from '../shared/Reaction.ts'
import * as Api from './api.ts'
import * as Outbox from './outbox.ts'
import { Overlay } from './Overlay.tsx'
import * as Limits from '../shared/Limits.ts'

const recentKey = 'swarms.emoji'

const recentMost = Limits.WebReactions.recentMost

function recent(): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]')
    return Array.isArray(kept) ? kept.filter((each): each is string => typeof each === 'string' && Emoji.known(each)).slice(0, recentMost) : []
  } catch {
    return []
  }
}

function remember(emoji: string) {
  try {
    localStorage.setItem(recentKey, JSON.stringify([emoji, ...recent().filter((each) => each !== emoji)].slice(0, recentMost)))
  } catch {}
}

export { flip, held } from './outbox.ts'

export function send(swarm: string, message: number, emoji: string, on: boolean, me = '') {
  if (on) remember(emoji)
  const land = Outbox.fly(swarm, message, emoji, me, on)
  return Api.react(swarm, message, { emoji, on }).then(
    (done) => {
      land()
      return Outbox.held(swarm, message, done.reactions)
    },
    (error: unknown) => {
      land()
      throw error
    },
  )
}

export function Picker(props: { anchor: HTMLElement | null; onClose: () => void; onPick: (emoji: string) => void }) {
  const [used] = useState(recent)
  const pick = (emoji: string) => {
    props.onPick(emoji)
    props.onClose()
  }
  return (
    <Overlay anchor={props.anchor} className="emoji-card" label="Add a reaction" onClose={props.onClose}>
      {used.length > 0 && (
        <div className="emoji-row" aria-label="Recent">
          {used.map((emoji) => <button aria-label={emoji} className="emoji" key={emoji} onClick={() => pick(emoji)} type="button">{emoji}</button>)}
        </div>
      )}
      <div className="emoji-row" aria-label="Reactions">
        {Emoji.emojis.map((emoji) => <button aria-label={emoji} className="emoji" key={emoji} onClick={() => pick(emoji)} type="button">{emoji}</button>)}
      </div>
    </Overlay>
  )
}

export function Chips(props: { me: string | undefined; name: (address: string) => string; onAdd?: ((anchor: HTMLElement) => void) | undefined; onToggle?: ((emoji: string, on: boolean) => void) | undefined; reactions: readonly Reaction[] | undefined }) {
  const list = props.reactions ?? []
  if (!list.length) return null
  const me = props.me?.toLowerCase()
  return (
    <div className="reacts">
      {list.map((each) => {
        const mine = !!me && each.who.some((address) => address.toLowerCase() === me)
        const names = each.who.map(props.name).join(', ')
        return (
          <button aria-label={`${each.emoji} ${each.who.length}: ${names}`} aria-pressed={mine} className="react" disabled={!props.onToggle} key={each.emoji} onClick={() => props.onToggle?.(each.emoji, !mine)} title={names} type="button">
            <span aria-hidden="true">{each.emoji}</span>
            <b>{each.who.length}</b>
          </button>
        )
      })}
      {props.onAdd && (
        <button aria-label="Add a reaction" className="react react-add" onClick={(event) => props.onAdd?.(event.currentTarget)} type="button">
          <Smile />
        </button>
      )}
    </div>
  )
}

export function Smile() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.5 9.5c.6.9 1.5 1.4 2.5 1.4s1.9-.5 2.5-1.4" />
      <path d="M6 6.4v.2M10 6.4v.2" strokeWidth="1.8" />
    </svg>
  )
}

export function Bubble() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
      <path d="M2.75 3.75h10.5v7h-6l-3 2.5v-2.5h-1.5z" />
    </svg>
  )
}

export function Acts(props: { onReact?: ((anchor: HTMLElement) => void) | undefined; onReply?: (() => void) | undefined }) {
  if (!props.onReact && !props.onReply) return null
  return (
    <div className="msg-acts">
      {props.onReact && <button aria-label="Add a reaction" onClick={(event) => props.onReact?.(event.currentTarget)} title="Add a reaction" type="button"><Smile /></button>}
      {props.onReply && <button aria-label="Reply in thread" onClick={props.onReply} title="Reply in thread" type="button"><Bubble /></button>}
    </div>
  )
}
