import { createClient, http } from 'viem'
import type { Address } from 'viem'
import { tempo } from 'viem/tempo/chains'
import type { Currency, Token } from '../shared/Api.ts'

export const chain = tempo

export const escrow: Address = '0x4d50500000000000000000000000000000000000'

export const recipient: Address = '0x40def0Cf3B5d28B6e9a7976BA10591e515AfECFE'

export const cap = 10_000_000n

export const tokens = {
  ousd: { address: '0x20c0000000000000000000006a37DA5C996874BE', symbol: 'OUSD' },
  pathusd: { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD' },
  usdce: { address: '0x20C000000000000000000000b9537d11c60E8b50', symbol: 'USDC.e' },
} as const satisfies Record<Token, { address: Address; symbol: string }>

export const ids = Object.keys(tokens) as Token[]

export const mach = { address: '0x20c000000000000000000000f37de3740ADec032', symbol: 'MACH' } as const satisfies { address: Address; symbol: string }

export function symbol(currency: Currency) {
  return currency === 'mach' ? mach.symbol : tokens[currency].symbol
}

export function token(address: string): Token | undefined {
  return ids.find((id) => tokens[id].address.toLowerCase() === address.toLowerCase())
}

const multicall: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'

export function client(env: Cloudflare.Env) {
  return createClient({ batch: { multicall: true }, chain: { ...tempo, contracts: { ...tempo.contracts, multicall3: { address: multicall } } }, transport: http(env.TEMPO_RPC) })
}
