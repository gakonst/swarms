import type { Account, Address, Hex } from 'viem'
import { isAddress } from 'viem'
import { Challenge } from 'mppx'
import { Mppx, tempo } from 'mppx/client'
import * as Memo from '../shared/Memo.ts'
import * as Chain from './Chain.ts'
import * as Gateway from './Gateway.ts'
import * as Payer from './Payer.ts'
import * as Seal from './Seal.ts'
import * as Store from './Store.ts'
import * as Vault from './Vault.ts'
import * as Words from './Words.ts'
import * as Clock from './Clock.ts'
import type { Swarm } from './Swarm.ts'

export type Pay = {
  amount?: string | undefined
  app?: string | undefined
  operation?: string | undefined
  path?: string | undefined
  attempt?: number | undefined
  challenge: string | string[]
  channels?: Payer.Snapshot[] | undefined
  hand?: string | undefined
  recipient?: Address | undefined
  rejected?: { detail: string; status: number } | undefined
  secret: string
  subagent?: number | undefined
  tree?: number | undefined
}

export type Paid = { authorization: string; topUp?: string } | { feeToken: Address } | Budget | { code: string; detail: string; retry?: number; status: 401 | 402 | 429 }

type Budget = { daily: string; page: string; raised: string; room: string; spent: string; swarm: string; usd: string }

type Source = { currency: Address; id: string; label: string }

export type Signer = { account: Account; key: Hex }

type Room = { amount: bigint; resets: number | null }

type Failed = { busy?: boolean; failed: string; price?: bigint; room: Room | undefined; small?: boolean; unopened?: boolean }

type Passed = { amount: string; at: number; host: string }

const passCall = 250_000n

const vendorCap = passCall

const passHour = 1_000_000n

const chunk = 100_000n

const handChunk = 50_000n

const recentMs = 10_000

const holdMs = 90_000

const heldMs = 10 * 60_000

export const most = 8

const activeMs = 30_000

const reserveMs = 30_000

const flowMs = 60_000

const burst = 3

const freshMs = 2_000


function asked(input: Pay) {
  const stated = Memo.units(/^\d+(\.\d{1,6})?$/.test(input.amount ?? '') ? (input.amount as string) : '0')
  const signed = (Array.isArray(input.challenge) ? input.challenge : [input.challenge]).map((serialized) => {
    try {
      const amount = (Challenge.deserialize(serialized).request as { amount?: unknown }).amount
      return typeof amount === 'string' && /^\d{1,19}$/.test(amount) ? BigInt(amount) : 0n
    } catch {
      return 0n
    }
  })
  return signed.reduce((most, amount) => (amount > most ? amount : most), stated)
}

function passHost(input: Pay) {
  try {
    return new URL(input.path ?? '').host || 'a paid service'
  } catch {
    return 'a paid service'
  }
}

export function lane(index: number) {
  return index === 0 ? 'pool' : `pool.${index}`
}

function pool(id = 'pool'): Source {
  return { currency: Chain.tokens.ousd.address, id, label: "the swarm's wallet" }
}

function index(id: string) {
  return id === 'pool' ? 0 : Number(id.slice('pool.'.length))
}

export function lanes(self: Pick<Swarm, 'kv'>) {
  const ids = new Set(['pool'])
  for (const prefix of ['channel:pool', 'spent:pool', 'banked:pool'])
    for (const [key] of self.kv.list({ prefix })) {
      const id = key.slice(key.indexOf('pool'))
      if (/^pool(\.\d+)?$/.test(id)) ids.add(id)
    }
  return [...ids].sort((a, b) => index(a) - index(b))
}

export function who(input: Pick<Pay, 'subagent' | 'tree'>) {
  return input.tree !== undefined ? `tree:${input.tree}` : input.subagent !== undefined ? `subagent:${input.subagent}` : 'lead'
}

export function revive(self: Pick<Swarm, 'kv'>) {
  for (const id of lanes(self)) self.kv.delete('exhausted:' + id)
}

function free(self: Swarm, id: string) {
  const channel = self.kv.get<Payer.Channel>(`channel:${id}`)
  if (!channel) return 0n
  return Payer.max(Payer.held(channel) - BigInt(self.kv.get<string>('spent:' + id) ?? channel.signed), 0n)
}

