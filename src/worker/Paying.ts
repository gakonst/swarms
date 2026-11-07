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
}

export type Paid = { authorization: string; topUp?: string } | { feeToken: Address } | Budget | { code: string; detail: string; retry?: number; status: 401 | 402 | 429 }

type Budget = { daily: string; raised: string; spent: string; usd: string }

type Source = { currency: Address; id: string; label: string }

export type Signer = { account: Account; key: Hex }

type Room = { amount: bigint; resets: number | null }

type Failed = { busy?: boolean; failed: string; price?: bigint; room: Room | undefined; small?: boolean }

type Passed = { amount: string; at: number; host: string }

const passCall = 250_000n

const vendorCap = passCall

const passHour = 1_000_000n

const chunk = 100_000n

const handChunk = 50_000n

const recentMs = 10_000

const holdMs = 90_000

const heldMs = 10 * 60_000

export const perCall = Store.perCall

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

function pool(): Source {
  return { currency: Chain.tokens.ousd.address, id: 'pool', label: "the swarm's wallet" }
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
  return row.wallet ? [pool()] : []
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
  const balances = await Vault.balances(self.env, row.wallet as Address)
  return { amount: Payer.max(balances.ousd - Vault.dust, 0n), resets: null }
}

export async function confirmed(self: Swarm, source: Source) {
  const channel = self.kv.get<Payer.Channel>(`channel:${source.id}`)
  if (!channel || channel.confirmed) return channel
  for (;;) {
    const state = await Payer.state(self.env, channel.id).catch(() => undefined)
    const old = Date.now() - channel.at > Payer.confirmMs
    if (state) {
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

export type Marks = { attempts?: number; confirm?: number; room?: number; row?: number; sign?: number }

function mark(marks: Marks, name: 'confirm' | 'room' | 'sign', since: number) {
  marks[name] = (marks[name] ?? 0) + Date.now() - since
}

export function outcome(paid: Paid) {
  if ('authorization' in paid) return paid.topUp ? 'topUp' : 'voucher'
  if ('feeToken' in paid) return 'feeToken'
  if ('usd' in paid) return 'budget'
  return paid.status
}

export function queued(self: Swarm, input: Pay): Promise<Paid> {
  const asked = Date.now()
  const marks: Marks = {}
  const run = self.paying.then(async () => {
    const started = Date.now()
    const paid = await charge(self, input, marks)
    console.log(JSON.stringify({ ...marks, operation: input.operation ?? null, paid: outcome(paid), pay: self.kv.get<string>('id'), waited: started - asked, worked: Date.now() - started }))
    return paid
  })
  self.paying = run.catch(() => undefined)
  return run
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
      else if (Payer.unsure(channel) && BigInt(snapshot.deposit) >= Payer.held(channel)) self.kv.put(key, Payer.confirm(channel, BigInt(snapshot.deposit), Date.now()))
      if (index === 0 && input.rejected && (input.attempt ?? 0) >= 2) {
        self.kv.put('exhausted:' + id, Date.now() + Clock.restMs)
        self.log('funds', `The gateway refused ${id === 'pool' ? "the swarm wallet's" : 'a contribution\'s'} payment again, so the swarm moves on to the next contribution.`, input.rejected.detail)
      }
    }

  const owed = input.recipient ? owing(input.recipient) : undefined
  if (owed && row.wallet && [owed.id, 'pool'].every((id) => (self.kv.get<number>('exhausted:' + id) ?? 0) <= Date.now())) {
    const source = owed
    const signing = Date.now()
    const result = await attempt(self, row, source, input, snapshots, marks).catch(
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

  const current = self.kv.get<string>('payer')
  const ordered = sources(self, row).filter((source) => (self.kv.get<number>('exhausted:' + source.id) ?? 0) <= Date.now())
  let busy = false
  let small = false
  let wanted = 0n
  for (const source of ordered) {
    const signing = Date.now()
    const result = await attempt(self, row, source, input, snapshots, marks).catch(
      (error: unknown): Failed => ({ failed: String(error).split('\n')[0]?.slice(0, 300) ?? 'The payment failed.', room: { amount: 0n, resets: Date.now() + Clock.retryMs } }),
    )
    mark(marks, 'sign', signing)
    marks.attempts = (marks.attempts ?? 0) + 1
    if ('feeToken' in result) return result
    if ('authorization' in result) {
      if (current !== source.id) {
        self.kv.put('payer', source.id)
        self.log('funds', `Paying from ${source.label} now.`)
      }
      return passing ? passed(self, input, result) : result
    }
    if (result.busy) busy = true
    if (result.busy || result.small) {
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
  const scarce = !passing && held >= perCall && price !== undefined && most < price
  if (scarce) wanted = Payer.max(wanted, price)
  const run = self.run()
  if (wanted && run.state === 'working') self.set({ ...run, wanted: String(wanted) })
  const wake = rested(self)
  const spent = wake ? `Every contribution to this swarm is spent for now; the next one comes back at ${new Date(wake).toISOString()}.` : 'Every contribution to this swarm is spent.'
  return {
    code: 'limit_reached',
    detail: scarce
      ? `No channel of this swarm holds ${Words.dollars(price)} at once: the MACH channels the gateway spends for it hold ${Words.dollars(held)} in all, the largest ${Words.dollars(most)}. Ask for less at once, such as a shorter lease or a smaller machine.`
      : held >= perCall && passing
        ? `Payments to outside services come only from the swarm's wallet, which cannot pay this; the MACH channels the gateway spends for the swarm (${Words.dollars(held)} left) pay only for the gateway's own requests.`
        : held >= perCall
          ? `The swarm's wallet cannot pay this, though the MACH channels the gateway spends for it still hold ${Words.dollars(held)}; try again in a moment.`
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
  const step = payee ? handChunk : chunk

  if (!channel) {
    const rooming = Date.now()
    const room = await headroom(self, row)
    mark(marks, 'room', rooming)
    const deposit = Payer.min(Payer.max(step, price), room.amount)
    if (deposit < price)
      return { failed: `It can put in ${Memo.decimal(room.amount)} now, less than the ${Memo.decimal(price)} this request holds.`, price, room, small: room.amount >= perCall }
    const authorization = await mppx.createCredential(offered.response, { depositRaw: String(deposit) })
    const entry = Payer.opened(self.kv, source.id)
    if (!entry) throw new Error('mppx stored no channel for the open')
    self.kv.put(`channel:${source.id}`, { at: Date.now(), confirmed: false, deposit: String(deposit), descriptor: entry.descriptor, id: entry.channelId, signed: String(price) } satisfies Payer.Channel)
    self.kv.put('spent:' + source.id, String(price))
    self.kv.put('paid:' + source.id, Date.now())
    self.cue('chain')
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
    const room = await headroom(self, row)
    mark(marks, 'room', rooming)
    const shortfall = need - deposit
    additional = Payer.min(Payer.max(step, shortfall), room.amount)
    if (additional < shortfall) {
      const unspent = spent === undefined ? 0n : deposit - BigInt(spent)
      return {
        busy: Date.now() - (self.kv.get<number>('paid:' + source.id) ?? 0) < (unspent >= perCall ? heldMs : holdMs),
        failed: `It can add ${Memo.decimal(room.amount)} now, less than the ${Memo.decimal(shortfall)} its channel needs (deposit ${Memo.decimal(deposit)}, spent ${Memo.decimal(BigInt(spent ?? '0'))}, accepted ${Memo.decimal(accepted)}, required ${Memo.decimal(BigInt(snapshot?.requiredCumulative ?? '0'))}, in flight ${Memo.decimal(pending)} over ${recent.length}, this request ${Memo.decimal(price)}).`,
        price,
        room,
        small: room.amount + Payer.max(unspent, 0n) >= perCall,
      }
    }
    topUp = await mppx.createCredential(offered.response, { action: 'topUp', additionalDepositRaw: String(additional), channelId: channel.id, descriptor: channel.descriptor })
  }
  const authorization = await mppx.createCredential(offered.response, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: String(need), descriptor: channel.descriptor })
  self.kv.put(`channel:${source.id}`, Payer.topped(channel, deposit, additional, need, Date.now()))
  if (topUp) self.cue('chain')
  self.kv.put('pending:' + source.id, [...recent, { amount: String(price), at: Date.now(), cumulative: String(need) }])
  self.kv.put('paid:' + source.id, Date.now())
  return topUp ? { authorization, topUp } : { authorization }
}

export async function probe(self: Swarm, row: Store.Row, source: Source) {
  const channel = self.kv.get<Payer.Channel>(`channel:${source.id}`)
  if (!channel?.confirmed) return
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
  self.kv.put(`channel:${source.id}`, { ...channel, signed: receipt.acceptedCumulative ?? String(cumulative) })
  if (receipt.spent) self.kv.put('spent:' + source.id, receipt.spent)
}

export function drop(self: Swarm, id: string) {
  self.kv.put('banked:' + id, String(used(self, id)))
  self.kv.delete('spent:' + id)
  Payer.forget(self.kv, id)
  self.clients.delete(id)
}

export function used(self: Swarm, id: string) {
  return BigInt(self.kv.get<string>('banked:' + id) ?? '0') + BigInt(self.kv.get<string>('spent:' + id) ?? '0')
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
