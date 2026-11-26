import { createHash, createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'
import * as Site from '../../src/shared/Site.ts'
import * as Verify from '../../src/worker/Verify.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  seed: { programs: 4, variants: 6, withNeeds: 10 },
  start: Date.UTC(2027, 0, 4, 9),
  verify: {
    asks: 3,
    cut: 7,
    files: 3,
    hashHex: 16,
    idHex: 10,
    lines: 4,
    noise: 21,
    polls: 3,
    shaHex: 40,
    steps: 160,
    tailMost: 1600,
    zip: { central: 46, directory: 0x02014b50, end: 0x06054b50, endSize: 22, local: 0x04034b50, localSize: 30, deflated: 8 },
  },
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

const subject = {
  create: Verify.create,
  read: Verify.read,
  reachable: Verify.reachable,
  request: Verify.request,
  statementFile: Verify.statementFile,
  unzip: Verify.unzip,
}

function swap<K extends keyof typeof subject>(key: K, broken: (typeof subject)[K]) {
  return () => {
    const was = subject[key]
    subject[key] = broken
    return () => void (subject[key] = was)
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const hex = (random: Rng, n: number) => Array.from({ length: n }, () => random.int(0, 15).toString(16)).join('')

const stmtHash = (statement: string) => createHash('sha256').update(statement).digest('hex').slice(0, limits.verify.hashHex)

const sign = (secret: string, body: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

function zipped(files: [string, string, boolean][]) {
  const Z = limits.verify.zip
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text)
    const data = deflate ? deflateRawSync(raw) : raw
    const method = deflate ? Z.deflated : 0
    const file = Buffer.from(name)
    const local = Buffer.alloc(Z.localSize)
    local.writeUInt32LE(Z.local, 0)
    local.writeUInt16LE(method, Z.deflated)
    local.writeUInt32LE(crc32(raw), Z.localSize - Z.endSize + Z.deflated - 2)
    local.writeUInt32LE(data.length, Z.localSize - Z.endSize + Z.deflated + 2)
    local.writeUInt32LE(raw.length, Z.endSize)
    local.writeUInt16LE(file.length, Z.localSize - 2 * 2)
    const entry = Buffer.alloc(Z.central)
    entry.writeUInt32LE(Z.directory, 0)
    entry.writeUInt16LE(method, Z.deflated + 2)
    entry.writeUInt32LE(crc32(raw), Z.deflated * 2)
    entry.writeUInt32LE(data.length, Z.endSize - 2)
    entry.writeUInt32LE(raw.length, Z.endSize + 2)
    entry.writeUInt16LE(file.length, Z.localSize - 2)
    entry.writeUInt32LE(offset, Z.central - 2 * 2)
    parts.push(local, file, data)
    central.push(entry, file)
    offset += Z.localSize + file.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(Z.endSize)
  end.writeUInt32LE(Z.end, 0)
  end.writeUInt16LE(files.length, Z.deflated)
  end.writeUInt16LE(files.length, Z.deflated + 2)
  end.writeUInt32LE(directory.length, Z.deflated + 2 * 2)
  end.writeUInt32LE(offset, Z.deflated * 2)
  return new Uint8Array(Buffer.concat([...parts, directory, end]))
}

type Fake = {
  conclusion: string | null
  display_title: string
  event: string
  expired: boolean
  head_branch: string
  html_url: string
  id: number
  inputs: Record<string, string>
  path: string
  report: Verify.Report | null | undefined
  repository: { full_name: string }
  status: string
  tail: string
  updated_at: string
}

const wire = (run: Fake) => ({
  conclusion: run.conclusion,
  display_title: run.display_title,
  event: run.event,
  head_branch: run.head_branch,
  html_url: run.html_url,
  id: run.id,
  path: run.path,
  repository: run.repository,
  status: run.status,
  updated_at: run.updated_at,
})

function reportFor(random: Rng, inputs: Record<string, string>): Verify.Report {
  return {
    axioms: Verify.allowed.filter(() => random.chance(1 / 2)),
    checker: 'swarms-proofs check 1',
    claim: inputs['claim'] as Verify.Claim,
    command: 'lake build',
    commit: inputs['sha']!,
    contentHash: hex(random, limits.verify.hashHex * 2 * 2),
    durationMs: random.int(1, limits.verify.tailMost),
    error: null,
    exitCode: 0,
    mathlib: hex(random, limits.verify.shaHex),
    nid: inputs['nid']!,
    ok: true,
    problem: 'pnp',
    statement: stmtHash(inputs['statement']!),
    swarm: inputs['swarm']!,
    theorem: inputs['theorem']!,
    toolchain: 'leanprover/lean4:v4.36.0',
  }
}

type Change = { change: Partial<Verify.Report> | null; early?: boolean; why: string; conclusion?: string }

const changes: Change[] = [
  { change: { commit: 'f'.repeat(limits.verify.shaHex) }, early: true, why: 'another node, commit or claim' },
  { change: { swarm: 'other' }, early: true, why: 'another node, commit or claim' },
  { change: { nid: 'f'.repeat(limits.verify.idHex) }, early: true, why: 'another node, commit or claim' },
  { change: { claim: 'refutation' }, early: true, why: 'another node, commit or claim' },
  { change: { theorem: 'Pnp.Nother' }, early: true, why: 'not Pnp.N' },
  { change: { axioms: ['propext', 'sorryAx'] }, why: 'outside the allowlist: sorryAx' },
  { change: { axioms: ['Lean.ofReduceBool'] }, why: 'outside the allowlist: Lean.ofReduceBool' },
  {
    change: { error: 'axioms outside the allowlist: [sorryAx]', exitCode: limits.verify.cut, ok: false },
    early: true,
    why: 'axioms outside the allowlist: [sorryAx]',
  },
  { change: { contentHash: '' }, why: 'missing its hashes' },
  { change: { statement: 'nope' }, why: 'missing its hashes' },
  { change: {}, conclusion: 'failure', why: 'ended failure' },
  { change: null, why: 'not JSON' },
]

function expectJudged(
  fail: (invariant: string, detail: string) => void,
  invariant: string,
  got: Verify.Outcome,
  want: { check: Record<string, unknown> } | { why: string[]; tail: string; url: string },
  label: string,
) {
  if ('check' in want) {
    if ('failed' in got) return fail(invariant, label + ' failed: ' + got.failed.slice(0, limits.verify.tailMost / limits.verify.lines))
    for (const [key, value] of Object.entries(want.check))
      if (!same((got as Record<string, unknown>)[key], value))
        fail(invariant, label + ' has ' + key + ' ' + JSON.stringify((got as Record<string, unknown>)[key]) + ', expected ' + JSON.stringify(value))
    return
  }
  if (!('failed' in got)) return fail(invariant, label + ' passed as a Check, expected a failure for ' + want.why.join(' / '))
  const tail = want.tail.slice(-Verify.tailBytes)
  if (!want.why.every((why) => got.failed.includes(why)))
    fail(invariant, label + ' failed without saying ' + want.why.join(' / ') + ': ' + got.failed.slice(0, limits.verify.tailMost / limits.verify.lines))
  if (tail && !got.failed.includes(tail)) fail(invariant, label + ' failed without its log tail')
  if (want.tail.length > Verify.tailBytes && got.failed.includes(want.tail)) fail(invariant, label + ' kept more than ' + Verify.tailBytes + ' bytes of tail')
  if (!got.failed.endsWith(want.url)) fail(invariant, label + ' failed without ending in its run url')
}

const real = { now: Date.now }

async function verify(seed: string): Promise<Outcome> {
  const random = rng(seed, 'verify')
  const { fail, violations } = recorder()
  const L = limits.verify
  Date.now = () => limits.start
  try {
    const repo = 'owner/proofs-' + hex(random, L.cut)
    const secret = 's' + hex(random, L.idHex)
    const runs: Fake[] = []
    let refuse = false
    let dispatched = 0
    const github = {
      fetch: async (request: Request) => {
        const url = new URL(request.url)
        const path = url.pathname
        const base = '/repos/' + repo + '/actions'
        if (path === base + '/runs') return Response.json({ workflow_runs: runs.map(wire) })
        if (path === base + '/workflows/verify.yml/dispatches' && request.method === 'POST') {
          if (refuse) return new Response('no', { status: 422 })
          dispatched += 1
          const inputs = ((await request.json()) as { inputs: Record<string, string> }).inputs
          const id = runs.length + 1
          runs.push({
            conclusion: null,
            display_title: 'verify ' + inputs['swarm'] + ' ' + inputs['nid'] + ' ' + inputs['sha'] + (inputs['claim'] === 'refutation' ? ' refutation' : ''),
            event: 'workflow_dispatch',
            expired: false,
            head_branch: 'main',
            html_url: 'https://github.com/' + repo + '/actions/runs/' + id,
            id,
            inputs,
            path: Verify.workflow,
            report: undefined,
            repository: { full_name: repo },
            status: 'queued',
            tail: '',
            updated_at: new Date(limits.start + id).toISOString(),
          })
          return new Response(null, { status: 204 })
        }
        const one = /\/runs\/(\d+)(\/artifacts)?$/.exec(path)
        if (one) {
          const run = runs[Number(one[1]) - 1]
          if (!run) return new Response('missing', { status: 404 })
          if (!one[2]) return Response.json(wire(run))
          return Response.json({ artifacts: run.report === undefined ? [] : [{ expired: run.expired, id: run.id, name: 'check' }] })
        }
        const art = /\/artifacts\/(\d+)\/zip$/.exec(path)
        if (art) {
          const run = runs[Number(art[1]) - 1]!
          const files: [string, string, boolean][] = [['check.tail', run.tail, random.chance(1 / 2)]]
          if (run.report !== null) files.unshift(['check.json', JSON.stringify(run.report), random.chance(1 / 2)])
          else files.unshift(['check.json', '{not json', false])
          return new Response(zipped(files))
        }
        return new Response('unknown', { status: 404 })
      },
    }
    const env = {
      GATEWAY_URL: 'https://gateway.test',
      GITHUB: github,
      GITHUB_API: 'https://api.github.test',
      SWARMS_GATEWAY_KEY: 'test',
      SWARMS_GITHUB_TOKEN: 'token',
      SWARMS_GITHUB_WEBHOOK_SECRET: secret,
      SWARMS_PROOFS_REPO: repo,
      SWARMS_URL: 'https://swarms.test',
    } as unknown as Verify.Env
    const swarm = 'swarm' + hex(random, L.cut)
    const asks = Array.from({ length: L.asks }, () => ({
      claim: random.pick(['proof', 'refutation'] as const),
      nid: random.chance(1 / L.asks) ? 'root' : hex(random, L.idHex),
      sha: hex(random, L.shaHex),
      statement: 'True ∧ ' + hex(random, L.cut),
    }))
    const hook = (run: Fake, change: Record<string, unknown> = {}, headers: Record<string, string> = {}, signed = true) => {
      const body = JSON.stringify({ action: 'completed', workflow_run: { ...wire(run), ...change } })
      return new Request('https://swarms.test/swarms/v1/hooks/github', {
        body,
        headers: { 'x-github-event': 'workflow_run', ...(signed ? { 'x-hub-signature-256': sign(secret, body) } : {}), ...headers },
        method: 'POST',
      })
    }
    let steps = 0
    for (; steps < L.steps; steps++) {
      const op = random.pick([
        'request',
        'request',
        'complete',
        'complete',
        'forged',
        'judged',
        'judged',
        'unzip',
        'reachable',
        'statement',
        'machine',
        'repo',
      ] as const)
      if (op === 'request') {
        const ask = random.pick(asks)
        const source = random.pick([
          'https://gateway.test/p/0xabc/swarm-' + swarm + '/git/proofs.git',
          'http://127.0.0.1:8787/p/x.git',
          'http://gateway.example/x.git',
        ])
        refuse = random.chance(1 / L.asks / 2)
        const full = { ...ask, source, swarm, theorem: Verify.theorem(ask.nid) }
        const named = Verify.title(swarm, ask.nid, ask.sha, ask.claim)
        const earlier = runs.find((run) => run.display_title === named && run.conclusion !== 'cancelled')
        const before = dispatched
        const got = await subject.request(env, full)
        const ok = Verify.reachable(source)
        const expected = earlier
          ? { ok: true, run: earlier.id }
          : !ok
            ? 'no public https source'
            : refuse
              ? 'GitHub refused the dispatch'
              : { ok: true, run: null }
        const matched = typeof expected === 'string' ? !got.ok && got.detail.includes(expected) : same(got, expected)
        if (!matched) fail('verify once', 'request ' + named + ' gave ' + JSON.stringify(got) + ', expected ' + JSON.stringify(expected))
        const sent = expected && typeof expected !== 'string' && expected.run === null ? 1 : 0
        if (dispatched - before !== sent) fail('verify once', 'request ' + named + ' dispatched ' + (dispatched - before) + ' times, expected ' + sent)
        const last = runs.at(-1)
        if (
          sent &&
          last &&
          !same(last.inputs, {
            claim: ask.claim,
            nid: ask.nid,
            problem: 'pnp',
            sha: ask.sha,
            source,
            statement: ask.statement,
            swarm,
            theorem: Verify.theorem(ask.nid),
          })
        )
          fail('verify once', 'the dispatch sent inputs ' + JSON.stringify(last.inputs))
        if (Verify.theorem(ask.nid) !== 'Pnp.N' + ask.nid) fail('verify statement', 'the theorem of ' + ask.nid + ' is ' + Verify.theorem(ask.nid))
      } else if (op === 'complete') {
        const run = runs.find((one) => one.status !== 'completed')
        if (!run) continue
        run.status = 'completed'
        run.conclusion = random.pick(['success', 'success', 'success', 'failure', 'cancelled'])
        const kind = random.pick(['valid', 'valid', 'valid', 'tampered', 'none', 'expired', 'garbled'] as const)
        const tampered = random.pick(changes.filter((one) => one.change && !one.conclusion && one.change.claim !== run.inputs['claim']))
        run.report =
          kind === 'none' ? undefined : kind === 'garbled' ? null : { ...reportFor(random, run.inputs), ...(kind === 'tampered' ? tampered.change : {}) }
        run.expired = kind === 'expired'
        run.tail = random.chance(1 / 2) ? 'error: '.repeat(random.int(1, L.tailMost / L.cut)) : ''
        const read = await subject.read(env, hook(run))
        const named = { claim: run.inputs['claim'], nid: run.inputs['nid'], sha: run.inputs['sha'], swarm: run.inputs['swarm'] }
        if (!read) {
          fail('verify webhook', 'a signed completion of run ' + run.id + ' was not read')
          continue
        }
        if (!same({ claim: read.claim, nid: read.nid, sha: read.sha, swarm: read.swarm }, named))
          fail(
            'verify webhook',
            'run ' +
              run.id +
              ' was read as ' +
              JSON.stringify({ claim: read.claim, nid: read.nid, sha: read.sha, swarm: read.swarm }) +
              ', expected ' +
              JSON.stringify(named),
          )
        const label = 'run ' + run.id + ' (' + kind + ', ' + run.conclusion + ')'
        if (kind === 'none' || kind === 'expired')
          expectJudged(fail, 'verify webhook', read.outcome, { tail: '', url: run.html_url, why: ['no check record'] }, label)
        else if (kind === 'garbled') expectJudged(fail, 'verify webhook', read.outcome, { tail: run.tail, url: run.html_url, why: ['not JSON'] }, label)
        else if (kind === 'tampered' && (tampered.early || run.conclusion === 'success'))
          expectJudged(fail, 'verify webhook', read.outcome, { tail: run.tail, url: run.html_url, why: [tampered.why] }, label)
        else if (run.conclusion !== 'success')
          expectJudged(fail, 'verify webhook', read.outcome, { tail: run.tail, url: run.html_url, why: ['ended ' + run.conclusion] }, label)
        else
          expectJudged(
            fail,
            'verify webhook',
            read.outcome,
            {
              check: {
                commit: run.inputs['sha'],
                repo,
                run: String(run.id),
                statement: stmtHash(run.inputs['statement']!),
                theorem: Verify.theorem(run.inputs['nid']!),
                url: run.html_url,
              },
            },
            label,
          )
        if (!('failed' in read.outcome) && !read.outcome.axioms.every((axiom) => Verify.allowed.includes(axiom)))
          fail('verify webhook', label + ' passed with axioms ' + read.outcome.axioms)
        const again = await Verify.result(env, run.id)
        if (!same(again, read)) fail('verify webhook', 'run ' + run.id + ' read again as ' + JSON.stringify(again).slice(0, L.tailMost / L.lines))
      } else if (op === 'forged') {
        const run = runs.find((one) => one.status === 'completed') ?? runs[0]
        if (!run) continue
        const forgery = random.pick([
          { headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(L.hashHex * 2 * 2) } },
          { signed: false },
          { headers: { 'x-github-event': 'push' } },
          { change: { path: '.github/workflows/other.yml' } },
          { change: { head_branch: 'verify/x' } },
          { change: { event: 'push' } },
          { change: { repository: { full_name: 'someone/else' } } },
          { change: { display_title: 'verify nonsense' } },
        ] as { change?: Record<string, unknown>; headers?: Record<string, string>; signed?: boolean }[])
        const got = await subject.read(env, hook(run, forgery.change, forgery.headers, forgery.signed ?? true))
        if (got !== null)
          fail('verify ours', 'a hook forged by ' + JSON.stringify(forgery) + ' was read as ' + JSON.stringify(got).slice(0, L.tailMost / L.lines))
      } else if (op === 'judged') {
        const ask = random.pick(asks)
        const named: Verify.Named = { claim: ask.claim, nid: ask.nid, sha: ask.sha, swarm }
        const inputs = { claim: ask.claim, nid: ask.nid, sha: ask.sha, statement: ask.statement, swarm, theorem: Verify.theorem(ask.nid) }
        const base = reportFor(random, inputs)
        const pick = random.chance(1 / L.asks) ? null : random.pick(changes)
        const run = {
          at: random.int(1, L.tailMost),
          conclusion: pick?.conclusion ?? 'success',
          run: String(random.int(1, L.tailMost)),
          tail: random.chance(1 / 2) ? 'x'.repeat(random.int(1, L.tailMost)) + 'end' : '',
          url: 'https://github.com/' + repo + '/actions/runs/' + random.int(1, L.tailMost),
        }
        if (pick?.change?.claim === ask.claim) continue
        const record = pick && pick.change === null ? null : { ...base, ...(pick?.change ?? {}) }
        const got = Verify.judged({} as Verify.Env, record, named, run)
        const label = 'judged ' + (pick ? pick.why : 'clean')
        if (!pick)
          expectJudged(fail, 'verify judged', got, { check: { at: run.at, commit: ask.sha, repo: Verify.repository, run: run.run, url: run.url } }, label)
        else expectJudged(fail, 'verify judged', got, { tail: run.tail, url: run.url, why: [pick.why] }, label)
      } else if (op === 'unzip') {
        const count = random.int(1, L.files)
        const files: [string, string, boolean][] = Array.from({ length: count }, (_, i) => [
          'f' + i + '.' + hex(random, L.lines),
          random.pick(['error: ', 'ok ', '∃ φ ']).repeat(random.int(0, L.tailMost / L.cut)) + hex(random, random.int(0, L.noise)),
          random.chance(1 / 2),
        ])
        const got = await subject.unzip(zipped(files))
        const expected = new Map(files.map(([name, text]) => [name, text]))
        if (!same([...got].sort(), [...expected].sort()))
          fail(
            'verify unzip',
            'a zip of ' +
              files.map(([name, text, deflate]) => name + ':' + text.length + (deflate ? 'd' : 's')).join(',') +
              ' read as ' +
              [...got].map(([name, text]) => name + ':' + text.length).join(','),
          )
        const junk = new Uint8Array(Array.from({ length: random.int(0, L.noise) }, () => random.int(0, L.noise)))
        if ((await subject.unzip(junk)).size !== 0) fail('verify unzip', 'junk bytes read as files')
      } else if (op === 'reachable') {
        const scheme = random.pick(['https', 'http', 'ftp', 'git@'])
        const host = random.pick(['localhost', '127.0.0.1', '[::1]', 'box.local', 'gateway.example', 'gateway.tempo-dev.workers.dev', 'github.com'])
        const url = scheme === 'git@' ? 'git@' + host + ':x/y.git' : scheme + '://' + host + (random.chance(1 / 2) ? ':8787' : '') + '/p/x.git'
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.local')
        const expected = scheme === 'https' || (scheme === 'http' && local)
        if (subject.reachable(url) !== expected) fail('verify reachable', url + ' reachable is ' + subject.reachable(url))
      } else if (op === 'statement') {
        const nid = random.chance(1 / L.asks) ? 'root' : hex(random, L.idHex)
        const lines = Array.from(
          { length: random.int(1, L.lines) },
          () => random.pick(['True', '∃ φ : CNF,', 'φ.Satisfiable ∧', '  x = y']) + hex(random, random.int(0, L.lines)),
        )
        const statement = lines.join('\n')
        const expected =
          'import Pnp.Defs\n\nnamespace Pnp\n\ndef Statements.N' + nid + ' : Prop :=\n' + lines.map((line) => '  ' + line).join('\n') + '\n\nend Pnp\n'
        if (subject.statementFile(nid, statement) !== expected)
          fail('verify statement', 'the statement file of ' + JSON.stringify(statement) + ' is ' + JSON.stringify(subject.statementFile(nid, statement)))
        if ((await Verify.hash(statement)) !== stmtHash(statement))
          fail('verify statement', 'hash of ' + JSON.stringify(statement) + ' is ' + (await Verify.hash(statement)))
        if (Verify.proofPath(nid) !== 'Pnp/Proofs/N' + nid + '.lean' || Verify.statementPath(nid) !== 'Pnp/Statements/N' + nid + '.lean')
          fail('verify statement', 'paths of ' + nid + ' are ' + Verify.proofPath(nid) + ' and ' + Verify.statementPath(nid))
        const sha = hex(random, L.shaHex)
        const claim = random.pick(['proof', 'refutation'] as const)
        if (Verify.title('abc', nid, sha, claim) !== 'verify abc ' + nid + ' ' + sha + (claim === 'refutation' ? ' refutation' : ''))
          fail('verify statement', 'title is ' + Verify.title('abc', nid, sha, claim))
      } else if (op === 'machine') {
        const ask = random.pick(asks)
        const calls: { app: string | null; body: Record<string, unknown>; path: string }[] = []
        const files = new Map<string, string>()
        const sandbox = 'sb-' + hex(random, L.lines)
        const createFails = random.chance(1 / L.lines)
        const spawnFails = random.chance(1 / L.lines)
        const machineEnv = {
          GATEWAY: {
            fetch: async (request: Request) => {
              const body = (await request.json()) as Record<string, unknown>
              const path = new URL(request.url).pathname
              calls.push({ app: request.headers.get('gateway-app'), body, path })
              if (path === '/v1/compute/create') return createFails ? Response.json({}, { status: 500 }) : Response.json({ sandboxId: sandbox })
              if (path === '/v1/compute/spawn' && spawnFails) return Response.json({}, { status: 500 })
              if (path === '/v1/compute/read') {
                const text = files.get(String(body['path']))
                return text === undefined ? Response.json({ detail: 'no such file' }, { status: 404 }) : new Response(text)
              }
              return Response.json({})
            },
          },
          GATEWAY_URL: 'https://gateway.test',
          SWARMS_GATEWAY_KEY: 'test',
          SWARMS_URL: 'https://swarms.test',
        } as unknown as Verify.Env
        const source = 'https://gateway.test/p/0xabc/swarm-' + swarm + '/git/proofs.git'
        const wrong = random.chance(1 / L.lines)
        const full = {
          claim: ask.claim,
          nid: ask.nid,
          sha: ask.sha,
          source,
          statement: ask.statement,
          swarm,
          theorem: wrong ? 'Pnp.Nwrong' : Verify.theorem(ask.nid),
        }
        const started = await Verify.fallback(machineEnv, full)
        const app = 'swarm-' + swarm + '-verify'
        if (wrong) {
          if (!same(started, { detail: 'the theorem must be named ' + Verify.theorem(ask.nid), ok: false }))
            fail('verify machine', 'a wrong theorem started ' + JSON.stringify(started))
          continue
        }
        const expected = createFails ? 'did not create' : spawnFails ? 'did not start' : null
        if (expected ? started.ok || !started.detail.includes(expected) : !same(started, { ok: true, sandbox })) {
          fail('verify machine', 'fallback gave ' + JSON.stringify(started) + ', expected ' + (expected ?? sandbox))
          continue
        }
        const heard = calls.map((call) => call.path + '@' + call.app).join()
        const want = ['/v1/compute/create@' + app, ...(createFails ? [] : ['/v1/compute/spawn@' + app])].join()
        if (heard !== want) fail('verify machine', 'the gateway heard ' + heard + ', expected ' + want)
        if (expected) continue
        const spawn = calls[1]!.body
        if (
          !same(spawn['env'], {
            CLAIM: ask.claim,
            NID: ask.nid,
            PROBLEM: 'pnp',
            SHA: ask.sha,
            SOURCE: source,
            STATEMENT: ask.statement,
            SWARM: swarm,
            THEOREM: Verify.theorem(ask.nid),
          })
        )
          fail('verify machine', 'the machine was spawned with ' + JSON.stringify(spawn['env']))
        if (!String((spawn['command'] as string[])[2]).includes('check/verify.sh')) fail('verify machine', 'the machine does not run check/verify.sh')
        const named: Verify.Named = { claim: ask.claim, nid: ask.nid, sha: ask.sha, swarm }
        for (let poll = random.int(0, L.polls); poll > 0; poll--)
          if ((await Verify.collected(machineEnv, { ...named, sandbox })) !== null) fail('verify machine', 'a machine still running was collected')
        const exit = random.chance(L.lines / (L.lines + 1)) ? 0 : 1
        const tail = random.chance(1 / 2) ? 'log ' + hex(random, L.cut) : ''
        files.set('/work/out/exit', exit + '\n')
        files.set('/work/out/check.json', JSON.stringify(reportFor(random, { ...full, theorem: Verify.theorem(ask.nid) })))
        if (tail) files.set('/work/out/check.log', tail)
        const read = await Verify.collected(machineEnv, { ...named, sandbox })
        const url = Site.home(machineEnv) + '/v1/swarms/' + swarm + '/proofs/' + ask.nid
        if (!read) {
          fail('verify machine', 'a machine that exited was not collected')
          continue
        }
        if (calls.at(-1)?.path !== '/v1/compute/terminate') fail('verify machine', 'a collected machine was not terminated')
        if (exit === 0) expectJudged(fail, 'verify machine', read.outcome, { check: { run: sandbox, url } }, 'machine exit 0')
        else expectJudged(fail, 'verify machine', read.outcome, { tail, url, why: ['ended failure'] }, 'machine exit 1')
      } else {
        const calls: { app: string | null; body: Record<string, unknown>; path: string }[] = []
        let exists = random.chance(1 / L.lines)
        const down = random.chance(1 / L.lines)
        const repoEnv = {
          GATEWAY: {
            fetch: async (request: Request) => {
              const body = (await request.json()) as Record<string, unknown>
              const path = new URL(request.url).pathname
              calls.push({ app: request.headers.get('gateway-app'), body, path })
              if (down) return Response.json({}, { status: 500 })
              if (path === '/v1/git/create' && exists) return Response.json({ detail: 'exists' }, { status: 409 })
              exists = true
              return Response.json({})
            },
          },
          GATEWAY_URL: 'https://gateway.test',
          SWARMS_GATEWAY_KEY: 'test',
        } as unknown as Cloudflare.Env
        const id = 'r' + hex(random, L.cut)
        const was = exists
        const created = await subject.create(repoEnv, id)
        const want = down ? null : was ? 'exists' : 'created'
        if (created !== want) fail('verify repo', 'create of a ' + (down ? 'down' : was ? 'taken' : 'new') + ' repository gave ' + created)
        if (!same(calls[0], { app: 'swarm-' + id, body: { name: 'proofs', public: true }, path: '/v1/git/create' }))
          fail('verify repo', 'create sent ' + JSON.stringify(calls[0]))
        const files = [{ path: 'lean-toolchain', text: 'leanprover/lean4:v4.36.0\n' }]
        const committed = await Verify.commit(repoEnv, id, files, Verify.seedMessage)
        if (committed !== !down) fail('verify repo', 'commit gave ' + committed)
        if (!same(calls[1], { app: 'swarm-' + id, body: { branch: 'main', files, message: Verify.seedMessage, name: 'proofs' }, path: '/v1/git/commit' }))
          fail('verify repo', 'commit sent ' + JSON.stringify(calls[1]))
      }
    }
    if ((await Verify.hash('∃ φ : CNF, φ.Satisfiable ∧ φ.eval (majorityAssignment φ) = false')) !== 'ad8c569d9b3bda66')
      fail('verify statement', 'the frozen statement hash moved')
    return { steps, violations }
  } finally {
    Date.now = real.now
  }
}

type SeedNode = { form: string; id: string; needs: string[]; parent: string | null; spec: string; statement: string | null; stmt: string; title: string }

type SeedFile = { header: string; mathlib: string; nodes: SeedNode[]; problem: string; reviewed: boolean; title: string; toolchain: string }

const problemRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'problems', 'pnp')

const problem: { list: (path: string) => string[]; read: (path: string) => string } = {
  list: (path) => readdirSync(join(problemRoot, path)),
  read: (path) => readFileSync(join(problemRoot, path), 'utf8'),
}

const frozen: [string, string][] = [
  ['root', 'none'],
  ['23a8aa7a3f', 'none'],
  ['d11c640642', 'none'],
  ['02f879c716', 'none'],
  ['315af74bc7', 'none'],
  ['ae3213ebe6', '32bc45c51130a6e5'],
  ['35f4b9585d', 'a822d83c3bc5fadf'],
  ['fa40748031', '59b4c5b0b1568fb3'],
  ['4b388ede84', '39085a851401dff8'],
  ['9eb0df13dc', '9a982abb925cebfe'],
  ['dbbb55ee8d', 'd7246ada4f3055ca'],
  ['ca0fc7256b', 'a36c6f525a6c3c8e'],
  ['9c37ac506c', '66a215faab8c0645'],
  ['8daffbfbe1', '22664f0f97cf803f'],
  ['93c4d31c35', 'cf929edeccd9f8d3'],
  ['c7bea4e90e', '303208b52040a135'],
  ['d658fca714', 'ce1fa8ec70402678'],
  ['8b0c6e4163', 'e8e42bc2989d8cf5'],
  ['4c4401c81d', 'a377ade69dcc196e'],
  ['c9e51a643d', 'a2e2e08fe976191b'],
  ['c0b9a05514', '428a93951cef07dd'],
  ['1364d81c47', '7024b8f80fbb09d7'],
  ['5ac0cf7cb5', '616e5260eb13ae6f'],
  ['81da17eb81', '57b9ef832eb55323'],
  ['dbb7e7488f', 'a9b872092ec94cbe'],
  ['143e0c5429', 'be97813153a3d852'],
  ['b629f6703c', '143e8706623875d6'],
  ['dc05d4ec1a', 'abb2921b3ff05bc7'],
  ['c1ad83e85e', '90ba7f028bf083db'],
  ['e83c2f5907', '2c048bb53218be15'],
  ['25ec4d810f', '818652534c167191'],
  ['f71cc669e4', 'd84b3eb2d9ba7dac'],
  ['2f7a140626', 'ad8c569d9b3bda66'],
  ['c9d5f7f35f', 'c0f58de882c54999'],
]

function nid(parent: string, title: string) {
  const normalized = (parent + '\n' + title).trim().toLowerCase().replace(/\s+/g, ' ')
  return createHash('sha256').update(normalized).digest('hex').slice(0, limits.verify.idHex)
}

async function seedFile(seed: string): Promise<Outcome> {
  const random = rng(seed, 'seed')
  const { fail, violations } = recorder()
  const L = limits.seed
  const file = JSON.parse(problem.read('seed.json')) as SeedFile
  const order = [...file.nodes].sort(() => random.next() - 1 / 2)
  const byId = new Map(file.nodes.map((node) => [node.id, node]))
  let steps = 0
  if (file.problem !== 'pnp') fail('seed tree', 'the seed is for ' + file.problem)
  const roots = file.nodes.filter((node) => node.parent === null)
  if (
    !same(
      roots.map((node) => [node.id, node.form, node.title]),
      [['root', 'goal', 'Does P = NP?']],
    )
  )
    fail('seed tree', 'the roots are ' + JSON.stringify(roots.map((node) => node.id)))
  if (byId.size !== file.nodes.length) fail('seed tree', 'ids repeat')
  const programs = file.nodes.filter((node) => node.form === 'program')
  if (
    !same(
      programs.map((node) => node.title.split(':')[0]),
      ['Foundations', 'Lower bounds', 'Barriers', 'Upper bounds'],
    ) ||
    programs.length !== L.programs
  )
    fail('seed tree', 'the programs are ' + programs.map((node) => node.title))
  for (const node of order) {
    steps += 1
    if (node.form === 'program' && node.parent !== 'root') fail('seed tree', node.title + ' hangs under ' + node.parent)
    if (node.form === 'lemma' && byId.get(node.parent ?? '')?.form !== 'program') fail('seed tree', 'lemma ' + node.title + ' is not under a program')
    if (node.parent !== null) {
      if (!byId.has(node.parent)) fail('seed tree', node.id + ' has no parent ' + node.parent)
      if (node.id !== nid(node.parent, node.title) || !/^[0-9a-f]{10}$/.test(node.id))
        fail('seed tree', node.title + ' has id ' + node.id + ', not ' + nid(node.parent, node.title))
      const variant = Array.from({ length: random.int(1, L.variants) }, () => random.pick([' ', '  ', '\t'])).join('')
      const spaced = node.title
        .split(' ')
        .map((word) => (random.chance(1 / 2) ? word.toUpperCase() : word))
        .join(variant)
      if (nid(node.parent, spaced + variant) !== node.id) fail('seed tree', 'the id of ' + node.title + ' changes with spacing or case')
      if (node.spec.split('\n')[0] !== node.title) fail('seed tree', node.title + ' spec opens with ' + node.spec.split('\n')[0])
    }
    if (node.form !== 'lemma') {
      if (node.statement !== null || node.stmt !== 'none') fail('seed stmt', node.title + ' carries a statement')
      continue
    }
    if (!node.statement) {
      fail('seed stmt', 'lemma ' + node.title + ' has no statement')
      continue
    }
    if (node.stmt !== (await Verify.hash(node.statement))) fail('seed stmt', node.title + ' stmt ' + node.stmt + ' is not the hash of its statement')
    if (!node.spec.endsWith('\u0060\u0060\u0060lean\n' + node.statement + '\n\u0060\u0060\u0060'))
      fail('seed stmt', node.title + ' spec does not end in its statement')
    if (/\bsorry\b|native_decide|\baxiom\b/.test(node.statement)) fail('seed stmt', node.title + ' statement cheats')
  }
  if (
    !same(
      file.nodes.map((node) => [node.id, node.stmt]),
      frozen,
    )
  )
    fail('seed stmt', 'the stmt labels moved from the frozen ones')
  const lemmas = new Set(file.nodes.filter((node) => node.form === 'lemma').map((node) => node.id))
  for (const node of order) for (const need of node.needs) if (!lemmas.has(need) || need === node.id) fail('seed needs', node.title + ' needs ' + need)
  const done = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (visiting.has(id)) return fail('seed needs', 'cycle through ' + id)
    visiting.add(id)
    for (const need of byId.get(id)?.needs ?? []) visit(need)
    visiting.delete(id)
    done.add(id)
  }
  for (const node of order) visit(node.id)
  if (file.nodes.filter((node) => node.needs.length).length < L.withNeeds) fail('seed needs', 'fewer than ' + L.withNeeds + ' nodes need others')
  if (problem.read('lean-toolchain').trim() !== file.toolchain) fail('seed lean', 'lean-toolchain is not ' + file.toolchain)
  const manifest = JSON.parse(problem.read('lake-manifest.json')) as { packages: { name: string; rev: string }[] }
  if (manifest.packages.find((pack) => pack.name === 'mathlib')?.rev !== file.mathlib || !/^[0-9a-f]{40}$/.test(file.mathlib))
    fail('seed lean', 'lake-manifest pins another Mathlib')
  if (!problem.read('lakefile.toml').includes('rev = "' + file.mathlib + '"')) fail('seed lean', 'lakefile.toml pins another Mathlib')
  const stated = file.nodes.filter((node) => node.statement !== null)
  if (!same(problem.list('Pnp/Statements/').sort(), stated.map((node) => 'N' + node.id + '.lean').sort())) fail('seed lean', 'Pnp/Statements holds other files')
  for (const node of [...stated].sort(() => random.next() - 1 / 2)) {
    steps += 1
    if (problem.read('Pnp/Statements/N' + node.id + '.lean') !== Verify.statementFile(node.id, node.statement ?? ''))
      fail('seed lean', 'N' + node.id + '.lean differs from the statement Swarms writes')
  }
  if (file.reviewed !== false) fail('seed reviewed', 'the seed statements are marked reviewed')
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  'mf.seed': seedFile,
  'mf.verify': verify,
}