function spare(self: Swarm) {
  if (!self.held || Date.now() - self.heldAt > Clock.minuteMs) return undefined
  return self.held.ousd - Vault.dust - reserved(self)
}

export function ordering(detail: string | undefined) {
  return /delta too small|strictly greater|does not add new funds|below .*required|higher voucher/i.test(detail ?? '')
}

export type Lane = { at: number; expect: bigint; seen: { at: number; deposit: bigint }[] }

function reserved(self: Swarm) {
  const now = Date.now()
  let total = 0n
  for (const lane of self.holding.values()) {
    const latest = lane.seen.at(-1)?.deposit ?? 0n
    if (lane.expect > latest && now - lane.at > reserveMs) {
      lane.expect = latest
      self.heldAt = 0
    }
    const by = [...lane.seen].reverse().find((seen) => seen.at <= self.heldAt)?.deposit ?? lane.seen[0]?.deposit ?? 0n
    if (lane.expect > by) total += lane.expect - by
  }
  return total
}

export function landed(self: Pick<Swarm, 'holding'>, id: string, deposit: bigint) {
  const lane = self.holding.get(id)
  if (!lane || deposit <= (lane.seen.at(-1)?.deposit ?? 0n)) return
  lane.seen = [...lane.seen.slice(-15), { at: Date.now(), deposit }]
}

function release(self: Swarm, id: string, amount: bigint) {
  const lane = self.holding.get(id)
  if (lane) lane.expect -= amount
}

function flowed(self: Swarm, id: string) {
  const lane = self.lanes.get(id)
  if (!lane) return 0n
  const now = Date.now()
  lane.flow = lane.flow.filter((item) => now - item.at < flowMs)
  return lane.flow.reduce((sum, item) => sum + item.amount, 0n)
}

function flow(self: Swarm, id: string, amount: bigint) {
  self.lanes.get(id)?.flow.push({ amount, at: Date.now() })
}

export function route(self: Swarm, row: Store.Row, input: Pay, snapshots: readonly Payer.Snapshot[]): Source[] {
  const now = Date.now()
  const caller = who(input)
  const known = [...new Set([...lanes(self), ...[...self.lanes.keys()].filter((id) => id.startsWith('pool'))])].sort((a, b) => index(a) - index(b))
  const live = known.filter((id) => (self.kv.get<number>('exhausted:' + id) ?? 0) <= now)
  const busy = new Map<string, number>()
  for (const [name, seen] of self.callers) {
    if (now - seen.at > activeMs) self.callers.delete(name)
    else if (name !== caller) busy.set(seen.lane, (busy.get(seen.lane) ?? 0) + 1)
  }
  const load = (id: string) => busy.get(id) ?? 0
  const refused = input.rejected && snapshots[0] ? live.find((id) => self.kv.get<Payer.Channel>(`channel:${id}`)?.id.toLowerCase() === snapshots[0]!.channelId.toLowerCase()) : undefined
  const kept = self.callers.get(caller)?.lane
  const opened = live.filter((id) => self.kv.get<Payer.Channel>(`channel:${id}`))
  const unused = Array.from({ length: most }, (_, at) => lane(at)).find((id) => !known.includes(id))
  const left = spare(self)
  const size = Payer.max(chunk, Store.reserveOf(row))
  const opening = BigInt(known.filter((id) => !self.kv.get<Payer.Channel>(`channel:${id}`)).length)
  const fresh = unused && left !== undefined && left - opening * size >= 2n * size ? unused : undefined
  const price = Payer.priced(input.challenge) ?? 0n
  const dry = left !== undefined && left < price
  const fits = (id: string) => !dry || free(self, id) >= price
  const least = [...live].filter(fits).sort((a, b) => load(a) - load(b))[0] ?? [...live].sort((a, b) => load(a) - load(b))[0]
  const held = kept && live.includes(kept) && fits(kept) ? kept : undefined
  const chosen =
    refused ??
    (held && !load(held) ? held : undefined) ??
    live.find((id) => !load(id) && fits(id)) ??
    fresh ??
    (held && least && load(held) <= load(least) + 1 ? held : undefined) ??
    least ??
    'pool'
  self.callers.set(caller, { at: now, lane: chosen })
  const crowded = (self.lanes.get(chosen)?.depth ?? 0) >= burst
  const spill = crowded && !refused ? opened.find((id) => id !== chosen && !load(id) && !(self.lanes.get(id)?.depth ?? 0)) : undefined
  const first = spill ?? chosen
  const rest = opened.filter((id) => id !== first && fits(id)).sort((a, b) => Number(free(self, b) - free(self, a)))
  return [first, ...rest].map((id) => pool(id))
}

