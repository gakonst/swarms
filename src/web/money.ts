import { useRef } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { memo } from '../shared/Transfer.ts'
import { choose, recorded } from './Contribute.tsx'
import { pledge, steps } from './Pledge.tsx'
import * as Wallet from './wallet.ts'

const minSteer = 100_000n

export async function payIn(config: Config, swarm: { id: string; wallet: `0x${string}` | null }, need: bigint, busy: (step: string) => void) {
  if (!swarm.wallet) throw new Error('This swarm has no wallet yet.')
  const wallet = swarm.wallet
  await Wallet.named()
  busy('Approve in Tempo Wallet…')
  await Wallet.refresh(config).catch(() => {})
  const token = choose('send', decimal(need), Wallet.snapshot().balances)
  if (token === 'mach') {
    await pledge(config, swarm.id, decimal(need < minSteer ? minSteer : need), '', 'mach', (step) => busy(step === 'approve' ? steps.approve : 'Sending…'))
    return
  }
  const hash = await Wallet.send(config, { amount: need, memo: memo(swarm.id, ''), to: wallet, token })
  busy('Sending…')
  await recorded(swarm.id, hash, '')
}

export function useCredit() {
  const credit = useRef(0n)
  return {
    async cover(config: Config, swarm: { id: string; wallet: `0x${string}` | null }, need: bigint, busy: (step: string) => void) {
      const backing = await Api.room(swarm.id, { after: Number.MAX_SAFE_INTEGER }).then((room) => (room.me ? units(room.me.available) : 0n), () => undefined)
      const owed = need - (backing ?? credit.current)
      if (owed <= 0n) return
      const sent = owed < 10_000n ? 10_000n : owed
      await payIn(config, swarm, sent, busy)
      credit.current += sent
    },
    spend(need: bigint) {
      credit.current = credit.current > need ? credit.current - need : 0n
    },
  }
}
