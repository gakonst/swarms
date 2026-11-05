import { useState } from 'react'
import type { Branch, Config, Detail } from '../shared/Api.ts'
import * as Mention from '../shared/Mention.ts'
import { decimal, units } from '../shared/Memo.ts'
import { memo } from '../shared/Transfer.ts'
import { Alert, explain } from './Alert.tsx'
import { choose, recorded } from './Contribute.tsx'
import { pledge } from './Pledge.tsx'
import * as Api from './api.ts'
import { usd } from './format.ts'
import { message, usePoll, useWallet } from './hooks.ts'
import { seated, useRoster } from './Steering.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'

const stakes = ['0.5', '1', '5'] as const

const states: Record<Branch['state'], string> = {
  closed: 'Closed',
  closing: 'Closing',
  completed: 'Done',
  failed: 'Failed',
  interrupted: 'Stopped',
  pending: 'Starting',
  running: 'Working',
}

function label(branch: Branch) {
  return branch.starved ? 'Out of budget' : states[branch.state]
}

function under(all: readonly Branch[], id: number, depth = 1): { branch: Branch; depth: number }[] {
  return all.filter((branch) => branch.parent === id).flatMap((branch) => [{ branch, depth }, ...under(all, branch.id, depth + 1)])
}

function valid(stake: string, least = Mention.smallestSteer) {
  return /^\d*\.?\d{0,6}$/.test(stake) && stake !== '' && stake !== '.' && units(stake) >= least
}

export function Branches(props: { config: Config | undefined; swarm: Detail }) {
  const [listed, reload] = usePoll(() => Api.branches(props.swarm.id), 15_000, `branches:${props.swarm.id}`)
  const [open, setOpen] = useState<number>()
  const all = listed.data?.branches ?? []
  const top = all.filter((branch) => branch.parent === null)
  const total = top.reduce((sum, branch) => sum + units(branch.funded), 0n)

  if (!listed.data)
    return listed.error ? (
      <div className="artifact-empty">
        <h2>The branches did not load.</h2>
        <p>{listed.error}</p>
      </div>
    ) : (
      <div aria-busy="true" className="artifact-empty"><p>Loading branches…</p></div>
    )

  if (!top.length)
    return (
      <div className="artifact-empty">
        <h2>No branches yet.</h2>
        <p>When the agent starts subagents, each one becomes a branch you can fund.</p>
      </div>
    )

  return (
    <section aria-label="Branches" className="branches">
      <header className="branches-head">
        <p className="branches-total">
          <b>{top.length}</b> {top.length === 1 ? 'branch' : 'branches'}
          {total > 0n && <> · <b>{usd(decimal(total))}</b> put behind them</>}
        </p>
        <p className="branches-how">A branch is a subagent the agent started, with the subagents under it. Money you put behind one becomes its budget, and it stops when that is spent. Move what it has not spent to another branch any time.</p>
      </header>
      <ol className="branches-list">
        {top.map((branch) => (
          <Card
            branch={branch}
            config={props.config}
            descendants={under(all, branch.id)}
            key={branch.id}
            onChanged={reload}
            onToggle={() => setOpen((current) => (current === branch.id ? undefined : branch.id))}
            open={open === branch.id}
            others={top.filter((other) => other.id !== branch.id && other.state !== 'closed' && other.state !== 'closing')}
            swarm={props.swarm}
          />
        ))}
      </ol>
    </section>
  )
}

