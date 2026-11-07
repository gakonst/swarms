import { useRef } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import { choose, least, record, send, stray, type Unrecorded } from './Contribute.tsx'
import * as Wallet from './wallet.ts'

export async function payIn(config: Config, swarm: { id: string; wallet: `0x${string}` | null }, need: bigint, busy: (step: string) => void, note = '') {
  await Wallet.named()
  busy('Approve in Tempo Wallet…')
  await Wallet.refresh(config).catch(() => {})
  const token = choose(decimal(need), Wallet.snapshot().balances, config)
  const floor = units(least(config, token))
  await send(config, swarm, need < floor ? floor : need, note, token)
  busy('Sending…')
}

export function useCredit() {
  const sent = useRef<Unrecorded | undefined>(undefined)
  return {
    async cover(config: Config, swarm: { id: string; wallet: `0x${string}` | null }, need: bigint, busy: (step: string) => void, note = '') {
      const owing = sent.current
      if (owing?.swarm === swarm.id) {
        busy('Recording…')
        try {
          await record(owing)
        } catch (error) {
          sent.current = stray(error)?.paid
          throw error
        }
        sent.current = undefined
        if (owing.note === note && owing.amount >= need) return
      }
      try {
        await payIn(config, swarm, need < 10_000n ? 10_000n : need, busy, note)
      } catch (error) {
        sent.current = stray(error)?.paid
        throw error
      }
    },
  }
}
