import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Entry } from '../../src/shared/Api.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  runs: {
    clip: 1999,
    entries: 70,
    eventBase: 100,
    hands: 2,
    logged: 0.8,
    msMost: 9000,
    pageMost: 4,
    readables: 12,
    sandboxes: 3,
    stepMs: 3000,
    window: 5,
    wraps: 3,
  },
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

const mutants = { exit: false, index: false, more: false, running: false, speaker: false, unwrap: false, versioned: false }

function mutant(key: keyof typeof mutants) {
  return () => {
    mutants[key] = true
    return () => void (mutants[key] = false)
  }
}

const said = (body: object) => JSON.stringify([{ text: JSON.stringify(body), type: 'text' }])

const created = (id: string) => said({ hand: null, sandboxId: id })

const exec = (id: string, script: string) => JSON.stringify({ command: ['sh', '-c', script], sandboxId: id })

type Meta = { clipped: boolean; exit: number | null; failed: boolean; log: string | null }

type Expected = {
  at: number
  clipped: boolean
  event: number | null
  exit: number | null
  failed: boolean
  log: string | null
  machine: string
  ms: number | null
  output: number | null
  seq: number
  text: string
  who: string | null
}

function feed(random: Rng) {
  const L = limits.runs
  const entries: Entry[] = []
  const meta = new Map<number, Meta>()
  const commands = new Map<number, { machine: string; text: string }>()
  const sandboxes: { id: string; name: string }[] = []
  const hands: string[] = []
  const speakers = [null, 'branch: moe', 'branch: attn'] as const
  let at = limits.start
  const push = (kind: string, text: string, detail: string | null, who: string | null) => {
    at += random.int(0, L.stepMs)
    const seq = entries.length + 1
    entries.push({ at, detail, event: seq + L.eventBase, kind, seq, text, who } as Entry)
    return seq
  }
  let made = 0
  while (entries.length < L.entries) {
    const who = random.pick(speakers)
    const op = random.pick(['start', 'join', 'exec', 'exec', 'spawn', 'status', 'hand', 'kv', 'out', 'out', 'out', 'shut'] as const)
    if (op === 'start') {
      if (sandboxes.length >= L.sandboxes * 2) continue
      const named = random.chance(0.6)
      const name = named ? 'gpu-' + random.int(1, L.sandboxes) : ''
      push('machine', 'Starting machine ' + name + ' (lmsysorg/sglang)', JSON.stringify({ gpu: 'H200', image: 'lmsysorg/sglang' }), who)
      if (random.chance(0.15)) {
        push('error', 'compute_create failed', JSON.stringify({ detail: 'no capacity' }), who)
        continue
      }
      made += 1
      const id = (random.chance(0.5) ? 'sb-' : 'e2b') + made + 'x' + random.int(0, 9999)
      push('output', 'compute_create output', created(id), who)
      sandboxes.push({ id, name: name || id })
    } else if (op === 'join') {
      if (hands.length >= L.hands) continue
      const name = 'room-' + (hands.length + 1)
      hands.push(name)
      push('machine', "A contributor's machine joined the swarm as hand " + name + ' (data room).', null, null)
    } else if (op === 'exec' || op === 'spawn' || op === 'status') {
      if (!sandboxes.length) continue
      const box = random.pick(sandboxes)
      const script = random.pick(['nvidia-smi', 'python bench.py', 'sleep 1', 'ls -la', '  make  '])
      if (op === 'status')
        commands.set(push('tool', 'Called compute_status', JSON.stringify({ sandboxId: box.id }), who), { machine: box.name, text: 'status' })
      else commands.set(push('tool', 'Called compute_' + op, exec(box.id, script), who), { machine: box.name, text: '$ ' + script.trim() })
    } else if (op === 'hand') {
      if (!hands.length) continue
      const hand = random.pick(hands)
      const cmd = random.pick(['cat q.txt', 'ls', 'make test'])
      commands.set(push('tool', '$ ' + cmd + ' on ' + hand, JSON.stringify({ cmd, hand }), who), { machine: hand, text: '$ ' + cmd })
    } else if (op === 'kv') push('tool', random.pick(['Called kv_get', 'Called kv_set']), JSON.stringify({ key: 'k' + random.int(0, 3) }), who)
    else if (op === 'shut') {
      if (!sandboxes.length) continue
      push('machine', 'Shutting down a machine', JSON.stringify({ sandboxId: random.pick(sandboxes).id }), null)
    } else {
      const form = random.pick(['exec', 'exec', 'spawn', 'hand', 'error', 'clipped', 'timed'] as const)
      if (form === 'exec') {
        const exit = random.int(0, 2)
        meta.set(push('output', 'compute_exec output', said(exit ? { exitCode: exit, stderr: 'boom' } : { exitCode: 0, stdout: 'H200' }), who), {
          clipped: false,
          exit,
          failed: exit !== 0,
          log: null,
        })
      } else if (form === 'timed')
        meta.set(push('output', 'compute_exec output', said({ exitCode: 0, timedOut: true }), who), { clipped: false, exit: 0, failed: true, log: null })
      else if (form === 'spawn') {
        const log = '/tmp/gateway/j' + random.int(0, 99) + '.log'
        meta.set(push('output', 'compute_spawn output', said({ exitPath: log + '.exit', logPath: log, pid: random.int(2, 999) }), who), {
          clipped: false,
          exit: null,
          failed: false,
          log,
        })
      } else if (form === 'hand') {
        const exit = random.int(0, 2)
        meta.set(push('output', exit ? 'Command output · exit ' + exit : 'Command output', 'no such file', who), {
          clipped: false,
          exit,
          failed: exit !== 0,
          log: null,
        })
      } else if (form === 'error') meta.set(push('error', 'compute_exec failed', 'gateway down', who), { clipped: false, exit: null, failed: true, log: null })
      else meta.set(push('output', 'compute_exec output', 'y'.repeat(L.clip) + '…', who), { clipped: true, exit: null, failed: false, log: null })
    }
  }
  const answers = new Map<number, number | null>()
  for (const [seq] of commands) {
    const from = entries[seq - 1]!
    let found: number | null = null
    for (const next of entries.slice(seq, seq + L.window)) {
      if (next.who !== from.who) continue
      if (next.kind === 'tool') break
      if (next.kind === 'output' || next.kind === 'error') {
        found = next.seq
        break
      }
    }
    answers.set(seq, found)
  }
  const expected = (ms: ReadonlyMap<number, number>) =>
    new Map(
      [...commands].map(([seq, command]): [number, Expected] => {
        const from = entries[seq - 1]!
        const out = answers.get(seq) ?? null
        const said = out === null ? undefined : entries[out - 1]!
        const known = out === null ? undefined : meta.get(out)
        const info = known ?? { clipped: false, exit: said?.text === 'compute_create output' ? null : null, failed: said?.kind === 'error', log: null }
        return [
          seq,
          {
            at: from.at,
            clipped: info.clipped,
            event: said ? (said.event ?? null) : null,
            exit: info.exit,
            failed: info.failed,
            log: info.log,
            machine: command.machine,
            ms: said ? (ms.get(said.seq) ?? (said.at > from.at ? said.at - from.at : null)) : null,
            output: out,
            seq,
            text: command.text,
            who: from.who,
          },
        ]
      }),
    )
  return { answers, entries, expected, sandboxes }
}

async function guarded() {
  await import('../run.ts')
  const Fleet = await import('../../src/shared/Fleet.ts')
  const Runs = await import('../../src/worker/Runs.ts')
  const fleet = { ...Fleet.guards }
  const runs = { ...Runs.guards }
  const indexes = [...Runs.indexes]
  Fleet.guards.exit = !mutants.exit
  Fleet.guards.speaker = !mutants.speaker
  Fleet.guards.unwrap = !mutants.unwrap
  Runs.guards.more = !mutants.more
  Runs.guards.running = !mutants.running
  Runs.guards.versioned = !mutants.versioned
  if (mutants.index) Runs.indexes.splice(0)
  return {
    Fleet,
    Runs,
    restore: () => {
      Object.assign(Fleet.guards, fleet)
      Object.assign(Runs.guards, runs)
      Runs.indexes.splice(0, Runs.indexes.length, ...indexes)
    },
  }
}