function inLane<T>(self: Swarm, id: string, marks: Marks, task: () => Promise<T>): Promise<T> {
  const queued = Date.now()
  const lane = self.lanes.get(id) ?? { depth: 0, flow: [], tail: Promise.resolve() }
  lane.depth += 1
  self.lanes.set(id, lane)
  const run = lane.tail.then(() => {
    marks.waited = (marks.waited ?? 0) + Date.now() - queued
    return task()
  })
  lane.tail = run.catch(() => undefined).finally(() => {
    lane.depth -= 1
  })
  return run
}

function owing(payee: Address): Source {
  return { currency: Chain.tokens.ousd.address, id: 'hand:' + payee.toLowerCase(), label: `the swarm's wallet to hand owner ${Words.short(payee)}` }
}

function owner(source: Source) {
  return source.id.startsWith('hand:') ? (source.id.slice('hand:'.length) as Address) : undefined
}

export async function vendor(self: Swarm, row: Store.Row, input: Pay): Promise<Paid> {
  const refused = (detail: string): Paid => ({ code: 'payment_failed', detail, status: 402 })
  const serialized = (Array.isArray(input.challenge) ? input.challenge : [input.challenge])[0]
  if (!serialized || !row.sealed_wallet || !row.wallet) return refused('No challenge, or this swarm has no wallet.')
  const challenge = (() => {
    try {
      return Challenge.deserialize(serialized)
    } catch {
      return undefined
    }
  })()
  const request = challenge?.request as { amount?: string; currency?: string; methodDetails?: { chainId?: number }; recipient?: string } | undefined
  const amount = /^[1-9]\d{0,18}$/.test(request?.amount ?? '') ? BigInt(request!.amount!) : 0n
  if (
    challenge?.method !== 'tempo' ||
    challenge.intent !== 'charge' ||
    String(request?.currency).toLowerCase() !== Chain.tokens.usdce.address.toLowerCase() ||
    (request?.methodDetails?.chainId ?? 4217) !== 4217 ||
    !isAddress(request?.recipient ?? '') ||
    amount === 0n ||
    amount > vendorCap
  )
    return refused(`The swarm pays a service directly only for a Tempo USDC.e charge of at most ${Words.dollars(vendorCap)}.`)
  const wallet = row.wallet
  const authorization = await locked(self, async () => {
    const account = await Vault.account(self.env, row)
    const held = await Vault.balances(self.env, wallet)
    if (held.usdce < amount) {
      const short = amount - held.usdce
      if (held.ousd < short + (short * Vault.slippage) / 10_000n + Vault.dust) return new Error("The swarm's wallet cannot cover this service.")
      await Vault.buy(self.env, account, 'usdce', short)
    }
    self.vended = Date.now()
    const client = Mppx.create({ methods: [tempo.charge({ account })], polyfill: false })
    return client.createCredential(new Response(null, { headers: { 'www-authenticate': serialized }, status: 402 })).catch((error: unknown) => error as Error)
  })
  if (authorization instanceof Error) return refused(authorization.message.split('\n')[0]?.slice(0, 200) ?? 'Signing failed.')
  self.kv.put('banked:pool', String(BigInt(self.kv.get<string>('banked:pool') ?? '0') + amount))
  const host = (() => {
    try {
      return new URL(input.path ?? '').host
    } catch {
      return challenge.realm
    }
  })()
  self.log('funds', `Paid ${host} ${Words.dollars(amount)} in USDC.e from the swarm's wallet, because the gateway's treasury could not front it.`)
  return { authorization }
}

export function sources(self: Swarm, row: Store.Row): Source[] {
  return row.wallet ? lanes(self).map((id) => pool(id)) : []
}

