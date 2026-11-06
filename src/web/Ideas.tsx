import type { Me, Member, Note, Way } from '../shared/Api.ts'
import { percent, usd } from './format.ts'
import { Avatar } from './Room.tsx'

const ways = { machine: 'lent a machine', transfer: 'sent money' } as const satisfies Record<Way, string>

export function Presence(props: { members: readonly Member[]; online: readonly string[]; watching: number }) {
  const here = props.members.filter((member) => props.online.includes(member.address)).slice(0, 3)
  const watching = Math.max(props.watching, here.length)
  if (!props.members.length && !watching) return null
  return (
    <span className="presence" title={`${props.members.length} backer${props.members.length === 1 ? '' : 's'} · ${watching} watching`}>
      {here.length > 0 && <span className="presence-faces">{here.map((member) => <Avatar address={member.address} handle={member.handle} key={member.address} size="small" />)}</span>}
      <span className="presence-count"><i />{watching}</span>
    </span>
  )
}

export function Ideas(props: { done: boolean; me: Me | null; members: readonly Member[]; notes: readonly Note[]; onBack: (note: string) => void; online: readonly string[] }) {
  const ranked = [...props.members].sort((a, b) => Number(BigInt(Math.round(Number(b.backed) * 1e6)) - BigInt(Math.round(Number(a.backed) * 1e6))))
  return (
    <div className="ideas-board">
      {props.notes.length ? (
        <ol className="tiles-swarm">
          {props.notes.map((note, index) => (
            <li key={note.id}>
              <button className="tile-swarm idea-row" disabled={props.done} onClick={() => props.onBack(note.note)} type="button">
                <span className="idea-rank">{index + 1}</span>
                <span className="tile-title">{note.note}</span>
                <b className="idea-amount">{usd(note.weight)}{!props.done && <em>+</em>}</b>
                <span className="idea-share"><i style={{ width: `${Math.max(3, note.share * 100)}%` }} /></span>
                <span className="idea-meta">{note.backers} backer{note.backers === 1 ? '' : 's'} · {percent(note.share)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="machine-none">No ideas yet. Send one with @swarm.</p>
      )}
      {ranked.length > 0 && (
        <>
          <h3 className="ideas-head">{ranked.length} backer{ranked.length === 1 ? '' : 's'}</h3>
          <ol className="tiles-swarm">
            {ranked.map((member) => (
              <li key={member.address}>
                <div className="tile-swarm backer-row">
                  <Avatar address={member.address} handle={member.handle} size="small" />
                  <span className="tile-title">@{member.handle}{member.address === props.me?.address && <span className="tag">you</span>}{props.online.includes(member.address) && <i className="roster-dot" title="Here now" />}</span>
                  <b className="idea-amount">{usd(member.backed)}</b>
                  <span className="idea-meta">{member.ways.map((way) => ways[way]).join(', ')}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
