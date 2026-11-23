import * as child from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import * as Mock from '../mock/gateway.ts'
import * as GitHub from '../mock/github.ts'

export type Dev = Awaited<ReturnType<typeof start>>

const root = path.join(import.meta.dirname, '..', '..')

const bin = (name: string) => path.join(root, 'node_modules', '.bin', name)

async function free() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

export function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const done = child.spawnSync(command, args, { cwd: root, encoding: 'utf8', env, timeout: 120_000 })
  if (done.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${done.stdout}${done.stderr}`)
  return done.stdout
}

export async function start(options: { gateway?: Mock.Options; leaseMs?: number; port?: number; spawn?: 'api' | 'dispatcher' } = {}) {
  const state = fs.mkdtempSync(path.join(process.env['E2E_STATE'] ?? os.tmpdir(), 'swarms-e2e-'))
  const port = options.port ?? (await free())
  const url = `http://127.0.0.1:${port}/swarms`
  const gateway = await Mock.start(options.gateway)
  const github = await GitHub.start({ hook: url + '/v1/hooks/github' })
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
    GITHUB_API: github.url,
    SWARMS_GATEWAY: gateway.url,
    SWARMS_GATEWAY_KEY: gateway.key,
    SWARMS_GITHUB_TOKEN: github.token,
    SWARMS_GITHUB_WEBHOOK_SECRET: github.secret,
    SWARMS_STATE: state,
    SWARMS_URL: url,
    TEMPO_RPC: gateway.url + '/mock/rpc',
    SWARMS_PROOFS_REPO: github.repo,
    ...(options.leaseMs ? { SWARMS_LEASE_MS: String(options.leaseMs) } : {}),
    ...(options.spawn === 'api' ? { SWARMS_SPAWN: 'api' } : {}),
  }
  run(bin('wrangler'), ['d1', 'migrations', 'apply', 'swarms', '--local', '--persist-to', state], env)
  const log: string[] = []
  const pids = process.env['E2E_PIDS']
  let vite: child.ChildProcess | undefined
  const kill = async (signal: 'SIGKILL' | 'SIGTERM') => {
    const pid = vite?.pid
    if (!vite || !pid || vite.exitCode !== null) return
    const exited = new Promise((resolve) => vite?.once('exit', resolve))
    try {
      process.kill(-pid, signal)
    } catch {}
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))])
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
    if (pids) fs.rmSync(path.join(pids, String(pid)), { force: true })
  }
  const launch = async () => {
    const started = child.spawn(bin('vite'), ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    vite = started
    if (pids && started.pid) fs.writeFileSync(path.join(pids, String(started.pid)), 'vite\n')
    started.stdout?.on('data', (chunk: Buffer) => log.push(chunk.toString()))
    started.stderr?.on('data', (chunk: Buffer) => log.push(chunk.toString()))
    const until = Date.now() + 90_000
    for (;;) {
      const answered = await fetch(url + '/v1/config').then((response) => response.status, () => 0)
      if (answered === 200) return
      if (started.exitCode !== null || Date.now() > until) throw new Error('pnpm dev did not start: ' + log.join('').slice(-3000))
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  const stop = async () => {
    await kill('SIGTERM')
    await gateway.close()
    await github.close()
    fs.rmSync(state, { force: true, recursive: true })
  }
  const restart = async (signal: 'SIGKILL' | 'SIGTERM' = 'SIGKILL') => {
    await kill(signal)
    await launch()
  }
  try {
    await launch()
  } catch (error) {
    await stop()
    throw error
  }
  const call = async <value = Record<string, unknown>>(method: string, route: string, body?: unknown, token?: string) => {
    const response = await fetch(url + route, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { accept: 'application/json', 'content-type': 'application/json', origin: new URL(url).origin, ...(token ? { authorization: 'Bearer ' + token } : {}) },
      method,
    })
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {}
    return { body: parsed as value, status: response.status }
  }
  return { call, env, gateway, github, log, port, restart, state, stop, url }
}