export function signer(self: Swarm, row: Store.Row, source: Source): Promise<Signer> {
  const cached = self.signers.get(source.id)
  if (cached) return cached
  const created = Seal.open(self.env.SWARMS_SECRET, row.sealed_wallet ?? '').then(async (key) => ({ account: await Vault.account(self.env, row), key: key as Hex }))
  created.catch(() => self.signers.delete(source.id))
  self.signers.set(source.id, created)
  return created
}

export async function client(self: Swarm, row: Store.Row, source: Source): Promise<Payer.Client> {
  const cached = self.clients.get(source.id)
  if (cached) return cached
  const created = Payer.client(self.env, self.kv, source.id, (await signer(self, row, source)).account, source.currency)
  self.clients.set(source.id, created)
  return created
}

export async function headroom(self: Swarm, row: Store.Row): Promise<Room> {
  if (!self.held || Date.now() - self.heldAt > freshMs) {
    self.balancing ??= (async () => {
      const started = Date.now()
      const balances = await Vault.balances(self.env, row.wallet as Address)
      if (started >= self.heldAt) {
        self.held = balances
        self.heldAt = started
      }
    })().finally(() => {
      self.balancing = undefined
    })
    await self.balancing
  }
  return room(self)
}

function room(self: Swarm): Room {
  return { amount: Payer.max((self.held?.ousd ?? 0n) - Vault.dust - reserved(self), 0n), resets: null }
}

function claim(self: Swarm, id: string, want: bigint, floor: bigint, base: bigint) {
  const free = room(self)
  const amount = Payer.min(want, free.amount)
  if (amount < floor) return { amount: 0n, room: free }
  const lane = self.holding.get(id) ?? { at: 0, expect: base, seen: [{ at: 0, deposit: base }] }
  lane.expect = Payer.max(lane.expect, base) + amount
  lane.at = Date.now()
  self.holding.set(id, lane)
  return { amount, room: free }
}

