import type { Config, Currency } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { symbols } from './format.ts'
import * as Wallet from './wallet.ts'

export type Step = 'request' | 'approve' | 'confirm'

export const amounts = ['2', '5', '10'] as const

export function disclosure(token: Currency) {
  const symbol = symbols[token]
  return token === 'mach'
    ? `Tempo Wallet will ask you to approve a spending key that this app holds, capped at your pledge, for 7 days. It can only open, top up and close payment channels with the gateway, so the swarm pays its requests from your wallet as it works, and what its channel did not spend goes back when the swarm finishes. It may also spend up to $0.10 each of your USDC.e, pathUSD or OUSD on the network fees of those channel transactions when the gateway cannot sponsor them, since MACH cannot pay fees.`
    : `Tempo Wallet will ask you to approve a spending key that this app holds, capped at your pledge, for 7 days. It can only move ${symbol} to this swarm's wallet, which the swarm does as its agent needs money, so what it never needs stays in your wallet; what the swarm's wallet does not spend goes back to its contributors in proportion when the swarm finishes.`
}

export function valid(amount: string, config: Config | undefined, least = config?.minPledge) {
  const text = amount.trim()
  if (!/^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(text)) return false
  return units(text) >= units(least ?? '0.000001')
}

export function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

export async function pledge(config: Config, swarm: string, amount: string, note: string, token: Currency, onStep: (step: Step) => void) {
  onStep('request')
  const text = note.trim()
  if (token === 'mach' && Wallet.snapshot().session && !Api.fixture) return await keyed(config, swarm, decimal(units(amount)), text, onStep)
  const requested = await Api.pledge(swarm, { amount: decimal(units(amount)), token, ...(text ? { note: text } : {}) })
  onStep('approve')
  const approved = await Wallet.authorize(config, requested.authorizeAccessKey)
  onStep('confirm')
  return await Api.confirm(swarm, requested.pledge, approved.keyAuthorization).finally(() => void Wallet.refresh(config).catch(() => {}))
}

async function keyed(config: Config, swarm: string, amount: string, note: string, onStep: (step: Step) => void) {
  const input = { amount, ...(note ? { note } : {}) }
  const first = await Api.backing(swarm, input).catch((error: unknown) => {
    if (code(error) === 'key_required') return undefined
    throw error
  })
  if (first) return first
  onStep('approve')
  const requested = await Api.keyRequest()
  const approved = await Wallet.authorize(config, requested.authorizeAccessKey)
  onStep('confirm')
  await Api.keyApprove(requested.key, approved.keyAuthorization)
  return await Api.backing(swarm, input).finally(() => void Wallet.refresh(config).catch(() => {}))
}

export const steps = { approve: 'Approve a $100 MACH spending key in Tempo Wallet…', confirm: 'Recording the pledge…', request: 'Preparing the pledge…' } as const satisfies Record<Step, string>
