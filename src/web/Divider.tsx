import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef } from 'react'
import { useMedia } from './hooks.ts'

type Axis = 'x' | 'y'

type Kept = { x: number | undefined; y: number | undefined }

type Drag = { at: 'idle' } | { at: 'dragging'; axis: Axis; from: number; size: number }

const kept = new Map<string, Kept>()

const narrowest = 280

const chat = 373

const least = 20

const most = 75

const steps = { x: 32, y: 5 }

function bounds(axis: Axis, host: HTMLElement) {
  if (axis === 'y') return [least, most] as const
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
  const phone = useMedia('(max-width: 719px)')
  const axis: Axis = phone ? 'y' : 'x'

  const set = (along: Axis, value: number) => {
    const host = handle.current?.parentElement
    if (!host) return
    const [low, high] = bounds(along, host)
    const next = Math.round(Math.min(high, Math.max(low, value)))
    kept.set(props.name, { ...(kept.get(props.name) ?? { x: undefined, y: undefined }), [along]: next })
    host.style.setProperty(along === 'x' ? '--pane' : '--split', along === 'x' ? `${next}px` : `${next}%`)
    handle.current?.setAttribute('aria-valuenow', String(next))
    handle.current?.setAttribute('aria-valuemin', String(low))
    handle.current?.setAttribute('aria-valuemax', String(Math.round(high)))
  }

  useLayoutEffect(() => {
    const host = handle.current?.parentElement
    const known = kept.get(props.name)
    if (!host || !known) return
    if (known.x !== undefined) host.style.setProperty('--pane', `${known.x}px`)
    if (known.y !== undefined) host.style.setProperty('--split', `${known.y}%`)
  }, [props.name])

  const share = (host: HTMLElement) => {
    const next = handle.current?.nextElementSibling
    return next instanceof HTMLElement && host.clientHeight ? (next.offsetHeight / host.clientHeight) * 100 : least
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const now = drag.current
    const host = event.currentTarget.parentElement
    if (now.at !== 'dragging' || !host) return
    if (now.axis === 'x') set('x', now.size + now.from - event.clientX)
    else {
      const box = host.getBoundingClientRect()
      set('y', ((box.bottom - event.clientY - event.currentTarget.offsetHeight / 2) / box.height) * 100)
    }
  }

  const stop = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { at: 'idle' }
    event.currentTarget.parentElement?.removeAttribute('data-dragging')
  }

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const host = event.currentTarget.parentElement
    if (!host) return
    const [low, high] = bounds(axis, host)
    const grow = axis === 'x' ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowUp: 1, ArrowDown: -1 }
    const step = grow[event.key as keyof typeof grow]
    const current = axis === 'x' ? pane(host) : share(host)
    const next = event.key === 'Home' ? low : event.key === 'End' ? high : step ? current + step * steps[axis] : undefined
    if (next === undefined) return
    event.preventDefault()
    set(axis, next)
  }

  return (
    <div
      aria-label={props.label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
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
        drag.current = { at: 'dragging', axis, from: axis === 'x' ? event.clientX : event.clientY, size: axis === 'x' ? pane(host) : share(host) }
      }}
      onPointerMove={move}
      onPointerUp={stop}
      ref={handle}
      role="separator"
      tabIndex={0}
    >
      <i aria-hidden="true" />
    </div>
  )
}
