import { Challenge, Credential } from 'mppx'
import { createJsonChannelStore, Mppx, tempo } from 'mppx/client'
import { Session } from 'mppx/tempo'
import { Hex as OxHex } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { encodeFunctionData, isAddressEqual } from 'viem'
import type { Account, Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { prepareTransactionRequest, readContract, sendRawTransactionSync, signTransaction } from 'viem/actions'
import { Transaction } from 'viem/tempo'
import * as Chain from './Chain.ts'

export type Channel = { at: number; confirmed: boolean; deposit: string; descriptor: unknown; id: Hex; signed: string; sponsored?: true }

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

const descriptor = {
  components: [
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'operator', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'salt', type: 'bytes32' },
    { name: 'authorizedSigner', type: 'address' },
    { name: 'expiringNonceHash', type: 'bytes32' },
  ],
  name: 'descriptor',
  type: 'tuple',
} as const

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
  { inputs: [descriptor], name: 'requestClose', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const

export function offer(challenge: string | readonly string[], currency: Address, recipient: Address = Chain.recipient) {
  const headers = new Headers()
  for (const value of typeof challenge === 'string' ? [challenge] : challenge) headers.append('www-authenticate', value)
  const response = new Response(null, { headers, status: 402 })
  const found = Challenge.fromResponseList(response).find((candidate) => {
    const request = candidate.request as { amount?: string; currency?: string; methodDetails?: { chainId?: number }; recipient?: string }
    return (
      candidate.method === 'tempo' &&
      candidate.intent === 'session' &&
      !!request.currency &&
      isAddressEqual(request.currency as Address, currency) &&
      !!request.recipient &&
      isAddressEqual(request.recipient as Address, recipient) &&
      request.methodDetails?.chainId === Chain.chain.id &&
      BigInt(request.amount ?? '0') <= Chain.cap
    )
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

export async function closing(client: Client, challenge: Response, channel: Channel, key: Hex) {
  const voucher = Credential.deserialize<{ cumulativeAmount: string; signature: Hex }>(
    await client.createCredential(challenge, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: channel.signed, descriptor: channel.descriptor }),
  )
  const signature = await privateKeyToAccount(key).signTypedData({
    domain: { chainId: Chain.chain.id, name: 'TIP20 Channel Reserve', verifyingContract: Chain.escrow, version: '1' },
    message: { channelId: channel.id, cumulativeAmount: BigInt(voucher.payload.cumulativeAmount) },
    primaryType: 'CloseAuthorization',
    types: { CloseAuthorization: [{ name: 'channelId', type: 'bytes32' }, { name: 'cumulativeAmount', type: 'uint96' }] },
  })
  return Credential.serialize({
    ...voucher,
    payload: {
      action: 'close',
      channelId: channel.id,
      closeSignature: SignatureEnvelope.serialize(SignatureEnvelope.from(signature)),
      cumulativeAmount: voucher.payload.cumulativeAmount,
      descriptor: channel.descriptor,
      signature: voucher.payload.signature,
    },
  })
}

export async function requestClose(env: Cloudflare.Env, channel: Channel, account: Account, sponsor: { account: Account; token: Address }) {
  const client = Chain.client(env)
  const call = { data: encodeFunctionData({ abi: escrowAbi, args: [channel.descriptor as never], functionName: 'requestClose' }), to: Chain.escrow }
  const own = isAddressEqual(account.address, sponsor.account.address)
  const prepared = await prepareTransactionRequest(client, {
    account,
    calls: [call],
    ...(own ? { feeToken: sponsor.token } : { feePayer: true }),
    nonceKey: 'expiring',
  } as never)
  const signed = await signTransaction(client, prepared as never)
  const serialized = own
    ? signed
    : await signTransaction(client, {
        ...(Transaction.deserialize(signed) as object),
        account: sponsor.account,
        feePayer: sponsor.account,
        feeToken: sponsor.token,
        type: 'tempo',
      } as never)
  const receipt = await sendRawTransactionSync(client, { serializedTransaction: serialized })
  if (receipt.status !== 'success') throw new Error('requestClose reverted')
  return receipt.transactionHash
}

export async function sponsored(env: Cloudflare.Env, account: Account, input: { deposit: bigint; operator: Address; signer: Address; token: Address }) {
  const client = Chain.client(env)
  const salt = OxHex.random(32)
  const prepared = await prepareTransactionRequest(client, {
    account,
    calls: [{ data: encodeFunctionData({ abi: Session.Precompile.escrowAbi, args: [Chain.recipient, input.operator, input.token, input.deposit, salt, input.signer], functionName: 'open' }), to: Chain.escrow }],
    feePayer: true,
    nonceKey: 'expiring',
  } as never)
  const transaction = await signTransaction(client, prepared as never)
  const expiringNonceHash = Session.Precompile.Channel.computeExpiringNonceHash(
    Session.Precompile.Channel.transactionForExpiringNonceHash({ feePayer: true, transaction: Transaction.deserialize(transaction) as never }),
    { sender: account.address },
  )
  const descriptor = { authorizedSigner: input.signer, expiringNonceHash, operator: input.operator, payee: Chain.recipient, payer: account.address, salt, token: input.token }
  return { descriptor, id: Session.Precompile.Channel.computeId({ ...descriptor, chainId: Chain.chain.id, escrow: Chain.escrow }), transaction }
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

export function state(env: Cloudflare.Env, channel: Hex) {
  return readContract(Chain.client(env), { abi: escrowAbi, address: Chain.escrow, args: [channel], functionName: 'getChannelState' })
}

export function max(a: bigint, b: bigint) {
  return a > b ? a : b
}

export function min(a: bigint, b: bigint) {
  return a < b ? a : b
}