export async function confirmed(self: Swarm, source: Source) {
  const channel = self.kv.get<Payer.Channel>(`channel:${source.id}`)
  if (!channel || channel.confirmed) return channel
  for (;;) {
    const state = await Payer.state(self.env, channel.id).catch(() => undefined)
    const old = Date.now() - channel.at > Payer.confirmMs
    if (state) {
      landed(self, source.id, state.deposit)
      const confirmed = Payer.confirm(channel, state.deposit, Date.now())
      if (confirmed.confirmed) {
        self.kv.put(`channel:${source.id}`, confirmed)
        return confirmed
      }
      if (old && state.deposit === 0n) {
        Payer.forget(self.kv, source.id)
        self.clients.delete(source.id)
        if (Date.now() - (self.kv.get<number>(`unopened:${source.id}`) ?? 0) > Clock.quietMs) self.log('error', `The channel for ${source.label} never opened on Tempo, so the next payment opens another.`)
        self.kv.put(`unopened:${source.id}`, Date.now())
        return undefined
      }
    }
    if (old) return channel
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
}

export function passable(self: Swarm, row: Store.Row, input: Pay): Paid | undefined {
  const amount = asked(input)
  const now = Date.now()
  const recent = (self.kv.get<Passed[]>('passed') ?? []).filter((item) => item.at > now - Clock.hourMs)
  const hourly = Payer.max(passHour, BigInt(row.raised) / 20n)
  const host = passHost(input)
  const used = recent.reduce((sum, item) => sum + BigInt(item.amount), 0n)
  const there = recent.filter((item) => item.host === host).reduce((sum, item) => sum + BigInt(item.amount), 0n)
  if (amount > passCall) return { code: 'limit_reached', detail: `The swarm pays an outside service at most ${Words.dollars(passCall)} a call; ${host} asked ${Words.dollars(amount)}.`, status: 402 }
  if (used + amount > hourly)
    return { code: 'limit_reached', detail: `The swarm pays outside services at most ${Words.dollars(hourly)} an hour, and ${Words.dollars(used)} went to them in the last hour.`, retry: 60, status: 402 }
  if (there + amount > hourly / 2n)
    return { code: 'limit_reached', detail: `The swarm pays one outside service at most ${Words.dollars(hourly / 2n)} an hour, and ${host} had ${Words.dollars(there)} of it.`, retry: 60, status: 402 }
  return undefined
}

export function passed(self: Swarm, input: Pay, paid: Paid): Paid {
  if (!('authorization' in paid)) return paid
  const amount = asked(input)
  const now = Date.now()
  const host = passHost(input)
  self.kv.put('passed', [...(self.kv.get<Passed[]>('passed') ?? []).filter((item) => item.at > now - Clock.hourMs), { amount: String(amount), at: now, host }])
  if (input.operation === 'agent.fetch') self.log('funds', `The agent paid ${Words.dollars(amount)} to an outside service through the gateway, from the swarm's money.`, input.path ?? null)
  return paid
}

export type Marks = { attempts?: number; confirm?: number; lane?: string; room?: number; row?: number; sign?: number; waited?: number }

function mark(marks: Marks, name: 'confirm' | 'room' | 'sign', since: number) {
  marks[name] = (marks[name] ?? 0) + Date.now() - since
}

export function outcome(paid: Paid) {
  if ('authorization' in paid) return paid.topUp ? 'topUp' : 'voucher'
  if ('feeToken' in paid) return 'feeToken'
  if ('usd' in paid) return 'budget'
  return paid.status
}

export async function queued(self: Swarm, input: Pay): Promise<Paid> {
  const asked = Date.now()
  const marks: Marks = {}
  const paid = await charge(self, input, marks)
  const worked = Date.now() - asked
  console.log(JSON.stringify({ ...marks, operation: input.operation ?? null, paid: outcome(paid), pay: self.kv.get<string>('id'), waited: marks.waited ?? 0, worked: worked - (marks.waited ?? 0) }))
  return paid
}

export async function charge(self: Swarm, input: Pay, marks: Marks = {}): Promise<Paid> {
  const id = self.kv.get<string>('id') ?? ''
  const reading = Date.now()
  const row = self.steady?.id === id ? self.steady : await self.found(id)
  marks.row = Date.now() - reading
  if (!row) return { code: 'limit_reached', detail: 'This swarm pays for nothing.', status: 402 }
  if (input.app !== undefined && input.app !== Gateway.app(row.id)) return { code: 'unauthorized', detail: 'This payer pays only for its own swarm.', status: 401 }
  const passing = input.operation === 'vendor' || input.operation === 'agent.fetch'
  if (passing) {
    const refused = passable(self, row, input)
    if (refused) return refused
  }
  if (input.operation === 'vendor') return passed(self, input, await vendor(self, row, input))

  const price = Payer.priced(input.challenge)
  if (price !== undefined && price > Chain.cap)
    return { code: 'limit_reached', detail: `This request costs ${Words.dollars(price)}, more than the ${Words.dollars(Chain.cap)} the swarm pays for any one request; ask for less at once, such as a shorter lease or fewer machines.`, status: 402 }

  const snapshots = input.channels ?? []
  const known = [...self.kv.list<Payer.Channel>({ prefix: 'channel:' })]
  for (const [index, snapshot] of snapshots.entries())
    for (const [key, channel] of known) {
      if (channel.id.toLowerCase() !== snapshot.channelId.toLowerCase()) continue
      const id = key.slice('channel:'.length)
      self.kv.put('spent:' + id, snapshot.spent)
      if (snapshot.closing || (index === 0 && input.rejected?.status === 410)) drop(self, id)
      else {
        landed(self, id, BigInt(snapshot.deposit))
        if (Payer.unsure(channel) && BigInt(snapshot.deposit) >= Payer.held(channel)) self.kv.put(key, Payer.confirm(channel, BigInt(snapshot.deposit), Date.now()))
      }
      if (index === 0 && input.rejected && (input.attempt ?? 0) >= 2 && !ordering(input.rejected.detail)) {
        self.kv.put('exhausted:' + id, Date.now() + Clock.restMs)
        self.log('funds', "The gateway refused a payment on one of the swarm wallet's channels again, so the swarm pays on its other channels for a while.", input.rejected.detail)
      }
    }

  const owed = input.recipient ? owing(input.recipient) : undefined
  if (owed && row.wallet && (self.kv.get<number>('exhausted:' + owed.id) ?? 0) <= Date.now()) {
    const source = owed
    const signing = Date.now()
    const result = await inLane(self, source.id, marks, () => attempt(self, row, source, input, snapshots, marks)).catch(
      (error: unknown): Failed => ({ failed: String(error).split('\n')[0]?.slice(0, 300) ?? 'The payment failed.', room: undefined }),
    )
    mark(marks, 'sign', signing)
    marks.attempts = (marks.attempts ?? 0) + 1
    if ('authorization' in result || 'feeToken' in result) return result
    if ((self.kv.get<number>('owing:' + source.id) ?? 0) <= Date.now()) {
      self.kv.put('owing:' + source.id, Date.now() + Clock.restMs)
      self.log('funds', `The swarm's wallet cannot pay the owner of hand ${input.hand ?? 'a lent machine'} over its own channel right now, so the gateway bills that hand's use and pays its owner.`, result.failed)
    }
  }

  const ordered = row.wallet ? route(self, row, input, snapshots) : []
  let busy = false
  let small = false
  let wanted = 0n
  for (const source of ordered) {
    const signing = Date.now()
    marks.lane = marks.lane ? `${marks.lane},${source.id}` : source.id
    const result = await inLane(self, source.id, marks, () => attempt(self, row, source, input, snapshots, marks)).catch(
      (error: unknown): Failed => ({ failed: String(error).split('\n')[0]?.slice(0, 300) ?? 'The payment failed.', room: { amount: 0n, resets: Date.now() + Clock.retryMs } }),
    )
    mark(marks, 'sign', signing)
    marks.attempts = (marks.attempts ?? 0) + 1
    if ('feeToken' in result) return result
    if ('authorization' in result) return passing ? passed(self, input, result) : result
    if (result.busy) busy = true
    if (result.busy || result.small || result.unopened) {
      small ||= !!result.small
      if (result.small && result.price) wanted = Payer.max(wanted, result.price)
      continue
    }
    const until = result.room?.resets ?? Date.now() + Clock.restMs
    self.kv.put('exhausted:' + source.id, until)
    self.log('funds', `${Words.capital(source.label)} cannot pay right now, so the swarm moves on until ${Words.clock(until)} UTC.`, result.failed)
  }

  if (busy) return { code: 'busy', detail: "The swarm's contributions are holding other calls' reservations; try again shortly.", retry: 2, status: 429 }
  const held = BigInt(((await self.found(row.id)) ?? row).sponsor_left ?? 0)
  const most = BigInt(self.kv.get<string>('sponsoredMost') ?? '0')
  const scarce = !passing && held >= Store.callOf(row) && price !== undefined && most < price
  if (scarce) wanted = Payer.max(wanted, price)
  const squeezed = !passing && !scarce && held >= Store.callOf(row)
  if (squeezed) self.kv.put('squeezed', Date.now())
  const run = self.run()
  if (wanted && run.state === 'working') self.set({ ...run, wanted: String(wanted) })
  const wake = rested(self)
  const spent = wake ? `Every contribution to this swarm is spent for now; the next one comes back at ${new Date(wake).toISOString()}.` : 'Every contribution to this swarm is spent.'
  return {
    code: 'limit_reached',
    detail: scarce
      ? `No channel of this swarm holds ${Words.dollars(price)} at once: the MACH channels the gateway spends for it hold ${Words.dollars(held)} in all, the largest ${Words.dollars(most)}. Ask for less at once, such as a shorter lease or a smaller machine.`
      : held >= Store.callOf(row) && passing
        ? `Payments to outside services come only from the swarm's wallet, which cannot pay this; the MACH channels the gateway spends for the swarm (${Words.dollars(held)} left) pay only for the gateway's own requests.`
        : held >= Store.callOf(row)
          ? `The swarm's wallet cannot pay this, and the gateway found no room for it on the MACH channels it spends for the swarm (${Words.dollars(held)} in all, the largest ${Words.dollars(most)}): it reserves a model call's worst case on one channel, and prepaid machine time stays on its channel until the machine ends. The swarm backs off before it tries again.`
          : small
            ? 'No single contribution to this swarm can pay this much at once right now.'
            : spent,
    ...(wake ? { retry: Math.max(1, Math.ceil((wake - Date.now()) / 1000)) } : {}),
    status: 402,
  }
}

export async function attempt(self: Swarm, row: Store.Row, source: Source, input: Pay, snapshots: Payer.Snapshot[], marks: Marks = {}): Promise<{ authorization: string; topUp?: string } | { feeToken: Address } | Failed> {
  const payee = owner(source)
  const offered = Payer.offer(input.challenge, source.currency, payee)
  if (!offered)
    return payee
      ? { failed: 'The hand owner is paid in a token other than OUSD, which the swarm\'s wallet holds.', room: undefined, small: true }
      : { failed: `The gateway offered no OUSD session to its recipient for at most ${Memo.decimal(Chain.cap)}.`, room: undefined, small: true }
  const mppx = await client(self, row, source)
  const confirming = Date.now()
  const channel = await confirmed(self, source)
  mark(marks, 'confirm', confirming)
  const price = offered.amount
  const step = Payer.max(payee ? handChunk : chunk, flowed(self, source.id))

  if (!channel) {
    const rooming = Date.now()
    await headroom(self, row)
    mark(marks, 'room', rooming)
    const claimed = claim(self, source.id, Payer.max(step, price), price, 0n)
    const room = claimed.room
    const deposit = claimed.amount
    if (deposit < price)
      return { failed: `It can put in ${Memo.decimal(room.amount)} now, less than the ${Memo.decimal(price)} this request holds.`, price, room, small: room.amount >= Store.callOf(row), unopened: source.id !== 'pool' && !payee }
    const authorization = await mppx.createCredential(offered.response, { depositRaw: String(deposit) }).catch((error: unknown) => {
      release(self, source.id, deposit)
      throw error
    })
    const entry = Payer.opened(self.kv, source.id)
    if (!entry) throw new Error('mppx stored no channel for the open')
    self.kv.put(`channel:${source.id}`, { at: Date.now(), confirmed: false, deposit: String(deposit), descriptor: entry.descriptor, id: entry.channelId, signed: String(price) } satisfies Payer.Channel)
    self.kv.put('spent:' + source.id, String(price))
    self.kv.put('paid:' + source.id, Date.now())
    self.cue('chain')
    flow(self, source.id, price)
    if (payee) self.log('funds', `Opened a channel from the swarm's wallet to the owner of hand ${input.hand ?? 'a lent machine'} (${Words.short(payee)}), which the gateway settles straight to them.`)
    return { authorization }
  }

  const snapshot = snapshots.find((item) => item.channelId.toLowerCase() === channel.id.toLowerCase())
  const accepted = BigInt(snapshot?.acceptedCumulative ?? '0')
  const recent = (self.kv.get<{ amount: string; at: number; cumulative: string }[]>('pending:' + source.id) ?? []).filter(
    (item) => Date.now() - item.at < recentMs && BigInt(item.cumulative) > accepted,
  )
  const pending = recent.reduce((sum, item) => sum + BigInt(item.amount), 0n)
  const signed = BigInt(channel.signed)
  const floor = snapshot ? recent.reduce((most, item) => Payer.max(most, BigInt(item.cumulative)), accepted) : signed
  const spent = snapshot?.spent ?? self.kv.get<string>('spent:' + source.id)
  const need =
    spent === undefined
      ? signed + price
      : [BigInt(snapshot?.requiredCumulative ?? '0'), floor + 1n, BigInt(spent) + pending + price].reduce(Payer.max)
  const deposit = BigInt(snapshot?.deposit ?? Payer.held(channel))
  let topUp: string | undefined
  let additional = 0n
  if (need > deposit) {
    const rooming = Date.now()
    await headroom(self, row)
    mark(marks, 'room', rooming)
    const shortfall = need - deposit
    const claimed = claim(self, source.id, Payer.max(step, shortfall), shortfall, deposit)
    const room = claimed.room
    additional = claimed.amount
    if (additional < shortfall) {
      const unspent = spent === undefined ? 0n : deposit - BigInt(spent)
      return {
        busy: Date.now() - (self.kv.get<number>('paid:' + source.id) ?? 0) < (unspent >= Store.callOf(row) ? heldMs : holdMs),
        failed: `It can add ${Memo.decimal(room.amount)} now, less than the ${Memo.decimal(shortfall)} its channel needs (deposit ${Memo.decimal(deposit)}, spent ${Memo.decimal(BigInt(spent ?? '0'))}, accepted ${Memo.decimal(accepted)}, required ${Memo.decimal(BigInt(snapshot?.requiredCumulative ?? '0'))}, in flight ${Memo.decimal(pending)} over ${recent.length}, this request ${Memo.decimal(price)}).`,
        price,
        room,
        small: room.amount + Payer.max(unspent, 0n) >= Store.callOf(row),
      }
    }
    topUp = await mppx.createCredential(offered.response, { action: 'topUp', additionalDepositRaw: String(additional), channelId: channel.id, descriptor: channel.descriptor }).catch((error: unknown) => {
      release(self, source.id, additional)
      throw error
    })
  }
  const authorization = await mppx.createCredential(offered.response, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: String(need), descriptor: channel.descriptor })
  flow(self, source.id, price)
  const latest = self.kv.get<Payer.Channel>(`channel:${source.id}`)
  if (latest?.id !== channel.id) return { authorization, ...(topUp ? { topUp } : {}) }
  self.kv.put(`channel:${source.id}`, Payer.topped(latest, deposit, additional, need, Date.now()))
  if (topUp) self.cue('chain')
  self.kv.put('pending:' + source.id, [...recent, { amount: String(price), at: Date.now(), cumulative: String(need) }])
  self.kv.put('paid:' + source.id, Date.now())
  return topUp ? { authorization, topUp } : { authorization }
}

