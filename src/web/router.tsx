import { createContext, type MouseEvent, type ReactNode, useCallback, useContext, useSyncExternalStore } from 'react'
import * as Site from '../shared/Site.ts'
import { fixture } from './api.ts'
import { here } from './boot.ts'

function subscribe(listener: () => void) {
  addEventListener('popstate', listener)
  return () => removeEventListener('popstate', listener)
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => Site.strip(location.pathname), () => here().pathname)
}

const based = createContext<string | undefined>(undefined)

export const Base = based.Provider

export function useBase(id: string) {
  return useContext(based) ?? `/s/${encodeURIComponent(id)}`
}

export function useQuery(name: string) {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(location.search).get(name), () => here().searchParams.get(name))
}

export function href(path: string) {
  if (!fixture) return Site.at(path)
  const base = here()
  const url = new URL(path, base.origin)
  const scene = base.searchParams.get('scene')
  url.searchParams.set('fixture', '')
  if (scene) url.searchParams.set('scene', scene)
  return Site.at(`${url.pathname}${url.search.replace(/([?&]fixture)=(?=&|$)/, '$1')}${url.hash}`)
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

let threaded: string | undefined

function withThread(id: number | undefined) {
  const url = new URL(location.href)
  if (id === undefined) url.searchParams.delete('thread')
  else url.searchParams.set('thread', String(id))
  return `${Site.strip(url.pathname)}${url.search}`
}

export function useThread() {
  const raw = useQuery('thread')
  const id = raw !== null && /^[0-9]+$/.test(raw) ? Number(raw) : undefined
  const open = useCallback(
    (next: number) => {
      if (next === id) return
      const pushed = threaded === location.href
      navigate(withThread(next), { keep: true, replace: id !== undefined })
      if (id === undefined || pushed) threaded = location.href
    },
    [id],
  )
  const close = useCallback(() => {
    if (id === undefined) return
    if (threaded === location.href && depth() > 0) history.back()
    else navigate(withThread(undefined), { keep: true, replace: true })
    threaded = undefined
  }, [id])
  return [id, open, close] as const
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

export function Link(props: { children: ReactNode; className?: string; data?: Readonly<Record<`data-${string}`, string>> | undefined; keep?: boolean; label?: string; lit?: boolean; onHover?: (hovering: boolean) => void; replace?: boolean; title?: string; to: string }) {
  return (
    <a
      {...props.data}
      aria-label={props.label}
      className={props.className}
      data-lit={props.lit || undefined}
      href={href(props.to)}
      title={props.title}
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