function storage(Runs: typeof import('../../src/worker/Runs.ts')) {
  const db = new DatabaseSync(':memory:')
  db.exec(
    'CREATE TABLE feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT, who TEXT, event INTEGER)',
  )
  for (const statement of [...Runs.schema, ...Runs.indexes]) db.exec(statement)
  const kv = new Map<string, unknown>()
  const sql = {
    exec: (query: string, ...bindings: unknown[]) => {
      const statement = db.prepare(query)
      const rows = (
        /^\s*(SELECT|WITH|EXPLAIN)/i.test(query) || /RETURNING/i.test(query)
          ? statement.all(...(bindings as never[]))
          : (statement.run(...(bindings as never[])), [])
      ) as Record<string, unknown>[]
      return { one: () => rows[0], toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    },
  }
  const self = {
    ctx: {
      storage: {
        kv: {
          delete: (key: string) => kv.delete(key),
          get: (key: string) => kv.get(key),
          put: (key: string, value: unknown) => kv.set(key, structuredClone(value)),
        },
        sql,
      },
    },
    last: () => Number((db.prepare('SELECT MAX(seq) AS seq FROM feed').get() as { seq: number | null }).seq ?? 0),
  }
  const insert = (item: Entry) =>
    Number(
      (
        db
          .prepare('INSERT INTO feed (at, kind, text, detail, who, event) VALUES (?, ?, ?, ?, ?, ?) RETURNING seq')
          .get(item.at, item.kind, item.text, item.detail, item.who, item.event) as { seq: number }
      ).seq,
    )
  return { db, insert, kv, self: self as never }
}

function same(got: Record<string, unknown> | undefined, want: Expected, keys: readonly (keyof Expected)[]) {
  if (!got) return 'missing'
  const off = keys.filter((key) => (got[key] ?? null) !== want[key])
  return off.length ? off.map((key) => key + ' ' + JSON.stringify(got[key]) + ' != ' + JSON.stringify(want[key])).join(', ') : null
}

const fields = ['at', 'clipped', 'exit', 'failed', 'log', 'machine', 'ms', 'text', 'who'] as const

function pages(Runs: typeof import('../../src/worker/Runs.ts'), self: never, machine: string, order: 'newest' | 'oldest', limit: number, most: number) {
  const seen: Record<string, unknown>[] = []
  let cursor: number | undefined
  let total = -1
  for (let page = 0; page <= most + 1; page++) {
    const listed = Runs.listed(self, machine, { cursor, limit, order })
    total = listed.total
    seen.push(...(listed.commands as unknown as Record<string, unknown>[]))
    if (listed.next === null) break
    cursor = listed.next
  }
  return { seen, total }
}

async function runs(seed: string): Promise<Outcome> {
  const random = rng(seed, 'runs')
  const { fail, violations } = recorder()
  const L = limits.runs
  const { Fleet, Runs, restore } = await guarded()
  const now = Date.now
  let steps = 0
  try {
    const made = feed(random)
    const { entries } = made
    const given = new Map<number, number>()
    for (const item of entries) if ((item.kind === 'output' || item.kind === 'error') && random.chance(0.4)) given.set(item.seq, random.int(1, L.msMost))
    const plain = made.expected(new Map())
    const timed = made.expected(given)
    for (const [ms, want] of [
      [new Map<number, number>(), plain],
      [given, timed],
    ] as const) {
      const state = Fleet.tracker()
      const got = new Map<number, Record<string, unknown>>()
      for (const item of entries)
        for (const change of Fleet.track(state, item, ms.get(item.seq) ?? null)) {
          steps += 1
          if (change.kind === 'command') got.set(change.command.seq, { ...change.command })
          else Object.assign(got.get(change.answer.seq) ?? {}, change.answer)
        }
      for (const [seq, one] of want) {
        const off = same(got.get(seq), one, fields)
        if (off) fail('answer read', 'command ' + seq + ': ' + off)
        if ((got.get(seq)?.['output'] ?? null) !== one.output)
          fail('runs match fold', 'command ' + seq + ' answered by ' + String(got.get(seq)?.['output']) + ', expected ' + one.output)
      }
      if (got.size !== want.size) fail('runs match fold', 'tracked ' + got.size + ' commands, expected ' + want.size)
    }
    const folded = Fleet.folded(entries, [])
    const state = Fleet.tracker()
    const tracked = new Map<number, Record<string, unknown>>()
    for (const item of entries)
      for (const change of Fleet.track(state, item)) {
        if (change.kind === 'command') tracked.set(change.command.seq, { ...change.command })
        else Object.assign(tracked.get(change.answer.seq) ?? {}, change.answer)
      }
    let count = 0
    for (const machine of folded)
      for (const run of machine.commands) {
        count += 1
        const found = tracked.get(run.seq)
        const output = typeof found?.['output'] === 'number' ? entries[found['output'] - 1] : undefined
        const read = output ? (output.detail ?? output.text) : null
        if (found?.['machine'] !== machine.name || found['text'] !== run.text || found['who'] !== run.who || read !== run.output)
          fail(
            'runs match fold',
            'command ' +
              run.seq +
              ' tracked as ' +
              JSON.stringify(found).slice(0, 160) +
              ' but folded on ' +
              machine.name +
              ' with ' +
              String(run.output).slice(0, 60),
          )
      }
    if (count !== tracked.size) fail('runs match fold', 'the fold has ' + count + ' commands, the tracker ' + tracked.size)

    const { db, insert, kv, self } = storage(Runs)
    const prefix = random.int(0, entries.length)
    for (const item of entries.slice(0, prefix)) insert(item)
    Runs.sync(self)
    if (kv.get('runs:cursor') !== (prefix || undefined) && prefix)
      fail('runs listed', 'backfill left the cursor at ' + String(kv.get('runs:cursor')) + ', not ' + prefix)
    let cursor = prefix
    const counted = new Map<number, number>()
    for (const item of entries.slice(prefix)) {
      const seq = insert(item)
      steps += 1
      if (!random.chance(L.logged)) continue
      const ms = given.get(seq) ?? null
      Runs.logged(self, { ...item, seq }, ms)
      if (cursor === seq - 1 && ms !== null) counted.set(seq, ms)
      cursor = seq
    }
    const want = made.expected(counted)
    const machines = new Map<string, Expected[]>()
    for (const one of want.values()) machines.set(one.machine, [...(machines.get(one.machine) ?? []), one])
    for (const [machine, list] of machines) {
      const limit = random.int(1, L.pageMost)
      for (const order of ['newest', 'oldest'] as const) {
        const { seen, total } = pages(Runs, self, machine, order, limit, list.length)
        const order1 = (order === 'newest' ? [...list].reverse() : list).map((one) => one.seq)
        if (total !== list.length) fail('runs listed', machine + ' counts ' + total + ' commands, expected ' + list.length)
        if (seen.map((one) => one['seq']).join() !== order1.join())
          fail('runs listed', machine + ' paged ' + order + ' by ' + limit + ' as ' + seen.map((one) => one['seq']).join() + ', expected ' + order1.join())
        for (const one of seen) {
          const spec = want.get(Number(one['seq']))
          if (!spec) continue
          const off = same(one, spec, [...fields, 'event'])
          if (off) fail('runs listed', machine + ' command ' + spec.seq + ' listed with ' + off)
        }
      }
      const picked = list.filter(() => random.chance(0.5)).map((one) => one.seq)
      for (const one of Runs.opened(self, machine, picked)) {
        const spec = want.get(one.seq)
        const out = spec?.output ? entries[spec.output - 1] : undefined
        const read = out ? (out.detail ?? out.text) : null
        if (!spec || one.output !== read || one.event !== spec.event || one.call !== entries[one.seq - 1]!.event)
          fail('runs listed', 'opened ' + one.seq + ' with output ' + String(one.output).slice(0, 60) + ' event ' + one.event + ' call ' + one.call)
      }
    }
    for (const machine of Runs.counted(self, Fleet.folded(entries, []))) {
      const list = machines.get(machine.name) ?? []
      const failed = list.filter((one) => one.failed).length
      if (machine.runs?.count !== list.length || machine.runs.failed !== failed)
        fail('runs listed', machine.name + ' counted ' + JSON.stringify(machine.runs) + ', expected ' + list.length + ' with ' + failed + ' failed')
      const ids = made.sandboxes.filter((box) => box.name === machine.name).map((box) => box.id)
      if (ids.length && [...machine.sandboxes].sort().join() !== ids.sort().join())
        fail('runs listed', machine.name + ' names sandboxes ' + machine.sandboxes.join() + ', expected ' + ids.join())
    }
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT seq FROM runs WHERE machine = ? AND seq < ? ORDER BY seq DESC LIMIT 10').all('m', 99) as {
      detail: string
    }[]
    if (!plan.some((step) => /USING (COVERING )?INDEX runs_machine/.test(step.detail))) fail('index used', 'paging runs scans: ' + JSON.stringify(plan))

    const again = storage(Runs)
    for (const item of entries) again.insert(item)
    again.kv.set('runs:cursor', entries.length)
    again.kv.set('runs:tracker', Fleet.tracker())
    const old = random.pick([undefined, 1])
    if (old !== undefined) again.kv.set('runs:v', old)
    for (const [machine, list] of machines) {
      const { seen } = pages(Runs, again.self, machine, 'oldest', list.length + 1, 1)
      const gotSeqs = seen.map((one) => one['seq']).join()
      if (gotSeqs !== list.map((one) => one.seq).join())
        fail('tracked again', machine + ' read ' + gotSeqs + ' under a tracker of version ' + String(old) + ', expected ' + list.map((one) => one.seq).join())
    }
    if (again.kv.get('runs:v') === old) fail('tracked again', 'the tracker version stayed ' + String(old))

    const letters = 'abcdef0123 '
    const text = () => Array.from({ length: random.int(1, 8) }, () => random.pick([...letters])).join('')
    for (let n = 0; n < L.readables; n++) {
      steps += 1
      const stdout = random.chance(0.8) ? text() + (random.chance(0.5) ? '\n' : '') : undefined
      const stderr = random.chance(0.4) ? text() + '\n' : stdout === undefined || random.chance(0.3) ? '' : undefined
      const body = { exitCode: random.int(0, 1), ...(stdout === undefined ? {} : { stdout }), ...(stderr === undefined ? {} : { stderr }) }
      const want =
        [stdout === undefined ? '' : stdout.replace(/\n$/, ''), stderr ? 'stderr:\n' + stderr.replace(/\n$/, '') : ''].filter(Boolean).join('\n') ||
        'No output.'
      let wrapped = JSON.stringify(body)
      for (let k = random.int(1, L.wraps); k > 0; k--) {
        const form = random.int(0, 2)
        wrapped =
          form === 0
            ? JSON.stringify([{ text: wrapped, type: 'text' }])
            : form === 1
              ? JSON.stringify({ content: [{ text: wrapped, type: 'text' }] })
              : JSON.stringify({ text: wrapped })
      }
      const got = Fleet.readable(wrapped)
      if (got !== want) fail('readable', JSON.stringify(wrapped).slice(0, 120) + ' read as ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want))
      const other = JSON.stringify({ path: '/w/' + text().trim() + '.py', size: random.int(0, 99) })
      if (Fleet.readable(said(JSON.parse(other) as object)) !== other) fail('readable', 'a non-compute output did not read as it came')
      const cut = wrapped.slice(0, random.int(1, wrapped.length - 1))
      if (Fleet.readable(cut) !== cut && JSON.stringify(Fleet.readable(cut)) !== JSON.stringify(cut))
        fail('readable', 'a cut output read as ' + Fleet.readable(cut))
    }

    const Limits = await import('../../src/shared/Limits.ts')
    const at = limits.start
    Date.now = () => at
    const ended = random.chance(0.5)
    const base = ended ? at - Limits.Runs.graceMs - random.int(2, L.msMost) : at - random.int(1, L.msMost)
    const name = 'gpu-' + random.int(1, L.sandboxes)
    const id = 'sb-' + random.int(1000, 9999)
    const log = '/tmp/gateway/run' + random.int(0, 9) + '.log'
    const line = 'epoch ' + random.int(1, 99)
    const chunk = 'step ' + random.int(1, 99) + '\n'
    const life = storage(Runs)
    const items = [
      ['machine', 'Starting machine ' + name + ' (pytorch)', JSON.stringify({ attach: name })],
      ['output', 'compute_create output', created(id)],
      ['tool', 'Called compute_spawn', exec(id, 'python train.py')],
      ['output', 'compute_spawn output', said({ logPath: log, pid: random.int(2, 99) })],
      ...(ended ? [['machine', 'Shutting down a machine', JSON.stringify({ sandboxId: id })]] : []),
    ] as const
    items.forEach(([kind, text, detail], n) => life.insert({ at: base + n, detail, event: n + 1 + L.eventBase, kind, seq: n + 1, text, who: null } as Entry))
    let fetched = 0
    Object.assign(life.self as object, {
      env: {
        GATEWAY: {
          fetch: async (request: Request) => {
            fetched += 1
            return new URL(request.url).pathname === '/v1/compute/output'
              ? Response.json({ before: null, entries: [{ at, stream: 'stdout', text: line }], sandboxId: id })
              : new Response(JSON.stringify({ data: chunk, offset: chunk.length, type: 'log' }) + '\n')
          },
        },
        GATEWAY_URL: 'https://gateway.test',
        SWARMS_GATEWAY_KEY: 'test',
      },
    })
    const rows = life.db.prepare('SELECT seq, at, kind, text, detail, who, event FROM feed ORDER BY seq').all() as unknown as Entry[]
    const machine = Runs.counted(life.self, Fleet.folded(rows, [])).find((found) => found.name === name)
    life.kv.set('log:' + id, { checked: 0, complete: true, newest: null, older: null })
    life.kv.set('job:3', { checked: 0, done: true, exit: null, offset: 0 })
    const logs = await Runs.logs(life.self, 'abc123abc123', machine, name, { limit: L.pageMost })
    const job = await Runs.job(life.self, 'abc123abc123', machine, name, 3)
    const wantLines = ended ? [] : [line]
    if (logs.complete !== ended || logs.lines.map((one) => one.text).join() !== wantLines.join())
      fail(
        'log reread',
        (ended ? 'an ended' : 'a running') +
          ' machine read its kept log as complete=' +
          logs.complete +
          ' lines ' +
          JSON.stringify(logs.lines.map((one) => one.text)),
      )
    if (job?.done !== ended || job.data !== (ended ? '' : chunk))
      fail('log reread', (ended ? 'an ended' : 'a running') + ' machine read its kept job as ' + JSON.stringify(job))
    if (ended && fetched) fail('log reread', 'an ended machine asked the gateway ' + fetched + ' times')
  } catch (error) {
    fail('finished', String((error as Error)?.stack ?? error).slice(0, 300))
  } finally {
    Date.now = now
    restore()
  }
  return { steps, violations }
}

const tree = {
  amountMost: 9_000_000,
  bare: 2,
  dependents: 2,
  extraMost: 4_000_000,
  gapParts: 2,
  lateRounds: 3,
  lagOver: 3,
  lagTold: 0.25,
  lemmas: 4,
  orphans: 3,
  quietMost: 4,
  quietLeast: 2,
  reposts: 4,
  rotateOver: 3,
  topups: 3,
  untilMs: 4000,
}

const nodeMutants = {
  adopt: false,
  final: false,
  inherit: false,
  late: false,
  orphan: false,
  quiet: false,
  rest: false,
  rotate: false,
  schema: false,
  step: false,
  stray: false,
  told: false,
}

function nodeMutant(key: keyof typeof nodeMutants) {
  return () => {
    nodeMutants[key] = true
    return () => void (nodeMutants[key] = false)
  }
}

function seeded(random: Rng) {
  const saved = { random: Math.random, uuid: crypto.randomUUID.bind(crypto) }
  Math.random = () => random.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => random.int(0, 15).toString(16)).join('')
    return (hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32)) as ReturnType<
      Crypto['randomUUID']
    >
  }
  return () => {
    Math.random = saved.random
    crypto.randomUUID = saved.uuid
  }
}

