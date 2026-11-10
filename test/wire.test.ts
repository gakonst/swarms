import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import type * as WireModule from '../src/web/wire.ts'

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
  document: { addEventListener: (name: string, listener: () => void) => void heard.set(name, listener), removeEventListener: () => {}, visibilityState: 'visible' },
  location: { host: 'swarms.test', href: 'http://swarms.test/', origin: 'http://swarms.test', pathname: '/', protocol: 'http:', search: '' },
  removeEventListener: () => {},
})

const Wire: typeof WireModule = await import('../src/web/wire.ts')

function timed() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  return mock.timers
}

const pulse = { hands: [], reason: null, swarm: { balance: '9' }, type: 'pulse', version: 'v2', why: null, working: null }

test('what a lingering room wire hears with nobody listening is told to whoever joins next', (t) => {
  const timers = timed()
  t.after(() => timers.reset())
  const first: string[] = []
  const leave = Wire.join('a', 'room', (signal) => first.push(signal.type === 'stir' ? `stir:${signal.parts.join(',')}` : signal.type))
  const socket = Socket.all.at(-1)!
  socket.opened()
  socket.says({ type: 'welcome', version: 'v1' })
  assert.equal(Wire.state('a', 'room'), 'live')
  assert.deepEqual(first, ['open', `stir:${Wire.parts.join(',')}`])
  leave()

  socket.says(pulse)
  socket.says({ parts: ['detail', 'members'], type: 'changed', version: 'v3' })
  timers.tick(1000)

  const second: string[] = []
  const third: string[] = []
  const left = [Wire.join('a', 'room', (signal) => second.push(signal.type === 'stir' ? `stir:${signal.parts.join(',')}` : signal.type)), Wire.join('a', 'room', (signal) => third.push(signal.type))]
  assert.equal(Wire.state('a', 'room'), 'live')
  assert.equal(Socket.all.at(-1), socket)
  timers.tick(1)
  assert.deepEqual(second, [`stir:${Wire.parts.join(',')}`])
  assert.deepEqual(third, ['stir'])
  timers.tick(1)
  assert.equal(second.length, 1)
  for (const each of left) each()
})

test('a lingering room wire that heard nothing tells a returning listener nothing', (t) => {
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
  assert.deepEqual(told, [])
  socket.says({ parts: ['feed'], type: 'changed', version: 'v2' })
  assert.deepEqual(told, ['changed', 'stir'])
  left()
})

test('a swarm the lingering lobby announced to nobody makes whoever enters next read the list again', (t) => {
  const timers = timed()
  t.after(() => timers.reset())
  const first: string[] = []
  const leave = Wire.enter((event) => first.push(event.type))
  const socket = Socket.all.at(-1)!
  socket.opened()
  socket.says({ type: 'welcome' })
  assert.deepEqual(first, ['welcome'])
  leave()
  socket.says({ swarm: { id: 's1' }, type: 'swarm' })
  const second: string[] = []
  const left = Wire.enter((event) => second.push(event.type))
  timers.tick(1)
  assert.deepEqual(second, ['welcome'])
  socket.says({ swarm: { id: 's2' }, type: 'swarm' })
  assert.deepEqual(second, ['welcome', 'swarm'])
  left()
  const third: string[] = []
  const gone = Wire.enter((event) => third.push(event.type))
  timers.tick(1)
  assert.deepEqual(third, [])
  gone()
})

test('a socket that stops answering pings is closed and opened again, so the page reads over HTTP meanwhile', (t) => {
  const timers = timed()
  t.after(() => timers.reset())
  const told: string[] = []
  const leave = Wire.join('c', 'room', (signal) => told.push(signal.type))
  const socket = Socket.all.at(-1)!
  socket.opened()
  socket.says({ type: 'welcome', version: 'v1' })
  timers.tick(30_000)
  assert.deepEqual(socket.sent, ['ping'])
  socket.says('pong')
  timers.tick(29_999)
  assert.equal(Wire.state('c', 'room'), 'live')
  timers.tick(1)
  assert.deepEqual(socket.sent, ['ping', 'ping'])
  timers.tick(9_999)
  assert.equal(Wire.state('c', 'room'), 'live')
  timers.tick(1)
  assert.equal(Wire.state('c', 'room'), 'down')
  assert.equal(socket.readyState, 3)
  assert.equal(told.at(-1), 'closed')
  socket.says(pulse)
  assert.equal(told.at(-1), 'closed')

  timers.tick(3000)
  const next = Socket.all.at(-1)!
  assert.notEqual(next, socket)
  assert.equal(next.url, socket.url)
  next.opened()
  next.says({ type: 'welcome', version: 'v1' })
  assert.equal(Wire.state('c', 'room'), 'live')
  assert.deepEqual(told.slice(-2), ['open', 'stir'])
  socket.onclose?.()
  assert.equal(Wire.state('c', 'room'), 'live')

  heard.get('online')?.()
  assert.deepEqual(next.sent, ['ping'])
  next.says({ online: [], type: 'presence', watching: 1 })
  timers.tick(10_000)
  assert.equal(Wire.state('c', 'room'), 'live')
  heard.get('visibilitychange')?.()
  timers.tick(10_000)
  assert.equal(Wire.state('c', 'room'), 'down')
  leave()
})
