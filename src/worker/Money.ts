import type { Hand } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Chain from './Chain.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Payer from './Payer.ts'
import * as Store from './Store.ts'
import * as Vault from './Vault.ts'
import * as Words from './Words.ts'
import * as Clock from './Clock.ts'
import * as Paying from './Paying.ts'
import type { Swarm } from './Swarm.ts'

type Money = { biggest: bigint; left: bigint; listed: Gateway.Listed[] | undefined; row: Store.Row }

type Plan = { chain: boolean; hands: boolean; sponsors: boolean }

export const everything: Plan = { chain: true, hands: true, sponsors: true }

export const smallestSwap = 10_000n

function earned(hand: Gateway.Listed) {
  const charges = hand['charges'] as { usd?: unknown } | null | undefined
  return typeof charges?.usd === 'number' && charges.usd > 0 ? Memo.units(charges.usd.toFixed(6)) : 0n
}

const pullMs = 120_000

export async function refresh(self: Swarm, row: Store.Row, plan: Plan = everything): Promise<Money> {
  const sources = Paying.sources(self, row)
  const client = Chain.client(self.env)
  const unsure = plan.chain ? [...self.kv.list<Payer.Channel>({ prefix: 'channel:' })].filter(([, channel]) => Payer.unsure(channel)) : []
  const reading = plan.chain || !self.held
  const [hands, balances, states, pledged] = await Promise.all([
    plan.hands ? Gateway.hands(self.env, row.id) : undefined,
    row.wallet ? (reading ? Vault.balances(self.env, row.wallet, client) : Promise.resolve(self.held)) : Promise.resolve(undefined),
    Promise.all(unsure.map(([, channel]) => Payer.state(self.env, channel.id, client).catch(() => undefined))),
    plan.sponsors ? sponsorships(self, row) : undefined,
  ])
  if (reading && balances) self.held = balances
  for (const [index, [key, channel]] of unsure.entries()) {
    const state = states[index]
    const confirmed = state ? Payer.confirm(channel, state.deposit, Date.now()) : channel
    if (confirmed !== channel) self.kv.put(key, confirmed)
  }
  let left = 0n
  let biggest = 0n
  let pooled = 0n
  for (const source of sources) {
    const channel = self.kv.get<Payer.Channel>(`channel:${source.id}`)
    const spent = BigInt(self.kv.get<string>('spent:' + source.id) ?? channel?.signed ?? '0')
    const inside = Payer.inside(channel, spent)
    const room = balances ? Payer.max(Vault.total(balances) - Vault.dust * 3n, 0n) : 0n
    const available = inside + room
    if (room >= Paying.perCall) self.kv.delete('exhausted:' + source.id)
    pooled = available
    if ((self.kv.get<number>('exhausted:' + source.id) ?? 0) > Date.now()) continue
    left += available
    biggest = Payer.max(biggest, available)
  }
  const loose = String(balances ? balances.pathusd + balances.usdce - Vault.dust * 2n : 0n)
  if (self.kv.get<string>('loose') !== loose) self.kv.put('loose', loose)
  if (pledged) self.pledged = pledged
  const sponsored = plan.sponsors ? self.pledged : { biggest: self.pledged.biggest, left: BigInt(row.sponsor_left ?? 0), spent: BigInt(row.sponsor_spent ?? 0) }
  left += sponsored.left
  biggest = Payer.max(biggest, sponsored.biggest)
  self.kv.put('sponsoredMost', String(sponsored.biggest))

  const previous = self.kv.get<Hand[]>('hands') ?? []
  const connected = hands ? (hands.ok ? hands.value.hands.filter((hand) => hand.connected) : []) : undefined
  if (connected) await joined(self, row, connected, new Set(previous.map((hand) => hand.name)))

  const pool = { machines: connected?.length ?? previous.length, pool_left: Number(pooled), pool_spent: Number(Paying.used(self, 'pool') + Paying.handsUsed(self)), sponsor_left: Number(sponsored.left), sponsor_spent: Number(sponsored.spent) }
  if (
    Number(row.machines) !== pool.machines ||
    Number(row.pool_left) !== pool.pool_left ||
    Number(row.pool_spent) !== pool.pool_spent ||
    Number(row.sponsor_left) !== pool.sponsor_left ||
    Number(row.sponsor_spent) !== pool.sponsor_spent
  ) {
    await Store.update(self.env, row.id, pool)
    const updated = { ...row, ...pool, remaining: pool.pool_left + pool.sponsor_left, spent: Number(row.spent) - Number(row.pool_spent) - Number(row.sponsor_spent) + pool.pool_spent + pool.sponsor_spent }
    self.remember(updated)
    self.beacon(updated)
    return { biggest, left, listed: hands?.ok ? hands.value.hands : undefined, row: updated }
  }
  return { biggest, left, listed: hands?.ok ? hands.value.hands : undefined, row: (await self.found(row.id)) ?? row }
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

export async function sponsorships(self: Swarm, row: Store.Row) {
  const counted = new Map<string, bigint>((await Store.channels(self.env, row.id)).map((gift) => [gift.channel, BigInt(gift.amount)]))
  if (!counted.size) return { biggest: 0n, left: 0n, spent: 0n }
  const listed = await Gateway.sponsors(self.env, row.id)
  if (!listed.ok) return { biggest: 0n, left: BigInt(row.sponsor_left ?? 0), spent: BigInt(row.sponsor_spent ?? 0) }
  let biggest = 0n
  let left = 0n
  let spent = 0n
  for (const channel of listed.value.sponsors) {
    const used = Memo.units(channel.spent)
    spent += used
    if (channel.endedAt !== null || channel.closing) {
      const amount = counted.get(channel.channel.toLowerCase())
      if (amount !== undefined && amount !== used) {
        await Store.delivered(self.env, channel.channel, used)
        self.marked += 1
      }
      continue
    }
    const available = Memo.units(channel.available)
    left += available
    biggest = Payer.max(biggest, available)
  }
  return { biggest, left, spent }
}

export function fund(self: Swarm, row: Store.Row) {
  self.funding ??= Paying.locked(self, () => refill(self, row)).finally(() => {
    self.funding = undefined
  })
  return self.funding
}

export async function refill(self: Swarm, row: Store.Row) {
  if (!row.wallet || !row.sealed_wallet) return
  const owner = await Vault.account(self.env, row)
  const balances = await Vault.balances(self.env, row.wallet)

  for (const id of ['pathusd', 'usdce'] as const) {
    const amount = balances[id] - Vault.dust
    if (amount < smallestSwap || (id === 'usdce' && Date.now() - self.vended < pullMs)) continue
    const result = await Vault.swap(self.env, owner, id, amount).catch((error: unknown) => error as Error)
    if (result instanceof Error) {
      self.log('error', `Swapping ${Chain.tokens[id].symbol} to OUSD failed.`, result.message.split('\n')[0] ?? null)
      continue
    }
    self.kv.delete('exhausted:pool')
    self.cue('chain')
    self.log(
      'funds',
      `Swapped ${Words.trim(Memo.decimal(amount))} ${Chain.tokens[id].symbol} to ${Words.trim(Memo.decimal(result.received))} OUSD on the stablecoin DEX (quote ${Words.trim(Memo.decimal(result.quote))}, at least ${Words.trim(Memo.decimal(result.minimum))}, fee ${Words.trim(Memo.decimal(result.fee))}).`,
      result.hash,
    )
  }
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
  const turn = total - BigInt(self.kv.get<string>('handTurn:' + hand.name) ?? String(total))
  const today = total - BigInt(day.usd)
  const left = Payer.min(perTurn - turn, BigInt(row.raised) / Hands.share - today)
  return left > 0n ? left : 0n
}
