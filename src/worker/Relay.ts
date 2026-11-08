import type { Live } from '../shared/Api.ts'
import type { Swarm } from './Swarm.ts'

export type Watcher = { follow: boolean; relaying: boolean; until: number; writer: WritableStreamDefaultWriter<Uint8Array> }

export type Ring = { bytes: number; frames: Uint8Array[] }

const ringBytes = 2_000_000

export const backlogSize = 500

export const followForMs = 15 * 60_000

const beatMs = 25_000

const keepalive = new TextEncoder().encode(': keepalive\n\n')

export function encoded(event: Live) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

export function sse(body: BodyInit) {
  return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'text/event-stream' } })
}

export function join(self: Swarm, watcher: Watcher) {
  if (watcher.relaying || !self.watchers.has(watcher)) return
  watcher.relaying = true
  write(self, watcher, encoded({ at: self.working()?.since ?? Date.now(), type: 'start' }))
  for (const frame of self.ring.frames) if (!write(self, watcher, frame)) return
  if (self.window && !self.window.live) poke(self)
}

export function poke(self: Swarm) {
  self.window?.stop.abort()
  self.ctx.waitUntil(self.ctx.storage.setAlarm(Date.now()))
}

export function relay(self: Swarm, event: Live) {
  if (!self.watchers.size) return
  const bytes = encoded(event)
  self.ring.frames.push(bytes)
  self.ring.bytes += bytes.byteLength
  while (self.ring.bytes > ringBytes && self.ring.frames.length > 1) self.ring.bytes -= self.ring.frames.shift()?.byteLength ?? 0
  for (const watcher of self.watchers) if (watcher.relaying) write(self, watcher, bytes)
}

export function begin(self: Swarm) {
  self.ring = { bytes: 0, frames: [] }
  self.fails = 0
  for (const watcher of self.watchers) join(self, watcher)
}

export function ended(self: Swarm) {
  const bytes = encoded({ type: 'end' })
  for (const watcher of [...self.watchers])
    if (watcher.relaying) {
      write(self, watcher, bytes)
      watcher.relaying = false
      if (!watcher.follow) unwatch(self, watcher)
    }
  self.ring = { bytes: 0, frames: [] }
}

export function write(self: Swarm, watcher: Watcher, bytes: Uint8Array) {
  if (!self.watchers.has(watcher)) return false
  if ((watcher.writer.desiredSize ?? 0) < -backlogSize) {
    unwatch(self, watcher)
    return false
  }
  watcher.writer.write(bytes).catch(() => unwatch(self, watcher))
  return true
}

export function unwatch(self: Swarm, watcher: Watcher) {
  if (!self.watchers.delete(watcher)) return
  watcher.writer.close().catch(() => undefined)
  if (!self.watchers.size && self.beating !== undefined) {
    clearInterval(self.beating)
    self.beating = undefined
  }
}

export function current(self: Swarm) {
  try {
    return self.ctx.storage.kv.get<string>('instance') === self.boot
  } catch {
    return false
  }
}

export function beat(self: Swarm) {
  self.beating ??= setInterval(() => {
    if (!current(self)) {
      console.log(JSON.stringify({ superseded: self.boot, watchers: self.watchers.size }))
      for (const watcher of [...self.watchers]) unwatch(self, watcher)
      return
    }
    const now = Date.now()
    for (const watcher of self.watchers)
      if (watcher.follow && !watcher.relaying && now > watcher.until) unwatch(self, watcher)
      else write(self, watcher, keepalive)
  }, beatMs)
}
