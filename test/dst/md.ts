import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import older from '../rpc-older.json' with { type: 'json' }
import type * as BoardModule from 'nanocode-ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  compat: { claimMs: 60_000, ids: 6, jumpMs: 130_000, ops: 48, sessions: 4, stepMs: 3_000 },
  older: { ops: 48, passesMs: [1_500, 6_000, 20_000, 45_000, 400_000] },
  skew: { passMs: 90_000, repeats: 2 },
  start: Date.UTC(2027, 0, 4, 9),
  violations: 20,
}

type Rng = {
  chance: (p: number) => boolean
  int: (lo: number, hi: number) => number
  next: () => number
  pick: <T>(items: readonly T[]) => T
}

function rng(...parts: (number | string)[]): Rng {
  const digest = createHash('sha256').update(parts.join(':')).digest()
  let a = digest.readUInt32LE(0)
  let b = digest.readUInt32LE(4)
  let c = digest.readUInt32LE(8)
  let d = digest.readUInt32LE(12)
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0
    d = (d + 1) >>> 0
    a = (b ^ (b >>> 9)) >>> 0
    b = (c + (c << 3)) >>> 0
    c = ((c << 21) | (c >>> 11)) >>> 0
    c = (c + t) >>> 0
    return t / 4294967296
  }
  return {
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    next,
    pick: (items) => items[Math.floor(next() * items.length)] as never,
  }
}

function recorder() {
  const violations: Violation[] = []
  const fail = (invariant: string, detail: string) => {
    if (violations.length < limits.violations) violations.push({ detail, invariant })
  }
  return { fail, violations }
}

const real = { error: console.error, info: console.info, log: console.log, now: Date.now, random: Math.random, uuid: crypto.randomUUID.bind(crypto) }

function pin(random: Rng) {
  Date.now = () => limits.start
  Math.random = () => random.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(random.next() * 16).toString(16)).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ReturnType<Crypto['randomUUID']>
  }
  console.error = () => undefined
  console.info = () => undefined
  console.log = () => undefined
  return () => {
    console.info = real.info
    console.log = real.log
    Date.now = real.now
    Math.random = real.random
    crypto.randomUUID = real.uuid
    console.error = real.error
  }
}

const mutants = { absent: false, checkpoint: false, dropped: false, field: false, lending: false, unconditional: false }

function mutant(key: keyof typeof mutants) {
  return () => {
    mutants[key] = true
    return () => void (mutants[key] = false)
  }
}

async function held() {
  const Limits = (await import('../../src/shared/Limits.ts')) as unknown as { Held: Record<'absent' | 'lending' | 'unconditional', { ms: number }> }
  const was = { absent: Limits.Held.absent.ms, lending: Limits.Held.lending.ms, unconditional: Limits.Held.unconditional.ms }
  for (const key of ['absent', 'lending', 'unconditional'] as const) if (mutants[key]) Limits.Held[key].ms = 1
  return () => {
    for (const key of ['absent', 'lending', 'unconditional'] as const) Limits.Held[key].ms = was[key]
  }
}

const unimplemented = (name: string) => new TypeError('The RPC receiver does not implement the method "' + name + '".')

