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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  'mf-nodes.runs': runs,
}

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('speaker'), invariant: 'runs match fold', name: 'mf-nodes.runs.speaker', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('exit'), invariant: 'answer read', name: 'mf-nodes.runs.exit', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('more'), invariant: 'runs listed', name: 'mf-nodes.runs.more', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('index'), invariant: 'index used', name: 'mf-nodes.runs.index', scenario: 'mf-nodes.runs', seeds: ['1'] },
  { flip: mutant('versioned'), invariant: 'tracked again', name: 'mf-nodes.runs.versioned', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('unwrap'), invariant: 'readable', name: 'mf-nodes.runs.unwrap', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3'] },
  { flip: mutant('running'), invariant: 'log reread', name: 'mf-nodes.runs.running', scenario: 'mf-nodes.runs', seeds: ['1', '2', '3', '4', '5', '6'] },
]
