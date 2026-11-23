import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'
import * as Verify from '../src/worker/Verify.ts'

type Mock = typeof import('./mock/github.ts')

const mock: Mock | null = await import('./mock/github.ts').catch(() => null)

const statement = '∃ φ : CNF, φ.Satisfiable ∧ φ.eval (majorityAssignment φ) = false'

const nid = '2f7a140626'

const sha = (n: number) => n.toString(16).padStart(40, 'a')

function environment(github: { url: string; token: string; secret: string; repo: string }) {
  return {
    GATEWAY_URL: 'https://gateway.test',
    GITHUB_API: github.url,
    SWARMS_GATEWAY_KEY: 'test',
    SWARMS_GITHUB_TOKEN: github.token,
    SWARMS_GITHUB_WEBHOOK_SECRET: github.secret,
    SWARMS_PROOFS_REPO: github.repo,
    SWARMS_URL: 'https://swarms.test',
  } as unknown as Verify.Env
}

async function receiver(env: Verify.Env) {
  const reads: (Verify.Read | null)[] = []
  const server = createServer((incoming, answer) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value)
      void Verify.read(env, new Request('https://swarms.test/swarms/v1/hooks/github', { body: Buffer.concat(chunks), headers, method: 'POST' })).then((read) => {
        reads.push(read)
        answer.writeHead(read ? 202 : 204)
        answer.end()
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
    reads,
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/hook`,
  }
}

function zipped(files: Record<string, string>) {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text)
    const data = deflateRawSync(raw)
    const file = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(file.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(crc32(raw), 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(file.length, 28)
    entry.writeUInt32LE(offset, 42)
    parts.push(local, file, data)
    central.push(entry, file)
    offset += 30 + file.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...parts, directory, end]))
}

const report = (claim: Verify.Claim = 'proof'): Verify.Report => ({
  axioms: ['propext'],
  checker: 'swarms-proofs check 1',
  claim,
  command: `lake build Pnp.Challenge.N${nid} && lake exe check ${nid} && lake env leanchecker <each Pnp module>`,
  commit: sha(1),
  contentHash: 'c'.repeat(64),
  durationMs: 61_000,
  error: null,
  exitCode: 0,
  mathlib: 'fc4f59e577feb1a4956671bc04ac18aaaf8cd842',
  nid,
  ok: true,
  problem: 'pnp',
  statement: 'ad8c569d9b3bda66',
  swarm: 'abc123def456',
  theorem: Verify.theorem(nid),
  toolchain: 'leanprover/lean4:v4.36.0',
})

const run = { at: 1, conclusion: 'success', run: '7', tail: '', url: 'https://github.com/gakonst/swarms-proofs/actions/runs/7' }

const named: Verify.Named = { claim: 'proof', nid, sha: sha(1), swarm: 'abc123def456' }

test('artifacts are read whether stored or deflated, as GitHub zips them', async () => {
  const files = await Verify.unzip(zipped({ 'check.json': JSON.stringify(report()), 'check.tail': 'error: '.repeat(900) }))
  assert.deepEqual(JSON.parse(files.get('check.json') ?? ''), report())
  assert.equal(files.get('check.tail'), 'error: '.repeat(900))
  assert.equal((await Verify.unzip(new Uint8Array([1, 2, 3]))).size, 0)
})

test('a record becomes a Check only for its own swarm, node, commit and claim, with allowed axioms, from a passing run', () => {
  const env = {} as Verify.Env
  const check = Verify.judged(env, report(), named, run)
  assert.ok(!('failed' in check))
  assert.equal(check.repo, Verify.repository)
  assert.equal(check.url, run.url)
  assert.equal(check.run, '7')
  assert.equal(check.commit, sha(1))
  for (const [change, why] of [
    [{ commit: sha(2) }, 'another node, commit or claim'],
    [{ swarm: 'other' }, 'another node, commit or claim'],
    [{ claim: 'refutation' as const }, 'another node, commit or claim'],
    [{ theorem: 'Pnp.Nother' }, 'not Pnp.N2f7a140626'],
    [{ axioms: ['propext', 'sorryAx'] }, 'outside the allowlist: sorryAx'],
    [{ ok: false, exitCode: 7, error: 'axioms outside the allowlist: [sorryAx]' }, 'axioms outside the allowlist: [sorryAx]'],
    [{ contentHash: '' }, 'missing its hashes'],
  ] as const) {
    const judged = Verify.judged(env, { ...report(), ...change }, named, { ...run, tail: 'the log tail' })
    assert.ok('failed' in judged && judged.failed.includes(why) && judged.failed.includes('the log tail') && judged.failed.endsWith(run.url), why)
  }
  const failedRun = Verify.judged(env, report(), named, { ...run, conclusion: 'failure' })
  assert.ok('failed' in failedRun && failedRun.failed.includes('ended failure'))
  assert.ok('failed' in Verify.judged(env, null, named, run))
})

test('a source must be https, or http on a local dev host', () => {
  assert.ok(Verify.reachable('https://gateway.tempo-dev.workers.dev/p/0xabc/swarm-a/git/proofs.git'))
  assert.ok(Verify.reachable('http://127.0.0.1:8787/p/0xabc/swarm-a/git/proofs.git'))
  assert.ok(Verify.reachable('http://localhost:8787/x.git'))
  assert.ok(!Verify.reachable('http://gateway.example/x.git'))
  assert.ok(!Verify.reachable('git@github.com:x/y.git'))
})

test('the statement file Swarms writes is the one the verifier writes', async () => {
  assert.equal(Verify.statementFile(nid, 'True ∧\nTrue'), 'import Pnp.Defs\n\nnamespace Pnp\n\ndef Statements.N2f7a140626 : Prop :=\n  True ∧\n  True\n\nend Pnp\n')
  assert.equal(await Verify.hash(statement), 'ad8c569d9b3bda66')
  assert.equal(Verify.proofPath(nid), 'Pnp/Proofs/N2f7a140626.lean')
  assert.equal(Verify.title('abc', nid, sha(1), 'refutation'), `verify abc ${nid} ${sha(1)} refutation`)
})

test('the gateway machine fallback creates a verifier machine under its own app, then collects its record once it exits', async () => {
  const calls: { app: string | null; body: Record<string, unknown>; path: string }[] = []
  const files = new Map<string, string>()
  const env = {
    GATEWAY: {
      fetch: async (request: Request) => {
        const body = (await request.json()) as Record<string, unknown>
        const path = new URL(request.url).pathname
        calls.push({ app: request.headers.get('gateway-app'), body, path })
        if (path === '/v1/compute/create') return Response.json({ sandboxId: 'sb-1' })
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
  const ask = { nid, sha: sha(1), source: 'https://gateway.test/p/0xabc/swarm-abc123def456/git/proofs.git', statement, swarm: 'abc123def456', theorem: Verify.theorem(nid) }
  const started = await Verify.fallback(env, ask)
  assert.deepEqual(started, { ok: true, sandbox: 'sb-1' })
  assert.deepEqual(
    calls.map((call) => [call.path, call.app]),
    [
      ['/v1/compute/create', 'swarm-abc123def456-verify'],
      ['/v1/compute/spawn', 'swarm-abc123def456-verify'],
    ],
  )
  assert.deepEqual(calls[1]?.body['env'], { CLAIM: 'proof', NID: nid, PROBLEM: 'pnp', SHA: sha(1), SOURCE: ask.source, STATEMENT: statement, SWARM: 'abc123def456', THEOREM: 'Pnp.N2f7a140626' })
  assert.ok(String((calls[1]?.body['command'] as string[])[2]).includes('check/verify.sh'))
  assert.equal(await Verify.collected(env, { ...named, sandbox: 'sb-1' }), null)
  files.set('/work/out/exit', '0\n')
  files.set('/work/out/check.json', JSON.stringify(report()))
  const read = await Verify.collected(env, { ...named, sandbox: 'sb-1' })
  assert.ok(read && !('failed' in read.outcome))
  assert.equal(read.outcome.url, 'https://swarms.test/swarms/v1/swarms/abc123def456/proofs/2f7a140626')
  assert.equal(read.outcome.run, 'sb-1')
  assert.equal(calls.at(-1)?.path, '/v1/compute/terminate')
  assert.deepEqual(await Verify.fallback(env, { ...ask, theorem: 'Pnp.Nwrong' }), { detail: 'the theorem must be named Pnp.N2f7a140626', ok: false })
})

test("a new swarm's proofs repository is created public and gets the Lean project once", async () => {
  const calls: { app: string | null; body: Record<string, unknown>; path: string }[] = []
  let exists = false
  const env = {
    GATEWAY: {
      fetch: async (request: Request) => {
        const body = (await request.json()) as Record<string, unknown>
        const path = new URL(request.url).pathname
        calls.push({ app: request.headers.get('gateway-app'), body, path })
        if (path === '/v1/git/create' && exists) return Response.json({ detail: 'exists' }, { status: 409 })
        exists = true
        return Response.json({})
      },
    },
    GATEWAY_URL: 'https://gateway.test',
    SWARMS_GATEWAY_KEY: 'test',
  } as unknown as Cloudflare.Env
  const files = [{ path: 'lean-toolchain', text: 'leanprover/lean4:v4.36.0\n' }]
  assert.deepEqual(await Verify.seed(env, 'abc123def456', files), { ok: true, repo: 'proofs' })
  assert.deepEqual(calls.map((call) => [call.path, call.app]), [['/v1/git/create', 'swarm-abc123def456'], ['/v1/git/commit', 'swarm-abc123def456']])
  assert.deepEqual(calls[0]?.body, { name: 'proofs', public: true })
  assert.deepEqual(calls[1]?.body['files'], files)
  assert.deepEqual(await Verify.seed(env, 'abc123def456', files), { ok: true, repo: 'proofs' })
  assert.equal(calls.length, 3)
})

const withMock = mock ? test : test.skip

withMock('a dispatched check comes back by webhook as a Check bound to its swarm, node and commit, once per node and commit', async () => {
  const github = await (mock as Mock).start({ delayMs: null })
  const env = environment(github)
  const hook = await receiver(env)
  github.settings.hook = hook.url
  try {
    const ask = { nid, sha: sha(1), source: 'https://gateway.test/p/0xabc/swarm-abc123def456/git/proofs.git', statement, swarm: 'abc123def456', theorem: Verify.theorem(nid) }
    assert.deepEqual(await Verify.request(env, ask), { ok: true, run: null })
    assert.equal(github.runs.length, 1)
    assert.deepEqual(github.runs[0]?.inputs, { claim: 'proof', nid, problem: 'pnp', sha: sha(1), source: ask.source, statement, swarm: 'abc123def456', theorem: 'Pnp.N2f7a140626' })
    const id = github.runs[0]?.id ?? 0
    assert.deepEqual(await Verify.request(env, ask), { ok: true, run: id })
    assert.equal(github.runs.length, 1)
    await github.complete(id, 'success')
    assert.equal(hook.reads.length, 1)
    const read = hook.reads[0]
    assert.ok(read && !('failed' in read.outcome), JSON.stringify(read))
    assert.deepEqual([read.swarm, read.nid, read.sha, read.claim], ['abc123def456', nid, sha(1), 'proof'])
    assert.equal(read.outcome.statement, await Verify.hash(statement))
    assert.equal(read.outcome.theorem, 'Pnp.N2f7a140626')
    assert.equal(read.outcome.repo, github.repo)
    assert.equal(read.outcome.run, String(id))
    assert.equal(read.outcome.url, `https://github.com/${github.repo}/actions/runs/${id}`)
    assert.ok(read.outcome.axioms.every((axiom) => Verify.allowed.includes(axiom)))
    const again = await Verify.result(env, id)
    assert.deepEqual({ ...again, outcome: { ...again?.outcome, at: 0 } }, { ...read, outcome: { ...read.outcome, at: 0 } })
  } finally {
    await hook.close()
    await github.close()
  }
})

