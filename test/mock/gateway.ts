import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { keccak256, stringToHex } from 'viem'
import * as Chain from './chain.ts'
import * as Model from './model.ts'

export type Token = Chain.Token

export type Deposit = { amount: string; from: Chain.Address; log: number; tag: Chain.Hex; token: Token }

export type Credited = Deposit & { created_at: number; hash: Chain.Hex }

export type Standing = { deposited: string; left: string; spent: string }

export type Charge = { agent: string; at: number; subagent: number | null; tree: number | null; usd: bigint; what: string }

type Status = { error?: string; output?: unknown; state: string }

type Message = { at: number; message: string; priority: string; read: boolean }

type Sub = {
  budget: bigint | null
  children: number[]
  createdAt: number
  harness: string | null
  held: bigint
  id: number
  messages: Message[]
  model: string | null
  own: bigint
  parent: number | null
  role: string
  status: Status
  task: string
}

type Turn = { createdAt: number; credentials?: string; error?: string; prompt: string; request_id: string; spent: bigint; status: string }

export type Event = { created_at: number; event: Record<string, unknown>; request_id?: string; seq: number }

type Agent = {
  app: string
  createdAt: number
  events: Event[]
  harness: string | null
  id: string
  instructions: string | null
  model: string | null
  name: string
  next: number
  payer: string | null
  streams: Set<ServerResponse>
  subagents: unknown
  subs: Map<number, Sub>
  turns: Map<string, Turn>
}

type Stored = { public: boolean }

type App = {
  agents: string[]
  backings: Record<string, unknown>[]
  bucket: Map<string, Stored>
  charges: Charge[]
  commits: { branch: string; date: string; message: string; parents: string[]; sha: string }[]
  deposits: Credited[]
  git: Map<string, Stored>
  hands: { cap?: number; connected: boolean; name: string }[]
  kv: Map<string, Stored>
  moves: { amount: bigint; app: string; at: number; id: string; way: 'in' | 'out' }[]
  name: string
  refunds: { amount: bigint; at: number; hash: Chain.Hex; id: string; to: Chain.Address }[]
  sandboxes: { hand?: string | null; log: { at: number; stream: string; text: string }[]; sandboxId: string; status: string }[]
}

export type Options = {
  chain?: Chain.Chain
  codeStorage?: 'paid' | 'treasury'
  credentialRoute?: boolean
  dispatcherBudget?: number | null
  dispatcherUsd?: number
  key?: string
  port?: number
  scripts?: { match: string; steps: Model.Step[] }[]
  spawnRoute?: boolean
  unsolicited?: boolean
  wallet?: Chain.Address
}

export const models = [
  { capabilities: { tools: true }, id: 'vercel/deepseek/deepseek-v4.1-flash-1017', kind: 'generate', metered: true, pricing: { cached: 0.000_000_02, input: 0.000_000_1, output: 0.000_000_4 } },
  { capabilities: { tools: true }, id: '@cf/zai-org/glm-5.3-flash', kind: 'generate', metered: true, pricing: { cached: 0.000_000_02, input: 0.000_000_1, output: 0.000_000_3 } },
  { capabilities: { tools: true }, id: '@cf/zai-org/glm-5.3', kind: 'generate', metered: true, pricing: { cached: 0.000_000_1, input: 0.000_000_6, output: 0.000_002 } },
  { capabilities: { tools: true }, id: 'vercel/moonshotai/kimi-k3.1-pro', kind: 'generate', metered: true, pricing: { cached: 0.000_000_15, input: 0.000_000_6, output: 0.000_002_5 } },
  { capabilities: { tools: true }, id: 'vercel/anthropic/claude-opus-5.5', kind: 'generate', metered: true, pricing: { cached: 0.000_000_5, input: 0.000_005, output: 0.000_025 } },
  { capabilities: { tools: true }, id: 'vercel/anthropic/claude-fable-5.2', kind: 'generate', metered: true, pricing: { cached: 0.000_000_3, input: 0.000_003, output: 0.000_015 } },
  { capabilities: { tools: true }, id: 'vercel/openai/gpt-6.1-sol', kind: 'generate', metered: true, pricing: { cached: 0.000_000_125, input: 0.000_001_25, output: 0.000_01 } },
  { capabilities: { tools: true }, id: 'vercel/google/gemini-3.8-flash', kind: 'generate', metered: true, pricing: { cached: 0.000_000_075, input: 0.000_000_75, output: 0.000_003_75 } },
  { capabilities: { tools: true }, id: 'vercel/openai/gpt-6-astra', kind: 'generate', metered: true, pricing: { cached: 0.000_000_05, input: 0.000_000_5, output: 0.000_004 } },
  { capabilities: { tools: true }, id: 'boundless/z-ai/glm-5.3-flash', kind: 'generate', metered: false, pricing: { cached: 0, input: 0, output: 0 } },
  { capabilities: { tools: false }, id: 'vercel/openai/text-embedding-4', kind: 'embed', metered: true, pricing: { input: 0.000_000_02 } },
]

class Problem extends Error {
  code: string
  status: number
  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.status = status
    this.code = code
  }
}

const decimal = Chain.decimal

export const gitCost = { commit: 5_000n, create: 1_000_000n }

const units = Chain.units

export type Gateway = Awaited<ReturnType<typeof start>>

