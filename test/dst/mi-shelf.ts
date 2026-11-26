import { registerHooks } from 'node:module'
import type { Entry, Kind } from '../../src/shared/Api.ts'
import * as Shelf from '../../src/shared/Artifact.ts'
import * as Trace from '../../src/shared/Trace.ts'
import * as Trail from '../../src/shared/Trail.ts'
import { recorder, rng, type Outcome, type Rng } from './mi.ts'

export const limits = { cases: 200, depthMost: 6, durationNs: 1_000_000, entries: 30, thoughtDeltas: 5000, deltaWidth: 7 }

const impl = {
  path: Shelf.path,
  rows: Trace.rows,
  redact: Trail.redact,
  located: null as
    | null
    | ((located: (self: never, row: never) => Promise<unknown>, self: { kv: { put: (key: string, value: unknown) => void } }, row: never) => Promise<unknown>),
}

const mutants: { [K in keyof typeof impl]: (typeof impl)[K] } = {
  path: (entry) => (typeof entry !== 'string' || entry.startsWith('/') ? undefined : entry.replace(/^\.\//, '')),
  rows: (entries) => Trace.rows(entries.flatMap((one) => [one, { ...one, event: (one.event ?? 0) + 0.5, seq: one.seq + 0.5 }])),
  redact: (text) => text.replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[redacted]'),
  located: async (located, self, row) => {
    self.kv.put('repo', 'my-swarm')
    return located(self as never, row)
  },
}

function mutant<K extends keyof typeof impl>(key: K) {
  return () => {
    const was = impl[key]
    impl[key] = mutants[key]
    return () => void (impl[key] = was)
  }
}

function segment(random: Rng) {
  return random.pick(['a', 'b', 'charts', '..', '.', 'cost.svg', 'index.html', 'x.md', ''])
}

async function artifact(seed: string): Promise<Outcome> {
  const random = rng('artifact', seed)
  const { holds, same, steps, violations } = recorder()
  same(
    'read',
    Shelf.read(
      'artifacts/leaderboard',
      { entry: 'index.html', kind: 'dashboard', summary: ' Solve rate by model. ', title: 'Leaderboard', updated: '2026-11-02T00:00:00Z' },
      3,
      '/a/abc',
    ),
    {
      cover: false,
      entry: 'index.html',
      form: 'page',
      kind: 'dashboard',
      slug: 'leaderboard',
      summary: 'Solve rate by model.',
      title: 'Leaderboard',
      updatedAt: Date.parse('2026-11-02T00:00:00Z'),
      url: '/a/abc/leaderboard/index.html',
      version: 3,
    },
    'a full manifest',
  )
  const bare = Shelf.read('artifacts/notes', 'not an object', 1, '/a/abc')
  same('read', [bare?.entry, bare?.title, bare?.form], ['index.html', 'notes', 'page'], 'a bare manifest')
  for (const key of ['git/x/issues/1', 'artifacts/Bad Slug', 'artifacts/a/b']) same('read', Shelf.read(key, {}, 1, '/a/abc'), undefined, key)
  for (const entry of ['../../secret.html', 'a/../b.html', '/etc/passwd', 'a/b/c/d/e.html']) same('no climbing', impl.path(entry), undefined, entry)
  same('no climbing', impl.path('./charts/cost.svg'), 'charts/cost.svg', './charts/cost.svg')
  same('no climbing', Shelf.read('artifacts/evil', { entry: '../../x.html' }, 1, '/a/abc')?.entry, 'index.html', 'a climbing entry')
  same('form', ['README.md', 'results.CSV', 'chart.svg', 'data.json', 'log.txt'].map(Shelf.form), ['markdown', 'table', 'image', 'json', 'text'], 'forms')
  const key = 'artifacts/gf3-parity/index.html'
  const page = '<!doctype html><title>x</title>'
  const once = JSON.stringify({ contentType: 'text/html', etag: '"a"', key, public: true, size: 31, text: page })
  const twice = JSON.stringify({ contentType: 'text/html', etag: '"b"', key, public: true, size: 99, text: once })
  const data = JSON.stringify({ key: 'value', text: 'a data file of its own' })
  same(
    'unwrapped',
    [
      Shelf.unwrapped(page, key),
      Shelf.unwrapped(once, key),
      Shelf.unwrapped(twice, key),
      Shelf.unwrapped(once, 'artifacts/other/index.html'),
      Shelf.unwrapped(data, 'artifacts/x/data.json'),
      Shelf.unwrapped('{"key": broken', key),
    ],
    [page, page, page, once, data, '{"key": broken'],
    'unwrapped',
  )
  const read = (slug: string, value: object, version = 1) => Shelf.read('artifacts/' + slug, value, version, '/a/abc')!
  const chart = read('autoresearch', { entry: 'index.html' }, 4)
  const notes = read('notes', { cover: true, entry: 'README.md' })
  const proofs = read('proofs', { cover: true, entry: 'map.svg', updated: '2026-11-09T00:00:00Z' }, 2)
  const older = read('grid', { cover: true, entry: 'index.html', updated: '2026-11-08T00:00:00Z' }, 7)
  same('cover', [proofs.cover, Shelf.cover([]), Shelf.cover([notes])], [true, null, null], 'no cover')
  same('cover', Shelf.cover([notes, chart]), { form: 'page', url: '/a/abc/autoresearch/index.html?cover=1&v=4' }, 'autoresearch stands in')
  same('cover', Shelf.cover([chart, older, proofs]), { form: 'image', url: '/a/abc/proofs/map.svg?v=2' }, 'newest marked cover')
  same('cover', Shelf.cover([chart, older]), { form: 'page', url: '/a/abc/grid/index.html?cover=1&v=7' }, 'marked page cover')
  for (let at = 0; at < limits.cases; at++) {
    const entry =
      (random.chance(0.2) ? '/' : random.chance(0.2) ? './' : '') + Array.from({ length: random.int(1, limits.depthMost) }, () => segment(random)).join('/')
    const placed = impl.path(entry)
    if (placed === undefined) continue
    const parts = placed.split('/')
    holds(
      'no climbing',
      !parts.includes('..') && !placed.startsWith('/') && parts.every(Boolean),
      JSON.stringify(entry) + ' placed at ' + JSON.stringify(placed),
    )
    const manifest = Shelf.read('artifacts/x', { entry }, 1, '/a/abc')
    holds('no climbing', !!manifest && !manifest.url.includes('..'), JSON.stringify(entry) + ' served at ' + manifest?.url)
  }
  return { steps: steps(), violations }
}

function entries() {
  let seq = 0
  return (kind: Kind, text: string, who: string | null = null, detail: string | null = null): Entry => {
    seq += 1
    return { at: seq * 1000, detail, event: seq, kind, seq, text, who }
  }
}

async function trace(seed: string): Promise<Outcome> {
  const random = rng('trace', seed)
  const { holds, same, steps, violations } = recorder()
  const entry = entries()
  const failed = JSON.stringify({ error: 'exit 1', tool: 'x' })
  const list = [
    entry('tool', 'Called compute_exec', 'helper-3'),
    entry('error', 'exec failed', null, failed),
    entry('error', 'git_read failed', null, '{"status":"failed"}'),
    entry('error', 'exec failed', null, failed),
    entry('error', 'git_read failed', null, '{"status":"failed"}'),
    entry('error', 'exec failed', 'helper-3', failed),
    entry('error', 'exec failed', null, failed),
    entry('thinking', 'Back **at** it', null),
    entry('error', 'exec failed', null, failed),
  ]
  const rows = impl.rows(list)
  same(
    'fold',
    rows.map((row) => [row.kind, row.who, row.text, row.count]),
    [
      ['tool', 'helper-3', 'Called compute_exec', 1],
      ['error', null, 'exec failed: exit 1', 3],
      ['error', null, 'git_read failed', 2],
      ['error', 'helper-3', 'exec failed: exit 1', 1],
      ['thinking', null, 'Back at it', 1],
      ['error', null, 'exec failed: exit 1', 1],
    ],
    'a run of errors',
  )
  same('fold', [rows[1]?.seq, rows[1]?.at], [list[1]?.seq, list[6]?.at], 'a folded row spans its run')
  const sponsor = JSON.stringify({
    error: 'Messages HTTP 503: Tempo Agents cannot pay the network fee to open your key channel right now: its fee sponsor is out of funds.',
  })
  const plumbing = [
    entry('error', 'A model call failed: Tempo Agents cannot pay the network fee to open your key channel right now', null, sponsor),
    entry('error', 'The run failed.', null, '{"status":"failed"}'),
    entry(
      'error',
      'The agent has made no model call or tool call for 21 minutes. Its session may be restarting without getting anywhere; after 30 minutes of it the swarm stops the turn and starts another.',
    ),
    entry(
      'error',
      'The agent stopped with an error after spending $0.',
      null,
      'The agent made no model call or tool call for 31 minutes, so the swarm stopped the turn to start another.',
    ),
    entry(
      'error',
      "The agent's turn failed 8 tries in a row, so the swarm starts a new agent with its goal, notes and updates; the old agent's workspace stays behind.",
    ),
    entry('error', 'The swarm hit an error and will retry.'),
    entry('error', 'The gateway did not take the next message for the agent.'),
    entry('error', 'A model call failed.', 'helper-3'),
  ]
  same(
    'operator hidden',
    impl.rows([entry('tool', 'Called compute_exec'), ...plumbing, entry('error', 'exec failed', 'helper-3')]).map((row) => [row.who, row.text]),
    [
      [null, 'Called compute_exec'],
      ['helper-3', 'exec failed'],
    ],
    'plumbing around work',
  )
  same(
    'operator hidden',
    [Trace.operator({ kind: 'error', text: 'The run failed.' }), Trace.operator({ kind: 'status', text: 'The run failed.' })],
    [true, false],
    'operator',
  )
  same(
    'status rewritten',
    impl
      .rows([entry('status', 'Told the agent to keep going, with $2.68 left.'), entry('status', 'Started working with $0.62 to spend.')])
      .map((row) => row.text),
    ['Started working.'],
    'old status lines',
  )
  same(
    'shown',
    [
      Trace.shown({ detail: JSON.stringify({ exitCode: 0, stderr: '', stdout: 'ok\n' }), text: 'Script output' }),
      Trace.shown({ detail: '{"a":1}', text: 'x' }),
      Trace.shown({ detail: 'plain text', text: 'x' }),
      Trace.shown({ detail: null, text: 'a whole thought' }),
    ],
    ['ok\n', '{\n  "a": 1\n}', 'plain text', 'a whole thought'],
    'shown',
  )
  const broke = 'Out of money: $0.021 left, and one step can cost up to $0.05. Fund it to keep going.'
  same(
    'fold',
    impl
      .rows([
        entry('status', broke),
        entry('status', broke),
        entry('tool', 'Called compute_exec'),
        entry('tool', 'Called compute_exec'),
        entry('status', broke),
      ])
      .map((row) => [row.kind, row.count]),
    [
      ['status', 2],
      ['tool', 1],
      ['tool', 1],
      ['status', 1],
    ],
    'repeated status and tools',
  )
  const pool = [...list, ...plumbing]
  for (let at = 0; at < limits.cases / 4; at++) {
    const make = entries()
    const picked = Array.from({ length: random.int(0, limits.entries) }, () => {
      const one = random.pick(pool)
      return make(one.kind, one.text, one.who, one.detail)
    })
    const out = impl.rows(picked)
    const kept = picked.filter((one) => !Trace.operator(one))
    holds('fold', out.reduce((sum, row) => sum + row.count, 0) <= kept.length, out.length + ' rows counted past ' + kept.length + ' entries')
    holds(
      'fold',
      out.every((row, i) => i === 0 || !(row.kind === 'error' && out[i - 1]!.kind === 'error' && row.text === out[i - 1]!.text && row.who === out[i - 1]!.who)),
      'two neighbouring rows are the same error',
    )
  }
  return { steps: steps(), violations }
}

async function trail(seed: string): Promise<Outcome> {
  const random = rng('trail', seed)
  const { holds, same, steps, violations } = recorder()
  const buffers = Trail.memory()
  const known = Trail.crew()
  const s = (event: unknown) => Trail.subagent(buffers, known, 's', event as never)
  same(
    'subagent',
    s({ agent: { id: 3, parent: 0, role: 'zstd tuner', task: 'Tune zstd levels.' }, type: 'added' }),
    { steps: [{ detail: 'Tune zstd levels.', kind: 'status', text: 'Started a subagent: zstd tuner' }], who: 'zstd tuner' },
    'added',
  )
  same('subagent', s({ agent: { id: 4, role: 'zstd tuner' }, type: 'added' })?.who, 'zstd tuner #4', 'a second of one role')
  same(
    'subagent',
    s({ agent: { id: 3, parent: 0, role: 'zstd tuner', task: 'Tune zstd levels.' }, type: 'added' }),
    { steps: [], who: 'zstd tuner' },
    'added again',
  )
  same(
    'subagent',
    s({ event: { payload: { arguments: { cmd: 'zstd -19 a' }, tool: 'exec_command' }, type: 'tool.call' }, id: 3, type: 'event' })?.steps,
    [{ detail: '{"cmd":"zstd -19 a"}', kind: 'tool', text: '$ zstd -19 a' }],
    'its tool call',
  )
  same('subagent', s({ id: 3, status: { state: 'completed' }, type: 'status' })?.steps, [], 'a bare status')
  same(
    'result once',
    s({ id: 3, status: { output: 'level 19 wins', state: 'completed' }, type: 'completion' })?.steps,
    [{ detail: 'level 19 wins', kind: 'output', text: 'zstd tuner finished' }],
    'completion',
  )
  same('result once', s({ id: 3, status: { output: 'again', state: 'completed' }, type: 'completion' })?.steps, [], 'completion again')
  same(
    'subagent',
    [s({ id: 9, status: { error: 'No capacity', state: 'failed' }, type: 'status' })?.steps[0]?.text, s('nonsense')],
    ['subagent 9 failed', undefined],
    'failed and nonsense',
  )
  const reported = Trail.call({
    arguments: { error: { code: 'payment_failed' }, message: 'kv_set stored a private key as public\nwhen the payer refused', tool: 'kv_set' },
    tool: 'mcp__gateway__send_feedback',
  })
  same('feedback', [reported?.kind, reported?.text], ['status', "Reported a problem to the gateway's team: kv_set stored a private key as public"], 'feedback')
  holds(
    'feedback',
    /Tool: kv_set/.test(reported?.detail ?? '') && /"code":"payment_failed"/.test(reported?.detail ?? ''),
    'feedback detail ' + reported?.detail,
  )
  const think = Trail.memory()
  same(
    'thinking',
    [
      Trail.narrate(think, 'a:1', 'reasoning.summary.delta', { text: 'Compare ' }),
      Trail.narrate(think, null, 'reasoning.summary.delta', { text: 'Plan the next step' }),
    ],
    [[], []],
    'deltas',
  )
  Trail.narrate(think, 'a:1', 'reasoning.summary.delta', { text: 'the two codecs.' })
  same(
    'thinking',
    Trail.narrate(think, 'a:1', 'model.call.completed', {}),
    [{ detail: null, kind: 'thinking', text: 'Compare the two codecs.' }],
    'subagent thought',
  )
  same('thinking', Trail.narrate(think, null, 'assistant.message', { text: 'Done.' })[0]?.text, 'Plan the next step', 'lead thought')
  same(
    'step',
    Trail.step('tool.result', {
      result: [
        { text: 'Script completed\nWall time 0.3 seconds\nOutput:\n', type: 'input_text' },
        { text: '42', type: 'input_text' },
      ],
      status: 'completed',
      tool: 'exec',
    }),
    { detail: '42', kind: 'output', text: 'Script output' },
    'script output',
  )
  same(
    'step',
    Trail.step('tool.result', {
      result: 'Chunk ID: 1\nWall time: 0.2 seconds\nProcess exited with code 127\nOriginal token count: 5\nOutput:\nbash: python3: command not found',
      status: 'completed',
      tool: 'exec_command',
    }),
    { detail: 'bash: python3: command not found', kind: 'output', text: 'Command output · exit 127' },
    'command output',
  )
  same(
    'step',
    [
      Trail.step('tool.result', { result: 'Script running with cell ID 4\nWall time 11.0 seconds\nOutput:\n', status: 'completed', tool: 'exec' }),
      Trail.step('tool.result', { result: 'boom', status: 'failed', tool: 'exec_command' })?.kind,
      Trail.step('tool.result', { result: 'x', status: 'completed', tool: 'wait_agent' }),
      Trail.step('tool.call', { arguments: { cmd: 'ls -la' }, tool: 'exec_command' })?.text,
    ],
    [undefined, 'error', undefined, '$ ls -la'],
    'steps',
  )
  const error =
    'Responses HTTPS request was rejected with HTTP 429: {"error":{"message":"The payer refused to pay (429 busy): try again shortly.","type":"api_error"}}'
  same(
    'step',
    [Trail.step('model.call.failed', { error })?.text, Trail.step('model.call.failed', { error: 'timeout' })?.text],
    ['A model call failed: The payer refused to pay (429 busy): try again shortly.', 'A model call failed.'],
    'model failures',
  )
  same(
    'step',
    [
      Trail.step('tool.result', { duration_ns: 1_499_600, result: '{"exitCode":0}', status: 'completed', tool: 'mcp__gateway__compute_exec' })?.ms,
      Trail.step('tool.result', { duration_ns: 2_600_000_000, result: 'boom', status: 'failed', tool: 'mcp__gateway__compute_exec' })?.ms,
      Trail.step('tool.result', { result: 'x', status: 'completed', tool: 'mcp__gateway__compute_exec' })?.ms,
    ],
    [1, 2600, undefined],
    'durations',
  )
  const base: Entry = { at: 1000, detail: null, event: 7, kind: 'tool', seq: 0, text: '$ ls', who: null }
  const merged = Trail.merge(Trail.merge([], [base]), [{ ...base, at: 1500, seq: 12 }])
  same(
    'merge',
    [merged.length, merged[0]?.seq, merged[0]?.at, Trail.merge(merged, [base]) === merged, Trail.merge(merged, [{ ...base, kind: 'status' }]).length],
    [1, 12, 1000, true, 2],
    'merge',
  )
  same(
    'redact',
    [impl.redact('git clone https://user:token@code.storage/repo'), impl.redact('eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4')],
    ['git clone https://***@code.storage/repo', '[redacted]'],
    'redact',
  )
  const named: [string | null, string, string][] = [
    [null, '$ cd /work && pytest -q tests', 'Ran pytest'],
    [null, '$ cat README.md', 'Read README.md'],
    [null, '$ python3 bench/run.py --n 4 on gpu-box-7a1c', 'Ran bench/run.py'],
    [null, '$ python -m swebench.harness.run_evaluation --run_id q', 'Ran swebench.harness.run_evaluation'],
    [null, "$ printf 'x' > ljmd/systems.py", 'Wrote ljmd/systems.py'],
    [null, '$ curl -fsSL -o p.gz https://deb.debian.org/debian/Packages.gz', 'Downloaded from deb.debian.org'],
    ['await tools.Write({ file_path: "/workspace/ljmd/systems.py", content: "x" })', 'Ran a script: await tools.Write({', 'Wrote ljmd/systems.py'],
    ['const r = await tools.exec_command({cmd:"cd /w && cargo test"})', 'Ran a script: const r', 'Ran cargo test'],
    ['{"key":"results/leaderboard.json","body":"{}"}', 'Called bucket_put', 'Saved results/leaderboard.json to the bucket'],
    [JSON.stringify({ message: 'Add tests\n\nMore' }), 'Called git_commit', 'Committed: Add tests'],
    [null, 'Called mystery_tool', 'Called mystery_tool'],
  ]
  for (const [detail, text, want] of named) same('named', Trail.named({ detail, text }), want, text)
  same(
    'trouble',
    Trail.trouble({
      detail: '{"error":"Responses HTTPS request was rejected with HTTP 402: {\"error\":{\"message\":\"The payer refused to pay (402 limit_reached)\"}}"}',
      text: 'A model call failed.',
    }),
    { money: true, text: 'Ran out of money for this step.' },
    '402',
  )
  same(
    'trouble',
    Trail.trouble({ detail: 'durable operation previously failed: HTTP 402', text: 'The agent stopped with an error after spending $0.046926.' }),
    { money: true, text: 'Ran out of money for this step. It had spent $0.047.' },
    '402 with spend',
  )
  same(
    'trouble',
    [
      Trail.trouble({ detail: '{"error":"Responses HTTPS request was rejected with HTTP 503: cannot"}', text: 'A model call failed.' }).text,
      Trail.trouble({ detail: '{"status":"failed"}', text: 'The run failed.' }).text,
      Trail.trouble({ detail: null, text: "The channel for 0x364e…7c19's pledge never opened on Tempo, so the next payment opens another." }).text,
      Trail.trouble({ detail: '429 busy', text: 'A model call failed.' }).money,
    ],
    [
      'The model service was unavailable, so the step stopped.',
      "The agent's turn stopped on an error.",
      'A payment channel did not open; the next payment tries again.',
      false,
    ],
    'troubles',
  )
  same(
    'gist',
    [
      Trail.gist('**Checking the base case**\n\nTrying n = 1 first.'),
      Trail.gist('**One**\n\nfirst\n\n**Two**\n\nsecond'),
      Trail.gist('Reading the file.\n\n> Now the \x60kv_set\x60 call'),
      Trail.gist('a'.repeat(300)).length,
      Trail.gist('  \n '),
    ],
    ['Checking the base case', 'Two', 'Now the kv_set call', 120, ''],
    'gist',
  )
  for (let at = 0; at < limits.cases / 20; at++) {
    const head = random.pick(['   ', 'word '.repeat(random.int(1, 20)), 'a\n'.repeat(random.int(1, 400))])
    const tail = random.pick(['', '   ', 'more text '.repeat(random.int(1, 800))])
    const text = head + 'x'.repeat(Trail.thought - random.int(0, 20)) + 'y'.repeat(random.int(1, 40)) + tail
    const memory = Trail.memory()
    const width = random.int(1, limits.deltaWidth * 4)
    const deltas = [...text.matchAll(new RegExp('[\\s\\S]{1,' + width + '}', 'g'))].map((found) => found[0])
    for (const delta of deltas) Trail.narrate(memory, null, 'reasoning.summary.delta', { text: delta })
    same(
      'thought bounded',
      Trail.narrate(memory, null, 'assistant.message', { text: 'done' })[0]?.text,
      Trail.clip(deltas.join('').trim(), Trail.thought),
      'a thought in ' + width + '-character deltas',
    )
  }
  const long = Trail.memory()
  for (let i = 0; i < limits.thoughtDeltas; i++) Trail.narrate(long, null, 'reasoning.summary.delta', { text: 'abcdefgh' })
  holds('thought bounded', long.take(null).length <= Trail.thought + 8, 'a long thought kept ' + long.take(null).length)
  for (let at = 0; at < limits.cases; at++) {
    const user = 'u' + random.int(0, 9999)
    const token = 'tok' + random.int(100000, 999999)
    const jwt = 'eyJ' + 'a'.repeat(random.int(8, 20)) + '.' + 'b'.repeat(random.int(8, 20)) + '.' + 'c'.repeat(random.int(8, 20))
    const text = random.pick(['git clone ', 'push to ', '']) + 'https://' + user + ':' + token + '@code.storage/r' + (random.chance(0.5) ? ' and ' + jwt : '')
    const out = impl.redact(text)
    holds('redact', !out.includes(token) && !out.includes(jwt), JSON.stringify(text) + ' redacted to ' + JSON.stringify(out))
  }
  return { steps: steps(), violations }
}

const workers = { repo: '../../src/worker/Repo.ts', host: '../host.ts' }

async function repo(seed: string): Promise<Outcome> {
  const random = rng('repo', seed)
  const { holds, same, steps, violations } = recorder()
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' }
        : next(specifier, context),
  })
  await import(workers.host)
  const Repo = (await import(workers.repo)) as { located: (self: never, row: never) => Promise<{ name: string; state: string }> }
  const located = (self: { kv: { put: (key: string, value: unknown) => void } }, row: never) =>
    impl.located ? impl.located(Repo.located, self, row) : Repo.located(self as never, row)
  const row = { id: 'abc123abc123', repo: null, title: 'My swarm' } as never
  const swarm = () => {
    const kv = new Map<string, unknown>()
    const logged: string[] = []
    const d1 = { failing: false, repo: null as string | null }
    const self = {
      born: 0,
      changed: () => undefined,
      cues: new Map<string, number>(),
      env: {
        DB: {
          prepare: () => ({
            bind: (...args: unknown[]) => ({
              run: async () => {
                if (d1.failing) throw new Error('D1_ERROR: network connection lost')
                d1.repo = String(args[0])
                return {}
              },
            }),
          }),
        },
        GATEWAY: {
          fetch: async (request: Request) =>
            new URL(request.url).pathname === '/api/keys/me' ? Response.json({ wallet: '0xAB' }) : Response.json({ repos: [{ name: 'my-swarm' }] }),
        },
        GATEWAY_URL: 'https://gateway.test',
        SWARMS_GATEWAY_KEY: 'test',
      },
      kv: { delete: (key: string) => kv.delete(key), get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) },
      log: (_kind: string, text: string) => void logged.push(text),
    }
    return { d1, kv, logged, self }
  }
  for (let at = 0; at < limits.cases / 20; at++) {
    const { d1, kv, logged, self } = swarm()
    const failures = random.int(0, 3)
    for (let i = 0; i < failures; i++) {
      d1.failing = true
      const answered = (await located(self, row).catch(() => undefined)) as { state: string } | undefined
      holds('ready only once stored', kv.get('repo') === undefined && answered?.state !== 'ready', 'the object held the repo while the database write failed')
    }
    d1.failing = false
    self.cues.set('git', Date.now() + 1)
    same('ready', await located(self, row), { name: 'my-swarm', state: 'ready' }, 'located after the database recovered')
    same('ready', [kv.get('repo'), d1.repo], ['my-swarm', 'my-swarm'], 'held in both')
    same('told once', logged, ["The swarm's code now lives in its public repository my-swarm, which its page shows."], 'room lines')
  }
  const { d1, kv, self } = swarm()
  kv.set('repo', 'my-swarm')
  same('older object heals', await located(self, row), { name: 'my-swarm', state: 'ready' }, 'an older object held the repo')
  same('older object heals', d1.repo, 'my-swarm', 'database after the next look')
  return { steps: steps(), violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { artifact, repo, trace, trail }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('path'), invariant: 'no climbing', name: 'artifact.path', scenario: 'artifact', seeds: ['1', '2', '3'] },
  { flip: mutant('rows'), invariant: 'fold', name: 'trace.rows', scenario: 'trace', seeds: ['1', '2', '3'] },
  { flip: mutant('redact'), invariant: 'redact', name: 'trail.redact', scenario: 'trail', seeds: ['1', '2', '3'] },
  { flip: mutant('located'), invariant: 'ready only once stored', name: 'repo.stored', scenario: 'repo', seeds: ['1', '2', '3'] },
]
