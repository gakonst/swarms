import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Artifact, Detail, Member, Update } from '../shared/Api.ts'
import type * as Wishlist from '../shared/Wishlist.ts'
import { ago, short, usd } from './format.ts'
import { useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

type Item = { at: number; key: string } & ({ kind: 'backed'; amount: string; note: string | null; who: string } | { kind: 'update'; text: string })

export function Results(props: {
  artifacts: readonly Artifact[]
  members: readonly Member[]
  onChat: () => void
  onOpen: (slug: string) => void
  onSteer: (note: string) => void
  swarm: Detail
  updates: readonly Update[] | undefined
  wishes: readonly Wishlist.Wish[]
}) {
  const swarm = props.swarm
  const now = useNow(60_000)
  const [more, setMore] = useState(false)
  const handle = (address: string) => props.members.find((member) => member.address === address)?.handle ?? short(address)
  const made = props.artifacts.filter((artifact) => artifact.slug !== 'wishlist')
  const asked = [...swarm.notes].sort((a, b) => Number(b.weight) - Number(a.weight)).slice(0, 4)
  const items: Item[] = [
    ...swarm.contributions.map((item, index): Item => ({ amount: item.amount, at: item.at, key: `c${index}`, kind: 'backed', note: item.note, who: handle(item.contributor) })),
    ...(props.updates ?? []).filter((update) => update.text.trim()).map((update, index): Item => ({ at: update.at, key: `u${index}`, kind: 'update', text: update.text })),
  ].sort((a, b) => b.at - a.at)
  const shown = more ? items : items.slice(0, 6)

  return (
    <div className="results">
      <section className="result-latest" aria-label="Latest">
        {swarm.answer ? (
          <>
            <span className="result-when">Latest · {ago(swarm.answer.at, now)}</span>
            <p className="result-gist">{Answer.gist(swarm.answer.text)}</p>
            <details className="result-read">
              <summary>Read more</summary>
              <Markdown text={swarm.answer.text} />
            </details>
          </>
        ) : (
          <p className="result-quiet">{swarm.status === 'running' ? 'AI is working on it. Results show up here.' : 'Results show up here once it starts.'}</p>
        )}
      </section>

      {made.length > 0 && (
        <section className="result-section">
          <h2>What it made</h2>
          <ul className="made">
            {made.map((artifact) => (
              <li key={artifact.slug}>
                <button onClick={() => props.onOpen(artifact.slug)} type="button">
                  <b>{artifact.title}</b>
                  {artifact.summary && <span>{artifact.summary}</span>}
                  {artifact.updatedAt && <small>Updated {ago(artifact.updatedAt, now)}</small>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.wishes.length > 0 && (
        <section className="result-section">
          <h2>It needs</h2>
          <ul className="needs">
            {props.wishes.slice(0, 3).map((wish, index) => <li key={index}>{wish.want}</li>)}
          </ul>
          <button className="result-link" onClick={props.onChat} type="button">Can you help? Say so in the chat →</button>
        </section>
      )}

      {asked.length > 0 && (
        <section className="result-section">
          <h2>Backers want</h2>
          <ul className="asked">
            {asked.map((note) => (
              <li key={note.id}>
                <span className="asked-text">“{note.note}”</span>
                <span className="asked-weight">{usd(note.weight)} · {note.backers} backer{note.backers === 1 ? '' : 's'}</span>
                <button onClick={() => props.onSteer(note.note)} type="button">+ Back this</button>
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
                  <p><b>{item.who}</b> backed it · {usd(item.amount)}{item.note ? <span className="news-note"> “{item.note}”</span> : null}</p>
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
    </div>
  )
}
