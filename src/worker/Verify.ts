import * as Credit from '../shared/Credit.ts'
import * as Site from '../shared/Site.ts'
import type { Check } from '../shared/Tree.ts'

export type Env = Cloudflare.Env & {
  GITHUB?: { fetch: (request: Request) => Promise<Response> }
  GITHUB_API?: string
  SWARMS_GITHUB_TOKEN?: string
  SWARMS_GITHUB_WEBHOOK_SECRET?: string
  SWARMS_PROOFS_REPO?: string
}

export type Claim = 'proof' | 'refutation'

export type Ask = { swarm: string; nid: string; sha: string; theorem: string; statement: string; claim?: Claim; source?: string; repo?: string; problem?: string }

export type Outcome = Check | { failed: string }

export type Named = { swarm: string; nid: string; sha: string; claim: Claim }

export type Read = Named & { outcome: Outcome }

export type Report = {
  ok: boolean
  swarm: string
  problem: string
  nid: string
  claim: Claim
  commit: string
  theorem: string
  statement: string
  axioms: string[]
  toolchain: string
  mathlib: string
  checker: string
  command: string
  exitCode: number
  durationMs: number
  contentHash: string
  error: string | null
}

type Run = {
  id: number
  path: string
  head_branch: string
  event: string
  status: string
  conclusion: string | null
  display_title: string
  html_url: string
  updated_at?: string
  repository: { full_name: string }
}

export const repository = 'gakonst/swarms-proofs'

export const workflow = '.github/workflows/verify.yml'

export const allowed = ['Classical.choice', 'Quot.sound', 'propext']

export const tailBytes = 4096

const nidPattern = /^([0-9a-f]{10}|root)$/

const shaPattern = /^[0-9a-f]{40}$/

const swarmPattern = /^[A-Za-z0-9_-]{1,64}$/

const titlePattern = /^verify ([A-Za-z0-9_-]{1,64}) ([0-9a-f]{10}|root) ([0-9a-f]{40})( refutation)?$/

export function theorem(nid: string) {
  return 'Pnp.N' + nid
}

export function title(swarm: string, nid: string, sha: string, claim: Claim = 'proof') {
  return `verify ${swarm} ${nid} ${sha}${claim === 'refutation' ? ' refutation' : ''}`
}

export async function hash(statement: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(statement))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function statementFile(nid: string, statement: string) {
  const body = statement
    .split('\n')
    .map((line) => '  ' + line)
    .join('\n')
  return `import Pnp.Defs\n\nnamespace Pnp\n\ndef Statements.N${nid} : Prop :=\n${body}\n\nend Pnp\n`
}

export function proofPath(nid: string) {
  return `Pnp/Proofs/N${nid}.lean`
}

function repo(env: Env) {
  return env.SWARMS_PROOFS_REPO ?? repository
}

function github(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('accept', headers.get('accept') ?? 'application/vnd.github+json')
  headers.set('user-agent', 'swarms-verify')
  headers.set('x-github-api-version', '2022-11-28')
  if (env.SWARMS_GITHUB_TOKEN) headers.set('authorization', 'Bearer ' + env.SWARMS_GITHUB_TOKEN)
  const request = new Request((env.GITHUB_API ?? 'https://api.github.com') + path, { ...init, headers })
  return env.GITHUB ? env.GITHUB.fetch(request) : fetch(request)
}

async function json<value>(response: Response): Promise<value | null> {
  if (!response.ok) return null
  return (await response.json().catch(() => null)) as value | null
}

export function reachable(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname) || parsed.hostname.endsWith('.local')))
  } catch {
    return false
  }
}

async function source(env: Env, ask: Ask) {
  if (ask.source) return ask.source
  const me = await gateway(env, '/api/keys/me', null)
  const wallet = me.ok ? ((await me.json().catch(() => null)) as { wallet?: string } | null)?.wallet : undefined
  return wallet ? `${env.GATEWAY_URL}/p/${wallet}/${Credit.app(ask.swarm)}/git/${ask.repo ?? 'proofs'}.git` : null
}

