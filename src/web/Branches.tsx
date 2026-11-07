import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Branch, Branches, Detail } from '../shared/Api.ts'
import * as Mention from '../shared/Mention.ts'
import { decimal, units } from '../shared/Memo.ts'
import { Alert, explain } from './Alert.tsx'
import * as Api from './api.ts'
import { usd } from './format.ts'
import { message, useVisible, useWallet } from './hooks.ts'
import { Markdown } from './Markdown.tsx'
import { useRoster } from './Steering.tsx'
import * as Wire from './wire.ts'

const states: Record<Branch['state'], string> = {
  closed: 'Stopped',
  closing: 'Stopping',
  completed: 'Done',
  failed: 'Failed',
  interrupted: 'Paused',
  pending: 'Starting',
  running: 'Working',
}

export function label(branch: Branch) {
  return branch.starved ? 'Out of budget' : states[branch.state]
}

export function ended(branch: Branch) {
  return branch.state === 'closed' || branch.state === 'closing'
}

export function root(all: readonly Branch[], branch: Branch) {
  let top = branch
  for (let parent = all.find((item) => item.id === top.parent); parent; parent = all.find((item) => item.id === top.parent)) top = parent
  return top
}

function under(all: readonly Branch[], id: number, depth = 1): { branch: Branch; depth: number }[] {
  return all.filter((branch) => branch.parent === id).flatMap((branch) => [{ branch, depth }, ...under(all, branch.id, depth + 1)])
}

export function tree(all: readonly Branch[]) {
  const ordered = all.filter((branch) => branch.parent === null).flatMap((branch) => [branch, ...under(all, branch.id).map((child) => child.branch)])
  return [...ordered, ...all.filter((branch) => !ordered.includes(branch))]
}

type Listed = { data?: Branches | undefined; error?: string | undefined }

type Kept = { flight: Promise<void> | undefined; leave: (() => void) | undefined; running: boolean; shown: Listed; soon: ReturnType<typeof setTimeout> | undefined; started: number; timer: ReturnType<typeof setTimeout> | undefined; users: number }

const lists = new Map<string, Kept>()

const told = new Set<() => void>()

const unlisted: Listed = {}

const settleMs = 5000

const branchMs = 60_000

function tell() {
  for (const listener of told) listener()
}

export function relist(id: string) {
  const kept = lists.get(id)
  if (!kept || kept.flight) return
  clearTimeout(kept.soon)
  kept.started = Date.now()
  kept.flight = Api.branches(id)
    .then(
      (data) => {
        kept.shown = { data }
      },
      (error: unknown) => {
        kept.shown = { ...kept.shown, error: message(error) }
      },
    )
    .finally(() => {
      kept.flight = undefined
      tell()
      plan(id)
    })
}

function plan(id: string) {
  const kept = lists.get(id)
  if (!kept) return
  clearTimeout(kept.timer)
  const state = Wire.state(id, 'room')
  const every = state === 'down' || (state === 'live' && kept.running) ? branchMs : null
  if (!kept.users || every === null || kept.flight || document.visibilityState === 'hidden') return
  kept.timer = setTimeout(() => relist(id), Math.max(0, kept.started + every - Date.now()))
}

function shown(id: string) {
  return lists.get(id)?.shown ?? unlisted
}

function listen(listener: () => void) {
  told.add(listener)
  return () => {
    told.delete(listener)
  }
}

export function useBranches(id: string, running: boolean) {
  const wired = Wire.useWire(id, 'room')
  const visible = useVisible()
  const listed = useSyncExternalStore(listen, () => shown(id), () => unlisted)

  useEffect(() => {
    const kept = lists.get(id) ?? { flight: undefined, leave: undefined, running, shown: unlisted, soon: undefined, started: 0, timer: undefined, users: 0 }
    lists.set(id, kept)
    kept.users += 1
    kept.leave ??= Wire.join(id, 'room', (signal) => {
      if (!Wire.stirred(signal, 'branches')) return
      if (signal.type === 'stir' && signal.cause === 'welcome') return relist(id)
      clearTimeout(kept.soon)
      kept.soon = setTimeout(() => relist(id), settleMs)
    })
    if (Date.now() - kept.started > settleMs) relist(id)
    return () => {
      kept.users -= 1
      if (kept.users > 0) return
      clearTimeout(kept.timer)
      clearTimeout(kept.soon)
      kept.leave?.()
      kept.leave = undefined
    }
  }, [id])

  useEffect(() => {
    const kept = lists.get(id)
    if (kept) kept.running = running
    plan(id)
  }, [id, running, wired, visible])

  return listed
}

function valid(stake: string) {
  return /^\d*\.?\d{0,6}$/.test(stake) && stake !== '' && stake !== '.' && units(stake) >= 10_000n
}

