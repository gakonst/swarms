import * as Memo from '../shared/Memo.ts'
import * as Gateway from './Gateway.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'

function unspent(branch: Gateway.Subagent) {
  if (branch.budget_usd === undefined) return null
  const left = Memo.units(branch.budget_usd.toFixed(6)) - Memo.units((branch.spent_usd ?? 0).toFixed(6))
  return left > 0n ? left : 0n
}

const keptBytes = 1_000_000

export const keptMs = 10 * 60_000

export const listingMs = 2_000

export const patienceMs = 1_500

export async function list(self: Swarm, swarm: string, agent: string): Promise<Gateway.Result<{ agent: string | null; list: Gateway.Subagent[] }>> {
  const value = Gateway.subagents(self.env, swarm, agent).then((listed): Gateway.Result<{ agent: string | null; list: Gateway.Subagent[] }> => (listed.ok ? { ok: true, value: { agent, list: listed.value } } : listed))
  const flight = { agent, at: Date.now(), pending: true, value }
  self.listing = flight
  const result = await value.catch((error: unknown) => ({ detail: error instanceof Error ? error.message : String(error), ok: false as const, status: 503 }))
  if (self.listing !== flight) return result
  self.listing = result.ok ? { ...flight, at: Date.now(), pending: false } : undefined
  if (result.ok && JSON.stringify(result.value.list).length < keptBytes) self.ctx.storage.kv.put('subagents', { agent, at: flight.at, list: result.value.list })
  return result
}

export function rebudget(self: Swarm, swarm: string, agent: string, branch: number) {
  const run = self.budgeting.then(async () => {
    const money = await Store.funds(self.env, swarm, agent)
    const funded = [...(money.shares.get(branch)?.values() ?? [])].reduce((sum, amount) => sum + amount, 0n)
    const total = (money.bases.get(branch) ?? 0n) + funded
    return Gateway.budget(self.env, swarm, agent, branch, Number(total > 0n ? total : 1n) / 1_000_000)
  })
  self.budgeting = run.catch(() => undefined)
  return run
}

export async function settled(self: Swarm, row: Store.Row) {
  const agent = self.agent()?.id
  if (!agent) return
  const at = Date.now()
  const listed = await Gateway.subagents(self.env, row.id, agent)
  if (!listed.ok) return
  const closed = listed.value.filter((found) => found.parent_agent_id === null && found.status.state === 'closed')
  const settled = closed.length ? (await Store.funds(self.env, row.id, agent)).settled : new Set<number>()
  for (const branch of closed.filter((found) => !settled.has(found.agent_id))) await Store.settle(self.env, { agent, branch: branch.agent_id, left: unspent(branch), swarm: row.id })
  self.kv.put('settledAt', at)
}

export async function release(self: Swarm, swarm: string, current: string) {
  for (const old of await Store.replaced(self.env, swarm, current)) {
    const listed = old.agent ? await Gateway.subagents(self.env, swarm, old.agent).catch(() => undefined) : undefined
    for (const branch of old.branches) {
      const found = listed?.ok ? listed.value.find((agent) => agent.agent_id === branch) : undefined
      await Store.settle(self.env, { agent: old.agent, branch, left: found ? unspent(found) : null, swarm })
    }
  }
}