export async function start(options: Options = {}) {
  const chain = options.chain ?? Chain.create()
  const key = options.key ?? 'sk-tempo-mock'
  const wallet = (options.wallet ?? Chain.address('operator')).toLowerCase() as Chain.Address
  const apps = new Map<string, App>()
  const agents = new Map<string, Agent>()
  const counted = new Map<string, string>()
  const settled = new Map<string, unknown>()
  const scripts = [...(options.scripts ?? [])]
  const calls: { at: number; method: string; path: string; status: number }[] = []
  const errors: string[] = []
  const settings = { codeStorage: options.codeStorage ?? 'paid', credentialRoute: options.credentialRoute ?? true, dispatcherBudget: options.dispatcherBudget, dispatcherUsd: options.dispatcherUsd ?? 0.0005, spawnRoute: options.spawnRoute ?? true, unsolicited: options.unsolicited ?? false }
  const keyed = new Map<string, number>()
  const owned = new Map<string, { claude: string; keys: Map<string, { added_at: number; hint: string }> }>()
  let agentCount = 0
  let closing = false

  const app = (name: string) => {
    let found = apps.get(name)
    if (!found) {
      found = { agents: [], backings: [], bucket: new Map(), charges: [], commits: [], deposits: [], git: new Map(), hands: [], kv: new Map(), moves: [], name, refunds: [], sandboxes: [] }
      apps.set(name, found)
    }
    return found
  }

  const ledger = (name: string) => {
    const found = app(name)
    const deposited = found.deposits.reduce((sum, each) => sum + units(each.amount), 0n)
    const refunded = found.refunds.reduce((sum, each) => sum + each.amount, 0n)
    const out = found.moves.filter((each) => each.way === 'out').reduce((sum, each) => sum + each.amount, 0n)
    const spent = found.charges.reduce((sum, each) => sum + each.usd, 0n)
    const held = [...agents.values()].filter((agent) => agent.app === name).reduce((sum, agent) => sum + [...agent.subs.values()].reduce((inner, sub) => inner + sub.held, 0n), 0n)
    return { deposited: deposited - refunded - out, held, movedOut: out, received: deposited, refunded, spent, left: deposited - refunded - out - spent }
  }

  const standing = (name: string): Standing => {
    const found = ledger(name)
    return { deposited: decimal(found.deposited), left: decimal(found.left), spent: decimal(found.spent) }
  }

  const lineage = (agent: Agent, id: number) => {
    const chain: Sub[] = []
    for (let at: number | null = id; at !== null; ) {
      const sub = agent.subs.get(at)
      if (!sub) break
      chain.push(sub)
      at = sub.parent
    }
    return chain
  }

  const subtree = (agent: Agent, sub: Sub, field: 'held' | 'own'): bigint => sub[field] + sub.children.reduce((sum, child) => { const found = agent.subs.get(child); return sum + (found ? subtree(agent, found, field) : 0n) }, 0n)

  const raw = (agent: Agent, sub: Sub) => ({
    agent_id: sub.id,
    ...(sub.budget === null ? {} : { budget_usd: Chain.usd(sub.budget) }),
    created_at: sub.createdAt,
    harness: sub.harness,
    ...(sub.status.output === undefined ? {} : { last_output: sub.status.output }),
    lineage: lineage(agent, sub.id).map((each) => each.id).reverse(),
    model: sub.model,
    parent_agent_id: sub.parent,
    role: sub.role,
    spent_usd: Chain.usd(subtree(agent, sub, 'own')),
    status: sub.status,
    task: sub.task,
  })

  const append = (agent: Agent, event: Record<string, unknown>, request?: string) => {
    const entry: Event = { created_at: Date.now(), event, ...(request ? { request_id: request } : {}), seq: agent.events.length + 1 }
    agent.events.push(entry)
    for (const stream of agent.streams) stream.write('data: ' + JSON.stringify(entry) + '\n\n')
    return entry
  }

  const live = (agent: Agent, event: Record<string, unknown>) => {
    const entry = { created_at: Date.now(), event, seq: agent.events.length }
    for (const stream of agent.streams) stream.write('event: live\ndata: ' + JSON.stringify(entry) + '\n\n')
  }

  const emitted = (agent: Agent, sub: Sub | null) => (type: string, payload: Record<string, unknown>, streamed = false) => {
    const inner = { payload, type }
    const event = sub ? { root_session_id: agent.id, source: 'subagent', update: { event: inner, id: sub.id, type: 'event' } } : { event: inner, source: 'session' }
    if (streamed) live(agent, event)
    else append(agent, event)
  }

  const meter = async (agent: Agent, sub: Sub | null, usd: number, ms: number, what: string) => {
    const amount = units(usd)
    const standingNow = ledger(agent.app)
    if (standingNow.left - standingNow.held < amount)
      return { error: `This app's credit has $${decimal(standingNow.left)} left, less than this call's $${decimal(amount)}: the call was not paid: over_limit`, ok: false as const, status: 402 as const }
    if (sub) {
      for (const bound of lineage(agent, sub.id)) {
        if (bound.budget === null) continue
        const spent = subtree(agent, bound, 'own')
        const held = subtree(agent, bound, 'held')
        if (spent + amount > bound.budget)
          return { error: `over_limit: subagent ${bound.id}'s budget of $${decimal(bound.budget)} has $${decimal(spent)} spent, and this call needs $${decimal(amount)}`, ok: false as const, status: 402 as const }
        if (spent + held + amount > bound.budget) return { error: `over_limit: subagent ${bound.id}'s budget is held by requests in flight`, ok: false as const, status: 429 as const }
      }
      sub.held += amount
    }
    await sleep(ms)
    if (sub) sub.held -= amount
    const top = sub ? (lineage(agent, sub.id).at(-1)?.id ?? null) : null
    app(agent.app).charges.push({ agent: agent.id, at: Date.now(), subagent: sub?.id ?? null, tree: top, usd: amount, what })
    if (sub) sub.own += amount
    return { ok: true as const }
  }

  const bill = (found: App, usd: bigint, what: string) => {
    const standingNow = ledger(found.name)
    if (standingNow.left - standingNow.held < usd) throw new Problem(402, 'over_limit', `This app's credit has $${decimal(standingNow.left)} left, less than this call's $${decimal(usd)}: the call was not paid: over_limit`)
    found.charges.push({ agent: '', at: Date.now(), subagent: null, tree: null, usd, what })
  }

  const finish = (agent: Agent, sub: Sub, status: Status) => {
    if (['closed', 'completed', 'failed', 'interrupted'].includes(sub.status.state)) return
    sub.status = status
    const commit = (status.output as { commit?: unknown } | undefined)?.commit
    if (typeof commit === 'string') {
      const found = app(agent.app)
      found.git.set('swarm', { public: true })
      found.commits.push({ branch: 'node/' + Model.nid(sub.role), date: new Date().toISOString(), message: sub.role + ': ' + String((status.output as { summary?: unknown }).summary ?? ''), parents: [], sha: commit })
    }
    append(agent, { root_session_id: agent.id, source: 'subagent', update: { id: sub.id, status, type: status.state === 'completed' ? 'completion' : 'status' } })
  }

  const spawn = (agent: Agent, parent: Sub | null, input: Model.Spawn & { harness?: string | null; model?: string | null }) => {
    const sub: Sub = {
      budget: input.budget_usd === undefined || input.budget_usd === null ? null : units(input.budget_usd),
      children: [],
      createdAt: Date.now(),
      harness: input.harness ?? agent.harness,
      held: 0n,
      id: agent.next++,
      messages: [],
      model: input.model ?? agent.model,
      own: 0n,
      parent: parent?.id ?? null,
      role: input.role,
      status: { state: 'running' },
      task: input.task,
    }
    agent.subs.set(sub.id, sub)
    parent?.children.push(sub.id)
    append(agent, { root_session_id: agent.id, source: 'subagent', update: { agent: { id: sub.id, parent_agent_id: sub.parent, role: sub.role, task: sub.task }, type: 'added' } })
    const scripted = input.steps ?? scripts.find((each) => sub.role.includes(each.match) || sub.task.includes(each.match))?.steps
    const steps = Model.script(sub.role, sub.task, scripted)
    const ended = (state: string) => ['closed', 'completed', 'failed', 'interrupted'].includes(state)
    const context: Model.Context = {
      closed: () => ended(sub.status.state) || closing,
      emit: emitted(agent, sub),
      inbox: () => sub.messages.filter((each) => !each.read).map((each) => ((each.read = true), each.message)),
      join: async (id) => {
        for (;;) {
          const child = agent.subs.get(id)
          if (!child || ended(child.status.state) || closing) return child?.status.state ?? 'closed'
          await sleep(25)
        }
      },
      meter: (usd, ms) => meter(agent, sub, usd, ms, sub.role),
      role: sub.role,
      sleep,
      spawn: async (child) => spawn(agent, sub, child).id,
      task: sub.task,
    }
    void Model.play(steps, context)
      .then((done) => {
        if (done.state === 'completed') finish(agent, sub, { output: done.output, state: 'completed' })
        else if (done.state === 'failed') finish(agent, sub, { error: done.error, state: 'failed' })
      })
      .catch((error: unknown) => {
        errors.push(String(error))
        finish(agent, sub, { error: String(error), state: 'failed' })
      })
    return sub
  }

  const close = (agent: Agent, sub: Sub, state: 'closed' | 'interrupted') => {
    for (const child of sub.children) {
      const found = agent.subs.get(child)
      if (found) close(agent, found, state)
    }
    finish(agent, sub, { ...(sub.status.output === undefined ? {} : { output: sub.status.output }), state })
  }

  const play = async (agent: Agent, turn: Turn) => {
    turn.status = 'running'
    const emit = emitted(agent, null)
    const asked = Model.spawned(turn.prompt)
    const paid = await meter(agent, null, asked ? settings.dispatcherUsd : 0.01, 20, 'turn')
    if (!paid.ok) {
      emit('model.call.failed', { error: paid.error })
      turn.status = 'failed'
      turn.error = paid.error
      append(agent, { error: { message: paid.error }, status: 'failed', type: 'result' }, turn.request_id)
      return
    }
    turn.spent += units(asked ? settings.dispatcherUsd : 0.01)
    emit('model.call.completed', { cost_usd: asked ? settings.dispatcherUsd : 0.01 })
    if (asked) {
      const budget = settings.dispatcherBudget === undefined ? asked.budget_usd : (settings.dispatcherBudget ?? undefined)
      emit('tool.call', { arguments: JSON.stringify({ ...asked, budget_usd: budget }), call_id: 'call_' + turn.request_id, name: 'spawn_agent' })
      const sub = spawn(agent, null, { role: asked.role, task: asked.task, ...(budget === undefined ? {} : { budget_usd: budget }) })
      if (settings.unsolicited) spawn(agent, null, { role: asked.role + ' (extra)', steps: [{ stall: 86_400_000 }], task: 'Unasked.' })
      emit('tool.result', { call_id: 'call_' + turn.request_id, name: 'spawn_agent', output: JSON.stringify({ agent_id: sub.id }) })
      emit('assistant.message', { text: 'Spawned ' + asked.role })
    }
    const answer = asked ? 'done' : (Model.pick(turn.prompt) ?? 'Noted.')
    if (!asked) emit('assistant.message', { text: answer })
    if (turn.status !== 'running') return
    turn.status = 'completed'
    emit('run.completed', {})
    append(agent, { ok: { message: answer }, spent_usd: Chain.usd(turn.spent), status: 'completed', type: 'result' }, turn.request_id)
  }

  const find = (id: string, name: string | null) => {
    const agent = agents.get(id)
    if (!agent || (name && agent.app !== name)) throw new Problem(404, 'not_found', `No agent ${id}.`)
    return agent
  }

  const sub = (agent: Agent, id: string) => {
    if (!/^[1-9]\d*$/.test(id)) throw new Problem(400, 'invalid_request', 'Subagent ids are positive integers.')
    const found = agent.subs.get(Number(id))
    if (!found) throw new Problem(404, 'not_found', `No subagent ${id}.`)
    return found
  }

  const credit = (name: string, hash: string) => {
    const transfer = chain.find(hash)
    const moved = app(name).deposits.filter((each) => each.hash === hash.toLowerCase())
    if (!transfer && moved.length && counted.get(hash.toLowerCase()) === name) return { created: false, credit: standing(name), deposits: moved.map(({ amount, from, log, tag, token }) => ({ amount, from, log, tag, token })) }
    if (!transfer) throw new Problem(404, 'not_found', `No transfer ${hash} on chain ${Chain.chainId}.`)
    const prefix = Chain.prefix(wallet, name)
    const logs = transfer.logs.flatMap((log, index) => (log.to === Chain.recipient && log.memo.startsWith(prefix) ? [{ index, log }] : []))
    if (!logs.length) throw new Problem(400, 'invalid_request', `Transfer ${hash} does not credit ${name}.`)
    const owner = counted.get(transfer.hash)
    if (owner && owner !== name) throw new Problem(409, 'conflict', `Transfer ${hash} already credited ${owner}.`)
    const deposits = logs.map(({ index, log }) => ({ amount: log.amount, from: log.from, log: index, tag: Chain.tag(log.memo), token: log.token }))
    if (owner) return { created: false, credit: standing(name), deposits }
    counted.set(transfer.hash, name)
    for (const deposit of deposits) app(name).deposits.push({ ...deposit, created_at: Date.now(), hash: transfer.hash })
    return { created: true, credit: standing(name), deposits }
  }

  const once = <value>(id: string, work: () => value): value => {
    if (settled.has(id)) return settled.get(id) as value
    const value = work()
    settled.set(id, value)
    return value
  }

  const refund = (input: { amount?: unknown; app?: unknown; id?: unknown; to?: unknown }) => {
    if (typeof input.app !== 'string' || typeof input.to !== 'string' || typeof input.amount !== 'string' || typeof input.id !== 'string') throw new Problem(400, 'invalid_request', 'Refund takes app, to, amount and id.')
    const { amount: text, app: name, id, to } = input as { amount: string; app: string; id: string; to: string }
    return once('refund:' + id, () => {
      const amount = units(text)
      const from = to.toLowerCase() as Chain.Address
      const found = app(name)
      const put = found.deposits.filter((each) => each.from === from).reduce((sum, each) => sum + units(each.amount), 0n)
      const back = found.refunds.filter((each) => each.to === from).reduce((sum, each) => sum + each.amount, 0n)
      if (amount <= 0n || amount > put - back) throw new Problem(409, 'conflict', `${from} deposited $${decimal(put)} to ${name} and was refunded $${decimal(back)}; $${decimal(amount)} is more than the rest.`)
      if (amount > ledger(name).left) throw new Problem(402, 'over_limit', `${name} has $${decimal(ledger(name).left)} left.`)
      const transfer = chain.transfer({ amount: decimal(amount), from: Chain.recipient, memo: keccak256(stringToHex('refund:' + id)), to: from })
      found.refunds.push({ amount, at: Date.now(), hash: transfer.hash, id, to: from })
      return { amount: decimal(amount), credit: standing(name), hash: transfer.hash, id }
    })
  }

  const move = (input: { from?: unknown; id?: unknown; riders?: unknown; tag?: unknown; to?: unknown }) => {
    if (typeof input.from !== 'string' || typeof input.to !== 'string' || typeof input.id !== 'string' || !Array.isArray(input.riders)) throw new Problem(400, 'invalid_request', 'Move takes from, to, id and riders [{ address, amount }].')
    const { from, id, to } = input as { from: string; id: string; to: string }
    const riders = (input.riders as { address?: unknown; amount?: unknown }[]).map((each) => {
      if (typeof each.address !== 'string' || typeof each.amount !== 'string') throw new Problem(400, 'invalid_request', 'Each rider has an address and an amount.')
      return { address: each.address.toLowerCase() as Chain.Address, amount: units(each.amount) }
    })
    const tag = (typeof input.tag === 'string' ? input.tag : '0x' + '0'.repeat(32)) as Chain.Hex
    return once('move:' + id, () => {
      const total = riders.reduce((sum, each) => sum + each.amount, 0n)
      if (total <= 0n || total > ledger(from).left) throw new Problem(402, 'over_limit', `${from} has $${decimal(ledger(from).left)} left, less than $${decimal(total)}.`)
      app(from).moves.push({ amount: total, app: to, at: Date.now(), id, way: 'out' })
      app(to).moves.push({ amount: total, app: from, at: Date.now(), id, way: 'in' })
      const deposits = riders.map((each, log) => {
        const hash = keccak256(stringToHex(`move:${id}:${each.address}`))
        const deposit: Credited = { amount: decimal(each.amount), created_at: Date.now(), from: each.address, hash, log, tag, token: 'pathusd' }
        counted.set(hash, to)
        app(to).deposits.push(deposit)
        return deposit
      })
      return { deposits, from: standing(from), id, to: standing(to) }
    })
  }

  const route = async (method: string, url: URL, body: Record<string, unknown>, headers: IncomingMessage['headers'], response: ServerResponse): Promise<unknown> => {
    const path = url.pathname
    const name = typeof headers['gateway-app'] === 'string' ? headers['gateway-app'] : null
    const named = () => {
      if (!name) throw new Problem(400, 'invalid_request', 'Send the app in the gateway-app header.')
      return name
    }

    if (path === '/mock/rpc' && method === 'POST') return chain.rpc(body)
    if (path === '/mock/transfer' && method === 'POST') {
      const tag = (typeof body['tag'] === 'string' ? body['tag'] : '0x' + '0'.repeat(32)) as Chain.Hex
      const memo = (typeof body['memo'] === 'string' ? body['memo'] : Chain.memo(String(body['owner'] ?? wallet), String(body['app'] ?? ''), tag)) as Chain.Hex
      return chain.transfer({ amount: String(body['amount'] ?? '0'), from: String(body['from'] ?? Chain.address('rider')) as Chain.Address, memo, ...(body['token'] ? { token: body['token'] as Token } : {}) })
    }
    if (path === '/mock/ledger') return Object.fromEntries([...apps.keys()].filter((each) => !url.searchParams.get('app') || each === url.searchParams.get('app')).map((each) => [each, view(each)]))
    if (path === '/mock/agents') return [...agents.values()].filter((agent) => !url.searchParams.get('app') || agent.app === url.searchParams.get('app')).map((agent) => described(agent))
    if (path === '/mock/scripts' && method === 'POST') {
      scripts.unshift({ match: String(body['match'] ?? ''), steps: body['steps'] as Model.Step[] })
      return { scripts: scripts.length }
    }
    if (path === '/mock/scripts' && method === 'DELETE') return { scripts: (scripts.length = 0) }
    if (path === '/mock/settings' && method === 'POST') {
      if ('dispatcherBudget' in body) settings.dispatcherBudget = body['dispatcherBudget'] as number | null | undefined
      if (typeof body['unsolicited'] === 'boolean') settings.unsolicited = body['unsolicited']
      if (body['codeStorage'] === 'paid' || body['codeStorage'] === 'treasury') settings.codeStorage = body['codeStorage']
      if (typeof body['spawnRoute'] === 'boolean') settings.spawnRoute = body['spawnRoute']
      if (typeof body['credentialRoute'] === 'boolean') settings.credentialRoute = body['credentialRoute']
      if (typeof body['dispatcherUsd'] === 'number') settings.dispatcherUsd = body['dispatcherUsd']
      return settings
    }
    if (path === '/mock/store' && method === 'POST') {
      const found = app(String(body['app']))
      const kind = String(body['kind'])
      if (kind === 'sandbox') {
        found.sandboxes.push({ hand: null, log: [{ at: Date.now(), stream: 'stdout', text: String(body['text'] ?? 'ok') }], sandboxId: String(body['key']), status: 'running' })
        return { ok: true }
      }
      if (kind === 'hand') {
        found.hands.push({ connected: true, name: String(body['key']) })
        return { ok: true }
      }
      const into = kind === 'git' ? found.git : kind === 'bucket' ? found.bucket : found.kv
      into.set(String(body['key']), { public: body['public'] === true })
      return { ok: true }
    }
    if (path === '/mock/calls') return { calls, errors }
    if (path === '/mock/chain') return { count: chain.count(), transfers: chain.list() }

    if (path === '/v1/models') return { data: models, object: 'list' }
    if (path.startsWith('/p/')) {
      const parts = path.split('/')
      const found = apps.get(parts[3] ?? '')
      if (!found) throw new Problem(404, 'not_found', 'No such app.')
      if (settings.codeStorage === 'treasury' && (parts[4] !== 'git' || parts.length > 5)) throw new Problem(503, 'unavailable', "The gateway's treasury cannot cover Code Storage now, and this caller cannot pay it directly.")
      if (parts[4] === 'kv' || parts[4] === 'bucket') return { entries: [...(parts[4] === 'kv' ? found.kv : found.bucket)].filter(([, stored]) => stored.public).map(([stored]) => ({ key: stored })), objects: [] }
      if (parts.length <= 5) return { repos: [...found.git].filter(([, stored]) => stored.public).map(([repo]) => ({ name: repo, public: true })) }
      const ref = url.searchParams.get('ref')
      const view = parts[6] ?? ''
      if (view === 'branches') return { branches: [...new Set(found.commits.map((each) => each.branch))].map((branch) => ({ name: branch, sha: found.commits.filter((each) => each.branch === branch).at(-1)?.sha ?? null })) }
      if (view === 'log') return { commits: found.commits.filter((each) => !ref || ref === 'main' || each.sha === ref || each.branch === ref).reverse() }
      if (view === 'files' || view === 'diff') return { files: [] }
      throw new Problem(404, 'not_found', 'No such file.')
    }

    if (!settings.credentialRoute && path.startsWith('/v1/credentials/')) throw new Problem(404, 'not_found', `No route answers ${method} ${path}; the routes are in /openapi.json and at /reference.`)

    if (headers['authorization'] !== 'Bearer ' + key) throw new Problem(401, 'invalid_api_key', 'The sk-tempo- key in Authorization is unknown.')

    if (path === '/api/keys/me') return { app: name, wallet }
    if (path === '/api/keys/credit' && method === 'GET') return standing(named())
    if (path === '/api/keys/credit' && method === 'POST') return credit(named(), String(body['hash'] ?? ''))
    if (path === '/api/keys/credit/deposits') return { deposits: app(named()).deposits }
    if (path === '/api/keys/credit/refund' && method === 'POST') return refund({ app: name, ...body })
    if (path === '/api/keys/credit/move' && method === 'POST') return move({ from: name, ...body })
    if (path === '/api/keys/backings') {
      const found = app(named())
      return { backings: found.backings, left: '0.000000', spent: '0.000000' }
    }

    const credential = /^\/v1\/credentials\/([^/]+)(\/keys\/(anthropic|openai)|\/plans\/claude(\/complete)?)?$/.exec(path)
    if (credential) {
      const subject = decodeURIComponent(credential[1] ?? '')
      const own = owned.get(subject) ?? { claude: 'none', keys: new Map() }
      owned.set(subject, own)
      const provider = credential[3]
      if (provider && method === 'PUT') {
        const typed = typeof body['key'] === 'string' ? body['key'] : ''
        if (!/^sk-/.test(typed) || /bad/.test(typed)) throw new Problem(400, 'invalid_request', `The ${provider} key was refused by ${provider}.`)
        const kept = { added_at: Date.now(), hint: typed.slice(-4) }
        own.keys.set(provider, kept)
        return { ...kept, provider }
      }
      if (provider && method === 'DELETE') return { deleted: own.keys.delete(provider) }
      if (credential[4] && method === 'POST') {
        if (body['code'] !== 'mock-code') throw new Problem(400, 'invalid_request', 'That code is not the one Claude showed.')
        own.claude = 'authenticated'
        return { state: own.claude }
      }
      if (credential[2] && method === 'POST') return { authorization_url: 'https://claude.ai/oauth/authorize?mock=1', expires_at: Date.now() + 600_000 }
      if (credential[2] && method === 'DELETE') {
        own.claude = 'none'
        return { deleted: true }
      }
      return { keys: [...own.keys].map(([each, kept]) => ({ ...kept, provider: each })), plans: { claude: { state: own.claude } }, subject }
    }

    if (path === '/v1/teams/create') return { address: Chain.address('team:' + String(body['name'])) }
    if (path === '/v1/teams/members') return { memberBudget: null, members: [] }
    if (path.startsWith('/v1/teams/')) return { removed: true }

    if (path === '/v1/agents' && method === 'POST') {
      const id = 'agt_' + (++agentCount).toString(36) + Math.random().toString(36).slice(2, 6)
      const agent: Agent = {
        app: named(),
        createdAt: Date.now(),
        events: [],
        harness: typeof body['harness'] === 'string' ? body['harness'] : null,
        id,
        instructions: typeof body['instructions'] === 'string' ? body['instructions'] : null,
        model: typeof body['model'] === 'string' ? body['model'] : null,
        name: String(body['name'] ?? id),
        next: 1,
        payer: typeof body['payer'] === 'string' ? body['payer'] : null,
        streams: new Set(),
        subagents: body['subagents'] ?? null,
        subs: new Map(),
        turns: new Map(),
      }
      agents.set(id, agent)
      app(agent.app).agents.push(id)
      return { id, name: agent.name }
    }
    if (path === '/v1/agents' && method === 'GET') return { agents: [...agents.values()].filter((agent) => agent.app === name).map((agent) => ({ id: agent.id, name: agent.name })) }

    const matched = /^\/v1\/agents\/([^/]+)(\/.*)?$/.exec(path)
    if (matched) {
      const agent = find(matched[1] ?? '', name)
      const rest = matched[2] ?? ''
      if (rest === '' && method === 'PATCH') {
        if (typeof body['instructions'] === 'string') agent.instructions = body['instructions']
        if (typeof body['payer'] === 'string') agent.payer = body['payer']
        if ('subagents' in body) agent.subagents = body['subagents']
        return { id: agent.id }
      }
      if (rest === '' && method === 'DELETE') {
        agents.delete(agent.id)
        return { deleted: true }
      }
      if (rest === '') return { id: agent.id, instructions: agent.instructions, model: agent.model, name: agent.name, payer: agent.payer }
      if (rest === '/turns' && method === 'POST') {
        const request = typeof body['id'] === 'string' && body['id'] ? body['id'] : `${agent.id}:${agent.turns.size + 1}`
        const known = agent.turns.get(request)
        if (known) return { request_id: known.request_id, status: known.status }
        const turn: Turn = { createdAt: Date.now(), ...(typeof body['credentials'] === 'string' ? { credentials: body['credentials'] } : {}), prompt: String(body['prompt'] ?? ''), request_id: request, spent: 0n, status: 'queued' }
        agent.turns.set(request, turn)
        setTimeout(() => void play(agent, turn).catch((error: unknown) => errors.push(String(error))), 5)
        return { request_id: request, status: 'queued' }
      }
      const turned = /^\/turns\/([^/]+)(\/cancel)?$/.exec(rest)
      if (turned) {
        const turn = agent.turns.get(decodeURIComponent(turned[1] ?? ''))
        if (!turn) throw new Problem(404, 'not_found', 'No such turn.')
        if (turned[2] && method === 'POST' && (turn.status === 'queued' || turn.status === 'running')) {
          turn.status = 'cancelled'
          append(agent, { status: 'cancelled', type: 'result' }, turn.request_id)
        }
        return { ...(turn.error ? { error: { message: turn.error } } : {}), request_id: turn.request_id, spent_usd: Chain.usd(turn.spent), status: turn.status }
      }
      if (rest === '/events') {
        const after = Number(url.searchParams.get('after') ?? 0)
        if (url.searchParams.get('live') === '1') {
          response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/event-stream' })
          response.write(': open\n\n')
          for (const event of agent.events.filter((each) => each.seq > after)) response.write('data: ' + JSON.stringify(event) + '\n\n')
          agent.streams.add(response)
          const beat = setInterval(() => response.write(': beat\n\n'), 10_000)
          response.on('close', () => {
            clearInterval(beat)
            agent.streams.delete(response)
          })
          return streaming
        }
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 128), 1000)
        const page = agent.events.filter((each) => each.seq > after).slice(0, limit)
        return { events: page, has_more: agent.events.filter((each) => each.seq > after).length > page.length, next_cursor: page.at(-1)?.seq ?? after }
      }
      if (rest === '/side_question' && method === 'POST') {
        if (!agent.turns.size) throw new Problem(409, 'conflict', 'the session has no conversation to ask about yet')
        const paid = await meter(agent, null, 0.001, 5, 'side_question')
        if (!paid.ok) throw new Problem(paid.status, 'over_limit', paid.error)
        const question = String(body['question'] ?? '')
        return { text: Model.pick(question) ?? Model.about(question) ?? `The mock lead answers: ${question}`, usage: { estimated_cost: { total_usd: 0.001 } } }
      }
      if (rest === '/subagents' && method === 'GET') return { agents: [...agent.subs.values()].map((each) => raw(agent, each)) }
      if (rest === '/subagents' && method === 'POST') {
        if (!settings.spawnRoute) throw new Problem(404, 'not_found', 'No route answers POST /v1/agents/' + agent.id + '/subagents.')
        const key = typeof body['key'] === 'string' ? agent.id + ':' + body['key'] : undefined
        const again = key === undefined ? undefined : keyed.get(key)
        if (again !== undefined) return { agent: raw(agent, sub(agent, String(again))), created: false }
        if (typeof body['role'] !== 'string' || typeof body['task'] !== 'string') throw new Problem(400, 'invalid_request', 'Spawn takes role and task.')
        const budget = body['budget_usd']
        if (budget !== undefined && budget !== null && (typeof budget !== 'number' || !(budget > 0))) throw new Problem(400, 'invalid_request', 'budget_usd is a positive number or null.')
        const known = [...agent.subs.values()].find((each) => each.role === body['role'] && each.parent === null && !['closed', 'completed', 'failed', 'interrupted'].includes(each.status.state))
        if (known) return { agent: raw(agent, known), created: false }
        const made = spawn(agent, null, {
          role: body['role'],
          task: body['task'],
          ...(typeof budget === 'number' ? { budget_usd: budget } : {}),
          ...(typeof body['model'] === 'string' ? { model: body['model'] } : {}),
          ...(typeof body['harness'] === 'string' ? { harness: body['harness'] } : {}),
        })
        if (key !== undefined) keyed.set(key, made.id)
        return { agent: raw(agent, made), created: true }
      }
      const subbed = /^\/subagents\/([^/]+)(\/[a-z_]+)?$/.exec(rest)
      if (subbed) {
        const found = sub(agent, subbed[1] ?? '')
        const action = subbed[2] ?? ''
        if (action === '') return { agent: raw(agent, found) }
        if (action === '/budget' && method === 'POST') {
          const budget = body['budget_usd']
          if (budget !== null && (typeof budget !== 'number' || !(budget > 0) || budget > 1_000_000)) throw new Problem(400, 'invalid_request', 'budget_usd is a positive number up to 1000000, or null.')
          found.budget = budget === null ? null : units(budget)
          return { agent: raw(agent, found) }
        }
        if (action === '/messages' && method === 'POST') {
          if (['closed', 'completed', 'failed', 'interrupted'].includes(found.status.state)) throw new Problem(409, 'conflict', `Subagent ${found.id} is ${found.status.state}.`)
          found.messages.push({ at: Date.now(), message: String(body['message'] ?? ''), priority: String(body['priority'] ?? 'deferred'), read: false })
          return { disposition: body['priority'] === 'urgent' ? 'steered' : 'queued' }
        }
        if (action === '/side_question' && method === 'POST') {
          const paid = await meter(agent, found, 0.001, 5, 'side_question')
          if (!paid.ok) throw new Problem(paid.status, 'over_limit', paid.error)
          return { text: `${found.role} answers: ${String(body['question'] ?? '')}` }
        }
        if ((action === '/close' || action === '/interrupt') && method === 'POST') {
          close(agent, found, action === '/close' ? 'closed' : 'interrupted')
          return { agents: [...agent.subs.values()].map((each) => raw(agent, each)) }
        }
        if (action === '/events') {
          const after = Number(url.searchParams.get('after') ?? 0)
          const mine = agent.events.filter((each) => each.seq > after && (each.event['update'] as { id?: unknown; agent?: { id?: unknown } } | undefined)?.id === found.id)
          return { events: mine, has_more: false, next_cursor: mine.at(-1)?.seq ?? after }
        }
      }
    }

    const found = name ? app(name) : undefined
    const listed = (into: Map<string, Stored> | undefined) => [...(into ?? new Map<string, Stored>())].filter(([stored]) => stored.startsWith(String(body['prefix'] ?? ''))).map(([stored, value]) => ({ key: stored, public: value.public }))
    if (path === '/v1/kv/list') return { cursor: null, entries: listed(found?.kv) }
    if (path === '/v1/bucket/list') return { cursor: null, objects: listed(found?.bucket) }
    if (path === '/v1/git/create' && found) {
      const repo = String(body['name'] ?? '')
      if (!repo) throw new Problem(400, 'invalid_request', 'Name the repository.')
      if (found.git.has(repo)) throw new Problem(409, 'conflict', `Repository ${repo} exists.`)
      bill(found, gitCost.create, 'git.create')
      found.git.set(repo, { public: body['public'] === true })
      return { name: repo, public: body['public'] === true }
    }
    if (path === '/v1/git/commit' && found) {
      const repo = String(body['name'] ?? '')
      if (!found.git.has(repo)) throw new Problem(404, 'not_found', `No repository ${repo}.`)
      bill(found, gitCost.commit, 'git.commit')
      const sha = keccak256(stringToHex(`commit:${repo}:${found.commits.length}:${String(body['message'] ?? '')}`)).slice(2, 42)
      found.commits.push({ branch: String(body['branch'] ?? 'main'), date: new Date().toISOString(), message: String(body['message'] ?? ''), parents: [], sha })
      return { sha }
    }
    if (path === '/v1/git/list') return { repos: [...(found?.git ?? [])].map(([repo, stored]) => ({ name: repo, public: stored.public })) }
    const shown = /^\/v1\/(kv|bucket|git)\/visibility$/.exec(path)
    if (shown && found) {
      const into = shown[1] === 'git' ? found.git : shown[1] === 'bucket' ? found.bucket : found.kv
      const item = String(body['name'] ?? body['key'] ?? '')
      if (!into.has(item)) throw new Problem(404, 'not_found', `No ${shown[1]} item ${item}.`)
      into.set(item, { public: body['public'] === true })
      return { public: body['public'] === true }
    }
    if (path === '/v1/compute/list') return { sandboxes: (found?.sandboxes ?? []).map(({ hand, sandboxId, status }) => ({ hand: hand ?? null, sandboxId, status })) }
    if (path === '/v1/compute/output' || path === '/v1/compute/terminate' || path === '/v1/compute/logs') {
      const sandbox = found?.sandboxes.find((each) => each.sandboxId === body['sandboxId'])
      if (!sandbox) throw new Problem(404, 'not_found', 'No such sandbox.')
      if (path === '/v1/compute/terminate') {
        sandbox.status = 'terminated'
        return { terminated: true }
      }
      if (path === '/v1/compute/logs') {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' })
        response.end(sandbox.log.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
        return streaming
      }
      return { before: null, entries: sandbox.log, provider: 'mock', sandboxId: sandbox.sandboxId }
    }
    if (path === '/v1/hands' && method === 'GET') return { hands: found?.hands ?? [] }
    if (path === '/v1/hands' && method === 'POST') {
      const hand = url.searchParams.get('name') ?? 'hand'
      return { command: `npx gateway-hand ${hand}`, short: hand, token: 'tok_' + hand, url: `https://gateway.mock/h/${hand}` }
    }
    const handed = /^\/v1\/hands\/([^/]+)(\/cap)?$/.exec(path)
    if (handed && found) {
      const hand = found.hands.find((each) => each.name === decodeURIComponent(handed[1] ?? ''))
      if (handed[2] && hand && typeof body['usd'] === 'number') hand.cap = body['usd']
      if (!handed[2] && method === 'DELETE' && hand) hand.connected = false
      return handed[2] ? { cap: hand?.cap ?? null } : { disconnected: true }
    }
    throw new Problem(404, 'not_found', `The mock gateway has no ${method} ${path}.`)
  }

  const view = (name: string) => {
    const found = app(name)
    const standingNow = ledger(name)
    const bySubagent: Record<string, string> = {}
    for (const charge of found.charges) {
      const at = charge.agent + ':' + (charge.subagent ?? 'lead')
      bySubagent[at] = decimal(units(bySubagent[at] ?? '0') + charge.usd)
    }
    return {
      bySubagent,
      charges: found.charges.length,
      deposited: decimal(standingNow.deposited),
      deposits: found.deposits.length,
      held: decimal(standingNow.held),
      left: decimal(standingNow.left),
      moved: decimal(standingNow.movedOut),
      received: decimal(standingNow.received),
      refunded: decimal(standingNow.refunded),
      spent: decimal(standingNow.spent),
    }
  }

  const described = (agent: Agent) => ({
    app: agent.app,
    events: agent.events.length,
    harness: agent.harness,
    id: agent.id,
    instructions: agent.instructions,
    model: agent.model,
    name: agent.name,
    offer: agent.subagents,
    subagents: [...agent.subs.values()].map((each) => ({ ...raw(agent, each), messages: each.messages.map(({ message, priority, read }) => ({ message, priority, read })) })),
    turns: [...agent.turns.values()].map(({ credentials, prompt, request_id, status }) => ({ credentials: credentials ?? null, prompt, request_id, status })),
  })

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://mock')
    const method = request.method ?? 'GET'
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      const answer = (status: number, value: unknown) => {
        calls.push({ at: Date.now(), method, path: url.pathname, status })
        if (value === streaming) return
        response.writeHead(status, { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' })
        response.end(JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)))
      }
      let body: Record<string, unknown> = {}
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        return answer(400, { code: 'invalid_request', detail: 'The body is not JSON.', status: 400 })
      }
      route(method, url, body, request.headers, response).then(
        (value) => answer(200, value),
        (error: unknown) => {
          if (error instanceof Problem) return answer(error.status, { code: error.code, detail: error.message, error: error.message, status: error.status })
          errors.push(String(error))
          return answer(500, { code: 'internal_error', detail: String(error), status: 500 })
        },
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const url = `http://127.0.0.1:${port}`

  return {
    agents: (name?: string) => [...agents.values()].filter((agent) => !name || agent.app === name).map(described),
    calls,
    chain,
    async close() {
      closing = true
      for (const agent of agents.values()) for (const stream of agent.streams) stream.end()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
    credit: (name: string, hash: string) => credit(name, hash),
    errors,
    key,
    ledger: (name: string) => ledger(name),
    port,
    script(match: string, steps: Model.Step[]) {
      scripts.unshift({ match, steps })
    },
    settings,
    standing,
    transfer(input: { amount: string; app: string; from: Chain.Address; tag?: Chain.Hex; token?: Token }) {
      return chain.transfer({ amount: input.amount, from: input.from, memo: Chain.memo(wallet, input.app, input.tag ?? (('0x' + '0'.repeat(32)) as Chain.Hex)), ...(input.token ? { token: input.token } : {}) })
    },
    url,
    view,
    wallet,
  }
}

const streaming = Symbol('streaming')

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gateway = await start({ ...(process.env['MOCK_GATEWAY_KEY'] ? { key: process.env['MOCK_GATEWAY_KEY'] } : {}), port: Number(process.env['MOCK_GATEWAY_PORT'] ?? 8788) })
  process.stdout.write(JSON.stringify({ key: gateway.key, url: gateway.url, wallet: gateway.wallet }) + '\n')
  const stop = () => void gateway.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
