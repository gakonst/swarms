import { readFileSync } from 'node:fs'
import type * as Tree from '../../src/shared/Tree.ts'
import type * as ConnectModule from '../../src/shared/Connect.ts'
import { applied, type Canary, load, mutant, type Outcome, pin, recorder, type Rng, rng } from './mh-kit.ts'

export const limits = {
  chance: 0.5,
  connect: { labels: 3, lockLeast: 5, queries: 3, snippets: 4, wordMost: 10 },
  id: 12,
  local: {
    delayMost: 3,
    deltas: 14,
    flightNames: 3,
    flights: 5,
    keys: 12,
    messages: 8,
    mutations: 8,
    nodes: 4,
    parts: 3,
    replays: 3,
    replies: 3,
    says: 10,
    seqMost: 40,
    threads: 3,
    touches: 6,
    versions: 9,
  },
  short: 4,
}

type Check = ReturnType<typeof recorder>

type Row = { state: string; version: string | undefined }

type Mutation = { input: unknown; state: string; swarm: string }

type Local = {
  advance: (swarm: string, next: string, changed: boolean) => void
  caught: (swarm: string, next: number) => void
  cursor: (swarm: string) => number | undefined
  define: (
    kind: string,
    runner: {
      confirm: (mutation: Mutation, result: unknown) => void
      landed: (mutation: Mutation) => Promise<boolean>
      run: (mutation: Mutation) => Promise<unknown>
    },
  ) => void
  delta: (swarm: string, event: Tree.Delta) => void
  fresh: (key: string) => boolean
  load: <T>(key: string, loader: () => Promise<T>) => Promise<T>
  lost: (swarm: string) => void
  mutate: (kind: string, swarm: string, input: unknown) => Promise<unknown>
  pending: (swarm: string, kind: string) => Mutation[]
  put: (key: string, data: unknown) => void
  replay: () => Promise<void>
  reset: () => void
  row: (key: string) => Row | undefined
  said: (swarm: string, message: { id: number; parent?: number }) => void
  scope: (key: string) => string | undefined
  stale: (key: string) => void
  start: (options: { data: Record<string, unknown>; now: number; persist: boolean }) => Promise<void>
  subscribe: (key: string, listener: () => void) => () => void
  table: (key: string) => string
  touched: <T extends { id: number }>(swarm: string, id: number, update: (message: T) => T) => void
  value: <T>(key: string) => T | undefined
  welcome: (swarm: string, next: string) => 'same' | 'moved'
}

type Api = {
  fixture: boolean
  hand: (id: string, label: string) => Promise<{ cli: string; library: string; name: string; npm: string; token: string; url: string }>
}

const digits = '0123456789abcdef'

const letters = 'abcdefghijklmnopqrstuvwxyz'

function word(random: Rng, length: number, from = letters) {
  return Array.from({ length }, () => random.pick([...from])).join('')
}