type Tree = {
  D: typeof import('../dispatch.ts')
  Flow: typeof import('../../src/worker/Flow.ts')
  Memo: typeof import('../../src/shared/Memo.ts')
  Nodes: typeof import('../../src/worker/Nodes.ts')
  Runner: typeof import('../../src/worker/Runner.ts')
  fail: (invariant: string, detail: string) => void
  g: ReturnType<typeof import('../dispatch.ts').gateway>
  hash: () => string
  random: Rng
  waited: (check: () => boolean | Promise<boolean>) => Promise<boolean>
  w: Awaited<ReturnType<typeof import('../dispatch.ts').planted>>
}

async function planted(seed: string, name: string, body: (t: Tree) => Promise<number>): Promise<Outcome> {
  const random = rng(seed, name)
  const { fail, violations } = recorder()
  const unseed = seeded(rng(seed, name, 'ids'))
  await import('../run.ts')
  const D = await import('../dispatch.ts')
  const Flow = await import('../../src/worker/Flow.ts')
  const Memo = await import('../../src/shared/Memo.ts')
  const Nodes = await import('../../src/worker/Nodes.ts')
  const Runner = await import('../../src/worker/Runner.ts')
  const was = { nodes: { ...Nodes.guards }, required: [...((Runner.output as { required?: string[] }).required ?? [])], runner: { ...Runner.guards } }
  for (const key of ['inherit', 'orphan', 'quiet', 'step', 'told'] as const) Nodes.guards[key] = !nodeMutants[key]
  for (const key of ['adopt', 'final', 'late', 'rest', 'rotate', 'stray'] as const) Runner.guards[key] = !nodeMutants[key]
  const required = (Runner.output as { required?: string[] }).required
  if (nodeMutants.schema && required) required.splice(required.indexOf('outcome'), 1)
  const g = D.gateway()
  const w = await D.planted(g.route as never)
  const hash = () => '0x' + Array.from({ length: 64 }, () => random.int(0, 15).toString(16)).join('')
  const waited = (check: () => boolean | Promise<boolean>) =>
    D.until(check, tree.untilMs).then(
      () => true,
      () => false,
    )
  let steps = 0
  try {
    steps = await body({ D, Flow, Memo, Nodes, Runner, fail, g, hash, random, w, waited })
  } catch (error) {
    fail('finished', String((error as Error)?.stack ?? error).slice(0, 300))
  } finally {
    await Runner.stop(w.swarm)
    w.restore()
    Object.assign(Nodes.guards, was.nodes)
    Object.assign(Runner.guards, was.runner)
    if (required) required.splice(0, required.length, ...was.required)
    unseed()
  }
  return { steps, violations }
}

