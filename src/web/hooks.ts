import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Config, Entry } from '../shared/Api.ts'
import * as Api from './api.ts'
import { boot, here, seeded, server } from './boot.ts'
import * as Wallet from './wallet.ts'

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useConfig() {
  const [config, setConfig] = useState<Config | undefined>(() => boot()?.config)
  useEffect(() => {
    const known = boot()?.config
    if (known) {
      void Wallet.restore(known).catch(() => {})
      return
    }
    let alive = true
    const load = () => {
      Api.config().then(
        (value) => {
          if (!alive) return
          setConfig(value)
          void Wallet.restore(value).catch(() => {})
        },
        () => {
          if (alive) setTimeout(load, 3000)
        },
      )
    }
    load()
    return () => {
      alive = false
    }
  }, [])
  return config
}

const kept = new Map<string, unknown>()

function shelf(key: string) {
  const search = here().searchParams
  return `poll:${search.has('fixture') ? `fixture:${search.get('scene') ?? ''}:` : ''}${key}`
}

function recall<T>(key: string): T | undefined {
  const name = shelf(key)
  if (kept.has(name)) return kept.get(name) as T
  try {
    if (server) return undefined
    const saved = sessionStorage.getItem(name)
    return saved ? (JSON.parse(saved) as T) : undefined
  } catch {
    return undefined
  }
}

export function remembered<T>(key: string) {
  return kept.get(shelf(key)) as T | undefined
}

export function remember(key: string, data: unknown) {
  kept.set(shelf(key), data)
}

function keep(key: string, data: unknown) {
  const name = shelf(key)
  kept.set(name, data)
  try {
    sessionStorage.setItem(name, JSON.stringify(data))
  } catch {}
}

