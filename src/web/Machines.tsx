import { useState } from 'react'
import type { Config, Detail, Lent } from '../shared/Api.ts'
import * as Fleet from '../shared/Fleet.ts'
import { Alert, explain } from './Alert.tsx'
import * as Api from './api.ts'
import * as Attempt from './attempt.ts'
import { useAttempt, usePoll, useWallet } from './hooks.ts'
import { useRoster } from './Steering.tsx'
import * as Wire from './wire.ts'

export function Machines(props: { config: Config | undefined; swarm: Pick<Detail, 'id' | 'steering'> }) {
  const id = props.swarm.id
  const wallet = useWallet()
  const roster = useRoster(id, props.swarm.steering)
  const [lent, relend, setLent] = usePoll(() => Api.hands(id), null, `hands:${id}`)
  Wire.useWire(id, 'room', (signal) => {
    if (Wire.stirred(signal, 'hands')) relend()
  })
  const [asking, setAsking] = useState<string>()
  const [attempt, run] = useAttempt()
  const busy = Attempt.busy(attempt)
  const error = Attempt.error(attempt)
  const admin = Fleet.removes(wallet.session?.address, roster?.admins ?? [], props.config?.credit?.owner)
  const hands = lent.data?.hands ?? []
  if (!hands.length && !error) return null

  const remove = async (hand: Lent) => {
    setAsking(undefined)
    const before = lent.data
    setLent((data) => data && { hands: data.hands.filter((each) => each.name !== hand.name) })
    const done = await run(() => Api.unhand(id, hand.name))
    if (!done) setLent(() => before)
    relend()
  }

  return (
    <section aria-labelledby="machines-title" className="machines">
      <h2 id="machines-title">Machines</h2>
      <ul className="reins-list">
        {hands.map((hand) => (
          <li key={hand.name}>
            <b title={hand.name}>{hand.label || hand.name}</b>
            <span>{hand.connected ? 'connected' : 'offline'}</span>
            {admin &&
              (asking === hand.name ? (
                <>
                  <button disabled={busy} onClick={() => void remove(hand)} type="button">Remove it?</button>
                  <button disabled={busy} onClick={() => setAsking(undefined)} type="button">Keep</button>
                </>
              ) : (
                <button disabled={busy} onClick={() => setAsking(hand.name)} type="button">Remove</button>
              ))}
          </li>
        ))}
      </ul>
      {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
    </section>
  )
}