async function program(t: Tree) {
  const made = await t.Nodes.post(t.w.swarm, { by: 'seed', form: 'program', needs: [], parent: 'root', statement: null, title: 'Lower bounds', words: '' })
  t.Nodes.weigh(t.w.swarm, made.nid, 1)
  return made.nid
}

function shuffled<T>(random: Rng, items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = random.int(0, i)
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}

const flow = (seed: string) =>
  planted(seed, 'mf-nodes.flow', async (t) => {
    const { D, Flow, Memo, Nodes, random, w } = t
    const p = await program(t)
    const step = Memo.units(Nodes.defaults.runStep)
    const k = random.int(1, tree.lemmas)
    const plan = shuffled(random, [
      ...Array.from({ length: k }, (_, n) => ({ by: 'agent:n:' + p, title: 'Lemma ' + n })),
      ...Array.from({ length: random.int(0, tree.bare) }, (_, n) => ({ by: random.pick([D.bo, D.ana]), title: 'Proposal ' + n })),
    ])
    const lemmas: string[] = []
    const others: string[] = []
    for (const one of plan) {
      const made = await Nodes.post(w.swarm, { by: one.by, form: 'lemma', needs: [], parent: p, statement: 'True', title: one.title, words: '' })
      ;(one.by.startsWith('agent:') ? lemmas : others).push(made.nid)
    }
    for (let n = random.int(0, tree.dependents); n > 0; n--) {
      const made = await Nodes.post(w.swarm, {
        by: 'agent:n:' + p,
        form: 'lemma',
        needs: [random.pick(lemmas)],
        parent: p,
        statement: 'True',
        title: 'After ' + n,
        words: '',
      })
      others.push(made.nid)
    }
    const extra = BigInt(random.int(0, tree.extraMost))
    const amount = step * BigInt(k) + extra
    await w.swarm.treePledge(D.id, { amount: Memo.decimal(amount), contributor: random.pick([D.ana, D.bo]), hash: t.hash(), nid: p })
    if (!(await t.waited(() => t.g.subs.length >= k))) t.fail('flow', 'only ' + t.g.subs.length + ' of ' + k + ' lemmas started')
    const got = t.g.subs.map((sub) => sub.role + '=' + sub.budget_usd).sort()
    const want = lemmas.map((nid) => 'n:' + nid + '#1=' + Flow.number(step)).sort()
    if (got.join() !== want.join())
      t.fail('flow', 'a pledge of ' + Memo.decimal(amount) + ' over ' + k + ' lemmas started ' + got.join() + ', expected ' + want.join())
    const ledger = Flow.fold(await Flow.rows(w.env, D.id))
    for (const nid of others)
      if ((ledger.inherited.get(nid) ?? 0n) !== 0n)
        t.fail('flow', nid + ' inherited ' + Memo.decimal(ledger.inherited.get(nid) ?? 0n) + ' without being runnable')
    if ((ledger.left.get(p) ?? 0n) !== extra) t.fail('flow', 'the program kept ' + Memo.decimal(ledger.left.get(p) ?? 0n) + ', expected ' + Memo.decimal(extra))
    return k + others.length
  })

const reconciled = (seed: string) =>
  planted(seed, 'mf-nodes.reconcile', async (t) => {
    const { D, Flow, Memo, Nodes, random, w } = t
    const p = await program(t)
    const least = Memo.units(Nodes.defaults.runMin)
    const pledged = BigInt(random.int(Number(least) * 2, tree.amountMost))
    const committed = BigInt(random.int(Number(least), Number(pledged)))
    const who = random.pick([D.ana, D.bo])
    await Flow.write(w.env, { from: null, id: t.hash(), kind: 'pledge', parts: [[who, pledged]], swarm: D.id, to: { node: p, run: null } })
    await Flow.write(w.env, {
      from: { node: p, run: null },
      id: 'commit:' + p + ':1',
      kind: 'commit',
      parts: [[who, committed]],
      swarm: D.id,
      to: { node: p, run: 'r:' + p + ':1' },
    })
    const orphans = [...new Set(Array.from({ length: random.int(1, tree.orphans) }, () => 'r:root:' + random.int(2, 9)))]
    for (const orphan of orphans) await w.swarm.board.post({ id: orphan, labels: { kind: 'run', node: 'root' }, parent: 'n:root', spec: 'run of root' })
    const ended = await Nodes.post(w.swarm, { by: D.bo, form: 'idea', needs: [], parent: random.pick(['root', p]), statement: null, title: 'Gone', words: '' })
    const gone = BigInt(random.int(1, tree.amountMost))
    await Flow.write(w.env, {
      from: null,
      id: t.hash(),
      kind: 'pledge',
      parts: [[random.pick([D.ana, D.bo]), gone]],
      swarm: D.id,
      to: { node: ended.nid, run: null },
    })
    await w.swarm.board.cancel('n:' + ended.nid, JSON.stringify({ at: 1, check: null, into: null, kind: 'withdrawn', why: 'x' }))
    await w.ring()
    for (const orphan of orphans) {
      const reason = (await w.swarm.board.task(orphan))?.reason
      if (reason !== 'orphan') t.fail('reconciled', orphan + ' has no money and was left with reason ' + String(reason))
    }
    if (!(await t.waited(() => t.g.subs.some((sub) => sub.role === 'n:' + p + '#1'))))
      t.fail('reconciled', 'the committed run of ' + p + ' was never posted and started')
    const ledger = Flow.fold(await Flow.rows(w.env, D.id))
    if ((ledger.left.get(ended.nid) ?? 0n) !== 0n || ledger.left.get(Flow.free) !== gone)
      t.fail(
        'reconciled',
        'the ended node kept ' +
          Memo.decimal(ledger.left.get(ended.nid) ?? 0n) +
          ' and the pool holds ' +
          Memo.decimal(ledger.left.get(Flow.free) ?? 0n) +
          ', expected ' +
          Memo.decimal(gone),
      )
    return orphans.length
  })

const refused = (seed: string) =>
  planted(seed, 'mf-nodes.refusal', async (t) => {
    const { D, Flow, Memo, Nodes, Runner, g, random, w } = t
    const amount = BigInt(random.int(Number(Memo.units(Nodes.defaults.runMin)), Number(Memo.units(Nodes.defaults.runStep))))
    g.state.refuse = true
    await w.swarm.treePledge(D.id, { amount: Memo.decimal(amount), contributor: random.pick([D.ana, D.bo]), hash: t.hash(), nid: null })
    if (!(await t.waited(() => w.swarm.kv.get<number>('rest:r:root:1') !== undefined))) t.fail('refusal rests', 'a refused run never rested')
    const rest = w.swarm.kv.get<number>('rest:r:root:1') ?? 0
    const task = await w.swarm.board.task('r:root:1')
    if (rest <= Date.now() || task?.phase !== 'open' || task.attempts !== 1 || g.subs.length)
      t.fail(
        'refusal rests',
        'after a refusal the run rests until +' +
          (rest - Date.now()) +
          'ms in phase ' +
          task?.phase +
          ' after ' +
          task?.attempts +
          ' attempts with ' +
          g.subs.length +
          ' subagents',
      )
    g.state.refuse = false
    g.make({ budget_usd: random.int(1, tree.lemmas), role: 'n:root#1', task: 'adopted' })
    w.swarm.kv.delete('rest:r:root:1')
    Runner.ensure(w.swarm)
    const budgeted = await t.waited(() => g.budgets.length >= 1 || g.subs.length > 1)
    if (!budgeted || g.subs.length !== 1 || g.prompts.length || g.budgets[0]?.join() !== [1, Flow.number(amount)].join())
      t.fail('adopted by role', 'the paid run left ' + g.subs.length + ' subagents, ' + g.prompts.length + ' prompts and budgets ' + JSON.stringify(g.budgets))
    return 2
  })

