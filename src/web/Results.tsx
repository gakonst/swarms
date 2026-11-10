import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Artifact, Branch, Detail, Member, Update } from '../shared/Api.ts'
import type { Progress } from '../shared/Progress.ts'
import type * as Wishlist from '../shared/Wishlist.ts'
import { Explored } from './Explored.tsx'
import { ago, short, usd } from './format.ts'
import { useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

type Item = { at: number; key: string } & ({ kind: 'backed'; amount: string; note: string | null; who: string } | { kind: 'update'; text: string })

function source(artifact: Artifact) {
  return /^https?:/.test(artifact.url) ? `${artifact.url}?v=${artifact.version}` : artifact.url
}

const marks = { image: '◩', json: '{ }', markdown: '¶', page: '▦', table: '▤', text: '≡' } as const

function Preview(props: { artifact: Artifact }) {
  const artifact = props.artifact
  if (artifact.form === 'page')
    return (
      <span className="made-preview" data-form="page">
        <iframe aria-hidden="true" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts" scrolling="no" src={source(artifact)} tabIndex={-1} title="" />
      </span>
    )
  if (artifact.form === 'image') return <span className="made-preview" data-form="image"><img alt="" loading="lazy" src={source(artifact)} /></span>
  return <span className="made-preview" data-form={artifact.form}><i aria-hidden="true">{marks[artifact.form]}</i></span>
}

export function Results(props: {
  artifacts: readonly Artifact[] | undefined
  branches: readonly Branch[] | undefined
  progress: Progress | null | undefined
  members: readonly Member[]
  onChat: () => void
  onOpen: (slug: string) => void
  onSteer: ((note: string) => void) | undefined
  swarm: Detail
  updates: readonly Update[] | undefined
  wishes: readonly Wishlist.Wish[]
}) {
  const swarm = props.swarm
  const now = useNow(60_000)
  const [more, setMore] = useState(false)
  const handle = (address: string) => props.members.find((member) => member.address === address)?.handle ?? short(address)
  const made = (props.artifacts ?? []).filter((artifact) => artifact.slug !== 'wishlist' && artifact.slug !== 'surface')
  const pictured = made.filter((artifact) => artifact.form === 'page' || artifact.form === 'image')
  const written = made.filter((artifact) => artifact.form !== 'page' && artifact.form !== 'image')
  const asked = [...swarm.notes].sort((a, b) => Number(b.weight) - Number(a.weight)).slice(0, 4)
  const items: Item[] = [
    ...swarm.contributions.map((item, index): Item => ({ amount: item.amount, at: item.at, key: `c${index}`, kind: 'backed', note: item.note, who: handle(item.contributor) })),
    ...(props.updates ?? []).filter((update) => update.text.trim()).map((update, index): Item => ({ at: update.at, key: `u${index}`, kind: 'update', text: update.text })),
  ].sort((a, b) => b.at - a.at)
  const shown = more ? items : items.slice(0, 5)

  return (
    <div className="results">
      <section className="result-section" aria-labelledby="made-title">
        <h2 className="sr-only" id="made-title">Results</h2>
        {pictured.length > 0 && (
          <ul className="made">
            {pictured.map((artifact) => (
              <li key={artifact.slug}>
                <button onClick={() => props.onOpen(artifact.slug)} type="button">
                  <Preview artifact={artifact} />
                  <span className="made-text">
                    <b>{artifact.title}</b>
                    {artifact.summary && <span>{artifact.summary}</span>}
                    {artifact.updatedAt && <small>Updated {ago(artifact.updatedAt, now)}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {written.length > 0 && (
          <ul className="made-rows">
            {written.map((artifact) => (
              <li key={artifact.slug}>
                <button onClick={() => props.onOpen(artifact.slug)} type="button">
                  <i aria-hidden="true">{marks[artifact.form]}</i>
                  <span>
                    <b>{artifact.title}</b>
                    {artifact.summary && <span>{artifact.summary}</span>}
                  </span>
                  {artifact.updatedAt && <small>{ago(artifact.updatedAt, now)}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!made.length && <p className="result-quiet">{props.artifacts ? 'Results show up here as the AI makes them.' : ' '}</p>}
      </section>

      <section className="result-section" aria-labelledby="explored-title">
        <h2 id="explored-title">How it got here</h2>
        <Explored branches={props.branches} progress={props.progress} running={swarm.status === 'running'} />
      </section>

      {asked.length > 0 && (
        <section className="result-section">
          <h2>Riders want</h2>
          <ul className="asked">
            {asked.map((note) => (
              <li key={note.id}>
                <span className="asked-text">“{note.note}”</span>
                <span className="asked-weight">{usd(note.weight)} · {note.backers} rider{note.backers === 1 ? '' : 's'}</span>
                {props.onSteer && <button onClick={() => props.onSteer?.(note.note)} type="button">+ Steer this</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="result-section">
        <h2>Updates</h2>
        {items.length ? (
          <ol className="news">
            {shown.map((item) => (
              <li data-kind={item.kind} key={item.key}>
                <span className="news-when">{ago(item.at, now)}</span>
                {item.kind === 'backed' ? (
                  <p><b>{item.who}</b> rode in · {usd(item.amount)}{item.note ? <span className="news-note"> “{item.note}”</span> : null}</p>
                ) : (
                  <details>
                    <summary>{Answer.gist(item.text) || 'An update'}</summary>
                    <Markdown text={item.text} />
                  </details>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="result-quiet">No updates yet.</p>
        )}
        {items.length > shown.length && <button className="result-link" onClick={() => setMore(true)} type="button">Show all {items.length}</button>}
      </section>

      {props.wishes.length > 0 && (
        <section className="result-section">
          <h2>It needs</h2>
          <ul className="needs">
            {props.wishes.slice(0, 3).map((wish, index) => <li key={index}>{wish.want}</li>)}
          </ul>
          <button className="result-link" onClick={props.onChat} type="button">Can you help? Say so in the chat →</button>
        </section>
      )}
    </div>
  )
}
