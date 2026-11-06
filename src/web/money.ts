import type { Config } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import { memo } from '../shared/Transfer.ts'
import { choose, recorded } from './Contribute.tsx'
import { pledge } from './Pledge.tsx'
import * as Wallet from './wallet.ts'

export async function payIn(config: Config, swarm: { id: string; wallet: `0x${string}` | null }, need: bigint, busy: (step: string) => void) {
  if (!swarm.wallet) throw new Error('This swarm has no wallet yet.')
  const wallet = swarm.wallet
  busy('Approve in Tempo Wallet…')
  await Wallet.refresh(config).catch(() => {})
  const token = choose('send', decimal(need), Wallet.snapshot().balances)
  if (token === 'mach') {
    await pledge(config, swarm.id, decimal(need), '', 'mach', (step) => busy(step === 'approve' ? 'Approve in Tempo Wallet…' : 'Sending…'))
    return
  }
  const hash = await Wallet.send(config, { amount: need, memo: memo(swarm.id, ''), to: wallet, token })
  busy('Sending…')
  await recorded(swarm.id, hash, '')
}
