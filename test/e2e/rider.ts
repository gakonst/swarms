import { keccak256, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Credit from '../../src/shared/Credit.ts'
import type * as Chain from '../mock/chain.ts'
import type { Dev } from './dev.ts'

export type Rider = Awaited<ReturnType<typeof rider>>

export async function rider(dev: Dev, name: string) {
  const account = privateKeyToAccount(keccak256(stringToHex('rider:' + name)))
  const address = account.address.toLowerCase() as Chain.Address
  const challenge = await dev.call<{ id: string; message: string }>('POST', '/v1/auth/challenge', {})
  if (challenge.status !== 200) throw new Error('challenge failed: ' + JSON.stringify(challenge.body))
  const signature = await account.signMessage({ message: challenge.body.message })
  const signed = await dev.call<{ token: string }>('POST', '/v1/auth', { address: account.address, id: challenge.body.id, message: challenge.body.message, signature })
  if (signed.status !== 200) throw new Error('sign-in failed: ' + JSON.stringify(signed.body))
  const token = signed.body.token
  return {
    address,
    call: <value = Record<string, unknown>>(method: string, route: string, body?: unknown) => dev.call<value>(method, route, body, token),
    name,
    pay(swarm: string, amount: string, note?: string | null) {
      return dev.gateway.chain.transfer({ amount, from: address, memo: Credit.memo(dev.gateway.wallet, swarm, note ?? null) as Chain.Hex })
    },
    token,
  }
}
