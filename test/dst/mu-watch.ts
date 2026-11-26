import { mock } from 'node:test'
import type * as Tree from '../../src/shared/Tree.ts'
import type * as Watch from '../../src/worker/Watch.ts'
import type * as M1 from '../../src/worker/Watch.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function watch(seed: string): Promise<Outcome> {
  const random = rng('watch', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Watch = await load<typeof M1>('src/worker/Watch.ts')

  type Frame = { data: unknown; event: string; id: string | undefined }

  function harness() {
    let on: ((signal: Watch.Signal) => void) | undefined
    const tap = { closed: 0, pings: 0 }
    const listen = async (heard: (signal: Watch.Signal) => void): Promise<Watch.Tap> => {
      on = heard
      return { close: () => void (tap.closed += 1), ping: () => void (tap.pings += 1) }
    }
    return { emit: (signal: unknown) => on?.(signal as Watch.Signal), listen, tap }
  }

  function reader(response: Response) {
    a.equal(response.headers.get('content-type'), 'text/event-stream')
    const stream = (response.body as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream()).getReader()
    const frames: Frame[] = []
    const notes: string[] = []
    let buffer = ''
    let ended = false
    const pump = async () => {
      const read = await stream.read()
      if (read.done) {
        ended = true
        return
      }
      buffer += read.value
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const lines = block.split('\n')
        const value = (name: string) => lines.find((line) => line.startsWith(name + ': '))?.slice(name.length + 2)
        const data = value('data')
        if (data === undefined) {
          notes.push(block)
          continue
        }
        frames.push({ data: JSON.parse(data), event: value('event') ?? 'message', id: value('id') })
      }
    }
    return {
      ended: () => ended,
      frames,
      notes,
      async until(count: number) {
        while (frames.length < count && !ended) await pump()
        return frames
      },
      async end() {
        while (!ended) await pump()
      },
    }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

  function node(id: string, extra: Partial<Tree.Node> = {}) {
    return { id, parent: id === 'root' ? null : 'root', title: id, ...extra } as Tree.Node
  }

  function delta(seq: number, event: Tree.Delta['event'], nid = 'aaaaaaaaaa'): Tree.Delta {
    return { at: seq, event, node: node(nid), seq, text: event + ' ' + seq }
  }

  function json(body: unknown, status = 200): Watch.Read {
    return { body, status, text: JSON.stringify(body) }
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'a GET route names its stream, and the live, wait, export and write-only routes have none',
      async (_t) => {
        const cases: [string, string | undefined, string | undefined][] = [
          ['/v1/swarms', 'swarms', 'lobby'],
          ['/v1/swarms/s1', 'swarm', 'swarm'],
          ['/v1/swarms/s1/tree', 'tree', 'swarm'],
          ['/v1/swarms/s1/deltas', 'deltas', 'swarm'],
          ['/v1/swarms/s1/nodes/aaaaaaaaaa', 'node', 'swarm'],
          ['/v1/swarms/s1/nodes/aaaaaaaaaa/updates', 'node updates', 'swarm'],
          ['/v1/swarms/s1/chat', 'chat', 'swarm'],
          ['/v1/swarms/s1/feed', 'feed', 'swarm'],
          ['/v1/swarms/s1/ledger', 'ledger', 'swarm'],
          ['/v1/swarms/s1/backers', 'backers', 'swarm'],
          ['/v1/swarms/s1/machines/box/commands', 'machines', 'swarm'],
          ['/v1/swarms/s1/code', 'code', 'swarm'],
          ['/v1/swarms/s1/answer', 'answer', 'swarm'],
          ['/v1/me/swarms/s1', 'standing', 'swarm'],
          ['/v1/general/chat', '#general', 'hall'],
          ['/v1/riders/0xabc', 'riders', 'lobby'],
          ['/v1/health', 'health', 'lobby'],
          ['/v1/swarms/s1/live', undefined, undefined],
          ['/v1/swarms/s1/wait', undefined, undefined],
          ['/v1/swarms/s1/chat/live', undefined, undefined],
          ['/v1/swarms/live', undefined, undefined],
          ['/v1/general/chat/live', undefined, undefined],
          ['/v1/swarms/s1/machines/export', undefined, undefined],
          ['/v1/hooks/github', undefined, undefined],
          ['/api/swarms', undefined, undefined],
        ]
        for (const [path, name, scope] of cases) {
          const found = Watch.topic(path)
          a.equal(found?.name, name, path)
          a.equal(found?.scope.kind, scope, path)
        }
        a.equal(Watch.wanted('text/event-stream'), true)
        a.equal(Watch.wanted('application/json'), false)
      },
    ],
    [
      'the tree stream sends the tree with its seq as the id, then each delta once, doing deltas without an id, and the tree again when the money moves',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms/s1/tree') as Watch.Topic
        const h = harness()
        let headline = { spent: '1.000000' }
        const reads: string[] = []
        const response = await Watch.open({
          last: null,
          listen: h.listen,
          read: async (query, path) => {
            reads.push((path ?? 'tree') + ' ' + JSON.stringify(query))
            if (reads.length === 1) h.emit({ delta: delta(3, 'funded'), type: 'delta' })
            return json({ headline, nodes: [node('root')], seq: 3 })
          },
          signal: new AbortController().signal,
          topic,
        })
        const r = reader(response)
        await r.until(1)
        a.deepEqual(r.frames[0], { data: { headline, nodes: [node('root')], seq: 3 }, event: 'snapshot', id: '3' })
        h.emit({ delta: delta(3, 'funded'), type: 'delta' })
        h.emit({ delta: delta(4, 'started'), type: 'delta' })
        h.emit({ delta: { ...delta(4, 'doing'), text: 'reading the lemma' }, type: 'delta' })
        h.emit({ said: true, type: 'presence' })
        await r.until(3)
        a.deepEqual(
          r.frames.slice(1).map((frame) => [frame.event, frame.id, (frame.data as Tree.Delta).event]),
          [
            ['delta', '4', 'started'],
            ['delta', undefined, 'doing'],
          ],
        )
        headline = { spent: '2.000000' }
        h.emit({ hands: [], reason: null, swarm: {}, type: 'pulse', version: 'v', why: null, working: null })
        await r.until(4)
        a.deepEqual(r.frames[3], { data: { headline, nodes: [node('root')], seq: 3 }, event: 'snapshot', id: '4' })
        h.emit({ hands: [], reason: null, swarm: {}, type: 'pulse', version: 'v', why: null, working: null })
        await settle()
        await settle()
        a.equal(r.frames.length, 4)
        h.emit({ type: 'closed' })
        await r.end()
        a.equal(h.tap.closed, 1)
      },
    ],
    [
      'the tree stream resumes from Last-Event-ID with the deltas it missed and no snapshot',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms/s1/tree', new URLSearchParams('depth=2')) as Watch.Topic
        const h = harness()
        const stored = [delta(5, 'posted'), delta(6, 'funded'), delta(7, 'proven')]
        const reads: [string | undefined, Watch.Query][] = []
        const response = await Watch.open({
          last: '5',
          listen: h.listen,
          read: async (query, path) => {
            reads.push([path, query])
            const from = Number(query['after'])
            const deltas = stored.filter((each) => each.seq > from)
            return json({ deltas, next: deltas.at(-1)?.seq ?? from })
          },
          signal: new AbortController().signal,
          topic,
        })
        const r = reader(response)
        await r.until(2)
        a.deepEqual(
          r.frames.map((frame) => [frame.event, frame.id]),
          [
            ['delta', '6'],
            ['delta', '7'],
          ],
        )
        a.deepEqual(
          reads.map(([path, query]) => [path, query['after']]),
          [
            ['/v1/swarms/s1/deltas', '5'],
            ['/v1/swarms/s1/deltas', '7'],
          ],
        )
        h.emit({ delta: delta(7, 'proven'), type: 'delta' })
        h.emit({ delta: delta(8, 'ended'), type: 'delta' })
        await r.until(3)
        a.deepEqual(r.frames[2]?.id, '8')
        a.equal(
          r.frames.some((frame) => frame.event === 'snapshot'),
          false,
        )
        h.emit({ type: 'closed' })
        await r.end()
      },
    ],
    [
      'the chat stream sends the room, then each message once, the room again when its members change, and resumes after the last id it sent',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms/s1/chat') as Watch.Topic
        const message = (id: number) => ({ artifact: null, at: id, author: null, id, mentions: [], steer: null, text: 'm' + id })
        let members = ['ana']
        const messages = [message(1), message(2)]
        const h = harness()
        const read = async (query: Watch.Query) => {
          const from = Number(query['after'] ?? 0)
          const shown = messages.filter((each) => each.id > from)
          return json({ me: null, members, messages: shown, next: shown.at(-1)?.id ?? from })
        }
        const r = reader(await Watch.open({ last: null, listen: h.listen, read, signal: new AbortController().signal, topic }))
        await r.until(1)
        a.equal(r.frames[0]?.event, 'snapshot')
        a.equal(r.frames[0]?.id, '2')
        messages.push(message(3))
        h.emit({ message: message(3), type: 'said' })
        h.emit({ message: message(3), type: 'said' })
        h.emit({ message: message(2), type: 'said' })
        await r.until(2)
        a.deepEqual(r.frames[1], { data: { message: message(3) }, event: 'said', id: '3' })
        members = ['ana', 'bo']
        h.emit({ parts: ['members'], type: 'changed', version: 'v' })
        await r.until(3)
        a.equal(r.frames[2]?.event, 'snapshot')
        a.deepEqual((r.frames[2]?.data as { members: string[] }).members, ['ana', 'bo'])
        a.equal(r.frames[2]?.id, '3')

        const again = harness()
        const resumed = reader(await Watch.open({ last: '1', listen: again.listen, read, signal: new AbortController().signal, topic }))
        await resumed.until(2)
        a.deepEqual(
          resumed.frames.map((frame) => [frame.event, frame.id]),
          [
            ['said', '2'],
            ['said', '3'],
          ],
        )
        again.emit({ type: 'closed' })
        await resumed.end()
        h.emit({ type: 'closed' })
        await r.end()
      },
    ],
    [
      '#general carries the name each message went out under',
      async (_t) => {
        const topic = Watch.topic('/v1/general/chat') as Watch.Topic
        const h = harness()
        const r = reader(
          await Watch.open({
            last: null,
            listen: h.listen,
            read: async () => json({ messages: [], names: {}, next: 0 }),
            signal: new AbortController().signal,
            topic,
          }),
        )
        await r.until(1)
        h.emit({ message: { id: 1, text: 'hi' }, name: 'ada', type: 'said' })
        await r.until(2)
        a.deepEqual(r.frames[1], { data: { message: { id: 1, text: 'hi' }, name: 'ada' }, event: 'said', id: '1' })
        h.emit({ type: 'closed' })
        await r.end()
      },
    ],
    [
      'the swarm list stream sends the list under its hash, each changed swarm, and nothing on a resume that already has it',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms') as Watch.Topic
        const list = { funders: {}, heads: {}, riders: 1, swarms: [{ balance: '1.000000', id: 's1' }] }
        const read = async () => json(list)
        const h = harness()
        const r = reader(await Watch.open({ last: null, listen: h.listen, read, signal: new AbortController().signal, topic }))
        await r.until(1)
        a.equal(r.frames[0]?.event, 'snapshot')
        a.equal(r.frames[0]?.id, await Watch.digest(JSON.stringify(list)))
        h.emit({ type: 'welcome' })
        h.emit({ swarm: { balance: '2.000000', id: 's1' }, type: 'swarm' })
        await r.until(2)
        a.deepEqual(r.frames[1], { data: { balance: '2.000000', id: 's1' }, event: 'swarm', id: undefined })

        const again = harness()
        const resumed = reader(await Watch.open({ last: r.frames[0]?.id ?? null, listen: again.listen, read, signal: new AbortController().signal, topic }))
        again.emit({ swarm: { balance: '3.000000', id: 's1' }, type: 'swarm' })
        await resumed.until(1)
        a.deepEqual(
          resumed.frames.map((frame) => frame.event),
          ['swarm'],
        )
        a.deepEqual(resumed.notes, ['retry: 3000'])
        for (const each of [h, again]) each.emit({ type: 'closed' })
        await r.end()
        await resumed.end()
      },
    ],
    [
      'the money stream sends the books again only when a pulse or a ride changes them, and a resume at the current books sends nothing',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms/s1/ledger') as Watch.Topic
        let books = { pledged: '5.000000', spent: '1.000000' }
        let reads = 0
        const read = async () => {
          reads += 1
          return json({ ...books })
        }
        const h = harness()
        const r = reader(await Watch.open({ last: null, listen: h.listen, read, signal: new AbortController().signal, topic }))
        await r.until(1)
        const first = r.frames[0]?.id
        const pulse = { hands: [], reason: null, swarm: {}, type: 'pulse', version: 'v', why: null, working: null }
        h.emit(pulse)
        await settle()
        a.equal(r.frames.length, 1)
        books = { pledged: '5.000000', spent: '1.500000' }
        h.emit(pulse)
        await r.until(2)
        a.deepEqual(r.frames[1]?.data, books)
        a.equal(r.frames[1]?.id, await Watch.digest(JSON.stringify(books)))
        books = { pledged: '7.000000', spent: '1.500000' }
        h.emit({ delta: delta(9, 'funded'), type: 'delta' })
        await r.until(3)
        a.deepEqual(r.frames[2]?.data, books)
        const before = reads
        h.emit({ delta: { ...delta(9, 'doing') }, type: 'delta' })
        h.emit({ online: [], type: 'presence', watching: 1 })
        await settle()
        a.equal(reads, before)

        const again = harness()
        const resumed = reader(await Watch.open({ last: r.frames[2]?.id ?? null, listen: again.listen, read, signal: new AbortController().signal, topic }))
        await settle()
        a.deepEqual(resumed.frames, [])
        books = { pledged: '9.000000', spent: '1.500000' }
        again.emit(pulse)
        await resumed.until(1)
        a.deepEqual((resumed.frames[0] as { data: unknown } | undefined)?.data, books)
        a.notEqual(first, (resumed.frames[0] as { id: string } | undefined)?.id)
        for (const each of [h, again]) each.emit({ type: 'closed' })
        await r.end()
        await resumed.end()
      },
    ],
    [
      'reads that land while one is running fold into one more read',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms/s1/backers') as Watch.Topic
        let reads = 0
        let release: (() => void) | undefined
        const h = harness()
        const r = reader(
          await Watch.open({
            last: null,
            listen: h.listen,
            read: async () => {
              reads += 1
              if (reads === 2) await new Promise<void>((resolve) => (release = resolve))
              return json({ reads })
            },
            signal: new AbortController().signal,
            topic,
          }),
        )
        await r.until(1)
        const pulse = { hands: [], reason: null, swarm: {}, type: 'pulse', version: 'v', why: null, working: null }
        for (let i = 0; i < 5; i += 1) h.emit(pulse)
        await settle()
        a.equal(reads, 2)
        release?.()
        await r.until(3)
        a.equal(reads, 3)
        h.emit({ type: 'closed' })
        await r.end()
      },
    ],
    [
      'a failed first read answers its problem and closes the socket, and an abort ends the stream',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms/nope/team') as Watch.Topic
        const h = harness()
        const failed = await Watch.open({
          last: null,
          listen: h.listen,
          read: async () => json({ code: 'not_found', detail: 'No swarm has this id.', status: 404 }, 404),
          signal: new AbortController().signal,
          topic,
        })
        a.equal(failed.status, 404)
        a.equal(failed.headers.get('content-type'), 'application/problem+json')
        a.equal(h.tap.closed, 1)
        const stop = new AbortController()
        const again = harness()
        const r = reader(await Watch.open({ last: null, listen: again.listen, read: async () => json({ members: [] }), signal: stop.signal, topic }))
        await r.until(1)
        stop.abort()
        await r.end()
        a.equal(again.tap.closed, 1)
        const refused = await Watch.open({
          last: null,
          listen: async () => new Response('full', { status: 503 }),
          read: async () => json({}),
          signal: stop.signal,
          topic,
        })
        a.equal(refused.status, 503)
      },
    ],
    [
      'the feed stream starts from the newest page and sends each entry once',
      async (_t) => {
        const topic = Watch.topic('/v1/swarms/s1/feed') as Watch.Topic
        a.deepEqual(topic.snapshot, { before: '999999999999999' })
        a.equal(Watch.topic('/v1/swarms/s1/feed', new URLSearchParams('after=10'))?.snapshot, undefined)
        const h = harness()
        const queries: Watch.Query[] = []
        const r = reader(
          await Watch.open({
            last: null,
            listen: h.listen,
            read: async (query) => {
              queries.push(query)
              return json({ entries: [{ seq: 40 }, { seq: 41 }], next: 41 })
            },
            signal: new AbortController().signal,
            topic,
          }),
        )
        await r.until(1)
        a.deepEqual(queries, [{ before: '999999999999999' }])
        h.emit({ entry: { seq: 41 }, type: 'entry' })
        h.emit({ entry: { seq: 42 }, type: 'entry' })
        await r.until(2)
        a.deepEqual(r.frames[1], { data: { seq: 42 }, event: 'entry', id: '42' })
        h.emit({ type: 'closed' })
        await r.end()
      },
    ],
    [
      'the heartbeat writes a keepalive and pings the room every 25 s',
      async (_t) => {
        mock.timers.enable({ apis: ['setInterval'] })
        try {
          const topic = Watch.topic('/v1/swarms/s1/team') as Watch.Topic
          const h = harness()
          const r = reader(
            await Watch.open({ last: null, listen: h.listen, read: async () => json({ members: [] }), signal: new AbortController().signal, topic }),
          )
          await r.until(1)
          mock.timers.tick(Watch.beatMs)
          a.equal(h.tap.pings, 1)
          h.emit({ type: 'closed' })
          await r.end()
          a.deepEqual(r.notes, ['retry: 3000', ': keepalive'])
        } finally {
          mock.timers.reset()
        }
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { watch }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'watch.watch',
      'src/worker/Watch.ts',
      "return signal.type === 'changed' && (!parts.length || signal.parts.some((part) => parts.includes(part)))",
      "return signal.type !== 'changed' && (!parts.length || signal.parts.some((part) => parts.includes(part)))",
    ),
    invariant: 'the money stream sends the books again only when a pulse or a ride changes them, and a resume at the current books sends nothing',
    name: 'watch.watch',
    scenario: 'watch',
    seeds: ['1', '2', '3'],
  },
]
