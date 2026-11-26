import { useState } from 'react'
import type { Branch } from '../shared/Api.ts'
import * as Crew from '../shared/Crew.ts'
import type * as Tree from '../shared/Tree.ts'
import { Faces } from './Branches.tsx'
import { spent as outlay } from './format.ts'
import { Inline } from './Markdown.tsx'

const first = 6

const marks: Record<Crew.State, [Tree.Status, string]> = {
  done: ['proven', 'Done'],
  failed: ['dead end', 'Failed'],
  starved: ['proposed', 'Out of budget'],
  stopped: ['proposed', 'Stopped'],
  working: ['in flight', 'Working'],
}

function funders(branch: Branch | undefined): Tree.Funder[] {
  return (branch?.funders ?? []).map((funder) => ({ amount: funder.amount, since: 0, who: { address: funder.address, agent: null, handle: funder.handle } }))
}

export function Board(props: { branches: readonly Branch[] }) {
  const [limit, setLimit] = useState(first)
  const [open, setOpen] = useState<number>()
  const list = Crew.board(props.branches)
  if (!list.length) return null
  const byId = new Map(props.branches.map((branch) => [branch.id, branch] as const))
  const working = list.filter((member) => member.state === 'working').length
  const spent = list.reduce((sum, member) => sum + member.spent, 0)
  const shown = list.slice(0, limit)
  const hidden = list.slice(limit)
  return (
    <section aria-labelledby="crew-title" className="crew">
      <h2 id="crew-title">
        Who is on what
        <small>{working ? `${working} working · ` : ''}{list.length} part{list.length === 1 ? '' : 's'} · {outlay(String(spent))} spent</small>
      </h2>
      <ol className="crew-list">
        {shown.map((member) => {
          const [status, word] = marks[member.state]
          const branch = byId.get(member.id)
          const opened = open === member.id
          const more = member.told && member.told !== member.summary ? member.told : null
          const Bud = more || member.blockers ? 'button' : 'div'
          return (
            <li className="crew-row" data-open={opened || undefined} data-state={member.state} key={member.id}>
              <Bud {...(Bud === 'button' ? { 'aria-expanded': opened, onClick: () => setOpen(opened ? undefined : member.id), type: 'button' as const } : {})} className="crew-bud">
                <i aria-label={word} className="mark" data-checking={member.state === 'starved' || undefined} data-status={status} role="img" />
                <Inline className="crew-title" text={member.title} />
                <span className="crew-meta">
                  {member.metric && <b className="crew-metric">{member.metric}</b>}
                  <Faces funders={funders(branch)} riders={branch?.funders.length ?? 0} />
                  <span className="bud-money">{outlay(String(member.spent))}</span>
                </span>
                <Inline className="crew-line" text={opened && more ? more : (member.summary ?? word)} />
              </Bud>
              {opened && member.blockers && <p className="crew-open"><b>Blockers</b><Inline text={member.blockers} /></p>}
            </li>
          )
        })}
        {hidden.length > 0 && (
          <li className="crew-row crew-rest">
            <button onClick={() => setLimit(limit + first)} type="button">
              See {hidden.length} more<span>{outlay(String(hidden.reduce((sum, member) => sum + member.spent, 0)))}</span>
            </button>
          </li>
        )}
      </ol>
    </section>
  )
}
