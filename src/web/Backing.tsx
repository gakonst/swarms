import { type ReactNode, useState } from 'react'
import type { Budget, Config, Contribution, Pledge } from '../shared/Api.ts'
import { ago, clock, mach, money, short } from './format.ts'
import { useNow, useWallet } from './hooks.ts'

const pledged = { active: 'Active', ended: 'Ended', spent: 'Spent' } as const satisfies Record<Pledge['status'], string>

const allowed = { active: 'Active', ended: 'Ended', expired: 'Expired', revoked: 'Revoked', waiting: 'Waiting' } as const satisfies Record<Budget['status'], string>

function Who(props: { address: string | null; at: number; config: Config | undefined }) {
  const wallet = useWallet()
  const now = useNow(30_000)
  return (
    <p className="pledge-head">
      {props.address && props.config ? (
        <a href={`${props.config.explorer}/address/${props.address}`} rel="noreferrer" target="_blank">
          {short(props.address)}
        </a>
      ) : (
        <span>{props.address ? short(props.address) : 'Pending'}</span>
      )}
      {props.address && wallet.address?.toLowerCase() === props.address.toLowerCase() && <span className="tag tag-on">You</span>}
      <span className="pledge-ago">{ago(props.at, now)}</span>
    </p>
  )
}

function More<item>(props: { items: readonly item[]; render: (item: item) => ReactNode }) {
  const [all, setAll] = useState(false)
  const shown = all ? props.items : props.items.slice(0, 6)
  return (
    <>
      <ol className="pledges">{shown.map(props.render)}</ol>
      {props.items.length > shown.length && (
        <button className="btn btn-minimal" onClick={() => setAll(true)} type="button">
          Show all {props.items.length}
        </button>
      )}
    </>
  )
}

export function Budgets(props: { budgets: readonly Budget[]; config: Config | undefined }) {
  const now = useNow(30_000)
  if (props.budgets.length === 0) return <p className="empty">No monthly budgets yet. A budget lets the swarm pull a set amount every 30 days from your wallet, the first at once, only to its own address.</p>
  const ordered = [...props.budgets].sort((a, b) => b.at - a.at)
  return (
    <More
      items={ordered}
      render={(budget) => (
        <li className="pledge-row" data-status={budget.status === 'active' || budget.status === 'waiting' ? 'active' : 'ended'} key={budget.id}>
          <Who address={budget.contributor} at={budget.at} config={props.config} />
          <p className="pledge-figures">
            <span>
              {money(budget.amount, budget.token)} {budget.period === 2_592_000 ? 'a month' : budget.period === 86_400 ? 'a day' : `per ${Math.round(budget.period / 3600)} h`}
            </span>
            <span>{mach(budget.pulled)} pulled</span>
            {budget.left !== null && (budget.status === 'active' || budget.status === 'waiting') && <span>{mach(budget.left)} left {budget.period === 2_592_000 ? 'this month' : budget.period === 86_400 ? 'today' : 'this period'}</span>}
            <span className={budget.status === 'active' ? 'tag tag-on' : 'tag'}>{allowed[budget.status]}</span>
          </p>
          {(budget.detail || (budget.nextAt !== null && budget.nextAt > now)) && (
            <p className="pledge-detail">
              {budget.detail}
              {budget.nextAt !== null && budget.nextAt > now && ` Next pull ${clock(budget.nextAt)}.`}
            </p>
          )}
          {budget.note && <p className="pledge-note">{budget.note}</p>}
        </li>
      )}
    />
  )
}

export function Contributions(props: { config: Config | undefined; contributions: readonly Contribution[] }) {
  if (props.contributions.length === 0) return <p className="empty">No transfers yet. Send USDC.e, pathUSD or OUSD to the swarm's wallet, or set a monthly budget.</p>
  const ordered = [...props.contributions].sort((a, b) => b.at - a.at)
  return (
    <More
      items={ordered}
      render={(contribution) => (
        <li className="pledge-row" data-status="active" key={contribution.hash}>
          <Who address={contribution.contributor} at={contribution.at} config={props.config} />
          <p className="pledge-figures">
            <span>{money(contribution.amount, contribution.token)}</span>
            <span className="tag">{contribution.kind === 'pull' ? 'Pulled from a budget' : contribution.kind === 'pledge' ? 'Pulled from a pledge' : 'Sent once'}</span>
            {props.config && (
              <a href={`${props.config.explorer}/tx/${contribution.hash}`} rel="noreferrer" target="_blank">
                Transfer ↗
              </a>
            )}
          </p>
          {contribution.note && <p className="pledge-note">{contribution.note}</p>}
        </li>
      )}
    />
  )
}

export function Pledges(props: { config: Config | undefined; pledges: readonly Pledge[] }) {
  if (props.pledges.length === 0) return <p className="empty">No pledges yet.</p>
  const ordered = [...props.pledges].sort((a, b) => b.at - a.at)
  return (
    <More
      items={ordered}
      render={(pledge) => (
        <li className="pledge-row" data-status={pledge.status} key={pledge.id}>
          <Who address={pledge.contributor} at={pledge.at} config={props.config} />
          <p className="pledge-figures">
            <span>{money(pledge.amount, pledge.token)}</span>
            <span>{mach(pledge.spent)} spent</span>
            <span className="tag">{pledged[pledge.status]}</span>
          </p>
          {pledge.note && <p className="pledge-note">{pledge.note}</p>}
        </li>
      )}
    />
  )
}