export function BranchBar(props: { all: readonly Branch[]; branch: Branch; onChanged: () => void; onPick: (who: string) => void; swarm: Detail }) {
  const [open, setOpen] = useState(false)
  const branch = props.branch
  const top = root(props.all, branch)
  const budget = branch.budget === null ? null : units(branch.budget)
  const spent = branch.spent === null ? 0n : units(branch.spent)
  const filled = budget && budget > 0n ? Math.min(100, (Number(spent) / Number(budget)) * 100) : 0
  const below = under(props.all, branch.id)
  const live = branch.parent === null && !ended(branch)

  return (
    <section aria-label={branch.who} className="lane" data-open={open} data-starved={branch.starved} data-state={branch.state}>
      <button aria-expanded={open} className="lane-row" onClick={() => setOpen(!open)} type="button">
        <span className="lane-top">
          <span className="lane-state">{label(branch)}</span>
          <span className="lane-task">{branch.task}</span>
          <span aria-hidden="true" className="lane-chevron">›</span>
        </span>
        <span className="lane-money">
          {budget === null ? (
            <span className="lane-figures"><b>{usd(decimal(spent))}</b> spent of the swarm's money{units(branch.funded) > 0n ? ` · ${usd(branch.funded)} behind it` : ''}</span>
          ) : (
            <>
              <span aria-hidden="true" className="lane-bar"><i style={{ width: `${filled}%` }} /></span>
              <span className="lane-figures"><b>{usd(decimal(spent))}</b> of {usd(decimal(budget))}{branch.left !== null && units(branch.left) > 0n && branch.state !== 'closed' ? ` · ${usd(branch.left)} left` : ''}</span>
            </>
          )}
          {branch.funders.length > 0 && (
            <span className="lane-funders">
              {branch.funders.slice(0, 4).map((funder) => `${Mention.at(funder.handle)} ${usd(funder.amount)}`).join(' · ')}
              {branch.funders.length > 4 ? ` · +${branch.funders.length - 4}` : ''}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="lane-open">
          {branch.error && <p className="lane-error">{branch.error}</p>}
          {top !== branch && (
            <p className="lane-note">
              A subagent under <button className="lane-link" onClick={() => props.onPick(top.who)} type="button">{top.who}</button>, which you steer and fund for it.
            </p>
          )}
          {live && budget === null && <p className="lane-note">It has no budget of its own, so money put behind it counts as backing, not a cap.</p>}
          {live && branch.starved && <p className="lane-note">It spent its budget; funding it starts it again.</p>}
          {below.length > 0 && (
            <ul className="lane-children">
              {below.map((child) => (
                <li key={child.branch.id} style={{ paddingInlineStart: `${(child.depth - 1) * 14}px` }}>
                  <button className="lane-link" onClick={() => props.onPick(child.branch.who)} type="button">{child.branch.who}</button>
                  <span>
                    {label(child.branch)}
                    {child.branch.spent !== null && ` · ${usd(child.branch.spent)}`}
                    {child.branch.budget !== null && ` of ${usd(child.branch.budget)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {branch.result && (
            <details className="lane-result">
              <summary>What it found</summary>
              <Markdown text={branch.result} />
            </details>
          )}
          {live && <Manage branch={branch} onChanged={props.onChanged} others={props.all.filter((other) => other.parent === null && other.id !== branch.id && !ended(other))} swarm={props.swarm} />}
        </div>
      )}
    </section>
  )
}

function Manage(props: { branch: Branch; onChanged: () => void; others: readonly Branch[]; swarm: Detail }) {
  const wallet = useWallet()
  const roster = useRoster(props.swarm.id, props.swarm.steering)
  const me = wallet.session?.address
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const mine = props.branch.funders.find((funder) => funder.address === me)
  const movable = mine ? (props.branch.left !== null && units(props.branch.left) < units(mine.amount) ? props.branch.left : mine.amount) : '0'
  const [chosen, setTo] = useState<number | undefined>(props.others[0]?.id)
  const to = props.others.some((other) => other.id === chosen) ? chosen : props.others[0]?.id
  const [shift, setShift] = useState<string>('')
  const admin = !!me && !!roster?.admins.includes(me as `0x${string}`)
  const funded = props.branch.funders.reduce((sum, funder) => sum + units(funder.amount), 0n)
  const majority = !!mine && units(mine.amount) * 2n > funded
  const moving = !!mine && units(movable) > 0n && props.others.length > 0

  if (!wallet.session || (!moving && !majority && !admin && !done && !error)) return null

  const move = async () => {
    const amount = shift || movable
    if (busy || to === undefined || !valid(amount)) return
    setError(undefined)
    setDone(undefined)
    setBusy('Moving…')
    try {
      const moved = await Api.move(props.swarm.id, props.branch.id, { amount: decimal(units(amount)), to })
      setDone(`Moved ${usd(decimal(units(amount)))} to ${moved[1]?.who ?? 'the other branch'}.`)
      setShift('')
      props.onChanged()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const stop = async () => {
    if (busy || !confirm(`Stop ${props.branch.who}? Its subagent closes, and what it has not spent of its backers' money goes back to them.`)) return
    setError(undefined)
    setBusy('Stopping…')
    try {
      await Api.stop(props.swarm.id, props.branch.id)
      setDone(`Stopped ${props.branch.who}.`)
      props.onChanged()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="lane-manage">
      {moving && mine && (
        <div className="lane-move">
          <span>Move</span>
          <label className="say-own">$<input aria-label="Amount to move" disabled={!!busy} inputMode="decimal" onChange={(event) => setShift(event.target.value.replace(',', '.').replace('$', ''))} placeholder={String(Number(movable))} value={shift} /></label>
          <span>of your {usd(mine.amount)} to</span>
          <select aria-label="Branch to move it to" disabled={!!busy} onChange={(event) => setTo(Number(event.target.value))} value={to}>
            {props.others.map((other) => (
              <option key={other.id} value={other.id}>{other.who}</option>
            ))}
          </select>
          <button disabled={!!busy || to === undefined || !valid(shift || movable)} onClick={() => void move()} type="button">{busy === 'Moving…' ? busy : 'Move'}</button>
        </div>
      )}
      {(majority || admin) && (
        <button className="lane-stop" disabled={!!busy} onClick={() => void stop()} type="button">{busy === 'Stopping…' ? busy : 'Stop this branch'}</button>
      )}
      {done && <p className="lane-done">{done}</p>}
      {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
    </div>
  )
}
