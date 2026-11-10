import type { Hand } from '../shared/Api.ts'
import * as Credit from '../shared/Credit.ts'
import * as Memo from '../shared/Memo.ts'
import * as Branching from './Branching.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Store from './Store.ts'
import * as Clock from './Clock.ts'
import * as Words from './Words.ts'
import type { Swarm } from './Swarm.ts'

type Money = { known: boolean; left: bigint; listed: Gateway.Listed[] | undefined; row: Store.Row }

type Plan = { credit: boolean; hands: boolean }

export const everything: Plan = { credit: true, hands: true }

function earned(hand: Gateway.Listed) {
  const charges = hand['charges'] as { usd?: unknown } | null | undefined
  return typeof charges?.usd === 'number' && charges.usd > 0 ? Memo.units(charges.usd.toFixed(6)) : 0n
}

async function settle(self: Swarm, row: Store.Row, listed: Gateway.Backing[]) {
  if (!listed.length) return false
  const known = new Map((await Store.backings(self.env, row.id)).map((gift) => [gift.id, gift]))
  let changed = false
  for (const each of listed) {
    const id = Credit.backing(each.key)
    const gift = known.get(id)
    const counted = Memo.units(each.ended ? each.spent : each.limit)
    if (!gift) {
      if (counted === 0n) continue
      const adopted = await Store.give(self.env, { amount: String(counted), channel: each.key, contributor: each.backer, id, note: null, note_id: null, swarm: row.id, token: 'mach' })
      if (adopted) self.log('funds', `${Words.short(each.backer)} backs the swarm with up to $${Words.trim(Memo.decimal(counted))}`, each.key)
      changed = changed || adopted !== null
      continue
    }
    if (!each.ended || BigInt(gift.amount) === counted) continue
    const taken = await Store.lower(self.env, row.id, id, String(counted))
    self.log('funds', `${Words.short(each.backer)}'s backing ended after paying $${Words.trim(Memo.decimal(counted))}; the rest never left their wallet`, each.key)
    await lowered(self, row.id, taken).catch((error: unknown) => console.error('Lowering branch budgets failed', error))
    changed = true
  }
  return changed
}

async function lowered(self: Swarm, swarm: string, taken: { agent: string; branch: number }[]) {
  const agent = self.agent()?.id
  const mine = taken.filter((each) => each.agent === agent)
  if (!agent || !mine.length) return
  const { bases } = await Store.funds(self.env, swarm, agent)
  for (const each of mine) if (bases.has(each.branch)) await Branching.rebudget(self, swarm, agent, each.branch)
  self.changed('branches')
}

export async function refresh(self: Swarm, row: Store.Row, plan: Plan = everything): Promise<Money> {
  const [hands, credit, backings] = await Promise.all([
    plan.hands ? Gateway.hands(self.env, row.id) : undefined,
    plan.credit ? Gateway.credit(self.env, row.id) : undefined,
    plan.credit ? Gateway.backings(self.env, row.id) : undefined,
  ])
  const credited = credit?.ok ? Memo.units(credit.value.left) : BigInt(row.pool_left)
  const spent = credit?.ok ? Memo.units(credit.value.spent) : BigInt(row.pool_spent)
  const backed = backings?.ok ? Memo.units(backings.value.left) : BigInt(row.sponsor_left)
  const used = backings?.ok ? Memo.units(backings.value.spent) : BigInt(row.sponsor_spent)
  const left = credited + backed
  const known = !plan.credit || (!!credit?.ok && !!backings?.ok)
  const settled = backings?.ok ? await settle(self, row, backings.value.backings).catch((error: unknown) => (console.error('Settling backings failed', error), false)) : false

  const previous = self.kv.get<Hand[]>('hands') ?? []
  const connected = hands?.ok ? hands.value.hands.filter((hand) => hand.connected) : undefined
  if (connected) await joined(self, row, connected, new Set(previous.map((hand) => hand.name)))

  const listed = hands?.ok ? hands.value.hands : undefined
  const pool = { machines: connected?.length ?? previous.length, pool_left: Number(credited), pool_spent: Number(spent), sponsor_left: Number(backed), sponsor_spent: Number(used) }
  const same =
    Number(row.machines) === pool.machines &&
    Number(row.pool_left) === pool.pool_left &&
    Number(row.pool_spent) === pool.pool_spent &&
    Number(row.sponsor_left) === pool.sponsor_left &&
    Number(row.sponsor_spent) === pool.sponsor_spent
  if (same && !settled) return { known, left, listed, row }

  if (!same) await Store.update(self.env, row.id, pool)
  const paid = Number(row.spent) - Number(row.pool_spent) - Number(row.sponsor_spent) + pool.pool_spent + pool.sponsor_spent
  const updated = settled ? ((await Store.find(self.env, row.id)) ?? row) : { ...row, ...pool, remaining: Number(row.balance) - paid, spent: paid }
  self.remember(updated)
  self.beacon(updated)
  if (settled) self.changed('detail', 'members')
  return { known, left, listed, row: updated }
}