async function olderObject(seed: string): Promise<Outcome> {
  const random = rng(seed, 'older')
  const { fail, violations } = recorder()
  const unpin = pin(random)
  const unheld = await held()
  try {
    const { id, world } = await import('../run.ts')
    const Operations = await import('../../src/worker/Operations.ts')
    const Store = await import('../../src/worker/Store.ts')
    const Limits = await import('../../src/shared/Limits.ts')
    const unconditionalMs = Limits.Operations.unconditionalMs
    const lendingMs = Limits.Operations.lendingMs
    const absentMs = Limits.Store.absentMs
    const hand = 'idle-aaaaaa'
    let listed = [{ connected: false, name: hand }]
    const w = world((_request, url) => (url.pathname === '/v1/hands' ? Response.json({ hands: listed }) : undefined))
    try {
      await w.seed()
      await w.env.DB.prepare('insert into hands (swarm, name, label, created_at) values (?, ?, ?, ?)').bind(id, hand, 'idle', 1).run()
      const ghost = 'f00dfeedbeef'
      let reads = 0
      let batches: Promise<unknown> = Promise.resolve()
      const db = w.env.DB
      const env = w.env as unknown as Record<string, unknown>
      env['DB'] = new Proxy(db, {
        get(target, name) {
          if (name === 'prepare')
            return (query: string) => {
              const statement = target.prepare(query)
              return { ...statement, bind: (...values: unknown[]) => (values.includes(ghost) && (reads += 1), statement.bind(...values)) }
            }
          if (name === 'batch')
            return (statements: D1PreparedStatement[]) => {
              const done = batches.then(() => target.batch(statements))
              batches = done.catch(() => undefined)
              return done
            }
          const value = Reflect.get(target, name) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      let upgraded = random.chance(0.5)
      const calls: string[] = []
      let lent = 0
      const object = new Proxy(w.swarm, {
        get(target, name, receiver) {
          if (name === 'viewed')
            return (...args: Parameters<typeof target.viewed>) => {
              calls.push('viewed')
              if (!upgraded) throw unimplemented('viewed')
              return target.viewed(...args)
            }
          if (name === 'view') return (...args: Parameters<typeof target.view>) => (calls.push('view'), target.view(...args))
          if (name === 'lent') return (swarm: string) => ((lent += 1), target.lent(swarm))
          return Reflect.get(target, name, receiver) as unknown
        },
      })
      env['SWARMS'] = { get: () => object, idFromName: (name: string) => name }
      let now = 0
      let memo: number | null = null
      let lending: { at: number; connected: boolean } | null = null
      let missed: number | null = null
      let created = false
      let steps = 0
      for (; steps < limits.older.ops; steps++) {
        const op = random.pick(['get', 'get', 'hands', 'hands', 'find', 'exists', 'pass', 'pass', 'flip', 'deploy', 'create'] as const)
        if (op === 'pass') {
          const ms = random.int(1, random.pick(limits.older.passesMs))
          w.pass(ms)
          now += ms
        } else if (op === 'flip') listed = [{ connected: random.chance(0.5), name: hand }]
        else if (op === 'deploy') upgraded = !upgraded
        else if (op === 'get') {
          calls.length = 0
          const read = await Operations.get(w.env, { swarm: id })
          if (!read.ok)
            fail(
              'older read',
              'a read at +' + now + 'ms against ' + (upgraded ? 'the current' : 'the previous') + ' object failed: ' + JSON.stringify(read).slice(0, 200),
            )
          const held = memo !== null && now - memo < unconditionalMs
          const expected = held ? ['view'] : upgraded ? ['viewed'] : ['viewed', 'view']
          if (!held && !upgraded) memo = now
          if (calls.join() !== expected.join()) fail('viewed memo', 'at +' + now + 'ms the object heard ' + calls.join() + ', expected ' + expected.join())
        } else if (op === 'hands') {
          const before = lent
          const read = await Operations.hands(w.env, { swarm: id })
          const fresh: boolean = lending === null || now - lending.at >= lendingMs
          const connected: boolean = fresh ? listed[0]!.connected : lending!.connected
          if (fresh) lending = { at: now, connected }
          const got = read.ok ? read.value.hands.map((one) => one.name + ':' + one.connected).join() : JSON.stringify(read).slice(0, 200)
          if (got !== hand + ':' + connected) fail('hands listed', 'at +' + now + 'ms hands read ' + got + ', expected ' + hand + ':' + connected)
          const told = fresh && connected ? 1 : 0
          if (lent - before !== told) fail('lent when used', 'at +' + now + 'ms the object heard lent ' + (lent - before) + ' times, expected ' + told)
        } else if (op === 'create') {
          if (created) continue
          await Store.insert(w.env, { creator: null, goal: 'g', id: ghost, problem: null, steering: 'open', title: 'Now it exists' })
          created = true
        } else {
          const before = reads
          const found = op === 'find' ? ((await Store.find(w.env, ghost))?.title ?? null) : await Store.exists(w.env, ghost)
          if (created) {
            if (found !== (op === 'find' ? 'Now it exists' : true))
              fail('created found', 'at +' + now + 'ms ' + op + ' of a created swarm answered ' + String(found))
            continue
          }
          const skip = missed !== null && now - missed < absentMs
          if (!skip) missed = now
          if (found !== (op === 'find' ? null : false)) fail('absent memo', op + ' of a missing swarm answered ' + String(found))
          if (reads - before !== (skip ? 0 : 1))
            fail('absent memo', 'at +' + now + 'ms ' + op + ' read D1 ' + (reads - before) + ' times, expected ' + (skip ? 0 : 1))
        }
      }
      return { steps, violations }
    } finally {
      w.restore()
    }
  } finally {
    unheld()
    unpin()
  }
}

function workerCalls() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'worker')
  const called = new Set<string>()
  for (const file of [
    'Operations.ts',
    'Machines.ts',
    'Og.ts',
    'Page.ts',
    'Rest.ts',
    'Mcp.ts',
    'index.ts',
    'site.ts',
    'Posters.ts',
    'Telegram.ts',
    'Watch.ts',
    'Lobby.ts',
  ]) {
    let source = ''
    try {
      source = readFileSync(join(dir, file), 'utf8')
    } catch {
      continue
    }
    for (const match of source.matchAll(/\bstub\(env, [^)]*\)\.(\w+)\(/g)) called.add(match[1]!)
    for (const named of source.matchAll(/const (\w+) = stub\(/g))
      for (const match of source.matchAll(new RegExp('\\b' + named[1] + '\\.(\\w+)\\(', 'g'))) called.add(match[1]!)
  }
  return called
}

function previous(swarm: object, methods: readonly string[]) {
  const known = new Set(methods)
  return new Proxy(swarm, {
    get(target, property) {
      if (typeof property !== 'string' || property === 'then') return undefined
      if (!known.has(property)) return () => Promise.reject(unimplemented(property))
      const value = Reflect.get(target, property) as unknown
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        const result = await Reflect.apply(value as (...args: unknown[]) => unknown, target, args)
        if (property !== 'view' || !result || typeof result !== 'object') return result
        const { failure: _failure, reason: _reason, ...rest } = result as Record<string, unknown>
        return rest
      }
    },
  })
}

async function skew(seed: string): Promise<Outcome> {
  const random = rng(seed, 'skew')
  const { fail, violations } = recorder()
  const unpin = pin(random)
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === '#ssr'
        ? {
            shortCircuit: true,
            url:
              'data:text/javascript,' +
              encodeURIComponent(
                'export async function render() { return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<p>page</p>")); c.close() } }) }',
              ),
          }
        : next(specifier, context),
    load: (url, context, next) =>
      /\.(wasm|bin)$/.test(url)
        ? {
            format: 'module',
            shortCircuit: true,
            source:
              'import { readFileSync } from "node:fs"; const data = readFileSync(new URL(' +
              JSON.stringify(url) +
              ')); export default data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)',
          }
        : next(url, context),
  })
  const { id, world } = await import('../run.ts')
  const { Swarm } = await import('../../src/worker/Swarm.ts')
  const prototype = Swarm.prototype as unknown as Record<string, unknown>
  const dropped = mutants.dropped ? prototype['view'] : undefined
  if (mutants.dropped) delete prototype['view']
  const w = world(() => undefined)
  try {
    const known = new Set(older.methods)
    const fallbacks = older.fallbacks as Record<string, string>
    for (const name of workerCalls())
      if (!known.has(name) && !(name in fallbacks))
        fail('worker call unexplained', 'the Worker calls ' + name + ', which the previous object lacks, with no fallback listed')
    for (const name of older.methods)
      if (typeof prototype[name] !== 'function') fail('object dropped method', 'the previous Worker calls ' + name + ', which the object no longer has')
    for (const [name, fallback] of Object.entries(fallbacks))
      if (!known.has(fallback)) fail('worker call unexplained', name + ' falls back to ' + fallback + ', which the previous object lacks')
    const worker = (await import('../../src/worker/site.ts')).default
    const objects = (await import('../../src/worker/index.ts')).default
    await w.seed()
    type Statement = Record<string, (...args: unknown[]) => unknown>
    const statement = (prepared: Statement): Statement => ({
      ...prepared,
      bind: (...values: unknown[]) => statement(prepared['bind']!(...values) as Statement),
      raw: async () => ((await prepared['all']!()) as { results: Record<string, unknown>[] }).results.map((row) => Object.values(row)),
    })
    const d1 = w.env.DB as unknown as Statement
    const db: Record<string, unknown> = { ...d1, prepare: (query: string) => statement(d1['prepare']!(query) as Statement) }
    db['withSession'] = () => db
    const env = {
      ...w.env,
      ASSETS: {
        fetch: async (request: Request) =>
          new URL(request.url).pathname === '/index.html'
            ? new Response('<html><head><title>x</title></head><body><div id="root"></div></body></html>')
            : new Response(null, { status: 404 }),
      },
      DB: db,
      SWARMS: { get: () => previous(w.swarm, older.methods), idFromName: (name: string) => name },
    } as unknown as Cloudflare.Env
    const context = { passThroughOnException() {}, props: {}, waitUntil() {} } as never
    env.OBJECTS = { fetch: (request: Request) => objects.fetch(request, env) } as unknown as Fetcher
    const base = 'https://swarms.new'
    const get = (path: string, init: RequestInit = {}) => worker.fetch(new Request(base + path, init), env, context)
    const paths = [
      '/v1/swarms/' + id,
      '/api/swarms/' + id,
      '/v1/swarms/' + id + '/answer',
      '/v1/swarms/' + id + '/backers',
      '/x/s/' + id,
      '/tg/s/' + id,
      '/oembed?url=' + encodeURIComponent(base + '/s/' + id),
      '/og/s/' + id + '/card.png',
      '/v1/swarms/' + id + '/live',
      'mcp:swarm_get',
      'mcp:swarm_answer',
      'mcp:swarm_backers',
    ]
    const plan = paths.flatMap((path) => Array.from({ length: random.int(1, limits.skew.repeats) }, () => path))
    for (let i = plan.length - 1; i > 0; i--) {
      const j = random.int(0, i)
      ;[plan[i], plan[j]] = [plan[j]!, plan[i]!]
    }
    let steps = 0
    for (const path of plan) {
      steps += 1
      if (random.chance(0.3)) w.pass(random.int(1, limits.skew.passMs))
      if (path.startsWith('mcp:')) {
        const name = path.slice(4)
        const response = await get('/mcp', {
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/call', params: { arguments: { swarm: id }, name } }),
          headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
          method: 'POST',
        })
        const text = await response.text()
        if (response.status !== 200 || /does not implement|"isError":true/.test(text))
          fail('skew served', name + ' answered ' + response.status + ': ' + text.slice(0, 200))
        continue
      }
      const stop = new AbortController()
      const response = await get(path, { signal: stop.signal })
      if (response.status !== 200) fail('skew served', path + ' answered ' + response.status + ': ' + (await response.clone().text()).slice(0, 200))
      else if (path === '/v1/swarms/' + id) {
        const body = (await response.clone().json()) as { failure?: unknown; reason?: unknown }
        if (!('failure' in body) || body.failure !== null || (body.reason ?? null) !== null)
          fail(
            'skew view fields',
            'the detail from a previous object carries failure ' + JSON.stringify(body.failure) + ' and reason ' + JSON.stringify(body.reason),
          )
      }
      stop.abort()
      await response.body?.cancel().catch(() => undefined)
    }
    return { steps, violations }
  } finally {
    w.restore()
    if (mutants.dropped) prototype['view'] = dropped
    unpin()
  }
}

