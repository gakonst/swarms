import * as assert from 'node:assert/strict'
import * as Credit from '../../src/shared/Credit.ts'
import type * as Tree from '../../src/shared/Tree.ts'
import * as Chain from '../mock/chain.ts'
import * as Model from '../mock/model.ts'
import type { Dev } from './dev.ts'
import type { Rider } from './rider.ts'

export type View = { headline: Tree.Headline; nodes: Tree.Node[]; seq?: number }

export type NodeView = Tree.Node & { runs?: { budget: string; k: number; outcome: string | null; spent: string; summary: string; task: string }[] }

export type Ledgered = { drift: string; gateway: { deposited: string; left: string; spent: string } | null; held: string; live: string; ok: boolean; pledged: string; spent: string; swarm: string }

export type Standing = { buckets: { amount: string; node: string }[]; committed: string; free: string; refundable: string; spent: string }

export const tolerance = 50_000n

export const call = Chain.units(String(Model.call))

export class Missing extends Error {}

export function units(amount: string | number | null | undefined) {
  return Chain.units(amount === null || amount === undefined ? '0' : String(amount))
}

export function swarm(dev: Dev, id: string) {
  const app = Credit.app(id)
  const drifts: { at: string; drift: string; first: string; live: string; mock: string }[] = []
  let ledgerPath: string | undefined

  const read = async <value>(route: string, as?: Rider) => {
    const answered = as ? await as.call<value>('GET', route) : await dev.call<value>('GET', route)
    if (answered.status !== 200) throw new Error(`GET ${route} answered ${answered.status}: ${JSON.stringify(answered.body).slice(0, 400)}`)
    return answered.body
  }

  const tree = () => read<View>(`/v1/swarms/${id}/tree?depth=12`)
  const node = (nid: string) => read<NodeView>(`/v1/swarms/${id}/nodes/${nid}`)

  const ledger = async (): Promise<Ledgered> => {
    for (const candidate of ledgerPath ? [ledgerPath] : [`/v1/swarms/${id}/health`, `/v1/swarms/${id}/ledger`, `/v1/health?swarm=${id}`]) {
      const answered = await dev.call<unknown>('GET', candidate)
      const body = answered.body as Partial<Ledgered> & { ledgers?: Ledgered[]; swarms?: Ledgered[] }
      const found = body && typeof body === 'object' ? (typeof body.drift === 'string' ? (body as Ledgered) : (body.ledgers ?? body.swarms ?? []).find((each) => each.swarm === id)) : undefined
      if (answered.status === 200 && found) {
        ledgerPath = candidate
        return found
      }
    }
    throw new Missing('ledger health')
  }

  const balanced = async (at: string) => {
    let health = await ledger()
    let mock = dev.gateway.ledger(app)
    let first: bigint | undefined
    for (let tries = 0; tries < 50; tries++) {
      const off = mock.left - (units(health.held) - units(health.live))
      first ??= off
      const apart = units(health.gateway?.left) - mock.left
      if ((off < 0n ? -off : off) <= tolerance && (apart < 0n ? -apart : apart) <= call) break
      await new Promise((resolve) => setTimeout(resolve, 200))
      health = await ledger()
      mock = dev.gateway.ledger(app)
    }
    assert.ok(health.gateway, at + ': the ledger did not read the gateway credit')
    const read = units(health.gateway.left) - mock.left
    assert.ok((read < 0n ? -read : read) <= call, at + ': the ledger read the gateway credit more than one metered call apart from the mock')
    assert.equal(units(health.held), units(health.pledged) - units(health.spent), at + ': buckets do not sum to pledges less spend')
    const drift = mock.left - (units(health.held) - units(health.live))
    drifts.push({ at, drift: Chain.decimal(drift), first: Chain.decimal(first ?? 0n), live: health.live, mock: Chain.decimal(mock.left) })
    if ((drift < 0n ? -drift : drift) > tolerance) {
      const view = await tree()
      const told = new Map<string, string>()
      for (const each of view.nodes) for (const run of (await node(each.id)).runs ?? []) told.set(`n:${each.id}${'#'}${run.k}`, run.spent)
      const apart = subagents().filter((each) => each.parent_agent_id === null && units(told.get(each.role) ?? '0') !== units(each.spent_usd)).map((each) => `${each.role} ${each.status.state}: gateway $${each.spent_usd}, Swarms $${told.get(each.role) ?? 'none'}`)
      assert.fail(`${at}: sum(flows) less live spend is $${Chain.decimal(units(health.held) - units(health.live))} but the gateway credit has $${Chain.decimal(mock.left)}; runs apart: ${apart.join('; ')}`)
    }
    assert.equal(health.ok, true, at + ': ' + JSON.stringify(health))
    return { drift, health, mock }
  }

  const prepared = async (as: Rider, nid: string, amount: string) => {
    const answered = await as.call<{ memo?: Chain.Hex }>('POST', `/v1/swarms/${id}/transfer`, { amount, node: nid, token: 'pathusd' })
    return answered.status === 200 && answered.body.memo ? answered.body.memo : (Credit.memo(dev.gateway.wallet, id, 'n:' + nid) as Chain.Hex)
  }

  const ride = async (as: Rider, nid: string, amount: string) => {
    const memo = await prepared(as, nid, amount)
    const transfer = dev.gateway.chain.transfer({ amount, from: as.address, memo })
    const counted = await as.call('POST', `/v1/swarms/${id}/contributions`, { hash: transfer.hash, node: nid })
    if (counted.status === 404) throw new Missing('contributions')
    assert.ok(counted.status === 200 || counted.status === 201, 'counting a ride: ' + JSON.stringify(counted.body))
    return transfer.hash
  }

  const propose = async (as: Rider, input: { form: Tree.Form; parent: string; spec: string; statement?: string | null; title: string }, amount = '1') => {
    const proposed = await as.call<{ nid: string; transfer?: { memo?: Chain.Hex } }>('POST', `/v1/swarms/${id}/nodes`, input)
    if (proposed.status === 404 || proposed.status === 405) throw new Missing('propose')
    assert.ok(proposed.status === 200 || proposed.status === 201, 'proposing: ' + JSON.stringify(proposed.body))
    const memo = proposed.body.transfer?.memo ?? (Credit.memo(dev.gateway.wallet, id, 'n:' + proposed.body.nid) as Chain.Hex)
    const transfer = dev.gateway.chain.transfer({ amount, from: as.address, memo })
    const counted = await as.call('POST', `/v1/swarms/${id}/contributions`, { hash: transfer.hash, node: proposed.body.nid })
    assert.ok(counted.status === 200 || counted.status === 201, 'counting a proposal: ' + JSON.stringify(counted.body))
    return proposed.body.nid
  }

  const until = async <value>(what: string, read: () => Promise<value | undefined | false>, ms = 60_000) => {
    const end = Date.now() + ms
    let last: unknown
    for (;;) {
      try {
        const value = await read()
        if (value !== undefined && value !== false) return value
      } catch (error) {
        if (error instanceof Missing) throw error
        last = error
      }
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last ? ': ' + String(last) : ''}`)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  const subagents = () => dev.gateway.agents(app).flatMap((agent) => agent.subagents.map((each) => ({ ...each, agent: agent.id })))

  const bounded = () => {
    for (const each of subagents()) if (each.budget_usd !== undefined) assert.ok(units(each.spent_usd) <= units(each.budget_usd), `${each.role} spent $${each.spent_usd} of a $${each.budget_usd} bound`)
  }

  return { app, balanced, bounded, drifts, id, ledger, node, propose, read, ride, subagents, tree, until }
}
