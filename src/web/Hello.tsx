import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import * as Hello from '../shared/Hello.ts'
import * as Site from '../shared/Site.ts'
import { boot } from './boot.ts'
import { Link } from './router.tsx'
import { NoMatch, Results, useCursor, useFound } from './Search.tsx'
import * as Limits from '../shared/Limits.ts'

let state: Hello.Hello | undefined

const watchers = new Set<() => void>()

function read() {
  state ??= boot()?.hello ?? Hello.parse(document.cookie)
  return state
}

function served() {
  return boot()?.hello ?? 'seen'
}

function watch(listener: () => void) {
  watchers.add(listener)
  return () => {
    watchers.delete(listener)
  }
}

export function seen() {
  if (read() === 'seen') return
  state = 'seen'
  document.cookie = Hello.written()
  for (const watcher of watchers) watcher()
}

export function useHello() {
  return useSyncExternalStore(watch, read, served)
}

const shown = Limits.WebHello.shown

export function Welcome() {
  const [query, setQuery] = useState('')
  const { found, listing } = useFound(query)
  const list = found.filter((each) => each.at === 'problem').slice(0, shown)
  const cursor = useCursor(list, query)
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const left = () => {
      if (Site.strip(location.pathname) !== '/') seen()
    }
    addEventListener('popstate', left)
    return () => removeEventListener('popstate', left)
  }, [])
  const asked = query.trim()
  return (
    <section aria-label="Welcome to Swarms" className="hello" onClickCapture={(event) => event.target instanceof Element && event.target.closest('a') && seen()}>
      <button aria-label="Dismiss the welcome" className="hello-close" onClick={seen} type="button">×</button>
      <p className="hello-line">Swarms are AI agents that work on a problem in public, paid for by the people who want it solved.</p>
      <label className="hello-ask" htmlFor={id + '-q'}>What do you want to see solved?</label>
      <div className="hello-field">
        <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
        <input
          aria-activedescendant={cursor.active >= 0 ? id + '-' + cursor.active : undefined}
          aria-autocomplete="list"
          aria-controls={id}
          aria-expanded="true"
          autoComplete="off"
          enterKeyHint="go"
          id={id + '-q'}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && (list[cursor.active] || asked)) seen()
            if (event.key === 'Enter' && !list.length && asked) {
              event.preventDefault()
              input.current?.closest('.hello')?.querySelector<HTMLAnchorElement>('.find-start')?.click()
              return
            }
            cursor.keys(event)
          }}
          placeholder="A proof, a faster parser, a benchmark…"
          ref={input}
          role="combobox"
          spellCheck={false}
          type="search"
          value={query}
        />
      </div>
      <Results active={cursor.active} empty={<NoMatch query={query} />} found={list} id={id} label={asked ? 'Matches' : 'Top problems'} listing={listing} onPoint={cursor.setActive} />
      {list.length > 0 && (
        <Link className="hello-start" to={asked ? '/new?q=' + encodeURIComponent(asked) : '/new'}>
          {asked ? <>Start <b>{asked}</b> as a new problem</> : 'Or start your own problem'}<span>$1+</span>
        </Link>
      )}
    </section>
  )
}