export async function probe(self: Swarm, row: Store.Row, source: Source, again = false) {
  const channel = self.kv.get<Payer.Channel>(`channel:${source.id}`)
  if (!channel?.confirmed || (!again && self.kv.get<string>('probed:' + source.id) === channel.signed)) return
  const init = { body: JSON.stringify({ key: 'probe' }), headers: { 'content-type': 'application/json', 'gateway-app': Gateway.app(row.id) }, method: 'POST' }
  const challenge = await Gateway.call(self.env, '/v1/kv/get', init)
  const offered = Payer.offer(challenge.headers.get('www-authenticate') ?? '', source.currency)
  const deposit = BigInt(channel.deposit)
  const known = BigInt(self.kv.get<string>('spent:' + source.id) ?? channel.signed)
  const cumulative = Payer.min(deposit, Payer.max(BigInt(channel.signed) + 1n, known + (offered?.amount ?? 0n)))
  if (!offered || cumulative <= BigInt(channel.signed)) return
  const mppx = await client(self, row, source)
  const authorization = await mppx.createCredential(offered.response, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: String(cumulative), descriptor: channel.descriptor })
  const paid = await Gateway.call(self.env, '/v1/kv/get', { ...init, headers: { ...init.headers, authorization } })
  const header = paid.headers.get('payment-receipt')
  if (!paid.ok || !header) return
  const receipt = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/'))) as { acceptedCumulative?: string; spent?: string }
  const signed = receipt.acceptedCumulative ?? String(cumulative)
  self.kv.put(`channel:${source.id}`, { ...channel, signed })
  self.kv.put('probed:' + source.id, signed)
  if (receipt.spent) self.kv.put('spent:' + source.id, receipt.spent)
}

