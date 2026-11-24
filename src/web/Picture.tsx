import type { Summary } from '../shared/Api.ts'
import * as Site from '../shared/Site.ts'
import type * as Tree from '../shared/Tree.ts'
import { Spiral } from './Field.tsx'
import { sown } from './Home.tsx'

export function Badge(props: { head: Tree.Headline | undefined; live: boolean; swarm: Summary }) {
  const picture = props.swarm.picture
  if (picture && 'emoji' in picture) return <span aria-hidden="true" className="badge" data-color={picture.color}>{picture.emoji}</span>
  if (picture) return <img alt="" className="badge badge-image" decoding="async" draggable={false} src={Site.at(picture.url)} />
  return <Spiral cells={sown(props.swarm, props.head)} id={props.swarm.id} live={props.live} />
}
