import { erc20Abi, parseEventLogs } from 'viem'
import type { Address, Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { readContract } from 'viem/actions'
import { Abis, Account, Actions } from 'viem/tempo'
import type { Token } from '../shared/Api.ts'
import * as Chain from './Chain.ts'
import * as Seal from './Seal.ts'
import type * as Store from './Store.ts'

export type Balances = Record<Token, bigint>

export type Swapped = { fee: bigint; hash: Hex; minimum: bigint; quote: bigint; received: bigint }

export const dust = 2_000n

export const slippage = 50n

export async function create(secret: string) {
  const key = generatePrivateKey()
  return { sealed_wallet: await Seal.seal(secret, key), wallet: privateKeyToAccount(key).address }
}

export async function account(env: Cloudflare.Env, row: Pick<Store.Row, 'sealed_wallet'>) {
  if (!row.sealed_wallet) throw new Error('This swarm has no wallet yet.')
  return Account.fromSecp256k1((await Seal.open(env.SWARMS_SECRET, row.sealed_wallet)) as Hex)
}

export async function balances(env: Cloudflare.Env, address: Address, client = Chain.client(env)): Promise<Balances> {
  const read = (id: Token) =>
    readContract(client, { abi: erc20Abi, address: Chain.tokens[id].address, args: [address], functionName: 'balanceOf' })
  const [ousd, pathusd, usdce] = await Promise.all([read('ousd'), read('pathusd'), read('usdce')])
  return { ousd, pathusd, usdce }
}

export function total(balances: Balances) {
  return balances.ousd + balances.pathusd + balances.usdce
}

export async function swap(env: Cloudflare.Env, owner: ReturnType<typeof Account.fromSecp256k1>, from: Token, amount: bigint): Promise<Swapped> {
  const client = Chain.client(env)
  const tokenIn = Chain.tokens[from].address
  const tokenOut = Chain.tokens.ousd.address
  const quote = await Actions.dex.getSellQuote(client, { amountIn: amount, tokenIn, tokenOut })
  const minimum = quote - (quote * slippage) / 10_000n
  const { receipt } = await Actions.dex.sellSync(client, {
    account: owner,
    amountIn: amount,
    feeToken: tokenIn,
    minAmountOut: minimum,
    nonceKey: 'expiring',
    tokenIn,
    tokenOut,
  })
  const received = parseEventLogs({ abi: Abis.tip20, eventName: 'Transfer', logs: receipt.logs })
    .filter((log) => log.address.toLowerCase() === tokenOut.toLowerCase() && log.args.to.toLowerCase() === owner.address.toLowerCase())
    .reduce((sum, log) => sum + log.args.amount, 0n)
  return { fee: fee(receipt), hash: receipt.transactionHash, minimum, quote, received }
}

export async function buy(env: Cloudflare.Env, owner: ReturnType<typeof Account.fromSecp256k1>, to: Token, amount: bigint) {
  const client = Chain.client(env)
  const tokenIn = Chain.tokens.ousd.address
  const tokenOut = Chain.tokens[to].address
  const quote = await Actions.dex.getBuyQuote(client, { amountOut: amount, tokenIn, tokenOut })
  const { receipt } = await Actions.dex.buySync(client, {
    account: owner,
    amountOut: amount,
    feeToken: tokenIn,
    maxAmountIn: quote + (quote * slippage) / 10_000n,
    nonceKey: 'expiring',
    tokenIn,
    tokenOut,
  })
  return { fee: fee(receipt), hash: receipt.transactionHash, quote }
}

export function fee(receipt: { effectiveGasPrice: bigint; gasUsed: bigint }) {
  return (receipt.gasUsed * receipt.effectiveGasPrice + 999_999_999_999n) / 1_000_000_000_000n
}