export function drop(self: Swarm, id: string) {
  self.kv.put('banked:' + id, String(used(self, id)))
  self.kv.delete('spent:' + id)
  Payer.forget(self.kv, id)
  self.clients.delete(id)
}

export function used(self: Pick<Swarm, 'kv'>, id: string) {
  return BigInt(self.kv.get<string>('banked:' + id) ?? '0') + BigInt(self.kv.get<string>('spent:' + id) ?? '0')
}

export function pooled(self: Pick<Swarm, 'kv'>) {
  return lanes(self).reduce((sum, id) => sum + used(self, id), 0n)
}

export function owners(self: Swarm) {
  const ids = new Set<string>()
  for (const prefix of ['channel:hand:', 'banked:hand:', 'spent:hand:'])
    for (const [key] of self.kv.list({ prefix })) ids.add(key.slice(key.indexOf('hand:')))
  return [...ids]
}

export function handsUsed(self: Swarm) {
  return owners(self).reduce((sum, id) => sum + used(self, id), 0n)
}

export function rested(self: Swarm) {
  const now = Date.now()
  const times = [...self.kv.list<number>({ prefix: 'exhausted:' })].map(([, until]) => until).filter((at) => at > now && at < now + 8 * 86_400_000)
  return times.length ? Math.min(...times) + 2_000 : null
}

export function locked<T>(self: Swarm, task: () => Promise<T>): Promise<T> {
  const run = self.wallet.then(task)
  self.wallet = run.catch(() => undefined)
  return run
}
