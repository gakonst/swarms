import { concat, keccak256, slice, stringToHex, toHex } from 'viem'

export type Address = `0x${string}`

export type Hex = `0x${string}`

export type Token = 'mach' | 'ousd' | 'pathusd' | 'usdce'

export type Log = { amount: string; from: Address; memo: Hex; to: Address; token: Token }

export type Transfer = { at: number; block: number; hash: Hex; logs: Log[] }

export const chainId = 4217

export const configCommitment = '0x5bd93359'

export const recipient: Address = '0x40def0cf3b5d28b6e9a7976ba10591e515afecfe'

export function prefix(owner: string, app: string): Hex {
  return slice(keccak256(stringToHex(`gateway:credit:${chainId}:${owner.toLowerCase()}:${app}`)), 0, 16)
}

export function memo(owner: string, app: string, tag: Hex): Hex {
  return concat([prefix(owner, app), slice(tag, 0, 16)])
}

export function tag(memo: Hex): Hex {
  return slice(memo, 16, 32)
}

export function units(amount: string | number) {
  const text = (typeof amount === 'number' ? amount.toFixed(6) : amount).trim()
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = text.replace(/^-/, '').split('.')
  const value = BigInt(whole || '0') * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
  return negative ? -value : value
}

export function decimal(atomics: bigint) {
  const sign = atomics < 0n ? '-' : ''
  const value = atomics < 0n ? -atomics : atomics
  return `${sign}${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`
}

export function usd(atomics: bigint) {
  return Number(atomics) / 1_000_000
}

export function address(seed: string): Address {
  return slice(keccak256(stringToHex(`address:${seed}`)), 12, 32).toLowerCase() as Address
}

export type Chain = ReturnType<typeof create>

export function create() {
  const transfers = new Map<string, Transfer>()
  let block = 1

  const send = (logs: Log[]) => {
    const hash = keccak256(stringToHex(`tx:${transfers.size}:${Date.now()}:${Math.random()}:${JSON.stringify(logs)}`))
    const transfer: Transfer = {
      at: Date.now(),
      block: block++,
      hash,
      logs: logs.map((log) => ({ ...log, amount: decimal(units(log.amount)), from: lower(log.from), memo: log.memo.toLowerCase() as Hex, to: lower(log.to) })),
    }
    transfers.set(hash, transfer)
    return transfer
  }

  return {
    transfer(input: { amount: string; from: Address; memo: Hex; to?: Address; token?: Token }) {
      return send([{ amount: input.amount, from: input.from, memo: input.memo, to: input.to ?? recipient, token: input.token ?? 'pathusd' }])
    },
    batch(logs: Log[]) {
      return send(logs)
    },
    find(hash: string) {
      return transfers.get(hash.toLowerCase())
    },
    list(filter: { tag?: Hex; to?: Address } = {}) {
      return [...transfers.values()].filter((transfer) =>
        transfer.logs.some((log) => (filter.to === undefined || log.to === lower(filter.to)) && (filter.tag === undefined || tag(log.memo) === filter.tag.toLowerCase())),
      )
    },
    count() {
      return transfers.size
    },
    total(filter: { from?: Address; to?: Address } = {}) {
      let sum = 0n
      for (const transfer of transfers.values())
        for (const log of transfer.logs)
          if ((filter.from === undefined || log.from === lower(filter.from)) && (filter.to === undefined || log.to === lower(filter.to))) sum += units(log.amount)
      return sum
    },
    rpc(body: { id?: unknown; method?: string; params?: unknown[] }) {
      const answer = (result: unknown) => ({ id: body.id ?? null, jsonrpc: '2.0', result })
      if (body.method === 'eth_chainId') return answer(toHex(chainId))
      if (body.method === 'eth_blockNumber') return answer(toHex(block))
      if (body.method === 'eth_getCode') return answer('0x')
      if (body.method === 'eth_call' && String((body.params?.[0] as { data?: string } | undefined)?.data ?? '').startsWith(configCommitment)) return answer('0x' + '0'.repeat(64))
      if (body.method === 'eth_getTransactionReceipt') {
        const found = transfers.get(String(body.params?.[0] ?? '').toLowerCase())
        return answer(found ? { blockNumber: toHex(found.block), status: '0x1', transactionHash: found.hash } : null)
      }
      return { error: { code: -32601, message: `the mock chain does not answer ${String(body.method)}` }, id: body.id ?? null, jsonrpc: '2.0' }
    },
  }
}

function lower(address: Address) {
  return address.toLowerCase() as Address
}