type Board = BoardModule.Board.Board

type Build = { checkpoints: boolean; name: string; open(file: string): Promise<{ board: Board; host: { close(): void } }> }

type Op =
  | { kind: 'post'; id: string; needs: string[] }
  | { kind: 'claim' | 'renew' | 'cancel' | 'heed'; id: string }
  | { kind: 'finish'; failed: boolean; id: string }
  | { kind: 'steer'; id: string; key: number }
  | { kind: 'reply' | 'fold'; id: string; key: number }
  | { kind: 'group'; id: string }

async function builds(): Promise<Build[]> {
  const require = createRequire(import.meta.url)
  const compile = (path: string) =>
    (WebAssembly as unknown as { compile(bytes: Uint8Array): Promise<WebAssembly.Module> }).compile(readFileSync(require.resolve(path)))
  const { Board } = await import('nanocode-ts')
  const { Sql } = await import('nanocode-ts/node')
  const { Board: OldBoard } = await import('nanocode-ts-old')
  const { Sql: OldSql } = await import('nanocode-ts-old/node')
  const [oldWasm, boardWasm, fullWasm] = await Promise.all([
    compile('nanocode-ts-old/nanocode_wasm.wasm'),
    compile('nanocode-ts/nanocode_board.wasm'),
    compile('nanocode-ts/nanocode_wasm.wasm'),
  ])
  const scope = 'swarm:abc'
  const mutated = (board: Board): Board => {
    if (mutants.checkpoint) board.checkpoint = async () => false
    if (mutants.field) {
      const post = board.post.bind(board)
      board.post = (task, options) => post({ ...task, labels: { ...task.labels, v: '2' } }, options)
    }
    return board
  }
  return [
    {
      checkpoints: false,
      name: 'old full wasm',
      async open(file) {
        const host = OldSql.open(file)
        return { board: (await OldBoard.open({ actor: scope, module: oldWasm, scope, sql: host })) as unknown as Board, host }
      },
    },
    ...(
      [
        ['new board wasm', boardWasm],
        ['new full wasm', fullWasm],
      ] as const
    ).map(([name, module]) => ({
      checkpoints: true,
      name,
      async open(file: string) {
        const host = Sql.open(file)
        return { board: mutated(await Board.open({ actor: scope, module, scope, sql: host })), host }
      },
    })),
  ]
}

