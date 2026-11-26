import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Config, Entry } from '../shared/Api.ts'
import * as Limits from '../shared/Limits.ts'
import * as Api from './api.ts'
import * as Attempt from './attempt.ts'
import { boot, seeded } from './boot.ts'
import * as Local from './local.ts'
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
          if (alive) setTimeout(load, Limits.Client.configRetryMs)
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

const solo = new EventTarget()

export function useSolo(open: boolean, close: () => void) {
  const shut = useRef(close)
  shut.current = close
  const [self] = useState(() => ({}))
  useEffect(() => {
    if (!open) return
    solo.dispatchEvent(new CustomEvent('open', { detail: self }))
    const other = (event: Event) => {
      if ((event as CustomEvent).detail !== self) shut.current()
    }
    solo.addEventListener('open', other)
    return () => solo.removeEventListener('open', other)
  }, [open, self])
}

export function remembered<T>(key: string) {
  return Local.value<T>(key)
}

export function remember(key: string, data: unknown) {
  Local.put(key, data)
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

export function usePoll<T>(load: () => Promise<T>, ms: number | null | ((data: T | undefined) => number | null), key: string) {
  const listen = useCallback((listener: () => void) => Local.subscribe(key, listener), [key])
  const data = useSyncExternalStore(
    listen,
    () => Local.value<T>(key),
    () => seeded<T>(key),
  )
  const [failure, setFailure] = useState<{ error: string; key: string } | undefined>(() => {
    const failed = seeded<string>(`!${key}`)
    return failed === undefined ? undefined : { error: failed, key }
  })
  const [landed, setLanded] = useState(0)
  const current = useRef(load)
  const visible = useVisible()
  const every = typeof ms === 'function' ? ms(data) : ms

  useEffect(() => {
    current.current = load
  })

  const fetched = useStable(() => {
    const wanted = key
    return Local.load(wanted, () => current.current()).then(
      () => setFailure((previous) => (previous?.key === wanted ? undefined : previous)),
      (error: unknown) => setFailure({ error: message(error), key: wanted }),
    ).finally(() => setLanded((count) => count + 1))
  })

  useEffect(() => {
    if (visible && !Local.fresh(key)) void fetched()
  }, [key, visible])

  useEffect(() => {
    if (!visible) return
    return Local.subscribe(key, () => {
      if (Local.row(key)?.state === 'stale') void fetched()
    })
  }, [key, visible])

  useEffect(() => {
    if (!visible || every === null) return
    const timer = setTimeout(() => void fetched(), Math.max(0, (Local.row(key)?.at ?? 0) + every - Date.now()))
    return () => clearTimeout(timer)
  }, [key, every, visible, landed])

  const reload = useCallback(() => {
    if (document.visibilityState === 'hidden') Local.stale(key)
    else void fetched()
  }, [key, fetched])

  const set = useCallback((change: (data: T | undefined) => T | undefined) => Local.change<T>(key, change), [key])

  const error = failure?.key === key ? failure.error : undefined
  return [error === undefined ? { data } : { data, error }, reload, set] as const
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

export function useAttempt() {
  const [now, setNow] = useState<Attempt.Attempt>(Attempt.idle)
  const live = useRef(now)
  const move = useCallback((next: Attempt.Attempt) => {
    live.current = next
    setNow(next)
  }, [])
  const run = useCallback(
    async <T>(work: () => Promise<T>): Promise<{ value: T } | undefined> => {
      const next = Attempt.start(live.current)
      if (!next) return undefined
      move(next)
      try {
        const value = await work()
        move(Attempt.settle(live.current))
        return { value }
      } catch (reason) {
        move(Attempt.fail(live.current, message(reason)))
        return undefined
      }
    },
    [move],
  )
  return [now, run] as const
}
