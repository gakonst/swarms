import { world } from './run.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import type * as NodesModule from '../src/worker/Nodes.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'

const Store: typeof StoreModule = await import('../src/worker/Store.ts')
const Nodes: typeof NodesModule = await import('../src/worker/Nodes.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')

Runner.timing.pollMs = 10
Runner.timing.listMs = 0
Runner.timing.streamDownMs = 10
Runner.timing.idleMs = 100_000
Runner.timing.verifyMs = 10

export const id = 'abc123abc123'

export const ana = '0x' + 'a'.repeat(40)

export const bo = '0x' + 'b'.repeat(40)

export type Sub = { agent_id: number; budget_usd?: number; messages: string[]; parent_agent_id: null; role: string; spent_usd: number; status: { error?: string; output?: unknown; state: string }; task: string }

export function gateway() {
  const subs: Sub[] = []
  const prompts: string[] = []
  const budgets: [number, number][] = []
  const spawned: Record<string, unknown>[] = []
  const state = { agents: 0, refuse: false }
  const make = (args: { budget_usd: number; role: string; task: string }) => {
    const sub: Sub = { agent_id: subs.length + 1, budget_usd: args.budget_usd, messages: [], parent_agent_id: null, role: args.role, spent_usd: 0, status: { state: 'running' }, task: args.task }
    subs.push(sub)
    return sub
  }
  const route = async (request: Request, url: URL) => {
    if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' + ++state.agents })
    const turn = url.pathname.match(/^\/v1\/agents\/(agt_d\d+)\/turns$/)
    if (turn && request.method === 'POST') {
      if (state.refuse) return Response.json({ error: 'over_limit' }, { status: 402 })
      const body = (await request.json()) as { prompt: string }
      prompts.push(body.prompt)
      make(JSON.parse(body.prompt.slice(body.prompt.indexOf('{'))) as { budget_usd: number; role: string; task: string })
      return Response.json({ request_id: 'x', status: 'queued' })
    }
    if (/^\/v1\/agents\/agt_d\d+\/subagents$/.test(url.pathname) && request.method === 'POST') {
      const body = (await request.json()) as { budget_usd: number; role: string; task: string }
      spawned.push(body)
      return Response.json({ agent: make(body), created: true })
    }
    if (/^\/v1\/agents\/agt_d\d+\/subagents$/.test(url.pathname)) return Response.json({ agents: subs })
    const sub = url.pathname.match(/^\/v1\/agents\/agt_d\d+\/subagents\/(\d+)\/(budget|close|messages)$/)
    if (sub) {
      const found = subs.find((one) => one.agent_id === Number(sub[1]))
      if (!found) return Response.json({ error: 'no' }, { status: 404 })
      const body = request.method === 'POST' && sub[2] !== 'close' ? ((await request.json()) as Record<string, unknown>) : {}
      if (sub[2] === 'budget') {
        found.budget_usd = Number(body['budget_usd'])
        budgets.push([found.agent_id, found.budget_usd])
        return Response.json({ agent: found })
      }
      if (sub[2] === 'messages') {
        found.messages.push(String(body['message']))
        return Response.json({ disposition: 'queued' })
      }
      if (!['completed', 'failed'].includes(found.status.state)) found.status = { ...found.status, state: 'closed' }
      return Response.json({ agents: subs })
    }
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '10', left: '10', spent: '0' })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: '0x' + 'e'.repeat(40) })
    return undefined
  }
  return { budgets, make, prompts, route, spawned, state, subs }
}

export async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out')
}

export function github(env: Cloudflare.Env) {
  Object.assign(env, { GITHUB: { fetch: async (request: Request) => (request.method === 'GET' ? Response.json({ workflow_runs: [] }) : new Response(null, { status: 204 })) }, SWARMS_GITHUB_TOKEN: 't' })
}

export async function planted(route: Parameters<typeof world>[0], triageShare = 0, statement: string | null = null) {
  const w = world(route)
  github(w.env)
  await Store.insert(w.env, { creator: null, form: 'tree', goal: 'g', id, problem: null, setup: null, steering: 'open', title: 'Tree' })
  await w.swarm.plant({
    dispatcher: 'spawn',
    rules: 'rules',
    root: { statement, title: 'Does P = NP?', words: 'The question.' },
    seed: [],
    settings: { ...Nodes.defaults, triageShare },
    setup: null,
    swarm: id,
  })
  return w
}

export const proof = (sha: string, statement = 'none') => ({ at: 1, axioms: ['propext'], checker: 'lean4checker', command: 'lake build', commit: sha, contentHash: 'h', durationMs: 1, exitCode: 0, mathlib: 'm', repo: 'r', run: '1', statement, theorem: 'Pnp.N', toolchain: 't', url: 'https://example.test/run/1' })