function watch(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

export function useVisible() {
  return useSyncExternalStore(
    watch,
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

export function useStable<A extends unknown[], R>(run: (...args: A) => R) {
  const current = useRef(run)
  useLayoutEffect(() => {
    current.current = run
  })
  return useCallback((...args: A) => current.current(...args), [])
}

export function usePoll<T>(load: () => Promise<T>, ms: number | null | ((data: T | undefined) => number | null), key: string, options: { keep?: boolean } = {}) {
  const [state, setState] = useState<{ data?: T | undefined; error?: string }>(() => {
    const data = remembered<T>(key) ?? seeded<T>(key) ?? (options.keep ? recall<T>(key) : undefined)
    const failed = seeded<string>(`!${key}`)
    return data === undefined ? (failed ? { error: failed } : {}) : { data }
  })
  const [version, setVersion] = useState(0)
  const [landed, setLanded] = useState(0)
  const current = useRef(load)
  const pace = useRef(ms)
  const held = useRef(state)
  const keyed = useRef(key)
  const text = useRef<string | undefined>(undefined)
  const started = useRef(remembered(key) !== undefined ? 0 : seeded(key) !== undefined || seeded(`!${key}`) !== undefined ? (boot()?.now ?? Date.now()) : undefined)
  const asked = useRef(false)
  const flight = useRef<Promise<void> | undefined>(undefined)
  const visible = useVisible()
  const every = typeof ms === 'function' ? ms(state.data) : ms

  useEffect(() => {
    current.current = load
    pace.current = ms
    held.current = state
  })

  const store = useStable((data: T) => {
    if (options.keep) keep(key, data)
    else remember(key, data)
  })

  const fetched = useStable(() => {
    if (flight.current) return flight.current
    const wanted = keyed.current
    started.current = Date.now()
    const promise = current
      .current()
      .then(
        (data) => {
          if (keyed.current !== wanted) return
          const json = JSON.stringify(data)
          const before = text.current ?? (held.current.data === undefined ? undefined : JSON.stringify(held.current.data))
          text.current = json
          if (json === before && held.current.error === undefined) return
          store(data)
          setState({ data })
        },
        (error: unknown) => {
          if (keyed.current === wanted) setState((previous) => ({ ...previous, error: message(error) }))
        },
      )
      .finally(() => {
        flight.current = undefined
        setLanded((count) => count + 1)
      })
    flight.current = promise
    return promise
  })

  useEffect(() => {
    if (keyed.current !== key) {
      keyed.current = key
      text.current = undefined
      asked.current = true
    }
    if (!visible || flight.current) return
    if (asked.current || (started.current === undefined && held.current.data === undefined)) {
      asked.current = false
      void fetched()
      return
    }
    const wait = typeof pace.current === 'function' ? pace.current(held.current.data) : pace.current
    if (wait === null) return
    const timer = setTimeout(() => void fetched(), Math.max(0, (started.current ?? 0) + wait - Date.now()))
    return () => clearTimeout(timer)
  }, [key, every, version, visible, landed])

  const reload = useCallback(() => {
    asked.current = true
    setVersion((value) => value + 1)
  }, [])

  const set = useCallback(
    (change: (data: T | undefined) => T | undefined) =>
      setState((previous) => {
        const data = change(previous.data)
        if (data === undefined || data === previous.data) return previous
        text.current = JSON.stringify(data)
        store(data)
        return { data }
      }),
    [store],
  )

  return [state, reload, set] as const
}

export type Stream = { at: number; input: string; inputItem: string; text: string; textItem: string; thinking: string; thinkingItem: string }

export type Live = { at: 'off' } | { at: 'following' } | { at: 'live'; since: number | undefined; streams: Readonly<Record<string, Stream>> }

const blank: Stream = { at: 0, input: '', inputItem: '', text: '', textItem: '', thinking: '', thinkingItem: '' }

function write(stream: Stream, channel: 'input' | 'text' | 'thinking', item: string, delta: string, offset: number | null): Stream {
  const before = stream[`${channel}Item`] === item ? stream[channel] : ''
  const text = offset === null ? before + delta : before.slice(0, offset) + delta
  return { ...stream, at: Date.now(), [channel]: text, [`${channel}Item`]: item }
}

function settle(stream: Stream, entry: Entry): Stream {
  if (entry.kind === 'thinking') return { ...stream, thinking: '', thinkingItem: '' }
  if (entry.kind === 'message') return { ...stream, text: '', textItem: '' }
  if (entry.kind === 'tool' || entry.kind === 'machine') return { ...stream, input: '', inputItem: '' }
  return stream
}

export const agent = 'agent'

export function speaker(who: string | null) {
  return who ?? agent
}

const off: Live = { at: 'off' }

function streamed(live: Live, who: string, change: (stream: Stream) => Stream): Live {
  const on = live.at === 'live' ? live : { at: 'live' as const, since: undefined, streams: {} }
  return { ...on, streams: { ...on.streams, [who]: change(on.streams[who] ?? blank) } }
}

export function useLive(id: string, active: boolean, onEntry: (entry: Entry) => void, after: () => number): Live {
  const [live, setLive] = useState<Live>(off)
  const handler = useRef(onEntry)
  const cursor = useRef(after)

  useEffect(() => {
    handler.current = onEntry
    cursor.current = after
  })

  useEffect(() => {
    setLive(off)
    if (!active) return
    return Api.live(id, () => cursor.current(), (event) => {
      if (event.type === 'open') return setLive((previous) => (previous.at === 'off' ? { at: 'following' } : previous))
      if (event.type === 'lost') return setLive(off)
      if (event.type === 'end' || event.type === 'idle') return setLive({ at: 'following' })
      if (event.type === 'start') return setLive((previous) => ({ at: 'live', since: event.at, streams: previous.at === 'live' ? previous.streams : {} }))
      if (event.type === 'delta') return setLive((previous) => streamed(previous, speaker(event.who), (current) => write(current, event.channel, event.item, event.delta, event.offset)))
      if (event.type !== 'entry') return
      const entry = event.entry
      setLive((previous) => (previous.at === 'live' ? streamed(previous, speaker(entry.who), (current) => settle(current, entry)) : previous.at === 'off' ? { at: 'following' } : previous))
      handler.current(entry)
    })
  }, [active, id])

  return active ? live : off
}

export function useNow(ms = 1000, active = true) {
  const [now, setNow] = useState(() => boot()?.now ?? Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms, active])
  return now
}

function fits(query: string, mobile: boolean) {
  const width = mobile ? 390 : 1440
  const min = /min-width:\s*(\d+)px/.exec(query)?.[1]
  const max = /max-width:\s*(\d+)px/.exec(query)?.[1]
  return (min === undefined || width >= Number(min)) && (max === undefined || width <= Number(max))
}

export function useMedia(query: string) {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query)
      list.addEventListener('change', listener)
      return () => list.removeEventListener('change', listener)
    },
    () => matchMedia(query).matches,
    () => fits(query, boot()?.mobile ?? false),
  )
}

export function useWallet() {
  return useSyncExternalStore(Wallet.subscribe, Wallet.snapshot, Wallet.initial)
}
