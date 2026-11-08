import type { Me, Member, Way } from '../shared/Api.ts'
import * as Mention from '../shared/Mention.ts'
import { decimal, units } from '../shared/Memo.ts'
import { percent, usd } from './format.ts'
import { Avatar } from './Room.tsx'

const ways = { machine: 'lent a machine', transfer: 'backed the mission' } as const satisfies Record<Way, string>

function day(at: number) {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function Contributors(props: { me: Me | null; members: readonly Member[]; online: readonly string[] }) {
  const ranked = [...props.members].sort((a, b) => Number(units(b.backed) - units(a.backed)) || a.since - b.since)
  const total = ranked.reduce((sum, member) => sum + units(member.backed), 0n)
  const top = ranked[0] ? units(ranked[0].backed) : 0n
  const mine = props.me ? ranked.findIndex((member) => member.address === props.me?.address) : -1

  if (!ranked.length)
    return (
      <div className="artifact-empty">
        <h2>No contributors yet.</h2>
        <p>Be the first to help this mission move forward. Every contribution counts.</p>
      </div>
    )

  return (
    <section aria-label="Contributors" className="contributors">
      <header className="contributors-head">
        <p className="contributors-total"><b>{usd(decimal(total))}</b> put in by {ranked.length} {ranked.length === 1 ? 'person' : 'people'}</p>
        {mine >= 0 && <p className="contributors-you">You’re part of this mission</p>}
      </header>
      <ol className="contributors-list">
        {ranked.map((member, index) => {
          const given = units(member.backed)
          const share = total > 0n ? Number(given) / Number(total) : 0
          return (
            <li className="contributor" data-me={member.address === props.me?.address} data-podium={given > 0n && index < 3 ? index + 1 : undefined} key={member.address}>
              <span className="contributor-rank">{index + 1}</span>
              <Avatar address={member.address} handle={member.handle} size="small" />
              <span className="contributor-who">
                <span className="contributor-name">
                  {Mention.at(member.handle)}
                  {member.address === props.me?.address && <span className="tag">you</span>}
                  {props.online.includes(member.address) && <i className="roster-dot" title="Here now" />}
                </span>
                <span className="contributor-meta">
                  {[...member.ways.map((way) => ways[way]), units(member.steered) > 0n ? `${usd(member.steered)} behind ideas` : '', `since ${day(member.since)}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="contributor-amount">
                <b>{usd(member.backed)}</b>
                <span>{given > 0n ? percent(share) : '—'}</span>
              </span>
              <span aria-hidden="true" className="contributor-bar"><i style={{ width: `${top > 0n ? Math.max(given > 0n ? 2 : 0, (Number(given) / Number(top)) * 100) : 0}%` }} /></span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
