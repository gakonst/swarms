import type { Cover } from '../shared/Api.ts'
import * as Site from '../shared/Site.ts'
import type { Mood } from '../shared/Status.ts'
import { Art } from './Art.tsx'

export function Tile(props: { className: string; cover: Cover | null | undefined; id: string; mood: Mood }) {
  const cover = props.cover
  return (
    <span className={`tile ${props.className}`} data-cover={cover?.form}>
      {!cover ? (
        <Art id={props.id} mood={props.mood} wide />
      ) : cover.form === 'image' ? (
        <img alt="" loading="lazy" src={Site.at(cover.url)} />
      ) : (
        <iframe aria-hidden="true" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts" scrolling="no" src={Site.at(cover.url)} tabIndex={-1} title="" />
      )}
    </span>
  )
}
