import { mock } from 'node:test'
import type * as WireModule from '../../src/web/wire.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function wire(seed: string): Promise<Outcome> {
  const random = rng('wire', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []

  class Socket {
    static OPEN = 1
    static all: Socket[] = []
    onclose: (() => void) | undefined
    onmessage: ((message: { data: string }) => void) | undefined
    onopen: (() => void) | undefined
    readyState = 0
    sent: string[] = []
    url: string
    constructor(url: string) {
      this.url = url
      Socket.all.push(this)
    }
    send(data: string) {
      this.sent.push(data)
    }
    close() {
      this.readyState = 3
    }
    opened() {
      this.readyState = 1
      this.onopen?.()
    }
    says(data: unknown) {
      this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
    }
  }

  const heard = new Map<string, () => void>()

  Object.assign(globalThis, {
    WebSocket: Socket,
    addEventListener: (name: string, listener: () => void) => void heard.set(name, listener),
    document: {
      addEventListener: (name: string, listener: () => void) => void heard.set(name, listener),
      removeEventListener: () => {},
      visibilityState: 'visible',
    },
    location: { host: 'swarms.test', href: 'http://swarms.test/', origin: 'http://swarms.test', pathname: '/', protocol: 'http:', search: '' },
    removeEventListener: () => {},
  })

  const Wire = await load<typeof WireModule>('src/web/wire.ts')

  function timed() {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    return mock.timers
  }

  const pulse = { hands: [], reason: null, swarm: { balance: '9' }, type: 'pulse', version: 'v2', why: null, working: null }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'what a lingering room wire hears with nobody listening is told to whoever joins next',
      async (t) => {
        const timers = timed()
        t.after(() => timers.reset())
        const first: string[] = []
        const leave = Wire.join('a', 'room', (signal) => first.push(signal.type === 'stir' ? `stir:${signal.parts.join(',')}` : signal.type))
        const socket = Socket.all.at(-1)!
        socket.opened()
        socket.says({ type: 'welcome', version: 'v1' })
        a.equal(Wire.state('a', 'room'), 'live')
        a.deepEqual(first, ['open', `stir:${Wire.parts.join(',')}`])
        leave()

        socket.says(pulse)
        socket.says({ parts: ['detail', 'members'], type: 'changed', version: 'v3' })
        timers.tick(1000)

        const second: string[] = []
        const third: string[] = []
        const left = [
          Wire.join('a', 'room', (signal) => second.push(signal.type === 'stir' ? `stir:${signal.parts.join(',')}` : signal.type)),
          Wire.join('a', 'room', (signal) => third.push(signal.type)),
        ]
        a.equal(Wire.state('a', 'room'), 'live')
        a.equal(Socket.all.at(-1), socket)
        timers.tick(1)
        a.deepEqual(second, [`stir:${Wire.parts.join(',')}`])
        a.deepEqual(third, ['stir'])
        timers.tick(1)
        a.equal(second.length, 1)
        for (const each of left) each()
      },
    ],
    [
      'a lingering room wire that heard nothing tells a returning listener nothing',
      async (t) => {
        const timers = timed()
        t.after(() => timers.reset())
        const leave = Wire.join('b', 'room', () => {})
        const socket = Socket.all.at(-1)!
        socket.opened()
        socket.says({ type: 'welcome', version: 'v1' })
        leave()
        socket.says({ online: [], type: 'presence', watching: 0 })
        const told: string[] = []
        const left = Wire.join('b', 'room', (signal) => told.push(signal.type))
        timers.tick(1)
        a.deepEqual(told, [])
        socket.says({ parts: ['feed'], type: 'changed', version: 'v2' })
        a.deepEqual(told, ['changed', 'stir'])
        left()
      },
    ],
    [
      'a swarm the lingering lobby announced to nobody makes whoever enters next read the list again',
      async (t) => {
        const timers = timed()
        t.after(() => timers.reset())
        const first: string[] = []
        const leave = Wire.enter((event) => first.push(event.type))
        const socket = Socket.all.at(-1)!
        socket.opened()
        socket.says({ type: 'welcome' })
        a.deepEqual(first, ['welcome'])
        leave()
        socket.says({ swarm: { id: 's1' }, type: 'swarm' })
        const second: string[] = []
        const left = Wire.enter((event) => second.push(event.type))
        timers.tick(1)
        a.deepEqual(second, ['welcome'])
        socket.says({ swarm: { id: 's2' }, type: 'swarm' })
        a.deepEqual(second, ['welcome', 'swarm'])
        left()
        const third: string[] = []
        const gone = Wire.enter((event) => third.push(event.type))
        timers.tick(1)
        a.deepEqual(third, [])
        gone()
      },
    ],
    [
      'a socket that stops answering pings is closed and opened again, so the page reads over HTTP meanwhile',
      async (t) => {
        const timers = timed()
        t.after(() => timers.reset())
        const told: string[] = []
        const leave = Wire.join('c', 'room', (signal) => told.push(signal.type))
        const socket = Socket.all.at(-1)!
        socket.opened()
        socket.says({ type: 'welcome', version: 'v1' })
        timers.tick(30_000)
        a.deepEqual(socket.sent, ['ping'])
        socket.says('pong')
        timers.tick(29_999)
        a.equal(Wire.state('c', 'room'), 'live')
        timers.tick(1)
        a.deepEqual(socket.sent, ['ping', 'ping'])
        timers.tick(9_999)
        a.equal(Wire.state('c', 'room'), 'live')
        timers.tick(1)
        a.equal(Wire.state('c', 'room'), 'down')
        a.equal(socket.readyState, 3)
        a.equal(told.at(-1), 'closed')
        socket.says(pulse)
        a.equal(told.at(-1), 'closed')

        timers.tick(3000)
        const next = Socket.all.at(-1)!
        a.notEqual(next, socket)
        a.equal(next.url, socket.url)
        next.opened()
        next.says({ type: 'welcome', version: 'v1' })
        a.equal(Wire.state('c', 'room'), 'live')
        a.deepEqual(told.slice(-2), ['open', 'stir'])
        socket.onclose?.()
        a.equal(Wire.state('c', 'room'), 'live')

        heard.get('online')?.()
        a.deepEqual(next.sent, ['ping'])
        next.says({ online: [], type: 'presence', watching: 1 })
        timers.tick(10_000)
        a.equal(Wire.state('c', 'room'), 'live')
        heard.get('visibilitychange')?.()
        timers.tick(10_000)
        a.equal(Wire.state('c', 'room'), 'down')
        leave()
      },
    ],
  ]
  for (const [dstName, dstRun] of [...dstCases].sort(() => random.next() - 0.5)) {
    a.as(dstName)
    try {
      await dstRun({ after: (fn) => void afters.push(fn) })
    } catch (error) {
      fail(dstName, String((error as Error)?.stack ?? error).slice(0, 400))
    } finally {
      for (const fn of afters.splice(0).reverse()) await fn()
    }
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { wire }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'wire.linger',
      'src/web/wire.ts',
      "if (!wire.listeners.size && (event.type === 'pulse' || event.type === 'said' || event.type === 'artifacts' || event.type === 'roster')) return stir(wire, parts, 'welcome')",
      "if (wire.listeners.size && (event.type === 'pulse' || event.type === 'said' || event.type === 'artifacts' || event.type === 'roster')) return stir(wire, parts, 'welcome')",
    ),
    invariant: 'what a lingering room wire hears with nobody listening is told to whoever joins next',
    name: 'wire.linger',
    scenario: 'wire',
    seeds: ['1', '2', '3'],
  },
]