const topped = (seed: string) =>
  planted(seed, 'mf-nodes.topup', async (t) => {
    const { D, Flow, Memo, Nodes, Runner, g, random, w } = t
    const step = Memo.units(Nodes.defaults.runStep)
    const stray = g.make({ budget_usd: 1, role: 'n:' + random.int(1, 9) + 'bcdefabcd#' + random.int(1, 9), task: 'nobody asked' })
    const n = random.int(1, tree.topups)
    const extra = BigInt(random.int(1, Number(step) - 1))
    await w.swarm.treePledge(D.id, { amount: Memo.decimal(step * BigInt(n + 1) + extra), contributor: random.pick([D.ana, D.bo]), hash: t.hash(), nid: null })
    await t.waited(() => g.spawned.length >= 1)
    if (!(g.spawned[0]?.['output_schema'] as { required?: string[] } | undefined)?.required?.includes('outcome'))
      t.fail('output schema', 'the spawn sent ' + JSON.stringify(g.spawned[0]?.['output_schema']).slice(0, 160))
    const run = g.subs.find((sub) => sub.role === 'n:root#1')
    if (!run) throw new Error('the run never started')
    let total = step
    let spent = 0n
    for (let i = 0; i < n; i++) {
      spent = total - BigInt(random.int(0, Number(step / BigInt(tree.gapParts))))
      run.spent_usd = Flow.number(spent)
      Runner.wake(w.swarm)
      total += step
      if (!(await t.waited(() => run.budget_usd === Flow.number(total))))
        t.fail('top-up step', 'after spending ' + Memo.decimal(spent) + ' the bound is ' + run.budget_usd + ', expected ' + Flow.number(total))
    }
    if (!(await t.waited(() => stray.status.state === 'closed'))) t.fail('strays closed', 'a subagent no run asked for stays ' + stray.status.state)
    const view = await w.swarm.treeRead(D.id, { depth: 0, root: 'root', status: undefined })
    const money = view.ok ? view.value.nodes[0]?.money : undefined
    if (money?.left !== Memo.decimal(extra) || money.committed !== Memo.decimal(total - spent))
      t.fail(
        'top-up step',
        'the root shows left ' + money?.left + ' committed ' + money?.committed + ', expected ' + Memo.decimal(extra) + ' and ' + Memo.decimal(total - spent),
      )
    return n
  })

const rotated = (seed: string) =>
  planted(seed, 'mf-nodes.rotate', async (t) => {
    const { D, Memo, Nodes, Runner, g, random, w } = t
    const rotate = random.chance(0.5)
    const runs = rotate ? Runner.rotateAfter + random.int(0, tree.rotateOver) : random.int(0, Runner.rotateAfter - 1)
    w.swarm.kv.put('dispatcher', { at: 0, id: 'agt_d0', runs })
    await w.swarm.treePledge(D.id, { amount: Nodes.defaults.runMin, contributor: random.pick([D.ana, D.bo]), hash: t.hash(), nid: null })
    await t.waited(() => g.subs.length >= 1)
    const kept = w.swarm.kv.get<{ id: string; runs: number }>('dispatcher')
    const want = rotate ? { id: 'agt_d1', runs: 1 } : { id: 'agt_d0', runs: runs + 1 }
    if (kept?.id !== want.id || kept.runs !== want.runs)
      t.fail(
        'rotated',
        'after ' + runs + ' runs the dispatcher is ' + JSON.stringify(kept) + ', expected ' + JSON.stringify(want) + ' (' + Memo.decimal(0n) + ')',
      )
    return runs
  })

const charged = (seed: string) =>
  planted(seed, 'mf-nodes.late', async (t) => {
    const { D, Flow, Memo, Nodes, Runner, g, random, w } = t
    const step = Memo.units(Nodes.defaults.runStep)
    const amount = step + BigInt(random.int(Number(step), tree.amountMost))
    await w.swarm.treePledge(D.id, { amount: Memo.decimal(amount), contributor: random.pick([D.ana, D.bo]), hash: t.hash(), nid: null })
    await t.waited(() => g.subs.length >= 1)
    const run = g.subs[0]
    if (!run) throw new Error('the run never started')
    let spent = BigInt(random.int(1, Number(step) - 1))
    run.spent_usd = Flow.number(spent)
    run.status = { output: { children: [], commit: null, outcome: 'progress', summary: 'Some way in', theorem: null, why: null }, state: 'completed' }
    Runner.wake(w.swarm)
    await t.waited(async () => (await w.swarm.board.task('s:r:root:1'))?.phase === 'done')
    const rounds = random.int(1, tree.lateRounds)
    for (let i = 0; i < rounds; i++) {
      if (random.chance(0.7)) spent += BigInt(random.int(1, tree.extraMost / tree.lemmas))
      run.spent_usd = Flow.number(spent)
      for (let n = random.int(1, 2); n > 0; n--) await Runner.late(w.swarm)
      const now = Flow.fold(await Flow.rows(w.env, D.id)).spent.get('root') ?? 0n
      const { results } = await w.env.DB.prepare(
        "select coalesce(-sum(amount), 0) as amount from flows where swarm = ?1 and kind = 'spend' and node = 'root' and run is not null and run != 'r:root:1' and id not like ?1 || ':late:r:root:1:%'",
      )
        .bind(D.id)
        .all<{ amount: number }>()
      const theirs = BigInt(results[0]?.amount ?? 0)
      if (now - theirs !== spent) t.fail('late once', 'round ' + i + ' charged root ' + Memo.decimal(now) + ' for a run that spent ' + Memo.decimal(spent))
    }
    return rounds
  })

const lagged = (seed: string) =>
  planted(seed, 'mf-nodes.lag', async (t) => {
    const { D, Flow, Memo, Nodes, Runner, g, random, w } = t
    const step = Memo.units(Nodes.defaults.runStep)
    await w.swarm.treePledge(D.id, { amount: Memo.decimal(step), contributor: random.pick([D.ana, D.bo]), hash: t.hash(), nid: null })
    await t.waited(() => g.subs.length >= 1)
    const run = g.subs[0]
    if (!run) throw new Error('the run never started')
    const seen = BigInt(random.int(0, Number(step) / 2))
    run.spent_usd = Flow.number(seen)
    Runner.wake(w.swarm)
    if (!(await t.waited(() => w.swarm.kv.get<{ spent: string }>('live:r:root:1')?.spent === Flow.usd(seen))))
      throw new Error('live never showed ' + Flow.usd(seen) + ': ' + JSON.stringify(w.swarm.kv.get('live:r:root:1')))
    g.subs.splice(g.subs.indexOf(run), 1)
    const spent = seen + BigInt(random.int(1, Number(step - seen)))
    run.spent_usd = Flow.number(spent)
    run.status = { output: { children: [], commit: null, outcome: 'progress', summary: 'Some way in', theorem: null, why: null }, state: 'completed' }
    Runner.wake(w.swarm)
    if (!(await t.waited(() => w.swarm.kv.get('charged:r:root:1') !== undefined))) throw new Error('the hidden run never settled')
    const real = Date.now
    let ahead = 0
    Date.now = () => real() + ahead
    try {
      const told = random.chance(tree.lagTold)
      const rounds = random.int(1, tree.lagOver)
      for (let i = 0; i < rounds; i++) {
        ahead += Runner.lateMs + random.int(1, Runner.lateMs)
        await Runner.late(w.swarm)
      }
      if (told) {
        ahead += Runner.lateMostMs
        await Runner.late(w.swarm)
        const said = w.swarm.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM tree_deltas WHERE text LIKE '%r:root:1%is not booked.'").one().n
        if (Number(said) !== 1 || w.swarm.kv.get('charged:r:root:1') !== undefined)
          t.fail(
            'unbooked told',
            'a run the gateway hid past ' +
              Runner.lateMostMs +
              ' ms was told ' +
              said +
              ' times and is ' +
              (w.swarm.kv.get('charged:r:root:1') ? 'still tracked' : 'dropped'),
          )
        return rounds
      }
      g.subs.unshift(run)
      for (let n = random.int(1, 2); n > 0; n--) await Runner.late(w.swarm)
      const booked = Flow.fold(await Flow.rows(w.env, D.id)).spent.get('root') ?? 0n
      const { results } = await w.env.DB.prepare(
        "select coalesce(-sum(amount), 0) as amount from flows where swarm = ?1 and kind = 'spend' and node = 'root' and run is not null and run != 'r:root:1' and id not like ?1 || ':late:r:root:1:%'",
      )
        .bind(D.id)
        .all<{ amount: number }>()
      const drift = booked - BigInt(results[0]?.amount ?? 0) - spent
      if (drift !== 0n)
        t.fail(
          'ledger drift',
          'after the list hid the run ' +
            rounds +
            ' sweeps past ' +
            Runner.lateMs +
            ' ms, the ledger is ' +
            Memo.decimal(drift) +
            ' off the ' +
            Memo.decimal(spent) +
            ' the gateway charged',
        )
      ahead += Runner.lateMs + 1
      await Runner.late(w.swarm)
      if (w.swarm.kv.get('charged:r:root:1') !== undefined)
        t.fail('ledger drift', 'a run the gateway showed ended is still tracked past ' + Runner.lateMs + ' ms')
      return rounds
    } finally {
      Date.now = real
    }
  })