function Card(props: {
  branch: Branch
  config: Config | undefined
  descendants: readonly { branch: Branch; depth: number }[]
  onChanged: () => void
  onToggle: () => void
  open: boolean
  others: readonly Branch[]
  swarm: Detail
}) {
  const branch = props.branch
  const budget = branch.budget === null ? null : units(branch.budget)
  const spent = branch.spent === null ? 0n : units(branch.spent)
  const filled = budget && budget > 0n ? Math.min(100, (Number(spent) / Number(budget)) * 100) : 0

  return (
    <li className="branch" data-open={props.open} data-starved={branch.starved} data-state={branch.state}>
      <button aria-expanded={props.open} className="branch-row" onClick={props.onToggle} type="button">
        <span className="branch-top">
          <b className="branch-role">{branch.role}</b>
          <span className="branch-state">{label(branch)}</span>
        </span>
        <span className="branch-task">{branch.task}</span>
        <span className="branch-money">
          {budget === null ? (
            <span className="branch-pool">No budget of its own · shares the swarm's money</span>
          ) : (
            <>
              <span aria-hidden="true" className="branch-bar"><i style={{ width: `${filled}%` }} /></span>
              <span className="branch-figures"><b>{usd(decimal(spent))}</b> of {usd(decimal(budget))} spent{branch.left !== null && units(branch.left) > 0n ? ` · ${usd(branch.left)} left` : ''}</span>
            </>
          )}
        </span>
        {branch.funders.length > 0 && (
          <span className="branch-funders">
            {branch.funders.slice(0, 4).map((funder) => `${Mention.at(funder.handle)} ${usd(funder.amount)}`).join(' · ')}
            {branch.funders.length > 4 ? ` · +${branch.funders.length - 4}` : ''}
          </span>
        )}
        {branch.error && <span className="branch-error">{branch.error}</span>}
        {!props.open && props.swarm.status !== 'done' && branch.state !== 'closed' && <span aria-hidden="true" className="branch-plus">Fund +</span>}
      </button>
      {props.descendants.length > 0 && (
        <ul className="branch-children">
          {props.descendants.map((child) => (
            <li data-state={child.branch.state} key={child.branch.id} style={{ paddingInlineStart: `${(child.depth - 1) * 14}px` }}>
              <span className="branch-child-role">{child.branch.role}</span>
              <span className="branch-child-meta">
                {label(child.branch)}
                {child.branch.budget !== null && ` · ${usd(child.branch.spent ?? '0')} of ${usd(child.branch.budget)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {props.open && props.swarm.status !== 'done' && branch.state !== 'closed' && (
        <Tray branch={branch} config={props.config} onChanged={props.onChanged} others={props.others} swarm={props.swarm} />
      )}
    </li>
  )
}

function Tray(props: { branch: Branch; config: Config | undefined; onChanged: () => void; others: readonly Branch[]; swarm: Detail }) {
  const wallet = useWallet()
  const roster = useRoster(props.swarm.id, props.swarm.steering)
  const team = props.swarm.steering === 'team'
  const seat = seated(roster, wallet.session?.address)
  const [stake, setStake] = useState<string>('1')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const mine = props.branch.funders.find((funder) => funder.address === wallet.session?.address.toLowerCase())
  const movable = mine ? (props.branch.left !== null && units(props.branch.left) < units(mine.amount) ? props.branch.left : mine.amount) : '0'
  const [to, setTo] = useState<number | undefined>(props.others[0]?.id)
  const [shift, setShift] = useState<string>('')

  if (!wallet.session)
    return (
      <div className="branch-tray">
        <button
          className="branch-go"
          disabled={!!busy || !props.config}
          onClick={() => {
            if (!props.config) return
            setBusy('Approve in Tempo Wallet…')
            void Wallet.signIn(props.config).catch((reason: unknown) => setError(message(reason))).finally(() => setBusy(undefined))
          }}
          type="button"
        >
          {busy ?? 'Sign in to fund this branch'}
        </button>
        {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
      </div>
    )

  if (wallet.account && !wallet.account.name)
    return (
      <div className="branch-tray">
        <Username why="Pick a username to fund branches. People see it beside what you put behind each one." />
      </div>
    )

  if (team && roster && !seat)
    return (
      <div className="branch-tray">
        <p className="branch-note"><b>Only its team directs this swarm's money.</b> Anyone can fund the swarm itself; its admins add who steers.</p>
      </div>
    )

  const fund = async () => {
    const config = props.config
    if (!config || busy || !valid(stake)) return
    setError(undefined)
    setDone(undefined)
    try {
      const need = units(stake)
      if (!team) {
        if (!props.swarm.wallet) throw new Error('This swarm has no wallet yet.')
        const swarmWallet = props.swarm.wallet
        setBusy('Approve in Tempo Wallet…')
        await Wallet.refresh(config).catch(() => {})
        const token = choose('send', decimal(need), Wallet.snapshot().balances)
        if (token === 'mach') await pledge(config, props.swarm.id, decimal(need), '', 'mach', (step) => setBusy(step === 'approve' ? 'Approve in Tempo Wallet…' : 'Sending…'))
        else {
          const hash = await Wallet.send(config, { amount: need, memo: memo(props.swarm.id, ''), to: swarmWallet, token })
          setBusy('Sending…')
          await recorded(props.swarm.id, hash, '')
        }
      }
      setBusy('Raising its budget…')
      const funded = await Api.fund(props.swarm.id, props.branch.id, { amount: decimal(need) })
      setDone(`${props.branch.role}'s budget is now ${usd(funded.budget ?? '0')}.`)
      props.onChanged()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const move = async () => {
    const amount = shift || movable
    if (busy || to === undefined || !valid(amount, 10_000n)) return
    setError(undefined)
    setDone(undefined)
    setBusy('Moving…')
    try {
      const moved = await Api.move(props.swarm.id, props.branch.id, { amount: decimal(units(amount)), to })
      setDone(`Moved ${usd(decimal(units(amount)))} to ${moved[1]?.role ?? 'the other branch'}.`)
      setShift('')
      props.onChanged()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="branch-tray">
      <div className="say-stake" role="radiogroup" aria-label="How much behind this branch">
        {stakes.map((value) => (
          <button aria-checked={stake === value} disabled={!!busy} key={value} onClick={() => setStake(value)} role="radio" type="button">${value === '0.5' ? '0.50' : value}</button>
        ))}
        <label className="say-own">$<input aria-label="Your amount" disabled={!!busy} inputMode="decimal" onChange={(event) => setStake(event.target.value.replace(',', '.').replace('$', ''))} onFocus={(event) => event.target.select()} placeholder="…" value={(stakes as readonly string[]).includes(stake) ? '' : stake} /></label>
        <button className="branch-go" disabled={!!busy || !valid(stake)} onClick={() => void fund()} type="button">{busy ?? (valid(stake) ? `Fund ${usd(decimal(units(stake)))}` : 'Fund')}</button>
      </div>
      <p className="branch-note">{team ? `From the swarm's money${seat?.left === null || seat?.left === undefined ? '' : ` · ${usd(seat.left)} of your team budget left`}.` : 'New money from your wallet, all of it for this branch.'}{props.branch.starved ? ' It is out of budget, so funding it starts it again.' : ''}</p>
      {mine && units(movable) > 0n && props.others.length > 0 && (
        <div className="branch-move">
          <span>Move</span>
          <label className="say-own">$<input aria-label="Amount to move" disabled={!!busy} inputMode="decimal" onChange={(event) => setShift(event.target.value.replace(',', '.').replace('$', ''))} placeholder={String(Number(movable))} value={shift} /></label>
          <span>of your {usd(mine.amount)} to</span>
          <select aria-label="Branch to move it to" disabled={!!busy} onChange={(event) => setTo(Number(event.target.value))} value={to}>
            {props.others.map((other) => (
              <option key={other.id} value={other.id}>{other.role}</option>
            ))}
          </select>
          <button disabled={!!busy || to === undefined || !valid(shift || movable, 10_000n)} onClick={() => void move()} type="button">Move</button>
        </div>
      )}
      {done && <p className="branch-done">{done}</p>}
      {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
    </div>
  )
}
