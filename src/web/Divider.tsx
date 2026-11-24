import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef } from 'react'

let kept = 40

const least = 15

const most = 50

function host(handle: HTMLElement | null) {
  return handle?.parentElement ?? null
}

export function Divider(props: { hidden: boolean }) {
  const handle = useRef<HTMLDivElement>(null)

  const set = (share: number) => {
    kept = Math.round(Math.min(most, Math.max(least, share)))
    host(handle.current)?.style.setProperty('--board', `${kept}%`)
    handle.current?.setAttribute('aria-valuenow', String(kept))
  }

  useLayoutEffect(() => {
    if (kept !== 40) set(kept)
  }, [])

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const article = host(event.currentTarget)
    const board = article?.querySelector<HTMLElement>(':scope > .panel-board')
    if (!article || !board) return
    set(((event.clientY - board.getBoundingClientRect().top) / article.clientHeight) * 100)
  }

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowUp' ? -5 : event.key === 'ArrowDown' ? 5 : 0
    if (!step) return
    event.preventDefault()
    set(kept + step)
  }

  return (
    <div
      aria-label="Resize the board and the chat"
      aria-orientation="horizontal"
      aria-valuemax={most}
      aria-valuemin={least}
      aria-valuenow={kept}
      className="split-handle"
      hidden={props.hidden}
      onKeyDown={keys}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={drag}
      ref={handle}
      role="separator"
      tabIndex={0}
    >
      <i aria-hidden="true" />
    </div>
  )
}
