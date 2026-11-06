import { useRef } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { choose, least, send } from './Contribute.tsx'
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