function valid(ask: Ask) {
  if (!swarmPattern.test(ask.swarm)) return 'bad swarm id'
  if (!nidPattern.test(ask.nid)) return 'bad node id'
  if (!shaPattern.test(ask.sha)) return 'bad commit'
  if (ask.theorem !== theorem(ask.nid)) return `the theorem must be named ${theorem(ask.nid)}`
  if (!ask.statement.trim()) return 'empty statement'
  return null
}

export async function runs(env: Env) {
  const listed = await json<{ workflow_runs: Run[] }>(await github(env, `/repos/${repo(env)}/actions/runs?event=workflow_dispatch&per_page=100`))
  return (listed?.workflow_runs ?? []).filter((run) => run.path === workflow)
}

export async function request(env: Env, ask: Ask): Promise<{ ok: true; run: number | null } | { ok: false; detail: string }> {
  const invalid = valid(ask)
  if (invalid) return { detail: invalid, ok: false }
  const named = title(ask.swarm, ask.nid, ask.sha, ask.claim)
  const earlier = (await runs(env)).find((run) => run.display_title === named && run.conclusion !== 'cancelled')
  if (earlier) return { ok: true, run: earlier.id }
  const from = await source(env, ask)
  if (!from || !reachable(from)) return { detail: 'no public https source for the candidate commit', ok: false }
  const response = await github(env, `/repos/${repo(env)}/actions/workflows/verify.yml/dispatches`, {
    body: JSON.stringify({
      inputs: { claim: ask.claim ?? 'proof', nid: ask.nid, problem: ask.problem ?? 'pnp', sha: ask.sha, source: from, statement: ask.statement, swarm: ask.swarm, theorem: ask.theorem },
      ref: 'main',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) return { detail: `GitHub refused the dispatch: ${response.status} ${(await response.text()).slice(0, 300)}`, ok: false }
  return { ok: true, run: null }
}

async function signed(secret: string, body: string, signature: string | null) {
  if (!signature?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['verify'])
  const hex = signature.slice(7)
  if (!/^[0-9a-f]{64}$/.test(hex)) return false
  const bytes = new Uint8Array(hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [])
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(body))
}

function ours(env: Env, run: Run) {
  const named = titlePattern.exec(run.display_title)
  if (!named) return null
  if (run.repository.full_name !== repo(env) || run.path !== workflow || run.head_branch !== 'main' || run.event !== 'workflow_dispatch') return null
  return { claim: named[4] ? 'refutation' : 'proof', nid: named[2] as string, sha: named[3] as string, swarm: named[1] as string } satisfies Named
}

export async function read(env: Env, incoming: Request): Promise<Read | null> {
  const body = await incoming.text()
  if (!env.SWARMS_GITHUB_WEBHOOK_SECRET || !(await signed(env.SWARMS_GITHUB_WEBHOOK_SECRET, body, incoming.headers.get('x-hub-signature-256')))) return null
  if (incoming.headers.get('x-github-event') !== 'workflow_run') return null
  const event = (() => {
    try {
      return JSON.parse(body) as { action?: string; workflow_run?: Run }
    } catch {
      return null
    }
  })()
  if (event?.action !== 'completed' || !event.workflow_run) return null
  const run = event.workflow_run
  const named = ours(env, run)
  if (!named) return null
  return { ...named, outcome: await outcome(env, run, named) }
}

export async function result(env: Env, id: number): Promise<Read | null> {
  const run = await json<Run>(await github(env, `/repos/${repo(env)}/actions/runs/${id}`))
  if (!run || run.status !== 'completed') return null
  const named = ours(env, run)
  if (!named) return null
  return { ...named, outcome: await outcome(env, run, named) }
}

async function outcome(env: Env, run: Run, named: Named): Promise<Outcome> {
  const artifacts = await json<{ artifacts: { id: number; name: string; expired: boolean }[] }>(await github(env, `/repos/${repo(env)}/actions/runs/${run.id}/artifacts`))
  const artifact = artifacts?.artifacts.find((item) => item.name === 'check' && !item.expired)
  if (!artifact) return { failed: `The verifier run ended ${run.conclusion ?? 'without a conclusion'} with no check record: ${run.html_url}` }
  const zipped = await github(env, `/repos/${repo(env)}/actions/artifacts/${artifact.id}/zip`)
  if (!zipped.ok) return { failed: `The verifier's check record could not be read (${zipped.status}): ${run.html_url}` }
  const files = await unzip(new Uint8Array(await zipped.arrayBuffer()))
  const text = files.get('check.json')
  const tail = files.get('check.tail') ?? ''
  if (!text) return { failed: `The verifier's artifact has no check.json: ${run.html_url}` }
  return judged(env, parse(text), named, { at: run.updated_at ? Date.parse(run.updated_at) : Date.now(), conclusion: run.conclusion, run: String(run.id), tail, url: run.html_url })
}

function parse(text: string): Report | null {
  try {
    return JSON.parse(text) as Report
  } catch {
    return null
  }
}

export function judged(env: Env, record: Report | null, named: Named, run: { at: number; conclusion: string | null; run: string; tail: string; url: string }): Outcome {
  const why = (text: string) => ({ failed: `${text}${run.tail ? '\n\n' + run.tail.slice(-tailBytes) : ''}\n\n${run.url}` })
  if (!record) return why('The check record is not JSON.')
  if (record.swarm !== named.swarm || record.nid !== named.nid || record.commit !== named.sha || record.claim !== named.claim) return why('The check record is for another node, commit or claim.')
  if (record.theorem !== theorem(named.nid)) return why(`The check record names ${record.theorem}, not ${theorem(named.nid)}.`)
  if (!record.ok || record.exitCode !== 0 || run.conclusion !== 'success') return why(record.error ?? `The verifier run ended ${run.conclusion ?? 'without a conclusion'}.`)
  const outside = record.axioms.filter((axiom) => !allowed.includes(axiom))
  if (outside.length) return why(`Axioms outside the allowlist: ${outside.join(', ')}.`)
  if (!/^[0-9a-f]{16}$/.test(record.statement) || !/^[0-9a-f]{64}$/.test(record.contentHash)) return why('The check record is missing its hashes.')
  return {
    at: run.at,
    axioms: record.axioms,
    checker: record.checker,
    command: record.command,
    commit: record.commit,
    contentHash: record.contentHash,
    durationMs: record.durationMs,
    exitCode: record.exitCode,
    mathlib: record.mathlib,
    repo: repo(env),
    run: run.run,
    statement: record.statement,
    theorem: record.theorem,
    toolchain: record.toolchain,
    url: run.url,
  }
}

export async function unzip(bytes: Uint8Array) {
  const files = new Map<string, string>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--)
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  if (end < 0) return files
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  for (let index = 0; index < count && at + 46 <= bytes.length; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) break
    const method = view.getUint16(at + 10, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extra + comment
    if (view.getUint32(local, true) !== 0x04034b50) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + size)
    if (method === 0) files.set(name, new TextDecoder().decode(data))
    else if (method === 8) files.set(name, await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text())
  }
  return files
}