function hex(random: Rng, length = limits.id) {
  return word(random, length, digits)
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function canon(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value
}

function kindOf(key: string) {
  return key.includes(':') ? key.slice(0, key.indexOf(':')) : ''
}

function scopeOf(key: string) {
  const id = key.includes(':') ? key.split(':')[1] : key
  return kindOf(key) !== 'rider' && id !== undefined && id.length === limits.id && [...id].every((each) => digits.includes(each)) ? id : undefined
}

function tableOf(key: string) {
  const kind = kindOf(key)
  if (kind === '') return 'swarms'
  if (kind === 'node') return 'nodes'
  if (kind === 'room' || kind === 'replies') return 'messages'
  if (kind === 'rider') return 'riders'
  if (kind === 'updates' && key.split(':').length === limits.local.parts) return 'runs'
  return 'views'
}

function coveredOf(key: string) {
  return tableOf(key) !== 'views' || kindOf(key) === 'tree' || kindOf(key) === 'proofs'
}

function trackedOf(key: string) {
  return tableOf(key) === 'nodes' || tableOf(key) === 'runs'
}

const fixtureSwarm = 'abcdef012345'

function boot(L: Local, swarm: string) {
  L.reset()
  void L.start({ data: { [swarm]: { title: 'seeded' } }, now: 1, persist: false })
}

function said(seq: number, event: string, id = 'n1', extra: Record<string, unknown> = {}): Tree.Delta {
  return { at: seq, event, node: { id, parent: 'root', title: 't' + seq, ...extra }, seq, text: 'd' + seq } as unknown as Tree.Delta
}

type Settled = { state: 'pending' } | { state: 'resolved'; value?: unknown } | { error: string; state: 'rejected' }

function watch(promise: Promise<unknown>) {
  const box: { at: Settled } = { at: { state: 'pending' } }
  promise.then(
    (value) => (box.at = { state: 'resolved', value }),
    (error: unknown) => (box.at = { error: error instanceof Error ? error.message : String(error), state: 'rejected' }),
  )
  return box
}

async function localFixtures(L: Local, check: Check) {
  const swarm = fixtureSwarm
  boot(L, swarm)
  check.same('boot fresh', 'seeded row', L.fresh(swarm), true)
  check.same(
    'key tables',
    'fixture keys',
    [L.scope('node:' + swarm + ':n1'), L.scope('rider:0xabc') ?? null, L.table('updates:' + swarm + ':n1'), L.table('updates:' + swarm)],
    [swarm, null, 'runs', 'views'],
  )
  let calls = 0
  const loader = () => new Promise<number>((resolve) => setTimeout(() => resolve(++calls), limits.local.delayMost))
  const [a, b] = await Promise.all([L.load('k', loader), L.load('k', loader)])
  check.same('load once', 'fixture flight', [calls, a === b, L.fresh('k')], [1, true, true])

  boot(L, swarm)
  check.same('welcome moved', 'fixture first welcome', [L.welcome(swarm, 'v1'), L.row(swarm)?.state], ['moved', 'stale'])
  L.put(swarm, { title: 'loaded' })
  L.put('node:' + swarm + ':n1', { funders: [], id: 'n1', runs: [], title: 'a' })
  L.put('artifacts:' + swarm, { artifacts: [] })
  check.same(
    'welcome same',
    'fixture same',
    [L.welcome(swarm, 'v1'), L.fresh('node:' + swarm + ':n1'), L.fresh(swarm), L.row('artifacts:' + swarm)?.state],
    ['same', true, true, 'stale'],
  )
  check.same(
    'welcome moved',
    'fixture moved',
    [L.welcome(swarm, 'v2'), L.row('node:' + swarm + ':n1')?.state, L.row(swarm)?.state],
    ['moved', 'stale', 'stale'],
  )

  boot(L, swarm)
  L.welcome(swarm, 'v1')
  L.put('node:' + swarm + ':n1', { funders: ['f'], id: 'n1', runs: ['r'], title: 'a' })
  L.put('updates:' + swarm + ':n1', { deltas: [], next: 0 })
  L.delta(swarm, said(7, 'posted'))
  check.same('delta node', 'fixture node', canon(L.value('node:' + swarm + ':n1')), { funders: ['f'], id: 'n1', parent: 'root', runs: ['r'], title: 't7' })
  check.same('delta cursor', 'fixture cursor', [L.value<{ next: number }>('updates:' + swarm + ':n1')?.next, L.cursor(swarm)], [7, 7])
  L.delta(swarm, said(8, 'doing'))
  check.same('delta cursor', 'fixture doing', L.cursor(swarm), 7)
  check.same(
    'welcome moved',
    'fixture moved with a cursor',
    [L.welcome(swarm, 'v2'), L.fresh('node:' + swarm + ':n1'), L.row(swarm)?.state],
    ['moved', true, 'stale'],
  )
  L.delta(swarm, said(9, 'funded'))
  check.same('delta node', 'fixture refetch', L.row('node:' + swarm + ':n1')?.state, 'stale')
  L.caught(swarm, 9)
  check.same('cursor reset', 'fixture caught', L.cursor(swarm), 9)
  L.lost(swarm)
  check.same('cursor reset', 'fixture lost', L.cursor(swarm), undefined)

  boot(L, swarm)
  L.welcome(swarm, 'v1')
  L.put(swarm, { title: 'loaded' })
  L.put('artifacts:' + swarm, { artifacts: [] })
  const stop = L.subscribe(swarm, () => {})
  L.advance(swarm, 'v2', true)
  check.same('advance', 'fixture advance', [L.fresh('artifacts:' + swarm), L.fresh(swarm), L.row(swarm)?.version], [false, true, 'v2'])
  stop()

  boot(L, swarm)
  const sent: string[] = []
  const confirmed: unknown[] = []
  const world = { landed: false, mode: 'ok' as Mode }
  L.define('say', {
    confirm: (_mutation, result) => confirmed.push(result),
    landed: async () => world.landed,
    run: async (mutation) => {
      sent.push(mutation.input as string)
      if (world.mode === 'down') throw new TypeError('fetch failed')
      if (world.mode === 'no') throw new Error('Not a member.')
      return { id: sent.length }
    },
  })
  const one = watch(L.mutate('say', swarm, 'one'))
  await tick()
  check.same('mutation confirm', 'fixture one', [one.at, L.pending(swarm, 'say').length], [{ state: 'resolved', value: { id: 1 } }, 0])
  world.mode = 'no'
  const two = watch(L.mutate('say', swarm, 'two'))
  await tick()
  check.same('mutation rollback', 'fixture two', [two.at, L.pending(swarm, 'say').length], [{ error: 'Not a member.', state: 'rejected' }, 0])
  world.mode = 'down'
  const three = watch(L.mutate('say', swarm, 'three'))
  await tick()
  check.same('mutation offline', 'fixture three queued', L.pending(swarm, 'say')[0]?.state, 'queued')
  world.landed = true
  await L.replay()
  await tick()
  check.same('replay landed', 'fixture three', [three.at, sent, L.pending(swarm, 'say').length], [{ state: 'resolved' }, ['one', 'two', 'three'], 0])
  world.landed = false
  const four = watch(L.mutate('say', swarm, 'four'))
  await tick()
  world.mode = 'ok'
  await L.replay()
  await tick()
  check.same('replay landed', 'fixture four', four.at, { state: 'resolved', value: { id: 5 } })
  check.same('mutation confirm', 'fixture confirmed', confirmed, [{ id: 1 }, undefined, { id: 5 }])

  boot(L, swarm)
  L.put('room:' + swarm, { messages: [{ id: 1, text: 'top' }], next: 1 })
  L.put('replies:' + swarm + ':1', { next: 2, parent: { id: 1, text: 'top' }, replies: [{ id: 2, parent: 1, text: 'first' }] })
  check.same('key tables', 'fixture replies table', L.table('replies:' + swarm + ':1'), 'messages')
  L.said(swarm, { id: 3, parent: 1 })
  L.said(swarm, { id: 3, parent: 1 })
  L.said(swarm, { id: 4 })
  const thread = L.value<{ next: number; replies: { id: number }[] }>('replies:' + swarm + ':1')
  check.same(
    'reply placement',
    'fixture placement',
    [L.value<{ messages: { id: number }[] }>('room:' + swarm)?.messages.map((each) => each.id), thread?.replies.map((each) => each.id), thread?.next],
    [[1, 4], [2, 3], 3],
  )
  const reactions = [{ emoji: '👍', who: ['0xa'] }]
  L.touched<Note>(swarm, 1, (message) => ({ ...message, reactions }))
  L.touched<Note>(swarm, 2, (message) => ({ ...message, reactions }))
  const held = L.value<{ parent: Note; replies: Note[] }>('replies:' + swarm + ':1')
  check.same(
    'reactions reach',
    'fixture reactions',
    [L.value<{ messages: Note[] }>('room:' + swarm)?.messages[0]?.reactions, held?.parent.reactions, held?.replies[0]?.reactions],
    [reactions, reactions, reactions],
  )
  let pinged = 0
  const off = L.subscribe('room:' + swarm, () => pinged++)
  L.touched<Note>(swarm, 99, (message) => ({ ...message }))
  off()
  check.same('touch quiet', 'fixture quiet', pinged, 0)
  return 1
}

async function flights(L: Local, random: Rng, check: Check, swarm: string) {
  boot(L, swarm)
  check.same('boot fresh', 'seeded ' + swarm, L.fresh(swarm), true)
  const kinds = ['', 'node', 'room', 'replies', 'rider', 'updates', 'tree', 'proofs', 'artifacts', 'burn', 'outbox']
  for (let i = 0; i < limits.local.keys; i++) {
    const kind = random.pick(kinds)
    const id = random.pick([swarm, hex(random), hex(random, limits.id - 1), '0x' + hex(random, limits.id - 2), word(random, limits.id)])
    const tail = random.pick(['', ':n' + random.int(0, limits.local.nodes), ':' + hex(random)])
    const key = kind === '' ? id : kind + ':' + id + tail
    check.same('key tables', key, [L.scope(key) ?? null, L.table(key)], [scopeOf(key) ?? null, tableOf(key)])
  }
  const names = Array.from({ length: random.int(1, limits.local.flightNames) }, (_, i) => random.pick(['k' + i + word(random, 2), 'node:' + swarm + ':f' + i]))
  const plan = random.shuffle([...names, ...Array.from({ length: random.int(1, limits.local.flights) }, () => random.pick(names))])
  const calls = new Map<string, number>()
  const loader = (name: string, wait: number) => () =>
    new Promise<number>((resolve) =>
      setTimeout(() => {
        const n = (calls.get(name) ?? 0) + 1
        calls.set(name, n)
        resolve(n)
      }, wait),
    )
  const answers = await Promise.all(plan.map((name) => L.load(name, loader(name, random.int(0, limits.local.delayMost)))))
  for (const name of names) {
    check.same('load once', name + ' loader calls', calls.get(name), 1)
    check.same(
      'load once',
      name + ' answers',
      answers.filter((_, i) => plan[i] === name),
      plan.filter((each) => each === name).map(() => 1),
    )
    check.same('load once', name + ' fresh', L.fresh(name), true)
  }
  return limits.local.keys + plan.length
}

function pool(swarm: string, nodes: string[]) {
  return [
    swarm,
    ...nodes.map((node) => 'node:' + swarm + ':' + node),
    ...nodes.map((node) => 'updates:' + swarm + ':' + node),
    'artifacts:' + swarm,
    'burn:' + swarm,
    'tree:' + swarm,
    'proofs:' + swarm,
    'room:' + swarm,
    'updates:' + swarm,
  ]
}

function versions(random: Rng) {
  const first = 'v' + random.int(1, limits.local.versions)
  return [first, first + '.' + random.int(1, limits.local.versions)] as const
}

async function welcomes(L: Local, random: Rng, check: Check, swarm: string) {
  boot(L, swarm)
  const [v1, v2] = versions(random)
  check.same('welcome moved', 'first welcome', [L.welcome(swarm, v1), L.row(swarm)?.state], ['moved', 'stale'])
  const nodes = Array.from({ length: random.int(1, limits.local.nodes) }, (_, i) => 'n' + i)
  const all = pool(swarm, nodes)
  const keys = all.filter((key) => key === 'artifacts:' + swarm || random.chance(limits.chance))
  for (const key of keys) L.put(key, { key, n: random.int(0, limits.local.seqMost) })
  const staled = keys.filter(() => random.chance(limits.chance))
  for (const key of staled) L.stale(key)
  check.same('welcome same', 'same version', L.welcome(swarm, v1), 'same')
  for (const key of all) {
    const want = !keys.includes(key) ? (key === swarm ? 'stale' : undefined) : staled.includes(key) || !coveredOf(key) ? 'stale' : 'fresh'
    check.same('welcome same', key + ' after the same version', L.row(key)?.state, want)
    if (want === 'fresh') check.same('welcome same', key + ' version', [L.fresh(key), L.row(key)?.version], [true, v1])
  }
  check.same('welcome moved', 'moved version', L.welcome(swarm, v2), 'moved')
  for (const key of all) if (L.row(key)) check.same('welcome moved', key + ' after a moved version', L.row(key)?.state, 'stale')
  return all.length
}

const events = ['posted', 'doing', 'proven', 'ended', 'started', 'progress', 'checking', 'funded', 'moved', 'steered', 'noted']

const refetched = new Set(['proven', 'ended', 'started', 'progress', 'checking', 'funded', 'moved', 'steered'])

async function deltas(L: Local, random: Rng, check: Check, swarm: string) {
  boot(L, swarm)
  const [v1, v2] = versions(random)
  L.welcome(swarm, v1)
  L.put(swarm, { title: 'loaded' })
  const nodes = Array.from({ length: random.int(1, limits.local.nodes) }, (_, i) => 'n' + i + word(random, 2))
  const views = new Map<string, Record<string, unknown>>()
  const updates = new Map<string, { list: number[]; next: number }>()
  const staled = new Set<string>()
  for (const node of nodes) {
    const view = { funders: [word(random, limits.short)], id: node, runs: [word(random, limits.short)], title: 'a' }
    views.set(node, view)
    L.put('node:' + swarm + ':' + node, view)
    if (random.chance(limits.chance)) {
      updates.set(node, { list: [], next: 0 })
      L.put('updates:' + swarm + ':' + node, { deltas: [], next: 0 })
    }
  }
  let cursor: number | undefined
  const count = random.int(1, limits.local.deltas)
  for (let i = 0; i < count; i++) {
    const seq = random.int(1, limits.local.seqMost)
    const node = random.pick(nodes)
    const event = random.pick(events)
    L.delta(swarm, said(seq, event, node, random.chance(limits.chance) ? { funders: ['e' + seq], runs: ['e' + seq] } : {}))
    views.set(node, { ...views.get(node), id: node, parent: 'root', title: 't' + seq })
    if (event === 'doing') continue
    cursor = Math.max(cursor ?? seq, seq)
    const held = updates.get(node)
    if (held) updates.set(node, { list: [seq, ...held.list.filter((each) => each !== seq)], next: Math.max(held.next, seq) })
    if (refetched.has(event)) staled.add(node)
  }
  for (const node of nodes) {
    const key = 'node:' + swarm + ':' + node
    check.same('delta node', key, canon(L.value(key)), canon(views.get(node)))
    check.same('delta node', key + ' state', L.row(key)?.state, staled.has(node) ? 'stale' : 'fresh')
    const held = updates.get(node)
    const got = L.value<{ deltas: Tree.Delta[]; next: number }>('updates:' + swarm + ':' + node)
    if (held) check.same('delta cursor', 'updates of ' + node, { list: got?.deltas.map((each) => each.seq), next: got?.next }, held)
  }
  check.same('delta cursor', 'cursor', L.cursor(swarm), cursor)
  check.same('welcome moved', 'moved under deltas', [L.welcome(swarm, v2), L.row(swarm)?.state], ['moved', 'stale'])
  for (const node of nodes) {
    const keys = ['node:' + swarm + ':' + node, ...(updates.has(node) ? ['updates:' + swarm + ':' + node] : [])]
    for (const key of keys) {
      const want = cursor === undefined || (staled.has(node) && key.startsWith('node:')) ? 'stale' : 'fresh'
      check.same('welcome moved', key + ' after a moved version with cursor ' + cursor, L.row(key)?.state, want)
    }
  }
  const at = random.int(cursor ?? 0, limits.local.seqMost * 2)
  L.caught(swarm, at)
  check.same('cursor reset', 'caught', L.cursor(swarm), at)
  L.lost(swarm)
  check.same('cursor reset', 'lost', L.cursor(swarm), undefined)
  for (const node of nodes) check.same('cursor reset', node + ' after lost', L.row('node:' + swarm + ':' + node)?.state, 'stale')
  return count
}

async function advances(L: Local, random: Rng, check: Check, swarm: string) {
  boot(L, swarm)
  const [v1, v2] = versions(random)
  L.welcome(swarm, v1)
  const nodes = Array.from({ length: random.int(1, limits.local.nodes) }, (_, i) => 'n' + i)
  const all = [...pool(swarm, nodes), 'replies:' + swarm + ':' + random.int(1, limits.local.seqMost)]
  const keys = all.filter((key) => key === swarm || key === 'artifacts:' + swarm || random.chance(limits.chance))
  for (const key of keys) L.put(key, { key })
  const watched = keys.filter(() => random.chance(limits.chance))
  const stops = watched.map((key) => L.subscribe(key, () => {}))
  const staled = keys.filter(() => random.chance(limits.chance))
  for (const key of staled) L.stale(key)
  const changed = random.chance(limits.chance)
  L.advance(swarm, v2, changed)
  for (const key of keys) {
    const chilled = changed && !watched.includes(key) && !trackedOf(key) && tableOf(key) !== 'messages'
    const want = staled.includes(key) || chilled ? [false, v1] : [true, v2]
    check.same('advance', key + (changed ? ' changed' : ' unchanged') + (watched.includes(key) ? ' watched' : ''), [L.fresh(key), L.row(key)?.version], want)
  }
  for (const stop of stops) stop()
  return keys.length
}

type Mode = 'ok' | 'down' | 'no'

type Sent = { box: { at: Settled }; input: string; invariant: string; swarm: string; want: Settled }

async function mutations(L: Local, random: Rng, check: Check, swarm: string) {
  boot(L, swarm)
  await tick()
  const other = hex(random)
  const sent: string[] = []
  const confirmed: unknown[] = []
  const world = { landed: new Set<string>(), mode: 'ok' as Mode }
  L.define('say', {
    confirm: (_mutation, result) => confirmed.push(result),
    landed: async (mutation) => world.landed.has(mutation.input as string),
    run: async (mutation) => {
      sent.push(mutation.input as string)
      if (world.mode === 'down') throw new TypeError('fetch failed')
      if (world.mode === 'no') throw new Error('Not a member.')
      return { id: sent.length }
    },
  })
  const want = { confirmed: [] as unknown[], sent: [] as string[] }
  const held: Sent[] = []
  let queued: Sent[] = []
  const look = (when: string) => {
    for (const entry of held) check.same(entry.invariant, entry.input + ' ' + when, entry.box.at, entry.want)
    check.same('mutation confirm', 'sent ' + when, sent, want.sent)
    check.same('mutation confirm', 'confirmed ' + when, confirmed, want.confirmed)
    const pending = new Map(
      [...L.pending(swarm, 'say'), ...L.pending(other, 'say')].map((mutation) => [mutation.input as string, mutation.state + ':' + mutation.swarm]),
    )
    for (const entry of held)
      check.same(entry.invariant, entry.input + ' pending ' + when, pending.get(entry.input), queued.includes(entry) ? 'queued:' + entry.swarm : undefined)
  }
  const count = random.int(1, limits.local.mutations)
  for (let i = 0; i < count; i++) {
    const mode = random.pick(['ok', 'down', 'no'] as const)
    world.mode = mode
    const input = 'm' + i
    const where = random.chance(limits.chance) ? swarm : other
    const box = watch(L.mutate('say', where, input))
    want.sent.push(input)
    const entry: Sent = { box, input, invariant: 'mutation confirm', swarm: where, want: { state: 'pending' } }
    if (mode === 'ok') {
      entry.want = { state: 'resolved', value: { id: want.sent.length } }
      want.confirmed.push({ id: want.sent.length })
    }
    if (mode === 'no') {
      entry.want = { error: 'Not a member.', state: 'rejected' }
      entry.invariant = 'mutation rollback'
    }
    if (mode === 'down') {
      entry.invariant = 'mutation offline'
      queued.push(entry)
    }
    held.push(entry)
    await tick()
    look('after sending ' + input)
  }
  for (let round = 0; round < limits.local.replays && queued.length; round++) {
    const mode: Mode = round === limits.local.replays - 1 ? 'ok' : random.pick(['ok', 'down'] as const)
    world.mode = mode
    for (const entry of queued) if (random.chance(limits.chance)) world.landed.add(entry.input)
    const next: Sent[] = []
    for (const entry of queued) {
      if (world.landed.has(entry.input)) {
        entry.invariant = 'replay landed'
        entry.want = { state: 'resolved' }
        want.confirmed.push(undefined)
        continue
      }
      want.sent.push(entry.input)
      if (mode === 'ok') {
        entry.invariant = 'replay landed'
        entry.want = { state: 'resolved', value: { id: want.sent.length } }
        want.confirmed.push({ id: want.sent.length })
      } else next.push(entry)
    }
    queued = next
    await L.replay()
    await tick()
    look('after replay ' + round + ' ' + mode)
  }
  return count
}

type Note = { id: number; parent?: number; reactions?: unknown }

async function replies(L: Local, random: Rng, check: Check, swarm: string) {
  boot(L, swarm)
  let counter = limits.local.seqMost
  const ids = random
    .shuffle(Array.from({ length: limits.local.seqMost }, (_, i) => i + 1))
    .slice(0, random.int(1, limits.local.messages))
    .sort((a, b) => a - b)
  const room = new Map<number, unknown>(ids.map((id) => [id, undefined]))
  L.put('room:' + swarm, { messages: ids.map((id) => ({ id, text: 't' + id })), next: ids.at(-1) })
  const parents = random.shuffle(ids).slice(0, random.int(1, limits.local.threads))
  const threads = new Map<number, { next: number; parent: unknown; replies: Map<number, unknown> }>()
  for (const parent of parents) {
    const list = Array.from({ length: random.int(0, limits.local.replies) }, () => ++counter)
    const next = Math.max(parent, ...list)
    threads.set(parent, { next, parent: undefined, replies: new Map(list.map((id) => [id, undefined])) })
    L.put('replies:' + swarm + ':' + parent, { next, parent: { id: parent, text: 'p' + parent }, replies: list.map((id) => ({ id, parent, text: 'r' + id })) })
  }
  const says = random.int(1, limits.local.says)
  for (let i = 0; i < says; i++) {
    const shape = random.pick(['room', 'roomAgain', 'reply', 'replyAgain', 'orphan'] as const)
    const parent = random.pick(parents)
    const thread = threads.get(parent)
    const message: Note =
      shape === 'room'
        ? { id: ++counter }
        : shape === 'roomAgain'
          ? { id: random.pick([...room.keys()]) }
          : shape === 'reply'
            ? { id: ++counter, parent }
            : shape === 'replyAgain'
              ? { id: random.pick([...(thread?.replies.keys() ?? []), parent]), parent }
              : { id: ++counter, parent: ++counter }
    L.said(swarm, message)
    if (message.parent === undefined) {
      if (!room.has(message.id)) room.set(message.id, undefined)
    } else {
      const target = threads.get(message.parent)
      if (target) {
        if (!target.replies.has(message.id)) target.replies.set(message.id, undefined)
        target.next = Math.max(target.next, message.id)
      }
    }
  }
  const sorted = (keys: Iterable<number>) => [...keys].sort((a, b) => a - b)
  check.same(
    'reply placement',
    'room ids',
    L.value<{ messages: Note[] }>('room:' + swarm)?.messages.map((each) => each.id),
    sorted(room.keys()),
  )
  for (const [parent, thread] of threads) {
    const got = L.value<{ next: number; replies: Note[] }>('replies:' + swarm + ':' + parent)
    check.same(
      'reply placement',
      'thread ' + parent,
      { ids: got?.replies.map((each) => each.id), next: got?.next },
      { ids: sorted(thread.replies.keys()), next: thread.next },
    )
  }
  const known = [...room.keys(), ...parents, ...[...threads.values()].flatMap((thread) => [...thread.replies.keys()])]
  const touches = random.int(1, limits.local.touches)
  for (let i = 0; i < touches; i++) {
    const id = random.pick(known)
    const reactions = [{ emoji: random.pick(['👍', '🎉', '👀']), who: ['0x' + hex(random, limits.short)] }]
    L.touched<Note>(swarm, id, (message) => ({ ...message, reactions }))
    if (room.has(id)) room.set(id, reactions)
    for (const [parent, thread] of threads) {
      if (parent === id) thread.parent = reactions
      if (thread.replies.has(id)) thread.replies.set(id, reactions)
    }
  }
  const reacted = (list: Note[] | undefined) => list?.map((each) => [each.id, each.reactions ?? null])
  check.same(
    'reactions reach',
    'room',
    reacted(L.value<{ messages: Note[] }>('room:' + swarm)?.messages),
    sorted(room.keys()).map((id) => [id, room.get(id) ?? null]),
  )
  for (const [parent, thread] of threads) {
    const got = L.value<{ parent: Note; replies: Note[] }>('replies:' + swarm + ':' + parent)
    check.same(
      'reactions reach',
      'thread ' + parent,
      { parent: got?.parent.reactions ?? null, replies: reacted(got?.replies) },
      { parent: thread.parent ?? null, replies: sorted(thread.replies.keys()).map((id) => [id, thread.replies.get(id) ?? null]) },
    )
  }
  let pinged = 0
  const offs = ['room:' + swarm, ...parents.map((parent) => 'replies:' + swarm + ':' + parent)].map((key) => L.subscribe(key, () => pinged++))
  L.touched<Note>(swarm, ++counter, (message) => ({ ...message, reactions: [] }))
  for (const off of offs) off()
  check.same('touch quiet', 'pings for an unknown message', pinged, 0)
  return says + touches
}

async function local(seed: string): Promise<Outcome> {
  const random = rng(seed, 'web_local')
  const check = recorder()
  const unpin = pin(random)
  let steps = 0
  try {
    const L = await load<Local>('src/web/local.ts')
    applied()
    steps += await localFixtures(L, check)
    const episodes = random.shuffle([flights, welcomes, deltas, advances, mutations, replies])
    for (const episode of episodes) steps += await episode(L, random, check, hex(random))
    L.reset()
  } finally {
    unpin()
  }
  return { steps, violations: check.violations }
}

const handLines = [
  "import { Hand } from 'nanocode-ts'",
  "import { Bash, MemoryFileSystem } from 'nanocode-ts/bash'",
  "resolve('nanocode-ts/nanocode_wasm.wasm')",
  'workspace: shell.workspace()',
  'cwd: shell.cwd',
]

async function connect(seed: string): Promise<Outcome> {
  const random = rng(seed, 'web_connect')
  const check = recorder()
  const unpin = pin(random)
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const query = random.shuffle([
    'fixture',
    ...Array.from({ length: random.int(0, limits.connect.queries) }, () => word(random, limits.short) + '=' + random.int(0, limits.connect.wordMost)),
  ])
  const page =
    'https://' +
    random.pick(['swarms.test', 'swarms.new', 'localhost:5173', 'paradigm.xyz']) +
    random.pick(['/swarms', '/', '/s/' + hex(random), '/faq']) +
    '?' +
    query.join('&')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(page) })
  let steps = 0
  try {
    const C = await load<typeof ConnectModule>('src/shared/Connect.ts')
    const api = await load<Api>('src/web/api.ts')
    applied()
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    const lock = readFileSync('pnpm-lock.yaml', 'utf8')
    check.same('release pinned', 'package.json nanocode-ts', manifest.dependencies['nanocode-ts'], C.release)
    if (!/\/build-([a-f0-9]{7})\/nanocode-ts-\1\.tgz$/.test(C.release)) check.fail('release pinned', 'the release is not one immutable build: ' + C.release)
    check.same('install', 'install command', C.install, 'npm install ' + C.release)
    const old = manifest.devDependencies['nanocode-ts-old']
    const releases = (lock.match(/https:\/\/github\.com\/nanocodexyz\/nanocode-ts\/releases\/download\/[^\s(),}:]+/g) ?? []).filter(
      (release) => release !== old,
    )
    if (releases.length < limits.connect.lockLeast) check.fail('release pinned', 'the lockfile names the release ' + releases.length + ' times')
    check.same('release pinned', 'lockfile releases', [...new Set(releases)], [C.release])
    const inputs = [
      { name: 'my-machine-3c1f', token: 'hand_demo_4f2a', url: 'https://gateway.test/v1/hands/attach' },
      ...Array.from({ length: random.int(1, limits.connect.snippets) }, () => ({
        name: word(random, random.int(1, limits.connect.wordMost)) + '-' + hex(random, limits.short),
        token: 'hand_' + word(random, random.int(1, limits.connect.wordMost), letters + digits) + '_' + hex(random, limits.short),
        url:
          'https://' +
          word(random, random.int(1, limits.connect.wordMost)) +
          random.pick(['.test', '.xyz', '.dev']) +
          random.pick(['/v1/hands/attach', '/hands', '/v1/hands/attach?x=' + hex(random, limits.short)]),
      })),
    ]
    for (const input of inputs) {
      const source = C.library(input)
      for (const line of handLines) if (!source.includes(line)) check.fail('library snippet', 'the library snippet lacks ' + line)
      for (const [key, value] of Object.entries(input))
        if (!source.includes(key + ": '" + value + "'")) check.fail('library snippet', 'the library snippet lacks ' + key + ': ' + value)
      const cli = C.cli(input)
      if (!cli.includes("'" + input.url + "'") || !cli.includes('--token ' + input.token))
        check.fail('cli snippet', 'the cli snippet ' + cli + ' lacks ' + input.url + ' or ' + input.token)
      steps++
    }
    check.same('fixture answers', 'fixture flag under ' + page, api.fixture, true)
    const labels = ['', 'laptop', ...Array.from({ length: random.int(0, limits.connect.labels) }, () => word(random, random.int(1, limits.connect.wordMost)))]
    for (const label of random.shuffle(labels)) {
      const issued = await api.hand(hex(random), label)
      check.same('fixture answers', 'npm for ' + label, issued.npm, C.install)
      check.same('fixture answers', 'library for ' + label, issued.library, C.library(issued))
      check.same('fixture answers', 'cli for ' + label, issued.cli, C.cli(issued))
      steps++
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous)
    else Reflect.deleteProperty(globalThis, 'location')
    unpin()
  }
  return { steps, violations: check.violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  web_connect: connect,
  web_local: local,
}

