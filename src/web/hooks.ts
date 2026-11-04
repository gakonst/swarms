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

export function usePoll<T>(load: () => Promise<T>, ms: number | ((data: T | undefined) => number), key: string, options: { keep?: boolean } = {}) {
  const [state, setState] = useState<{ data?: T | undefined; error?: string }>(() => {
    const data = remembered<T>(key) ?? seeded<T>(key) ?? (options.keep ? recall<T>(key) : undefined)
    const failed = seeded<string>(`!${key}`)
    return data === undefined ? (failed ? { error: failed } : {}) : { data }
  })
  const warm = useRef(remembered(key) === undefined && (seeded(key) !== undefined || seeded(`!${key}`) !== undefined))
  const [version, setVersion] = useState(0)
  const current = useRef(load)
  const pace = useRef(ms)
  const held = useRef(state)
  const text = useRef<string | undefined>(undefined)
  const visible = useVisible()

  useEffect(() => {
    current.current = load
    pace.current = ms
    held.current = state
  })

  useEffect(() => {
    if (!visible) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      let latest = held.current.data
      try {
        const data = await current.current()
        if (!alive) return
        latest = data
        const json = JSON.stringify(data)
        const before = text.current ?? (held.current.data === undefined ? undefined : JSON.stringify(held.current.data))
        text.current = json
        if (json !== before || held.current.error !== undefined) {
          if (options.keep) keep(key, data)
          else remember(key, data)
          setState({ data })
        }
      } catch (error) {
        if (alive) setState((previous) => ({ ...previous, error: message(error) }))
      }
      if (alive) timer = setTimeout(() => void run(), wait(latest))
    }
    const wait = (data: T | undefined) => (typeof pace.current === 'number' ? pace.current : pace.current(data))
    if (warm.current) {
      warm.current = false
      const pace = wait(held.current.data)
      timer = setTimeout(() => void run(), Math.min(pace, Math.max(0, pace - (Date.now() - (boot()?.now ?? Date.now())))))
    } else void run()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [key, typeof ms === 'number' ? ms : 0, version, visible])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return [state, reload] as const
}

export type Stream = { at: number; input: string; inputItem: string; text: string; textItem: string; thinking: string; thinkingItem: string }

export type Live = { connected: boolean; pushed: boolean; since: number | undefined; streams: Readonly<Record<string, Stream>> }

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

export function useLive(id: string, active: boolean, onEntry: (entry: Entry) => void, after?: () => number): Live {
  const [connected, setConnected] = useState(false)
  const [pushed, setPushed] = useState(false)
  const [since, setSince] = useState<number>()
  const [streams, setStreams] = useState<Readonly<Record<string, Stream>>>({})
  const handler = useRef(onEntry)
  const cursor = useRef(after)

  useEffect(() => {
    handler.current = onEntry
    cursor.current = after
  })

  useEffect(() => {
    setStreams({})
    setSince(undefined)
  }, [id])

  useEffect(() => {
    if (!active) return
    setPushed(false)
    const stream = (who: string, change: (stream: Stream) => Stream) => setStreams((previous) => ({ ...previous, [who]: change(previous[who] ?? blank) }))
    return Api.live(id, (event) => {
      if (event.type === 'end' || event.type === 'idle') {
        if (event.type === 'end') setStreams({})
        if (cursor.current) return
        setConnected(false)
        setPushed(false)
        return
      }
      setConnected(true)
      if (event.type === 'start') setSince(event.at)
      if (event.type === 'delta') stream(speaker(event.who), (current) => write(current, event.channel, event.item, event.delta, event.offset))
      if (event.type === 'entry') {
        if (event.entry.seq > 0) setPushed(true)
        stream(speaker(event.entry.who), (current) => settle(current, event.entry))
        handler.current(event.entry)
      }
    }, cursor.current ? () => cursor.current?.() ?? 0 : undefined, cursor.current ? () => {
      setConnected(false)
      setPushed(false)
    } : undefined)
  }, [active, id])

  return { connected: active && connected, pushed: active && connected && pushed, since, streams }
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

export function usePresence<T>(items: readonly T[], key: (item: T) => string, ms = 700) {
  const [gone, setGone] = useState<{ at: number; item: T }[]>([])
  const previous = useRef<readonly T[]>(items)

  useEffect(() => {
    const keys = new Set(items.map(key))
    const left = previous.current.filter((item) => !keys.has(key(item)))
    previous.current = items
    if (left.length === 0) return
    const now = Date.now()
    setGone((list) => [...list.filter((entry) => !keys.has(key(entry.item))), ...left.map((item) => ({ at: now, item }))])
  }, [items, key])

  useEffect(() => {
    if (gone.length === 0) return
    const timer = setTimeout(() => setGone((list) => list.filter((entry) => Date.now() - entry.at < ms)), ms)
    return () => clearTimeout(timer)
  }, [gone, ms])

  const keys = new Set(items.map(key))
  return [...items.map((item) => ({ item, leaving: false })), ...gone.filter((entry) => !keys.has(key(entry.item))).map((entry) => ({ item: entry.item, leaving: true }))]
}