export const machine = {
  cpu: 4,
  memory: 16_384,
  seconds: 3_600,
  out: '/work/out',
}

export function app(swarm: string) {
  return Credit.app(swarm) + '-verify'
}

function gateway(env: Cloudflare.Env, path: string, body: unknown, app?: string) {
  const headers = new Headers({ accept: 'application/json', authorization: 'Bearer ' + env.SWARMS_GATEWAY_KEY })
  if (body !== null) headers.set('content-type', 'application/json')
  if (app) headers.set('gateway-app', app)
  const request = new Request(env.GATEWAY_URL + path, { body: body === null ? null : JSON.stringify(body), headers, method: body === null ? 'GET' : 'POST' })
  return 'GATEWAY' in env && env.GATEWAY ? env.GATEWAY.fetch(request) : fetch(request)
}

export function script(env: Env) {
  return [
    'set -u',
    `mkdir -p ${machine.out}`,
    'curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -o /tmp/elan-init.sh',
    'sh /tmp/elan-init.sh -y --no-modify-path --default-toolchain none',
    'export PATH="$HOME/.elan/bin:$PATH"',
    `git clone -q --depth 1 https://github.com/${repo(env)}.git /work/trusted`,
    `bash /work/trusted/check/verify.sh /work/trusted /work/candidate ${machine.out}; echo $? > ${machine.out}/exit`,
  ].join(' && ')
}