function plan(random: Rng): Op[] {
  const ids = Array.from({ length: limits.compat.ids }, (_, i) => 'n:' + i)
  const posted: string[] = []
  return Array.from({ length: limits.compat.ops }, (): Op => {
    const kind =
      posted.length < 2
        ? 'post'
        : random.pick(['post', 'claim', 'claim', 'renew', 'finish', 'cancel', 'steer', 'steer', 'heed', 'reply', 'fold', 'group'] as const)
    const id = kind === 'post' || kind === 'group' ? random.pick(ids) : random.pick(posted)
    if (kind === 'post' || kind === 'group') {
      const needs = kind === 'post' && posted.length && !posted.includes(id) && random.chance(0.3) ? [random.pick(posted)] : []
      if (!posted.includes(id)) posted.push(id)
      return kind === 'post' ? { id, kind, needs } : { id, kind }
    }
    if (kind === 'finish') return { failed: random.chance(0.3), id, kind }
    if (kind === 'steer' || kind === 'reply' || kind === 'fold') return { id, key: random.int(0, 2), kind }
    return { id, kind }
  })
}

const root = { id: 'n:root', labels: { form: 'goal', kind: 'node' }, spec: 'Does P = NP?' }

function verdict(result: { ok: boolean; rejection?: { kind: string }; tookOver?: boolean }) {
  return result.ok ? 'ok' + (result.tookOver ? ' took over' : '') : (result.rejection?.kind ?? 'rejected')
}