const quieted = (seed: string) =>
  planted(seed, 'mf-nodes.quiet', async (t) => {
    const { D, Nodes, g, random, w } = t
    const Triage = await import('../../src/worker/Triage.ts')
    const cap = random.int(tree.quietLeast, tree.quietMost)
    w.swarm.kv.put('tree', { ...Nodes.defaults, quietRuns: cap })
    const result = (outcome: import('../../src/worker/Nodes.ts').Result['outcome'], children: import('../../src/worker/Nodes.ts').Result['children'] = []) => ({
      children,
      commit: null,
      outcome,
      summary: outcome,
      theorem: null,
      why: null,
    })
    const verify = async () => undefined
    const made: string[] = []
    let steps = 0
    for (const title of ['A', 'B']) {
      const nid = (await Nodes.post(w.swarm, { by: 'agent:n:root', form: 'lemma', needs: [], parent: 'root', statement: null, title, words: '' })).nid
      made.push(nid)
      let quiet = 0
      let stuck = 0
      let k = 0
      let halves = 0
      while (quiet < cap) {
        k += 1
        steps += 1
        const kind = random.pick(['progress', 'progress', 'stuck', 'split', 'again'] as const)
        if (kind === 'split') {
          halves += 1
          await Nodes.ran(
            w.swarm,
            Nodes.runId(nid, k),
            result('split', [{ needs: [], spec: 'Half.', statement: null, title: 'Half ' + halves + ' of ' + title }]),
            verify,
          )
          quiet = 0
        } else if (kind === 'again' && halves) {
          await Nodes.ran(
            w.swarm,
            Nodes.runId(nid, k),
            result('split', [{ needs: [], spec: 'Half.', statement: null, title: 'Half ' + halves + ' of ' + title }]),
            verify,
          )
          quiet += 1
        } else {
          const outcome = kind === 'stuck' && stuck < Nodes.stuckRuns - 1 ? 'stuck' : 'progress'
          if (outcome === 'stuck') stuck += 1
          await Nodes.ran(w.swarm, Nodes.runId(nid, k), result(outcome), verify)
          quiet += 1
        }
        const paused = Nodes.paused(w.swarm, nid)
        const want = quiet >= cap ? quiet : null
        if (paused !== want)
          t.fail('quiet pause', title + ' after run ' + k + ' (' + kind + ') shows paused ' + paused + ', expected ' + want + ' under a cap of ' + cap)
      }
      for (let n = 1; n <= halves; n++)
        await w.swarm.board.cancel(
          'n:' + (await Nodes.nid(nid, 'Half ' + n + ' of ' + title)),
          JSON.stringify({ at: 1, check: null, into: null, kind: 'withdrawn', why: 'x' }),
        )
    }
    const [a, b] = made as [string, string]
    if ((await Nodes.view(w.swarm)).nodes.get(a)?.paused !== Nodes.paused(w.swarm, a)) t.fail('quiet pause', 'the view shows a different pause from the count')
    await w.swarm.treePledge(D.id, { amount: Nodes.defaults.runStep, contributor: D.ana, hash: t.hash(), nid: null })
    await w.ring()
    if (g.subs.some((sub) => sub.role.startsWith('n:' + a) || sub.role.startsWith('n:' + b)) || (await Nodes.start(w.swarm, await Nodes.state(w.swarm), a)))
      t.fail('quiet pause', 'a paused node started a run')
    const applied = await Triage.apply(w.swarm, [{ amount: Nodes.defaults.ideaMin, kind: 'grant', node: a }], 'agent:n:triage', 'quiet', async () => undefined)
    if (!applied.every((one) => one.ok) || Nodes.paused(w.swarm, a) !== null)
      t.fail('quiet pause', 'a triage grant left ' + a + ' paused: ' + JSON.stringify(applied))
    await w.ring()
    if (!(await t.waited(() => g.subs.some((sub) => sub.role === 'n:' + a + '#1')))) t.fail('quiet pause', 'a granted node never ran')
    await w.swarm.treePledge(D.id, { amount: Nodes.defaults.runStep, contributor: D.bo, hash: t.hash(), nid: b })
    if (Nodes.paused(w.swarm, b) !== null) t.fail('quiet pause', 'a fresh pledge left ' + b + ' paused')
    if (!(await t.waited(() => g.subs.some((sub) => sub.role === 'n:' + b + '#1')))) t.fail('quiet pause', 'a pledged node never ran')
    return steps
  })

