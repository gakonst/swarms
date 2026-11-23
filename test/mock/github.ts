import { createHash, createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

export type Inputs = Record<string, string>

export type Run = {
  artifact: number | null
  check: Record<string, unknown> | null
  conclusion: 'failure' | 'success' | null
  created_at: string
  delivered: number
  head_branch: string
  head_sha: string
  id: number
  inputs: Inputs
  log: string
  status: 'completed' | 'in_progress' | 'queued'
  workflow: string
}

export type Options = {
  check?: (inputs: Inputs) => Record<string, unknown>
  delayMs?: number | null
  fail?: (inputs: Inputs) => Failure | null
  hook?: string | null
  port?: number
  repo?: string
  secret?: string
  token?: string
}

export const allowed = ['propext', 'Classical.choice', 'Quot.sound']

export const axioms: string[] = []

export const toolchain = 'leanprover/lean4:v4.36.0'

export const mathlib = 'fc4f59e577feb1a4956671bc04ac18aaaf8cd842'

export const checker = 'swarms-proofs check 1'

export function title(inputs: Inputs) {
  return `verify ${inputs['swarm'] ?? ''} ${inputs['nid'] ?? ''} ${inputs['sha'] ?? ''}${inputs['claim'] === 'refutation' ? ' refutation' : ''}`
}

export function hash(statement: string) {
  return createHash('sha256').update(statement).digest('hex').slice(0, 16)
}

export function sign(secret: string, body: string) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

export type Failure = { error: string; exitCode: number }

export function failing(inputs: Inputs): Failure | null {
  if (/mock:unprovable|sorry/.test(inputs['statement'] ?? '') || /fail/i.test(inputs['theorem'] ?? '')) return { error: 'axioms outside the allowlist: [sorryAx]', exitCode: 5 }
  return null
}

export function zip(files: Record<string, string>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8')
    const file = Buffer.from(name, 'utf8')
    const sum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(file.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(sum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(file.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, file, data)
    centrals.push(central, file)
    offset += local.length + file.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

export function unzip(archive: Buffer) {
  const files: Record<string, string> = {}
  for (let at = 0; archive.readUInt32LE(at) === 0x04034b50; ) {
    const size = archive.readUInt32LE(at + 18)
    const length = archive.readUInt16LE(at + 26)
    const extra = archive.readUInt16LE(at + 28)
    const name = archive.subarray(at + 30, at + 30 + length).toString('utf8')
    const start = at + 30 + length + extra
    files[name] = archive.subarray(start, start + size).toString('utf8')
    at = start + size
  }
  return files
}

export type GitHub = Awaited<ReturnType<typeof start>>

export async function start(options: Options = {}) {
  const repo = options.repo ?? 'gakonst/swarms-proofs'
  const secret = options.secret ?? 'mock-webhook-secret'
  const token = options.token ?? 'ghp_mock'
  const main = createHash('sha1').update('main:' + repo).digest('hex')
  const refs = new Map<string, string>([['refs/heads/main', main]])
  const runs: Run[] = []
  const artifacts = new Map<number, { name: string; run: number; zip: Buffer }>()
  const deliveries: { body: string; status: number; url: string }[] = []
  const errors: string[] = []
  const settings = { delayMs: options.delayMs === undefined ? 200 : options.delayMs, hook: options.hook ?? null }
  let next = 9_000_000_000
  let url = ''

  const shown = (run: Run) => ({
    conclusion: run.conclusion,
    created_at: run.created_at,
    display_title: title(run.inputs),
    event: 'workflow_dispatch',
    head_branch: run.head_branch,
    head_sha: run.head_sha,
    html_url: `https://github.com/${repo}/actions/runs/${run.id}`,
    id: run.id,
    name: 'verify',
    path: '.github/workflows/' + run.workflow,
    repository: { full_name: repo },
    run_attempt: 1,
    status: run.status,
    updated_at: new Date().toISOString(),
  })

  const deliver = async (run: Run) => {
    if (!settings.hook) return
    const body = JSON.stringify({ action: 'completed', repository: { full_name: repo }, workflow_run: shown(run) })
    const answered = await fetch(settings.hook, {
      body,
      headers: { 'content-type': 'application/json', 'x-github-delivery': 'mock-' + run.id + '-' + run.delivered, 'x-github-event': 'workflow_run', 'x-hub-signature-256': sign(secret, body) },
      method: 'POST',
    }).catch((error: unknown) => (errors.push(String(error)), undefined))
    run.delivered++
    deliveries.push({ body, status: answered?.status ?? 0, url: settings.hook })
    await answered?.body?.cancel().catch(() => undefined)
  }

  const complete = async (id: number, forced?: 'failure' | 'success') => {
    const run = runs.find((each) => each.id === id)
    if (!run || run.status === 'completed') return run
    const failure = forced === 'success' ? null : forced === 'failure' ? { error: 'forced failure', exitCode: 2 } : (options.fail ?? failing)(run.inputs)
    run.status = 'completed'
    run.conclusion = failure ? 'failure' : 'success'
    const started = Date.parse(run.created_at)
    const nid = run.inputs['nid'] ?? ''
    const statement = run.inputs['statement'] ?? ''
    run.log = failure ? ['lake build Pnp.Challenge.N' + nid, `Pnp/Challenge/N${nid}.lean: ${failure.error}`, 'error: build failed'].join('\n') : 'lake build Pnp.Challenge.N' + nid + '\nBuild completed successfully.\nlake exe check ' + nid + ': ok'
    run.check = options.check?.(run.inputs) ?? {
      axioms,
      checker,
      claim: run.inputs['claim'] ?? 'proof',
      command: `lake build Pnp.Challenge.N${nid} && lake exe check ${nid} && lake env leanchecker Pnp.Statements.N${nid} Pnp.Challenge.N${nid}`,
      commit: run.inputs['sha'] ?? '',
      contentHash: createHash('sha256').update(`${run.inputs['sha'] ?? ''}:${statement}`).digest('hex'),
      durationMs: Math.max(1, Date.now() - started),
      error: failure?.error ?? null,
      exitCode: failure?.exitCode ?? 0,
      mathlib,
      nid,
      ok: !failure,
      problem: run.inputs['problem'] ?? 'pnp',
      statement: hash(statement),
      swarm: run.inputs['swarm'] ?? '',
      theorem: run.inputs['theorem'] ?? '',
      toolchain,
      version: 1,
    }
    const artifact = next++
    artifacts.set(artifact, { name: 'check', run: run.id, zip: zip({ 'check.json': JSON.stringify(run.check, null, 2), ...(failure ? { 'check.tail': run.log.slice(-4096) } : {}) }) })
    run.artifact = artifact
    await deliver(run)
    return run
  }

  const answer = async (method: string, path: string, search: URLSearchParams, body: Record<string, unknown>, authorized: boolean): Promise<{ body?: unknown; bytes?: Buffer; status: number; type?: string }> => {
    if (path === '/mock/runs') return { body: runs, status: 200 }
    if (path === '/mock/deliveries') return { body: { deliveries, errors }, status: 200 }
    if (path === '/mock/complete' && method === 'POST') {
      const run = await complete(Number(body['id']), body['conclusion'] as 'failure' | 'success' | undefined)
      return run ? { body: run, status: 200 } : { body: { message: 'Not Found' }, status: 404 }
    }
    if (path === '/mock/redeliver' && method === 'POST') {
      const run = runs.find((each) => each.id === Number(body['id']))
      if (run) await deliver(run)
      return { body: { delivered: run?.delivered ?? 0 }, status: 200 }
    }
    if (path === '/mock/settings' && method === 'POST') {
      if (typeof body['hook'] === 'string') settings.hook = body['hook']
      if ('delayMs' in body) settings.delayMs = body['delayMs'] as number | null
      return { body: settings, status: 200 }
    }
    if (!authorized) return { body: { message: 'Bad credentials' }, status: 401 }
    const prefix = '/repos/' + repo
    if (!path.startsWith(prefix + '/')) return { body: { message: 'Not Found' }, status: 404 }
    const rest = path.slice(prefix.length)
    if (rest === '/git/refs' && method === 'POST') {
      const ref = String(body['ref'] ?? '')
      if (!/^refs\/heads\/.+/.test(ref) || !/^[0-9a-f]{40}$/.test(String(body['sha'] ?? ''))) return { body: { message: 'Validation Failed' }, status: 422 }
      if (refs.has(ref)) return { body: { message: 'Reference already exists' }, status: 422 }
      refs.set(ref, String(body['sha']))
      return { body: { object: { sha: body['sha'], type: 'commit' }, ref }, status: 201 }
    }
    const reffed = /^\/git\/refs\/(heads\/.+)$/.exec(rest)
    if (reffed && method === 'PATCH') {
      refs.set('refs/' + reffed[1], String(body['sha'] ?? ''))
      return { body: { object: { sha: body['sha'], type: 'commit' }, ref: 'refs/' + reffed[1] }, status: 200 }
    }
    if (reffed && method === 'GET') {
      const sha = refs.get('refs/' + reffed[1])
      return sha ? { body: { object: { sha, type: 'commit' }, ref: 'refs/' + reffed[1] }, status: 200 } : { body: { message: 'Not Found' }, status: 404 }
    }
    const dispatched = /^\/actions\/workflows\/([^/]+)\/dispatches$/.exec(rest)
    if (dispatched && method === 'POST') {
      const ref = String(body['ref'] ?? 'main')
      const head = refs.get('refs/heads/' + ref)
      if (!head) return { body: { message: `No ref found for: ${ref}` }, status: 422 }
      const inputs = Object.fromEntries(Object.entries((body['inputs'] ?? {}) as Record<string, unknown>).map(([field, value]) => [field, String(value)]))
      const run: Run = { artifact: null, check: null, conclusion: null, created_at: new Date().toISOString(), delivered: 0, head_branch: ref, head_sha: head, id: next++, inputs, log: '', status: 'queued', workflow: dispatched[1] ?? 'verify.yml' }
      runs.push(run)
      if (settings.delayMs !== null) {
        const delay = settings.delayMs
        setTimeout(() => (run.status = run.status === 'queued' ? 'in_progress' : run.status), Math.floor(delay / 2))
        setTimeout(() => void complete(run.id).catch((error: unknown) => errors.push(String(error))), delay)
      }
      return { status: 204 }
    }
    if (rest === '/actions/runs' && method === 'GET') {
      const picked = runs.filter((run) => (!search.get('branch') || run.head_branch === search.get('branch')) && (!search.get('head_sha') || run.head_sha === search.get('head_sha')) && (!search.get('status') || run.status === search.get('status')))
      return { body: { total_count: picked.length, workflow_runs: [...picked].reverse().map(shown) }, status: 200 }
    }
    const ran = /^\/actions\/runs\/(\d+)(\/artifacts|\/logs)?$/.exec(rest)
    if (ran) {
      const run = runs.find((each) => each.id === Number(ran[1]))
      if (!run) return { body: { message: 'Not Found' }, status: 404 }
      if (ran[2] === '/logs') return { bytes: Buffer.from(run.log), status: 200, type: 'text/plain' }
      if (ran[2] === '/artifacts') {
        const listed = run.artifact === null ? [] : [{ archive_download_url: `${url}${prefix}/actions/artifacts/${run.artifact}/zip`, expired: false, id: run.artifact, name: 'check', size_in_bytes: artifacts.get(run.artifact)?.zip.length ?? 0, workflow_run: { head_sha: run.head_sha, id: run.id } }]
        return { body: { artifacts: listed, total_count: listed.length }, status: 200 }
      }
      return { body: shown(run), status: 200 }
    }
    const zipped = /^\/actions\/artifacts\/(\d+)\/zip$/.exec(rest)
    if (zipped) {
      const found = artifacts.get(Number(zipped[1]))
      return found ? { bytes: found.zip, status: 200, type: 'application/zip' } : { body: { message: 'Not Found' }, status: 404 }
    }
    return { body: { message: 'Not Found' }, status: 404 }
  }

  const server = createServer((request, response) => {
    const parsed = new URL(request.url ?? '/', 'http://mock')
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      let body: Record<string, unknown> = {}
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        return response.end(JSON.stringify({ message: 'Problems parsing JSON' }))
      }
      const authorized = request.headers['authorization'] === 'Bearer ' + token || request.headers['authorization'] === 'token ' + token
      answer(request.method ?? 'GET', parsed.pathname, parsed.searchParams, body, authorized).then(
        (found) => {
          if (found.bytes) {
            response.writeHead(found.status, { 'content-type': found.type ?? 'application/octet-stream' })
            return response.end(found.bytes)
          }
          response.writeHead(found.status, found.body === undefined ? {} : { 'content-type': 'application/json' })
          response.end(found.body === undefined ? undefined : JSON.stringify(found.body))
        },
        (error: unknown) => {
          errors.push(String(error))
          response.writeHead(500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ message: String(error) }))
        },
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

  return {
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
    complete,
    deliveries,
    errors,
    main,
    refs,
    repo,
    runs,
    secret,
    settings,
    token,
    url,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const github = await start({
    ...(process.env['MOCK_GITHUB_HOOK'] ? { hook: process.env['MOCK_GITHUB_HOOK'] } : {}),
    port: Number(process.env['MOCK_GITHUB_PORT'] ?? 8789),
    ...(process.env['MOCK_GITHUB_SECRET'] ? { secret: process.env['MOCK_GITHUB_SECRET'] } : {}),
  })
  process.stdout.write(JSON.stringify({ repo: github.repo, secret: github.secret, token: github.token, url: github.url }) + '\n')
  const stop = () => void github.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