async function apply(board: Board, op: Op, at: number, claims: Map<string, string>) {
  return applied(board, op, at, claims).catch((error: unknown) => 'threw ' + String((error as Error)?.message ?? error))
}

async function applied(board: Board, op: Op, at: number, claims: Map<string, string>) {
  const claim = claims.get(op.id)
  switch (op.kind) {
    case 'post':
      return verdict(await board.post({ id: op.id, labels: { kind: 'node' }, needs: op.needs, parent: root.id, spec: op.id }, { atMs: at, key: op.id }))
    case 'group': {
      const verdicts = await board.group([
        { atMs: at, key: op.id, op: { op: 'post', task: { id: op.id, labels: { kind: 'node' }, needs: [], parent: root.id, spec: op.id } } },
        { atMs: at, key: 'g:' + op.id, op: { body: 'grouped ' + op.id, op: 'reply', task: root.id } },
      ])
      return verdicts.map(verdict).join('+')
    }
    case 'claim': {
      const claimed = await board.claim(op.id, { atMs: at, leaseMs: limits.compat.claimMs })
      if (claimed.ok) claims.set(op.id, claimed.claim)
      return verdict(claimed)
    }
    case 'renew':
      return claim ? verdict(await board.renew(op.id, claim, limits.compat.claimMs, at)) : 'skip'
    case 'finish':
      return claim ? verdict(await board.finish(op.id, claim, op.failed ? { failed: 'no' } : { done: 'shown' }, at)) : 'skip'
    case 'cancel':
      return verdict(await board.cancel(op.id, 'withdrawn', at))
    case 'steer':
      return verdict(await board.steer(op.id, 'steer ' + op.key, { atMs: at, key: 'steer:' + op.id + ':' + op.key }))
    case 'heed': {
      const last = claim ? (await board.steers(op.id, claim)).at(-1) : undefined
      return claim && last ? verdict(await board.heed(op.id, claim, last.seq, at)) : 'skip'
    }
    case 'reply':
      return verdict(await board.submit({ body: 'note ' + op.key, op: 'reply', task: root.id }, { atMs: at, key: 'note/' + op.key }))
    case 'fold':
      return verdict(await board.submit({ body: 'folded ' + op.id, op: 'reply', task: root.id }, { atMs: at, key: 'fold/' + op.id + '/' + op.key }))
  }
}

