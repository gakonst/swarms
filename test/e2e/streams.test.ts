import * as assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import * as Dev from './dev.ts'
import { type Rider, rider } from './rider.ts'
import { swarm } from './swarm.ts'

type Frame = { data: Record<string, unknown>; event: string; id: string | undefined }

let dev: Dev.Dev
let ana: Rider
let id = ''
const streams: AbortController[] = []

before(async () => {
  dev = await Dev.start()
  ana = await rider(dev, 'ana')
  await ana.call('POST', '/v1/me', { name: 'ana' })
  const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { form: 'tree', goal: 'Does every read stream? An end-to-end run on mocks.', template: 'cheap', title: 'Streams (e2e)' })
  assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.body))
  id = made.body.id
})

after(async () => {
  for (const stream of streams) stream.abort()
  await dev?.stop()
})

async function follow(route: string, last?: string) {
  const stop = new AbortController()
  streams.push(stop)
  const response = await fetch(dev.url + route, { headers: { accept: 'text/event-stream', ...(last ? { 'last-event-id': last } : {}) }, signal: stop.signal })
  assert.equal(response.status, 200, route)
  assert.equal(response.headers.get('content-type'), 'text/event-stream', route)
  const frames: Frame[] = []
  const waiting = new Set<() => void>()
  void (async () => {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const read = await reader.read().catch(() => undefined)
      if (!read || read.done) return
      buffer += read.value
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const lines = block.split('\n')
        const value = (name: string) => lines.find((line) => line.startsWith(name + ': '))?.slice(name.length + 2)
        const data = value('data')
        if (data === undefined) continue
        frames.push({ data: JSON.parse(data) as Record<string, unknown>, event: value('event') ?? 'message', id: value('id') })
        for (const wake of [...waiting]) wake()
      }
    }
  })()
  const until = (what: string, check: (frame: Frame) => boolean, ms = 30_000) =>
    new Promise<Frame>((resolve, reject) => {
      const look = () => {
        const found = frames.find(check)
        if (!found) return
        waiting.delete(look)
        clearTimeout(timer)
        resolve(found)
      }
      const timer = setTimeout(() => {
        waiting.delete(look)
        reject(new Error(route + ': timed out waiting for ' + what + ' in ' + JSON.stringify(frames.map((frame) => [frame.event, frame.id])).slice(0, 600)))
      }, ms)
      waiting.add(look)
      look()
    })
  return { frames, stop, until }
}

test('the list, the tree, the books, the riders and the room stream a snapshot and then what changes, and the tree resumes where it left off', async () => {
  const s = swarm(dev, id)
  const list = await follow('/v1/swarms')
  const tree = await follow('/v1/swarms/' + id + '/tree')
  const ledger = await follow('/v1/swarms/' + id + '/ledger')
  const backers = await follow('/v1/swarms/' + id + '/backers')
  const chat = await follow('/v1/swarms/' + id + '/chat')
  for (const stream of [list, tree, ledger, backers, chat]) await stream.until('a snapshot', (frame) => frame.event === 'snapshot')
  const first = tree.frames[0]
  assert.match(first?.id ?? '', /^\d+$/)

  await s.ride(ana, 'root', '5')
  const funded = await tree.until('a funded delta', (frame) => frame.event === 'delta' && frame.data['event'] === 'funded')
  assert.match(funded.id ?? '', /^\d+$/)
  assert.ok(Number(funded.id) > Number(first?.id))
  await ledger.until('the books with the ride', (frame) => frame.event === 'snapshot' && frame.data['pledged'] === '5.000000')
  await backers.until('the riders again', (frame) => frame.event === 'snapshot' && frame !== backers.frames[0])
  await list.until('the swarm', (frame) => frame.event === 'swarm' && frame.data['id'] === id)

  const posted = await ana.call<{ message: { id: number } }>('POST', '/v1/swarms/' + id + '/chat', { text: 'hello from a stream' })
  assert.equal(posted.status, 201, JSON.stringify(posted.body))
  const said = await chat.until('the message', (frame) => frame.event === 'said')
  assert.equal(said.id, String(posted.body.message.id))

  const resumed = await follow('/v1/swarms/' + id + '/tree', first?.id)
  const missed = await resumed.until('the missed funded delta', (frame) => frame.event === 'delta' && frame.data['event'] === 'funded')
  assert.equal(missed.id, funded.id)
  assert.equal(resumed.frames.some((frame) => frame.event === 'snapshot'), false)

  const books = ledger.frames.at(-1)
  const fresh = await follow('/v1/swarms/' + id + '/ledger', books?.id)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.ok(fresh.frames.every((frame) => frame.id !== books?.id), JSON.stringify(fresh.frames.map((frame) => frame.id)))

  const json = await fetch(dev.url + '/v1/swarms/' + id + '/tree')
  assert.equal(json.headers.get('content-type'), 'application/json')
})
