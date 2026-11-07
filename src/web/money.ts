import { useRef } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { choose, least, record, send, stray, type Unrecorded } from './Contribute.tsx'
import * as Wallet from './wallet.ts'

export async function payIn(config: Config, swarm: { id: string; wallet: `0x${string}` | null }, need: bigint, busy: (step: string) => void) {
  await Wallet.named()
  busy('Approve in Tempo Wallet…')
  await Wallet.refresh(config).catch(() => {})
  const token = choose(decimal(need), Wallet.snapshot().balances, config)
  const floor = units(least(config, token))
  await send(config, swarm, need < floor ? floor : need, '', token)
  busy('Sending…')
}

export function useCredit() {
  const credit = useRef(0n)
  const sent = useRef<Unrecorded | undefined>(undefined)
  return {
    async cover(config: Config, swarm: { id: string; wallet: `0x${string}` | null }, need: bigint, busy: (step: string) => void) {
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
        credit.current += owing.amount
      }
      const backing = await Api.room(swarm.id, { after: Number.MAX_SAFE_INTEGER }).then((room) => (room.me ? units(room.me.available) : 0n), () => undefined)
      const owed = need - (backing ?? credit.current)
      if (owed <= 0n) return
      const paying = owed < 10_000n ? 10_000n : owed
      try {
        await payIn(config, swarm, paying, busy)
      } catch (error) {
        sent.current = stray(error)?.paid
        throw error
      }
      credit.current += paying
    },
    spend(need: bigint) {
      credit.current = credit.current > need ? credit.current - need : 0n
    },
  }
}