export async function fallback(env: Env, ask: Ask): Promise<{ ok: true; sandbox: string } | { ok: false; detail: string }> {
  const invalid = valid(ask)
  if (invalid) return { detail: invalid, ok: false }
  const from = await source(env, ask)
  if (!from) return { detail: 'no public source for the candidate commit', ok: false }
  const created = await gateway(
    env,
    '/v1/compute/create',
    { apt: ['ca-certificates', 'curl', 'git', 'jq', 'xz-utils'], cpu: machine.cpu, image: 'ubuntu:24.04', lease: machine.seconds, memory: machine.memory, region: 'any', timeout: machine.seconds },
    app(ask.swarm),
  )
  const sandbox = (await json<{ sandboxId?: string }>(created))?.sandboxId
  if (!sandbox) return { detail: `The gateway did not create the verifier machine (${created.status}).`, ok: false }
  const spawned = await gateway(
    env,
    '/v1/compute/spawn',
    {
      command: ['bash', '-lc', script(env)],
      env: { CLAIM: ask.claim ?? 'proof', NID: ask.nid, PROBLEM: ask.problem ?? 'pnp', SHA: ask.sha, SOURCE: from, STATEMENT: ask.statement, SWARM: ask.swarm, THEOREM: ask.theorem },
      sandboxId: sandbox,
    },
    app(ask.swarm),
  )
  if (!spawned.ok) return { detail: `The verifier machine did not start the check (${spawned.status}).`, ok: false }
  return { ok: true, sandbox }
}

async function file(env: Env, swarm: string, sandbox: string, path: string) {
  const response = await gateway(env, '/v1/compute/read', { path, sandboxId: sandbox }, app(swarm))
  return response.ok ? response.text() : null
}

export async function collected(env: Env, input: Named & { sandbox: string }): Promise<Read | null> {
  const exit = await file(env, input.swarm, input.sandbox, machine.out + '/exit')
  if (exit === null) return null
  const text = await file(env, input.swarm, input.sandbox, machine.out + '/check.json')
  const log = (await file(env, input.swarm, input.sandbox, machine.out + '/check.log')) ?? ''
  await gateway(env, '/v1/compute/terminate', { sandboxId: input.sandbox }, app(input.swarm))
  const named: Named = { claim: input.claim, nid: input.nid, sha: input.sha, swarm: input.swarm }
  const url = `${Site.home(env)}/v1/swarms/${input.swarm}/proofs/${input.nid}`
  return {
    ...named,
    outcome: judged(env, text ? parse(text) : null, named, { at: Date.now(), conclusion: exit.trim() === '0' ? 'success' : 'failure', run: input.sandbox, tail: log.slice(-tailBytes), url }),
  }
}


export const project = 'proofs'

export async function template() {
  const loaders = import.meta.glob<string>(['../../problems/pnp/**/*', '!../../problems/pnp/seed.json'], { import: 'default', query: '?raw' })
  const files = await Promise.all(Object.entries(loaders).map(async ([path, load]) => ({ path: path.replace('../../problems/pnp/', ''), text: await load() })))
  return files.sort((a, b) => (a.path < b.path ? -1 : 1))
}

export async function seed(env: Cloudflare.Env, swarm: string, files?: { path: string; text: string }[]): Promise<{ ok: true; repo: string | null } | { ok: false; detail: string }> {
  const created = await gateway(env, '/v1/git/create', { name: project, public: true }, Credit.app(swarm))
  if (created.status === 409) return { ok: true, repo: project }
  if (!created.ok) return { detail: `The gateway did not create the proofs repository (${created.status}).`, ok: false }
  const committed = await gateway(
    env,
    '/v1/git/commit',
    { branch: 'main', files: files ?? (await template()), message: 'Lean project: pinned toolchain and Mathlib, definitions and the seed statements', name: project },
    Credit.app(swarm),
  )
  if (!committed.ok) return { detail: `The gateway did not write the Lean project (${committed.status}).`, ok: false }
  return { ok: true, repo: project }
}