export async function joined(self: Swarm, row: Store.Row, connected: Gateway.Listed[], previous: ReadonlySet<string>) {
  const arrived = connected.some((hand) => !previous.has(hand.name))
  const issued = new Map((arrived ? await Hands.seen(self.env, row.id, await Hands.list(self.env, row.id), connected) : []).map((hand) => [hand.name, hand]))
  for (const hand of connected) {
    if (previous.has(hand.name)) continue
    const guest = issued.get(hand.name)
    if (guest && 'cap' in hand && self.turn()) await Gateway.cap(self.env, row.id, hand.name, Number(Memo.decimal(allowance(self, row, hand, BigInt(self.kv.get<string>('handCap') ?? '0')))))
    self.log(
      'machine',
      guest
        ? `A contributor's machine joined the swarm as hand ${hand.name}${guest.label ? ` (${guest.label})` : ''}.`
        : `Machine ${hand.name} joined the swarm.`,
    )
  }
  for (const name of previous)
    if (!connected.some((hand) => hand.name === name)) self.log('machine', `Machine ${name} left.`)
  if (connected.length === previous.size && connected.every((hand) => previous.has(hand.name))) return
  self.kv.put('hands', connected.map((hand) => ({ connected: true, name: hand.name })))
  self.changed('hands', 'members')
}

export async function cap(self: Swarm, row: Store.Row, amount: bigint, known: Gateway.Listed[] | undefined) {
  self.kv.put('handCap', String(amount))
  if (!known && !(self.kv.get<Hand[]>('hands') ?? []).length) return
  const listed: Gateway.Listed[] = known ?? (await Gateway.hands(self.env, row.id).then((found) => (found.ok ? found.value.hands : [])))
  for (const hand of listed.filter((found) => found.connected && 'cap' in found)) {
    self.kv.put('handTurn:' + hand.name, String(earned(hand)))
    await Gateway.cap(self.env, row.id, hand.name, Number(Memo.decimal(allowance(self, row, hand, amount))))
  }
}

export function allowance(self: Swarm, row: Store.Row, hand: Gateway.Listed, perTurn: bigint) {
  const now = Date.now()
  const total = earned(hand)
  const known = self.kv.get<{ at: number; usd: string }>('handDay:' + hand.name)
  const day = known && now - known.at < Clock.dayMs ? known : { at: now, usd: String(total) }
  if (day !== known) self.kv.put('handDay:' + hand.name, day)
  const turn = perTurn - (total - BigInt(self.kv.get<string>('handTurn:' + hand.name) ?? String(total)))
  const today = BigInt(row.balance) / Hands.share - (total - BigInt(day.usd))
  const left = turn < today ? turn : today
  return left > 0n ? left : 0n
}
