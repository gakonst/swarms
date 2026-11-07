import type { Member } from '../shared/Api.ts'
import { Avatar } from './Room.tsx'

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
