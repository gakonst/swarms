import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef } from 'react'
import * as Limits from '../shared/Limits.ts'
import { Capped } from './capped.ts'

type Drag = { at: 'idle' } | { at: 'dragging'; from: number; size: number }

const kept = new Capped<string, number>(Limits.WebCache.dividersMost)

const narrowest = Limits.WebDivider.narrowest

const chat = Limits.WebDivider.chat

const step = Limits.WebDivider.step

function bounds(host: HTMLElement) {
  const style = getComputedStyle(host)
  const room = host.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
  return [narrowest, Math.max(narrowest, room - chat)] as const
}

function pane(host: HTMLElement) {
  return Number.parseFloat(getComputedStyle(host).gridTemplateColumns.split(' ')[2] ?? '') || narrowest
}

export function Divider(props: { label: string; name: string }) {
  const handle = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>({ at: 'idle' })

  const set = (value: number) => {
    const host = handle.current?.parentElement
    if (!host) return
    const [low, high] = bounds(host)
    const next = Math.round(Math.min(high, Math.max(low, value)))
    kept.set(props.name, next)
    host.style.setProperty('--pane', `${next}px`)
    handle.current?.setAttribute('aria-valuenow', String(next))
    handle.current?.setAttribute('aria-valuemin', String(low))
    handle.current?.setAttribute('aria-valuemax', String(Math.round(high)))
  }

  useLayoutEffect(() => {
    const host = handle.current?.parentElement
    const known = kept.get(props.name)
    if (host && known !== undefined) host.style.setProperty('--pane', `${known}px`)
  }, [props.name])

  const stop = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { at: 'idle' }
    event.currentTarget.parentElement?.removeAttribute('data-dragging')
  }

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const host = event.currentTarget.parentElement
    if (!host) return
    const [low, high] = bounds(host)
    const grow = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
    const next = event.key === 'Home' ? low : event.key === 'End' ? high : grow ? pane(host) + grow * step : undefined
    if (next === undefined) return
    event.preventDefault()
    set(next)
  }

  return (
    <div
      aria-label={props.label}
      aria-orientation="vertical"
      className="split-handle"
      onKeyDown={keys}
      onLostPointerCapture={stop}
      onPointerCancel={stop}
      onPointerDown={(event) => {
        const host = event.currentTarget.parentElement
        if (!host || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        host.setAttribute('data-dragging', '')
        drag.current = { at: 'dragging', from: event.clientX, size: pane(host) }
      }}
      onPointerMove={(event) => {
        const now = drag.current
        if (now.at === 'dragging') set(now.size + now.from - event.clientX)
      }}
      onPointerUp={stop}
      ref={handle}
      role="separator"
      tabIndex={0}
    >
      <i aria-hidden="true" />
    </div>
  )
}
