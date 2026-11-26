import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Limits from '../shared/Limits.ts'

const gap = Limits.WebOverlay.gap

const edge = Limits.WebOverlay.edge

export function Overlay(props: { anchor?: HTMLElement | null | undefined; children: ReactNode; className?: string | undefined; label: string; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null)
  const close = useRef(props.onClose)
  close.current = props.onClose
  const [mounted, setMounted] = useState(false)
  const [at, setAt] = useState<{ left: number; top: number } | undefined>()
  const anchor = props.anchor
  useEffect(() => {
    setMounted(true)
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && close.current()
    const mark = Math.random().toString(Limits.WebOverlay.markRadix).slice(2)
    const marked = () => (history.state as { overlay?: string } | null)?.overlay === mark
    const popped = () => {
      if (!marked()) close.current()
    }
    history.pushState({ ...(history.state as object | null), overlay: mark }, '')
    addEventListener('keydown', escape)
    addEventListener('popstate', popped)
    return () => {
      removeEventListener('keydown', escape)
      removeEventListener('popstate', popped)
      if (marked()) history.back()
    }
  }, [])
  useLayoutEffect(() => {
    const own = card.current
    if (!anchor || !own) return
    const place = () => {
      const box = anchor.getBoundingClientRect()
      const size = own.getBoundingClientRect()
      const left = Math.max(edge, Math.min(box.left, innerWidth - size.width - edge))
      const below = box.bottom + gap
      const above = box.top - gap - size.height
      const top = below + size.height <= innerHeight - edge || above < edge ? Math.max(edge, Math.min(below, innerHeight - size.height - edge)) : above
      setAt((current) => (current && current.left === left && current.top === top ? current : { left, top }))
    }
    place()
    const sized = new ResizeObserver(place)
    sized.observe(own)
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    return () => {
      sized.disconnect()
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
    }
  }, [anchor, mounted])
  if (!mounted) return null
  return createPortal(
    <div className="overlay" data-anchored={anchor ? '' : undefined} onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div aria-label={props.label} aria-modal="true" className={props.className ? `overlay-card ${props.className}` : 'overlay-card'} data-placed={at ? '' : undefined} ref={card} role="dialog" style={at && ({ '--x': `${at.left}px`, '--y': `${at.top}px` } as CSSProperties)}>
        <button aria-label="Close" className="sheet-close" onClick={props.onClose} type="button">×</button>
        {props.children}
      </div>
    </div>,
    document.body,
  )
}
