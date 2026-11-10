import type { Hand } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Store from './Store.ts'
import * as Clock from './Clock.ts'
import type { Swarm } from './Swarm.ts'

type Money = { left: bigint; listed: Gateway.Listed[] | undefined; row: Store.Row }

type Plan = { credit: boolean; hands: boolean }

export const everything: Plan = { credit: true, hands: true }

function earned(hand: Gateway.Listed) {
  const charges = hand['charges'] as { usd?: unknown } | null | undefined
  return typeof charges?.usd === 'number' && charges.usd > 0 ? Memo.units(charges.usd.toFixed(6)) : 0n
}

export async function refresh(self: Swarm, row: Store.Row, plan: Plan = everything): Promise<Money> {
  const [hands, credit] = await Promise.all([plan.hands ? Gateway.hands(self.env, row.id) : undefined, plan.credit ? Gateway.credit(self.env, row.id) : undefined])
  const left = credit?.ok ? Memo.units(credit.value.left) : BigInt(row.pool_left)
  const spent = credit?.ok ? Memo.units(credit.value.spent) : BigInt(row.pool_spent)

  const previous = self.kv.get<Hand[]>('hands') ?? []
  const connected = hands ? (hands.ok ? hands.value.hands.filter((hand) => hand.connected) : []) : undefined
  if (connected) await joined(self, row, connected, new Set(previous.map((hand) => hand.name)))

  const listed = hands?.ok ? hands.value.hands : undefined
  const pool = { machines: connected?.length ?? previous.length, pool_left: Number(left), pool_spent: Number(spent) }
  if (Number(row.machines) === pool.machines && Number(row.pool_left) === pool.pool_left && Number(row.pool_spent) === pool.pool_spent) return { left, listed, row }

  await Store.update(self.env, row.id, pool)
  const updated = { ...row, ...pool, remaining: pool.pool_left + Number(row.sponsor_left), spent: Number(row.spent) - Number(row.pool_spent) + pool.pool_spent }
  self.remember(updated)
  self.beacon(updated)
  return { left, listed, row: updated }
}

export async function joined(self: Swarm, row: Store.Row, connected: Gateway.Listed[], previous: ReadonlySet<string>) {
  const issued = new Map(connected.some((hand) => !previous.has(hand.name)) ? (await Hands.list(self.env, row.id)).map((hand) => [hand.name, hand]) : [])
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
  self.changed('hands')
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
  const today = BigInt(row.raised) / Hands.share - (total - BigInt(day.usd))
  const left = turn < today ? turn : today
  return left > 0n ? left : 0n
}