const all = ['1', '2', '3']

function canary(name: string, file: string, from: string, to: string, invariant: string, scenario: string, seeds = all): Canary {
  return { flip: mutant(name, file, from, to), invariant, name, scenario, seeds }
}

const localFile = 'src/web/local.ts'

export const canaries: Canary[] = [
  canary(
    'web.local.boot',
    localFile,
    "rows.set(key, { at, state: 'fresh', value: data, version: undefined })",
    "rows.set(key, { at, state: 'stored', value: data, version: undefined })",
    'boot fresh',
    'web_local',
  ),
  canary('web.local.twice', localFile, 'if (flying) return flying', 'if (flying && !flying) return flying', 'load once', 'web_local'),
  canary(
    'web.local.replies',
    localFile,
    "if (kind === 'room' || kind === 'replies') return 'messages'",
    "if (kind === 'room') return 'messages'",
    'key tables',
    'web_local',
  ),
  canary('web.local.uncovered', localFile, 'if (!covered(key)) stale(key)', 'if (!covered(key) && !key) stale(key)', 'welcome same', 'web_local'),
  canary('web.local.caught', localFile, 'if (!caught || !tracked(key)) stale(key)', 'if (!caught) stale(key)', 'welcome moved', 'web_local'),
  canary('web.local.runs', localFile, 'funders: view.funders, runs: view.runs', 'funders: view.funders', 'delta node', 'web_local'),
  canary(
    'web.local.cursor',
    localFile,
    'cursors.set(swarm, Math.max(cursors.get(swarm) ?? event.seq, event.seq))',
    'cursors.set(swarm, event.seq)',
    'delta cursor',
    'web_local',
  ),
  canary(
    'web.local.lost',
    localFile,
    'export function lost(swarm: string) {\n  cursors.delete(swarm)',
    'export function lost(swarm: string) {',
    'cursor reset',
    'web_local',
  ),
  canary('web.local.watched', localFile, 'if (changed && !watched(key) && ', 'if (changed && ', 'advance', 'web_local'),
  canary('web.local.confirm', localFile, 'runner.confirm(mutation, result)', 'void runner', 'mutation confirm', 'web_local'),
  canary(
    'web.local.rollback',
    localFile,
    '      queue.delete(mutation.id)\n      shelve(mutation)\n      waiting.get(mutation.id)?.reject(error)',
    '      shelve(mutation)\n      waiting.get(mutation.id)?.reject(error)',
    'mutation rollback',
    'web_local',
  ),
  canary('web.local.offline', localFile, 'if (offline(error)) {', 'if (offline(error) && !error) {', 'mutation offline', 'web_local'),
  canary(
    'web.local.landed',
    localFile,
    'if (landed) settle(mutation, runner, undefined)',
    'if (landed === false) settle(mutation, runner, undefined)',
    'replay landed',
    'web_local',
  ),
  canary('web.local.placed', localFile, 'list.some((each) => each.id === message.id) ? list : ', '', 'reply placement', 'web_local'),
  canary(
    'web.local.parent',
    localFile,
    'const parent = thread.parent.id === id ? update(thread.parent) : thread.parent',
    'const parent = thread.parent',
    'reactions reach',
    'web_local',
  ),
  canary(
    'web.local.loud',
    localFile,
    'return messages === room.messages ? room : { ...room, messages }',
    'return { ...room, messages }',
    'touch quiet',
    'web_local',
  ),
  canary('web.connect.release', 'src/shared/Connect.ts', "export const release = '", "export const release = '#", 'release pinned', 'web_connect'),
  canary('web.connect.install', 'src/shared/Connect.ts', 'npm install ${release}', 'npm i ${release}', 'install', 'web_connect'),
  canary('web.connect.token', 'src/shared/Connect.ts', "  token: '${input.token}',", "  token: '${input.name}',", 'library snippet', 'web_connect'),
  canary('web.connect.cli', 'src/shared/Connect.ts', '--token ${input.token}', '--token ${input.name}', 'cli snippet', 'web_connect'),
  canary('web.connect.fixture', 'src/web/api.ts', 'npm: Connect.install', 'npm: Connect.release', 'fixture answers', 'web_connect'),
]