const reposted = (seed: string) =>
  planted(seed, 'mf-nodes.repost', async (t) => {
    const { Nodes, random, w } = t
    const parent = random.chance(0.5) ? 'root' : await program(t)
    const statement = random.chance(0.7) ? random.pick(['True', 'True ∧ True', '1 = 1']) : null
    const input: Parameters<typeof Nodes.post>[1] = {
      by: random.pick(['seed', 'agent:n:' + parent]),
      form: 'lemma',
      needs: [],
      parent,
      statement,
      title: random.pick(['Again', 'Once more', 'Twice']),
      words: '',
    }
    const times = random.int(2, tree.reposts)
    let dropped = false
    const made: { created: boolean; nid: string }[] = []
    for (let n = 0; n < times; n++) {
      const one = await Nodes.post(w.swarm, input)
      made.push(one)
      if (random.chance(0.5)) {
        w.swarm.kv.delete('statement:' + one.nid)
        dropped = true
      }
    }
    const nid = made[0]!.nid
    if (made.some((one, n) => one.created !== (n === 0) || one.nid !== nid))
      t.fail('repost once', 'posting ' + times + ' times answered ' + JSON.stringify(made))
    const told = Number(w.swarm.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM tree_deltas WHERE node = ? AND event = 'posted'", nid).one().n)
    if (told !== 1) t.fail('repost once', 'the node was told posted ' + told + ' times')
    const queued = w.swarm.kv.get('statement:' + nid)
    if (queued !== (dropped || statement === null ? undefined : statement)) t.fail('repost once', 'its statement is queued as ' + JSON.stringify(queued))
    return times
  })

const apiLimits = { amountMost: 3_000_000, amountLeast: 100_000, lemmas: 4, rides: 4, skewMost: 50_000, suggestExtra: 2 }

const apiMutants = { covered: false, drift: false, limit: false, owner: false, reviewed: false, setup: false, tag: false }

function apiMutant(key: keyof typeof apiMutants) {
  return () => {
    apiMutants[key] = true
    return () => void (apiMutants[key] = false)
  }
}

async function api(seed: string): Promise<Outcome> {
  const random = rng(seed, 'mf-nodes.api')
  const { fail, violations } = recorder()
  const unseed = seeded(rng(seed, 'mf-nodes.api', 'ids'))
  const { world } = await import('../run.ts')
  const D = await import('../dispatch.ts')
  const Credit = await import('../../src/shared/Credit.ts')
  const Setup = await import('../../src/shared/Setup.ts')
  const Memo = await import('../../src/shared/Memo.ts')
  const Limits = await import('../../src/shared/Limits.ts')
  const Flow = await import('../../src/worker/Flow.ts')
  const Operations = await import('../../src/worker/Operations.ts')
  const Riding = await import('../../src/worker/Riding.ts')
  const Runner = await import('../../src/worker/Runner.ts')
  const Store = await import('../../src/worker/Store.ts')
  const was = { covered: Flow.guards.covered, drift: Riding.guards.drift, operations: { ...Operations.guards } }
  for (const key of ['limit', 'owner', 'reviewed', 'setup', 'tag'] as const) Operations.guards[key] = !apiMutants[key]
  Riding.guards.drift = !apiMutants.drift
  Flow.guards.covered = !apiMutants.covered
  const owner = '0x00000000000000000000000000000000000000ee'
  const ana = D.ana as `0x${string}`
  const bo = D.bo as `0x${string}`
  const deposits = new Map<string, { amount: string; from: string; tag: string }>()
  const skew = random.chance(0.5) ? BigInt(random.int(1, apiLimits.skewMost)) : 0n
  const total = () => [...deposits.values()].reduce((sum, one) => sum + Memo.units(one.amount), 0n)
  const w = world((async (request: Request, url: URL) => {
    if (url.pathname === '/v1/models')
      return Response.json({
        data: [Setup.flash, Setup.glmFlash, Setup.fable, Setup.sol, 'vercel/google/gemini-3.8-flash'].map((id) => ({
          id,
          kind: 'generate',
          pricing: { cached: 0.01, input: 0.1, output: 0.4 },
        })),
      })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: owner })
    if (url.pathname === '/api/keys/credit' && request.method === 'POST') {
      const { hash } = (await request.json()) as { hash: string }
      const found = deposits.get(hash)
      if (!found) return Response.json({ error: 'no receipt' }, { status: 404 })
      return Response.json({
        created: true,
        credit: { deposited: found.amount, left: found.amount, spent: '0' },
        deposits: [{ ...found, log: 0, token: 'pathusd' }],
      })
    }
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: Memo.decimal(total()), left: Memo.decimal(total() + skew), spent: '0' })
    if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' })
    if (url.pathname.startsWith('/v1/agents/agt_d'))
      return Response.json(url.pathname.endsWith('/subagents') ? { agents: [] } : { request_id: 'x', status: 'queued' })
    return undefined
  }) as never)
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
  D.github(w.env)
  let steps = 0
  const hash = () => '0x' + Array.from({ length: 64 }, () => random.int(0, 15).toString(16)).join('')
  const amount = () => Memo.decimal(BigInt(random.int(apiLimits.amountLeast, apiLimits.amountMost)))
  try {
    const n = random.int(1, apiLimits.lemmas)
    const statements = ['True', 'True ∧ True', '1 = 1']
    const lemmas = Array.from({ length: n }, (_, i) => ({
      form: 'lemma' as const,
      key: 'l' + i,
      needs: i > 0 && random.chance(0.5) ? ['l' + random.int(0, i - 1)] : [],
      parent: 'lower',
      statement: random.pick(statements),
      title: 'Lemma ' + i,
    }))
    const reviewed = random.chance(0.5)
    const made = await Operations.create(
      w.env,
      {
        form: 'tree',
        goal: 'Settle whether P equals NP, checked in Lean.',
        reviewed,
        seed: [{ form: 'program', key: 'lower', title: 'Lower bounds' }, ...lemmas],
        statement: 'P = NP ∨ P ≠ NP',
        template: 'cheap',
        title: 'P vs NP',
      },
      ana,
    )
    if (!made.ok) throw new Error(JSON.stringify(made))
    const id = made.value.id
    const shown = await Operations.tree(w.env, { swarm: id })
    if (!shown.ok) throw new Error(JSON.stringify(shown))
    const byTitle = new Map(shown.value.nodes.map((node) => [node.title, node]))
    const titles = shown.value.nodes.map((node) => node.title).sort()
    const wantTitles = ['Lower bounds', 'P vs NP', 'Triage', ...lemmas.map((one) => one.title)].sort()
    if (titles.join() !== wantTitles.join()) fail('tree created', 'the tree holds ' + titles.join() + ', expected ' + wantTitles.join())
    const ids = new Map(lemmas.map((one) => [one.key, byTitle.get(one.title)?.id ?? '']))
    for (const one of lemmas) {
      const node = byTitle.get(one.title)
      const needs = one.needs.map((key) => ids.get(key))
      if (node?.needs.join() !== needs.join()) fail('tree created', one.title + ' needs ' + node?.needs.join() + ', expected ' + needs.join())
      if (node?.review !== !reviewed) fail('tree created', one.title + ' shows review ' + node?.review + ' for a seed created reviewed=' + reviewed)
    }
    if (byTitle.get('Lower bounds')?.review !== false) fail('tree created', 'the program shows a statement under review')
    const frontier = lemmas.filter((one) => !one.needs.length).length
    if (shown.value.headline.frontier !== frontier) fail('tree created', 'the frontier is ' + shown.value.headline.frontier + ', expected ' + frontier)
    const pick = random.pick(lemmas)
    const detail = await Operations.node(w.env, { node: ids.get(pick.key), swarm: id })
    if (!detail.ok || detail.value.review !== !reviewed || detail.value.statement !== pick.statement)
      fail('tree created', pick.title + ' reads as ' + JSON.stringify(detail).slice(0, 200))
    const listed = await Store.list(w.env)
    if (listed.map((row) => row.id + ':' + row.form).join() !== id + ':tree')
      fail('tree created', 'the list holds ' + listed.map((row) => row.id + ':' + row.form).join())
    const branches = await Operations.branches(w.env, { swarm: id })
    if (branches.ok || branches.status !== 410) fail('tree created', 'branches of a tree answered ' + JSON.stringify(branches).slice(0, 120))

    const rider = {
      harness: random.pick(['codex', 'claude'] as const),
      model: random.pick([Setup.flash, Setup.glmFlash, Setup.sol]),
      template: random.pick(['custom', 'cheap', 'fable'] as const),
    }
    const other = await Operations.create(
      w.env,
      {
        form: 'tree',
        goal: 'Settle whether P equals NP, checked in Lean.',
        ...rider,
        subagents: { harnesses: [rider.harness], models: [rider.model] },
        title: 'P vs NP again',
      },
      ana,
    )
    const chosen = other.ok ? (JSON.parse(String((await Store.find(w.env, other.value.id))?.setup)) as import('../../src/shared/Setup.ts').Setup) : undefined
    const want = { harnesses: ['claude', 'codex'], models: [Setup.fable, 'vercel/google/gemini-3.8-flash', Setup.sol] }
    if (
      !chosen ||
      chosen.template !== 'board' ||
      chosen.harness !== 'claude' ||
      chosen.model !== Setup.fable ||
      JSON.stringify(chosen.subagents) !== JSON.stringify(want)
    )
      fail('tree setup', 'a tree asked for ' + JSON.stringify(rider) + ' was set up as ' + JSON.stringify(chosen ?? other).slice(0, 200))
    const agent = await Operations.create(
      w.env,
      { goal: 'An agent swarm still checks its fields.', model: Setup.flash, template: 'cheap', title: 'Agent' },
      ana,
    )
    if (agent.ok || agent.status !== 400) fail('tree setup', 'an agent swarm with a model outside custom answered ' + JSON.stringify(agent).slice(0, 120))

    const funders = new Map<string, Map<string, bigint>>()
    const add = (node: string, who: string, value: bigint) => {
      const held = funders.get(node) ?? new Map<string, bigint>()
      held.set(who, (held.get(who) ?? 0n) + value)
      funders.set(node, held)
    }
    const nodes = ['root', ...ids.values()]
    const rides = random.int(1, apiLimits.rides)
    let boBacked = 0n
    for (let i = 0; i <= rides; i++) {
      steps += 1
      const node = random.pick(nodes)
      const wrong = i === 0 || random.chance(0.3)
      const who = random.pick([ana, bo])
      const value = amount()
      const prepared = await Operations.transfer(w.env, { amount: value, node, swarm: id, token: 'pathusd' }, 'https://swarms.test')
      const memo = Credit.memo(owner, id, node === 'root' ? null : 'n:' + node)
      if (!prepared.ok || prepared.value.memo !== memo) fail('ride tag', 'a ride on ' + node + ' was prepared as ' + JSON.stringify(prepared).slice(0, 160))
      const tx = hash()
      deposits.set(tx, { amount: value, from: who, tag: Credit.tag(id, wrong ? 'n:ffffffffff' : node === 'root' ? null : 'n:' + node) })
      const counted = await Operations.contribute(w.env, { hash: tx, node, swarm: id })
      if (!counted.ok || !counted.value.created) fail('ride tag', 'a ride on ' + node + ' was counted as ' + JSON.stringify(counted).slice(0, 160))
      if (random.chance(0.3)) {
        const again = await Operations.contribute(w.env, { hash: tx, node, swarm: id })
        if (!again.ok || again.value.created) fail('ride tag', 'a ride counted again answered ' + JSON.stringify(again).slice(0, 160))
      }
      add(wrong ? 'root' : node, who, Memo.units(value))
      if (who === bo) boBacked += Memo.units(value)
    }
    for (const node of nodes) {
      const read = await Operations.node(w.env, { node, swarm: id })
      const held = funders.get(node) ?? new Map<string, bigint>()
      if (!read.ok) {
        fail('ride tag', node + ' could not be read')
        continue
      }
      if (node === 'root') {
        const pledged = Memo.decimal([...held.values()].reduce((sum, one) => sum + one, 0n))
        if (read.value.money.pledged !== pledged) fail('ride tag', 'the root shows pledged ' + read.value.money.pledged + ', expected ' + pledged)
        continue
      }
      const got = read.value.funders.map((funder) => funder.who.address + '=' + funder.amount).sort()
      const wantFunders = [...held].map(([who, value]) => who + '=' + Memo.decimal(value)).sort()
      if (got.join() !== wantFunders.join()) fail('ride tag', node + ' is ridden by ' + got.join() + ', expected ' + wantFunders.join())
    }
    const parent = random.pick([...ids.values()])
    const proposed = await Operations.propose(
      w.env,
      { parent, spec: 'Use the switching lemma.', swarm: id, title: 'Restrictions', token: 'pathusd' },
      'https://swarms.test',
      bo,
    )
    if (!proposed.ok) fail('ride tag', 'a proposal answered ' + JSON.stringify(proposed).slice(0, 160))
    else {
      const tx = hash()
      deposits.set(tx, { amount: proposed.value.transfer.amount ?? '0', from: bo, tag: Credit.tag(id, 'n:' + proposed.value.nid) })
      await Operations.contribute(w.env, { hash: tx, node: proposed.value.nid, swarm: id })
      boBacked += Memo.units(proposed.value.transfer.amount ?? '0')
      const node = await Operations.node(w.env, { node: proposed.value.nid, swarm: id })
      if (!node.ok || node.value.by.address !== bo || node.value.parent !== parent)
        fail('ride tag', 'a ridden proposal reads as ' + JSON.stringify(node).slice(0, 160))
      const mine = await Operations.standing(w.env, { swarm: id }, bo)
      const standing = mine.ok ? Memo.units(mine.value.committed) + Memo.units(mine.value.refundable) : -1n
      if (standing !== boBacked)
        fail('ride tag', 'bo stands behind ' + Memo.decimal(standing) + ' committed and refundable, expected ' + Memo.decimal(boBacked))
    }

    const limit = Limits.Operations.ideasPerDay
    const tries = shuffled(random, [
      ...Array.from({ length: limit + random.int(1, apiLimits.suggestExtra) }, () => ana),
      ...Array.from({ length: limit + random.int(1, apiLimits.suggestExtra) }, () => bo),
    ])
    const said = new Map<string, number>()
    for (const who of tries) {
      steps += 1
      const before = said.get(who) ?? 0
      const answer = await Operations.suggest(w.env, { swarm: id, text: 'Idea number ' + steps }, who)
      if (answer.ok) said.set(who, before + 1)
      const allowed = before < limit
      if (answer.ok !== allowed || (!answer.ok && answer.status !== 429))
        fail('suggest limit', who.slice(0, 6) + "'s suggestion " + (before + 1) + ' answered ' + JSON.stringify(answer).slice(0, 120))
    }
    const root = await Operations.node(w.env, { node: 'root', swarm: id })
    if (!root.ok || root.value.suggestions.length !== limit * 2)
      fail('suggest limit', 'the root lists ' + (root.ok ? root.value.suggestions.length : '?') + ' suggestions, expected ' + limit * 2)

    const free = BigInt(random.int(apiLimits.amountLeast, apiLimits.amountMost))
    const tx = hash()
    deposits.set(tx, { amount: Memo.decimal(free), from: ana, tag: Credit.tag(id, 'n:ffffffffff') })
    await Operations.contribute(w.env, { hash: tx, swarm: id })
    const placed = await Operations.standing(w.env, { swarm: id }, ana)
    const bucket = (placed.ok ? placed.value.buckets : []).reduce<{ amount: string; node: string } | null>(
      (best, one) => (best && Memo.units(best.amount) >= Memo.units(one.amount) ? best : one),
      null,
    )
    const moving = bucket ? Memo.units(bucket.amount) / 2n : 0n
    const moved = await Operations.nodeMove(w.env, { amount: Memo.decimal(moving > 0n ? moving : free), node: bucket?.node ?? 'root', swarm: id, to: '' }, ana)
    if (moving > 0n && !moved.ok) fail('move kept', 'a rider could not move ' + Memo.decimal(moving) + ' of their own: ' + JSON.stringify(moved).slice(0, 160))
    if (moving === 0n && moved.ok)
      fail('move kept', 'a rider whose money is all committed moved ' + Memo.decimal(free) + ': ' + JSON.stringify(moved).slice(0, 160))
    const stolen = await Operations.nodeMove(
      w.env,
      { amount: Memo.decimal(BigInt(random.int(1, Number(moving > 0n ? moving : free)))), node: '', swarm: id, to: 'root' },
      bo,
    )
    if (stolen.ok || stolen.status !== 409) fail('move kept', 'another rider moved free money that is not theirs: ' + JSON.stringify(stolen).slice(0, 160))
    const mine = await Operations.standing(w.env, { swarm: id }, ana)
    if (!mine.ok || mine.value.free !== Memo.decimal(moving))
      fail('move kept', 'the rider has ' + (mine.ok ? mine.value.free : '?') + ' free, expected ' + Memo.decimal(moving))

    const health = await Operations.health(w.env)
    const book = health.ok ? health.value.ledgers.find((one) => one.swarm === id) : undefined
    const held = Memo.decimal(total())
    if (book?.held !== held || book.pledged !== held || book.drift !== Memo.decimal(skew))
      fail('ledger drift', 'health reads ' + JSON.stringify(book) + ' for ' + held + ' held and a gateway ' + Memo.decimal(skew) + ' off')

    const refused = await Operations.archive(w.env, { swarm: id }, bo)
    if (refused.ok || refused.status !== 403) fail('archive admin', 'a rider who is not an admin archived the swarm: ' + JSON.stringify(refused).slice(0, 120))
    const archived = await Operations.archive(w.env, { swarm: id }, owner)
    if (!archived.ok || archived.value.archivedAt === null) fail('archive admin', 'the operator could not archive: ' + JSON.stringify(archived).slice(0, 120))
    const late = await Operations.transfer(w.env, { amount: amount(), swarm: id, token: 'pathusd' }, 'https://swarms.test')
    if (late.ok || late.status !== 410) fail('archive admin', 'an archived swarm prepared a ride: ' + JSON.stringify(late).slice(0, 120))
    if (!(await Operations.tree(w.env, { swarm: id })).ok) fail('archive admin', 'an archived tree could not be read')
  } catch (error) {
    fail('finished', String((error as Error)?.stack ?? error).slice(0, 300))
  } finally {
    await Runner.stop(w.swarm)
    w.restore()
    Flow.guards.covered = was.covered
    Riding.guards.drift = was.drift
    Object.assign(Operations.guards, was.operations)
    unseed()
  }
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  'mf-nodes.api': api,
  'mf-nodes.flow': flow,
  'mf-nodes.lag': lagged,
  'mf-nodes.late': charged,
  'mf-nodes.quiet': quieted,
  'mf-nodes.reconcile': reconciled,
  'mf-nodes.refusal': refused,
  'mf-nodes.repost': reposted,
  'mf-nodes.rotate': rotated,
  'mf-nodes.runs': runs,
  'mf-nodes.topup': topped,
}

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('speaker'), invariant: 'runs match fold', name: 'mf-nodes.runs.speaker', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('exit'), invariant: 'answer read', name: 'mf-nodes.runs.exit', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('more'), invariant: 'runs listed', name: 'mf-nodes.runs.more', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('index'), invariant: 'index used', name: 'mf-nodes.runs.index', scenario: 'mf-nodes.runs', seeds: ['1'] },
  { flip: mutant('versioned'), invariant: 'tracked again', name: 'mf-nodes.runs.versioned', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('unwrap'), invariant: 'readable', name: 'mf-nodes.runs.unwrap', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('running'), invariant: 'log reread', name: 'mf-nodes.runs.running', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3', '4', '5', '6'] },
  { flip: nodeMutant('inherit'), invariant: 'flow', name: 'mf-nodes.flow.inherit', scenario: 'mf-nodes.flow', seeds: ['1', '2', '3', '4', '5'] },
  { flip: nodeMutant('orphan'), invariant: 'reconciled', name: 'mf-nodes.reconcile.orphan', scenario: 'mf-nodes.reconcile', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('rest'), invariant: 'refusal rests', name: 'mf-nodes.refusal.rest', scenario: 'mf-nodes.refusal', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('adopt'), invariant: 'adopted by role', name: 'mf-nodes.refusal.adopt', scenario: 'mf-nodes.refusal', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('step'), invariant: 'top-up step', name: 'mf-nodes.topup.step', scenario: 'mf-nodes.topup', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('stray'), invariant: 'strays closed', name: 'mf-nodes.topup.stray', scenario: 'mf-nodes.topup', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('schema'), invariant: 'output schema', name: 'mf-nodes.topup.schema', scenario: 'mf-nodes.topup', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('rotate'), invariant: 'rotated', name: 'mf-nodes.rotate.rotate', scenario: 'mf-nodes.rotate', seeds: ['1', '2', '3', '4', '5', '6'] },
  { flip: nodeMutant('late'), invariant: 'late once', name: 'mf-nodes.late.late', scenario: 'mf-nodes.late', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('final'), invariant: 'ledger drift', name: 'mf-nodes.lag.final', scenario: 'mf-nodes.lag', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('quiet'), invariant: 'quiet pause', name: 'mf-nodes.quiet.quiet', scenario: 'mf-nodes.quiet', seeds: ['1', '2', '3'] },
  { flip: nodeMutant('told'), invariant: 'repost once', name: 'mf-nodes.repost.told', scenario: 'mf-nodes.repost', seeds: ['1', '2', '3'] },
  { flip: apiMutant('reviewed'), invariant: 'tree created', name: 'mf-nodes.api.reviewed', scenario: 'mf-nodes.api', seeds: ['1', '2', '3', '4', '5', '6'] },
  { flip: apiMutant('setup'), invariant: 'tree setup', name: 'mf-nodes.api.setup', scenario: 'mf-nodes.api', seeds: ['1', '2', '3'] },
  { flip: apiMutant('tag'), invariant: 'ride tag', name: 'mf-nodes.api.tag', scenario: 'mf-nodes.api', seeds: ['1', '2', '3'] },
  { flip: apiMutant('limit'), invariant: 'suggest limit', name: 'mf-nodes.api.limit', scenario: 'mf-nodes.api', seeds: ['1', '2', '3'] },
  { flip: apiMutant('covered'), invariant: 'move kept', name: 'mf-nodes.api.covered', scenario: 'mf-nodes.api', seeds: ['1', '2', '3'] },
  { flip: apiMutant('drift'), invariant: 'ledger drift', name: 'mf-nodes.api.drift', scenario: 'mf-nodes.api', seeds: ['1', '2', '3', '4', '5', '6'] },
  { flip: apiMutant('owner'), invariant: 'archive admin', name: 'mf-nodes.api.owner', scenario: 'mf-nodes.api', seeds: ['1', '2', '3'] },
]