function edited(path: string, edit: (text: string) => string) {
  return () => {
    const was = problem.read
    problem.read = (one) => (one === path ? edit(was(one)) : was(one))
    return () => void (problem.read = was)
  }
}

function seedEdit(edit: (file: SeedFile) => void) {
  return edited('seed.json', (text) => {
    const file = JSON.parse(text) as SeedFile
    edit(file)
    return JSON.stringify(file)
  })
}

function allowing() {
  Verify.allowed.push('sorryAx')
  return () => void Verify.allowed.pop()
}

function moved() {
  const was = Verify.machine.out
  Verify.machine.out = '/work/elsewhere'
  return () => void (Verify.machine.out = was)
}

const lemma = (file: SeedFile) => file.nodes.find((node) => node.form === 'lemma' && node.needs.length)!

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: swap(
      'unzip',
      async (bytes) => new Map([...(await Verify.unzip(bytes))].map(([name, text]) => [name, text.slice(0, limits.verify.tailMost / limits.verify.cut)])),
    ),
    invariant: 'verify unzip',
    name: 'mf.verify.unzip',
    scenario: 'mf.verify',
    seeds: ['1', '2', '3'],
  },
  { flip: allowing, invariant: 'verify judged', name: 'mf.verify.allowlist', scenario: 'mf.verify', seeds: ['1', '2', '3'] },
  {
    flip: swap('reachable', (url) => /^https?:/.test(url)),
    invariant: 'verify reachable',
    name: 'mf.verify.reachable',
    scenario: 'mf.verify',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('statementFile', (id, statement) => Verify.statementFile(id, statement.replaceAll('\n', ' '))),
    invariant: 'verify statement',
    name: 'mf.verify.statement',
    scenario: 'mf.verify',
    seeds: ['1', '2', '3'],
  },
  { flip: moved, invariant: 'verify machine', name: 'mf.verify.machine', scenario: 'mf.verify', seeds: ['1', '2', '3'] },
  {
    flip: swap('create', async (env, swarm) => {
      const created = await Verify.create(env, swarm)
      return created === 'exists' ? 'created' : created
    }),
    invariant: 'verify repo',
    name: 'mf.verify.exists',
    scenario: 'mf.verify',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('request', (env, ask) => {
      const gh = (env as { GITHUB: { fetch: (request: Request) => Promise<Response> } }).GITHUB
      return Verify.request(
        {
          ...env,
          GITHUB: {
            fetch: (request: Request) =>
              new URL(request.url).pathname.endsWith('/actions/runs') ? Promise.resolve(Response.json({ workflow_runs: [] })) : gh.fetch(request),
          },
        },
        ask,
      )
    }),
    invariant: 'verify once',
    name: 'mf.verify.once',
    scenario: 'mf.verify',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('read', async (env, incoming) => {
      const read = await Verify.read(env, incoming)
      return read && { ...read, claim: 'proof' }
    }),
    invariant: 'verify webhook',
    name: 'mf.verify.claim',
    scenario: 'mf.verify',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('read', async (env, incoming) => {
      const body = await incoming.text()
      const headers = new Headers(incoming.headers)
      headers.set('x-hub-signature-256', sign(env.SWARMS_GITHUB_WEBHOOK_SECRET ?? '', body))
      return Verify.read(env, new Request(incoming.url, { body, headers, method: 'POST' }))
    }),
    invariant: 'verify ours',
    name: 'mf.verify.unsigned',
    scenario: 'mf.verify',
    seeds: ['1', '2', '3'],
  },
  { flip: seedEdit((file) => void (lemma(file).title += ' again')), invariant: 'seed tree', name: 'mf.seed.id', scenario: 'mf.seed', seeds: ['1', '2', '3'] },
  {
    flip: seedEdit((file) => void (lemma(file).statement += ' ∧ True')),
    invariant: 'seed stmt',
    name: 'mf.seed.stmt',
    scenario: 'mf.seed',
    seeds: ['1', '2', '3'],
  },
  {
    flip: seedEdit((file) => {
      const one = lemma(file)
      const need = file.nodes.find((node) => node.id === one.needs[0])!
      need.needs = [...need.needs, one.id]
    }),
    invariant: 'seed needs',
    name: 'mf.seed.cycle',
    scenario: 'mf.seed',
    seeds: ['1', '2', '3'],
  },
  {
    flip: edited('lean-toolchain', (text) => text.replace(/v[\d.]+/, 'v0.0.0')),
    invariant: 'seed lean',
    name: 'mf.seed.toolchain',
    scenario: 'mf.seed',
    seeds: ['1', '2', '3'],
  },
  { flip: seedEdit((file) => void (file.reviewed = true)), invariant: 'seed reviewed', name: 'mf.seed.reviewed', scenario: 'mf.seed', seeds: ['1', '2', '3'] },
]
