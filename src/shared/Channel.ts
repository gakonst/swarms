import { encodeFunctionData } from 'viem'
import type { Channel } from './Api.ts'
import { memo } from './Transfer.ts'

export const mach: `0x${string}` = '0x20c000000000000000000000f37de3740ADec032'

const abi = [
  {
    inputs: [
      { name: 'payee', type: 'address' },
      { name: 'operator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'deposit', type: 'uint96' },
      { name: 'salt', type: 'bytes32' },
      { name: 'authorizedSigner', type: 'address' },
    ],
    name: 'open',
    outputs: [{ name: 'channelId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export function open(channel: Channel, swarm: string, amount: bigint, note?: string | null) {
  return {
    data: encodeFunctionData({ abi, args: [channel.recipient, channel.operator, mach, amount, memo(swarm, note), channel.signer], functionName: 'open' }),
    to: channel.escrow,
  }
}
