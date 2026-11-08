import { type MouseEvent, type ReactNode, useSyncExternalStore } from 'react'
import { fixture } from './api.ts'
import { here } from './boot.ts'

function subscribe(listener: () => void) {
  addEventListener('popstate', listener)
  return () => removeEventListener('popstate', listener)
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname, () => here().pathname)
}

export function useQuery(name: string) {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(location.search).get(name), () => here().searchParams.get(name))
}

export function href(path: string) {
  if (!fixture) return path
  const base = here()
  const url = new URL(path, base.origin)
  const scene = base.searchParams.get('scene')
  url.searchParams.set('fixture', '')
  if (scene) url.searchParams.set('scene', scene)
  return `${url.pathname}${url.search}${url.hash}`
}

const warmers: ((path: string) => void)[] = []

export function warmer(warm: (path: string) => void) {
  warmers.push(warm)
}

export function prefetch(path: string) {
  for (const warm of warmers) warm(path)
}

function depth() {
  const state: unknown = typeof history === 'undefined' ? null : history.state
  return typeof state === 'object' && state !== null && 'depth' in state && typeof state.depth === 'number' ? state.depth : 0
}

export function navigate(path: string, options: { replace?: boolean; keep?: boolean } = {}) {
  if (options.replace) history.replaceState({ depth: depth() }, '', href(path))
  else history.pushState({ depth: depth() + 1 }, '', href(path))
  dispatchEvent(new PopStateEvent('popstate'))
  if (!options.keep) scrollTo(0, 0)
}

export function useCanBack() {
  return useSyncExternalStore(subscribe, () => depth() > 0, () => false)
}

export function back(fallback: string) {
  if (depth() > 0) history.back()
  else navigate(fallback, { replace: true })
}

function plain(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function Link(props: { children: ReactNode; className?: string; data?: Readonly<Record<`data-${string}`, string>> | undefined; keep?: boolean; label?: string; lit?: boolean; onHover?: (hovering: boolean) => void; replace?: boolean; to: string }) {
  return (
    <a
      {...props.data}
      aria-label={props.label}
      className={props.className}
      data-lit={props.lit || undefined}
      href={href(props.to)}
      onBlur={() => props.onHover?.(false)}
      onFocus={() => {
        prefetch(props.to)
        props.onHover?.(true)
      }}
      onPointerEnter={() => {
        prefetch(props.to)
        props.onHover?.(true)
      }}
      onPointerLeave={() => props.onHover?.(false)}
      onTouchStart={() => prefetch(props.to)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (!plain(event)) return
        event.preventDefault()
        navigate(props.to, { ...(props.replace ? { replace: true } : {}), ...(props.keep ? { keep: true } : {}) })
      }}
    >
      {props.children}
    </a>
  )
}

export function Back(props: { children: ReactNode; className?: string; label?: string; to: string }) {
  return (
    <a
      aria-label={props.label}
      className={props.className}
      href={href(props.to)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (!plain(event)) return
        event.preventDefault()
        back(props.to)
      }}
    >
      {props.children}
    </a>
  )
}
