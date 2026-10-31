import { type MouseEvent, type ReactNode, useSyncExternalStore } from 'react'
import { fixture } from './api.ts'

function subscribe(listener: () => void) {
  addEventListener('popstate', listener)
  return () => removeEventListener('popstate', listener)
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname)
}

export function href(path: string) {
  if (!fixture) return path
  const url = new URL(path, location.origin)
  url.searchParams.set('fixture', '')
  return `${url.pathname}${url.search}${url.hash}`
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState(null, '', href(path))
  else history.pushState(null, '', href(path))
  dispatchEvent(new PopStateEvent('popstate'))
  scrollTo(0, 0)
}

export function Link(props: { children: ReactNode; className?: string; to: string }) {
  return (
    <a
      className={props.className}
      href={href(props.to)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(props.to)
      }}
    >
      {props.children}
    </a>
  )
}
