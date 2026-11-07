import { Challenge } from 'mppx'
import { createJsonChannelStore, Mppx, tempo } from 'mppx/client'
import { isAddressEqual } from 'viem'
import type { Account, Address, Hex } from 'viem'
import { readContract } from 'viem/actions'
import * as Chain from './Chain.ts'

export type Channel = { at: number; confirmed: boolean; deposit: string; descriptor: unknown; id: Hex; signed: string; topUp?: { amount: string; at: number } | undefined }

export const confirmMs = 8_000

export type Snapshot = {
  acceptedCumulative: string
  channelId: string
  closing?: boolean | undefined
  currency?: string | null | undefined
  deposit: string
  payee?: string | null | undefined
  requiredCumulative: string
  settled?: string | undefined
  spent: string
}

export type Client = { createCredential(response: Response, context?: unknown): Promise<string> }

const escrowAbi = [
  {
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    name: 'getChannelState',
    outputs: [
      {
        components: [
          { name: 'settled', type: 'uint96' },
          { name: 'deposit', type: 'uint96' },
          { name: 'closeRequestedAt', type: 'uint32' },
        ],
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

function sessions(challenge: string | readonly string[], recipient: Address) {
  const headers = new Headers()
  for (const value of typeof challenge === 'string' ? [challenge] : challenge) headers.append('www-authenticate', value)
  const found = (() => {
    try {
      return Challenge.fromResponseList(new Response(null, { headers, status: 402 }))
    } catch {
      return []
    }
  })()
  return found.filter((candidate) => {
    const request = candidate.request as { amount?: string; currency?: string; methodDetails?: { chainId?: number }; recipient?: string }
    return (
      candidate.method === 'tempo' &&
      candidate.intent === 'session' &&
      !!request.currency &&
      !!request.recipient &&
      isAddressEqual(request.recipient as Address, recipient) &&
      request.methodDetails?.chainId === Chain.chain.id
    )
  })
}

export function priced(challenge: string | readonly string[], recipient: Address = Chain.recipient) {
  const amounts = sessions(challenge, recipient).map((candidate) => BigInt((candidate.request as { amount?: string }).amount ?? '0'))
  return amounts.length ? amounts.reduce((least, amount) => (amount < least ? amount : least)) : undefined
}

export function offer(challenge: string | readonly string[], currency: Address, recipient: Address = Chain.recipient) {
  const found = sessions(challenge, recipient).find((candidate) => {
    const request = candidate.request as { amount?: string; currency?: string }
    return isAddressEqual(request.currency as Address, currency) && BigInt(request.amount ?? '0') <= Chain.cap
  })
  if (!found) return undefined
  return {
    amount: BigInt((found.request as { amount: string }).amount),
    fee: (found.request as { methodDetails?: { feePayer?: boolean; feeToken?: string } }).methodDetails ?? {},
    response: new Response(null, { headers: { 'www-authenticate': Challenge.serialize(found) }, status: 402 }),
  }
}

export function client(env: Cloudflare.Env, kv: SyncKvStorage, id: string, account: Account, currency: Address): Client {
  const prefix = `mppx:${id}:`
  const mppx = Mppx.create({
    methods: [
      tempo.session({
        account,
        channelStore: createJsonChannelStore({
          delete: async (key) => void kv.delete(prefix + key),
          get: async (key) => kv.get<string>(prefix + key),
          set: async (key, value) => kv.put(prefix + key, value),
        }),
        getClient: () => Chain.client(env),
      }),
    ],
    orderChallenges: (candidates) =>
      candidates.filter((candidate) => {
        const request = candidate.challenge.request as { currency?: string }
        return candidate.challenge.intent === 'session' && !!request.currency && isAddressEqual(request.currency as Address, currency)
      }),
    polyfill: false,
  })
  return { createCredential: (response, context) => mppx.createCredential(response, context as never) }
}

export function opened(kv: SyncKvStorage, id: string) {
  for (const [, value] of kv.list<string>({ prefix: `mppx:${id}:` })) {
    const entry = JSON.parse(value) as { channelId: Hex; descriptor: unknown; opened?: boolean }
    if (entry.opened) return entry
  }
  return undefined
}

export function forget(kv: SyncKvStorage, id: string) {
  for (const [key] of [...kv.list({ prefix: `mppx:${id}:` })]) kv.delete(key)
  kv.delete(`channel:${id}`)
  kv.delete(`pending:${id}`)
}

export function state(env: Cloudflare.Env, channel: Hex, client = Chain.client(env)) {
  return readContract(client, { abi: escrowAbi, address: Chain.escrow, args: [channel], functionName: 'getChannelState' })
}

export function held(channel: Channel) {
  return BigInt(channel.deposit) + BigInt(channel.topUp?.amount ?? '0')
}

export function inside(channel: Channel | undefined, spent: bigint) {
  return channel?.confirmed ? max(BigInt(channel.deposit) - spent, 0n) : 0n
}

export function unsure(channel: Channel) {
  return !channel.confirmed || !!channel.topUp
}

export function topped(channel: Channel, deposit: bigint, additional: bigint, signed: bigint, now: number): Channel {
  if (additional <= 0n) return { ...channel, signed: String(signed) }
  return { ...channel, signed: String(signed), topUp: { amount: String(deposit + additional - BigInt(channel.deposit)), at: now } }
}

export function confirm(channel: Channel, deposit: bigint, now: number): Channel {
  const old = now - (channel.topUp?.at ?? channel.at) > confirmMs
  if (deposit <= 0n || (deposit < held(channel) && !old)) return channel
  return { at: channel.at, confirmed: true, deposit: String(deposit), descriptor: channel.descriptor, id: channel.id, signed: channel.signed }
}

export function max(a: bigint, b: bigint) {
  return a > b ? a : b
}

export function min(a: bigint, b: bigint) {
  return a < b ? a : b
}