withMock('a failing check comes back as failed with why, and a refutation keeps its claim', async () => {
  const github = await (mock as Mock).start({ delayMs: null })
  const env = environment(github)
  const hook = await receiver(env)
  github.settings.hook = hook.url
  try {
    const ask = { nid, sha: sha(2), source: 'https://gateway.test/p/0xabc/swarm-abc123def456/git/proofs.git', statement, swarm: 'abc123def456', theorem: Verify.theorem(nid) }
    await Verify.request(env, ask)
    await github.complete(github.runs[0]?.id ?? 0, 'failure')
    const failed = hook.reads[0]
    assert.ok(failed && 'failed' in failed.outcome && failed.outcome.failed.includes(`/actions/runs/${github.runs[0]?.id}`), JSON.stringify(failed))
    await Verify.request(env, { ...ask, claim: 'refutation', sha: sha(3) })
    assert.equal(github.runs[1]?.inputs['claim'], 'refutation')
    await github.complete(github.runs[1]?.id ?? 0, 'success')
    const refuted = hook.reads[1]
    assert.ok(refuted, 'a refutation run is read')
    assert.equal(refuted.claim, 'refutation')
    assert.equal(refuted.sha, sha(3))
  } finally {
    await hook.close()
    await github.close()
  }
})

withMock('webhooks that are unsigned, for another event, workflow or branch are not ours', async () => {
  const github = await (mock as Mock).start({ delayMs: null })
  const env = environment(github)
  try {
    const body = (change: Record<string, unknown>) =>
      JSON.stringify({ action: 'completed', workflow_run: { conclusion: 'success', display_title: `verify abc123def456 ${nid} ${sha(1)}`, event: 'workflow_dispatch', head_branch: 'main', html_url: 'https://github.com/x', id: 1, path: Verify.workflow, repository: { full_name: github.repo }, status: 'completed', ...change } })
    const send = (text: string, headers: Record<string, string>) => Verify.read(env, new Request('https://swarms.test/hook', { body: text, headers, method: 'POST' }))
    const signed = (text: string) => ({ 'x-github-event': 'workflow_run', 'x-hub-signature-256': (mock as Mock).sign(github.secret, text) })
    assert.equal(await send(body({}), { 'x-github-event': 'workflow_run', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }), null)
    assert.equal(await send(body({}), { ...signed(body({})), 'x-github-event': 'push' }), null)
    for (const change of [{ path: '.github/workflows/other.yml' }, { head_branch: 'verify/x' }, { event: 'push' }, { repository: { full_name: 'someone/else' } }, { display_title: 'verify nonsense' }])
      assert.equal(await send(body(change), signed(body(change))), null, JSON.stringify(change))
  } finally {
    await github.close()
  }
})