async function snapshot(board: Board, at: number) {
  const strip = (tasks: BoardModule.Board.Task[]) => tasks.map(({ claimSeq: _, ...task }) => task).sort((a, b) => a.id.localeCompare(b.id))
  const ids = [root.id, ...Array.from({ length: limits.compat.ids }, (_, i) => 'n:' + i)]
  return JSON.stringify({
    held: strip(await board.held(at)),
    steers: await Promise.all(ids.map((id) => board.steers(id))),
    tasks: strip(await board.tasks(at)),
  })
}

function unkeyed(text: string) {
  return text.replace(/swarm:abc\.\d+/g, 'swarm:abc.n')
}

function log(file: string) {
  const db = new DatabaseSync(file)
  try {
    return JSON.stringify(
      db
        .prepare('select seq, body from nanocode_log order by seq')
        .all()
        .map((row) => [row['seq'], String(row['body']).replace(/"at_ms":\d+,("op":\{"op":"charter")/, '$1')]),
    )
  } finally {
    db.close()
  }
}

async function compat(seed: string): Promise<Outcome> {
  const random = rng(seed, 'compat')
  const { fail, violations } = recorder()
  const all = await builds()
  const ops = plan(random)
  const times: number[] = []
  for (let at = limits.start, i = 0; i < ops.length; i++) times.push((at += random.chance(0.1) ? limits.compat.jumpMs : random.int(1, limits.compat.stepMs)))
  const cuts = new Set(Array.from({ length: limits.compat.sessions - 1 }, () => random.int(1, ops.length - 1)))
  const chain = Array.from({ length: cuts.size + 1 }, () => random.pick(all))
  if (chain.every((build) => build === chain[0])) chain[chain.length - 1] = all[(all.indexOf(chain[0]!) + 1) % all.length]!
  const directory = mkdtempSync(join(tmpdir(), 'swarms-md-'))
  let steps = 0
  const session = async (build: Build, file: string, step: (board: Board) => Promise<void>, opened: (board: Board) => Promise<void>) => {
    const { board, host } = await build.open(file)
    try {
      await opened(board)
      await step(board)
      if (build.checkpoints && !(await board.checkpoint())) fail('opened', build.name + ' could not checkpoint')
    } finally {
      await board.close()
      host.close()
    }
  }
  try {
    const reference: { log: string; name: string; seen: string[]; verdicts: string[] }[] = []
    for (const build of all) {
      const file = join(directory, build.name.replaceAll(' ', '-') + '.db')
      const claims = new Map<string, string>()
      const verdicts: string[] = []
      const seen: string[] = []
      await session(
        build,
        file,
        async (board) => {
          verdicts.push(verdict(await board.post(root, { atMs: limits.start, key: root.id })))
          for (let i = 0; i < ops.length; i++) {
            if (cuts.has(i)) seen.push(await snapshot(board, times[i - 1]!))
            verdicts.push(await apply(board, ops[i]!, times[i]!, claims))
            steps += 1
          }
          seen.push(await snapshot(board, times.at(-1)!))
        },
        async () => undefined,
      )
      reference.push({ log: log(file), name: build.name, seen, verdicts })
    }
    for (const other of reference.slice(1)) {
      if (other.log !== reference[0]!.log) fail('log same', other.name + ' wrote a different log from ' + reference[0]!.name + ' for the same operations')
      const at = other.verdicts.findIndex((one, i) => one !== reference[0]!.verdicts[i])
      if (at >= 0)
        fail(
          'verdict same',
          other.name + ' answered ' + other.verdicts[at] + ' where ' + reference[0]!.name + ' answered ' + reference[0]!.verdicts[at] + ' at op ' + at,
        )
    }
    const file = join(directory, 'chain.db')
    const claims = new Map<string, string>()
    const verdicts: string[] = []
    const bounds = [0, ...[...cuts].sort((a, b) => a - b), ops.length]
    let last: Build | null = null
    let checkpointed = false
    let before: string | null = null
    for (let s = 0; s < chain.length; s++) {
      const build = chain[s]!
      const from = bounds[s]!
      const to = bounds[s + 1]!
      await session(
        build,
        file,
        async (board) => {
          if (s === 0) verdicts.push(verdict(await board.post(root, { atMs: limits.start, key: root.id })))
          for (let i = from; i < to; i++) {
            verdicts.push(await apply(board, ops[i]!, times[i]!, claims))
            steps += 1
          }
          const seen = await snapshot(board, times[to - 1]!)
          if (unkeyed(seen) !== unkeyed(reference[0]!.seen[s]!))
            fail(
              'reopen same',
              'after ops ' +
                from +
                '..' +
                to +
                ' under ' +
                chain
                  .slice(0, s + 1)
                  .map((one) => one.name)
                  .join(' > ') +
                ' the board differs from one build',
            )
          before = seen
        },
        async (board) => {
          if (s > 0 && (await snapshot(board, times[from - 1]!)) !== before)
            fail('reopen same', build.name + ' reopened a board ' + last?.name + ' wrote and read it differently')
          if (!build.checkpoints) return
          const [opened] = await board.opened()
          if (!checkpointed && (opened?.from !== 'replay' || opened.fallback !== 'missing'))
            fail('opened', build.name + ' opened a board never checkpointed as ' + JSON.stringify(opened))
          if (checkpointed && opened?.from !== 'checkpoint') fail('opened', build.name + ' opened a checkpointed board as ' + JSON.stringify(opened))
          if (checkpointed && last?.checkpoints && opened?.from === 'checkpoint' && opened.tail !== 0)
            fail('opened', build.name + ' found a tail of ' + opened.tail + ' after ' + last.name + ' checkpointed')
        },
      )
      if (build.checkpoints) checkpointed = true
      last = build
    }
    const written = log(file)
    const ids = (JSON.parse(written) as [number, string][]).map(([, body]) => (JSON.parse(body) as { id: string }).id)
    const twice = ids.find((one, i) => ids.indexOf(one) !== i)
    if (twice) fail('event ids unique', 'the chained board logged ' + twice + ' twice')
    if (unkeyed(written) !== unkeyed(reference[0]!.log))
      fail('log same', 'the board written by ' + chain.map((one) => one.name).join(' > ') + ' logged differently from one build')
    const at = verdicts.findIndex((one, i) => one !== reference[0]!.verdicts[i])
    if (at >= 0) fail('verdict same', 'the chained board answered ' + verdicts[at] + ' where one build answered ' + reference[0]!.verdicts[at] + ' at op ' + at)
    return { steps, violations }
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  compat,
  older: olderObject,
  skew,
}

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('unconditional'), invariant: 'viewed memo', name: 'older.unconditional', scenario: 'older', seeds: ['1', '2', '3'] },
  { flip: mutant('lending'), invariant: 'lent when used', name: 'older.lending', scenario: 'older', seeds: ['1', '2', '3'] },
  { flip: mutant('absent'), invariant: 'absent memo', name: 'older.absent', scenario: 'older', seeds: ['1', '2', '3'] },
  { flip: mutant('dropped'), invariant: 'object dropped method', name: 'skew.dropped', scenario: 'skew', seeds: ['1'] },
  { flip: mutant('checkpoint'), invariant: 'opened', name: 'compat.checkpoint', scenario: 'compat', seeds: ['1', '2', '3'] },
  { flip: mutant('field'), invariant: 'log same', name: 'compat.field', scenario: 'compat', seeds: ['1', '2', '3'] },
]
