import { useEffect, useRef, useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Artifact, Config, Detail, Member, Said } from '../shared/Api.ts'
import * as Status from '../shared/Status.ts'
import { Cover, Gauge, lead, line, Pill } from './Card.tsx'
import { Fuel, type Prefill } from './Contribute.tsx'
import { ago, short } from './format.ts'
import { useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'
import { Avatar } from './Room.tsx'
import { Link } from './router.tsx'

export type Work = 'about' | 'artifacts' | 'code' | 'contributors' | 'machines' | 'room' | 'transcript'

type Update = { at: number; key: string } & ({ kind: 'backed'; amount: string; note: string | null; who: string } | { kind: 'post'; text: string })

export function Campaign(props: {
  artifacts: readonly Artifact[]
  config: Config | undefined
  funding: boolean
  members: readonly Member[]
  messages: readonly Said[]
  note: string
  onArtifact: (slug: string) => void
  onBacked: () => void
  onNote: (note: string) => void
  onWork: (work: Work) => void
  prefill: Prefill
  swarm: Detail
  watching: number
}) {
  const swarm = props.swarm
  const stood = Status.standing(swarm)
  const now = useNow(60_000)
  const box = useRef<HTMLElement>(null)
  const [past, setPast] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('')
  const raised = Number(swarm.raised)
  const left = Number(swarm.remaining)
  const backers = props.members.filter((member) => Number(member.backed) > 0)
  const handle = (address: string) => props.members.find((member) => member.address === address)?.handle ?? short(address)

  useEffect(() => {
    try {
      setSaved(localStorage.getItem(`following:${swarm.id}`) !== null)
    } catch {}
  }, [swarm.id])

  useEffect(() => {
    const element = box.current
    if (!element) return
    const watcher = new IntersectionObserver(([entry]) => setPast(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0))
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [])

  useEffect(() => {
    if (!props.funding) return
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    box.current?.querySelector<HTMLInputElement>('#amount')?.focus({ preventScroll: true })
  }, [props.funding])

  const toggle = () => {
    try {
      if (saved) localStorage.removeItem(`following:${swarm.id}`)
      else localStorage.setItem(`following:${swarm.id}`, swarm.title)
      setSaved(!saved)
      setNotice(saved ? '' : 'Saved. Find it under Following.')
    } catch {
      setNotice('This browser could not save it. Bookmark the page instead.')
    }
  }
  const share = async () => {
    const url = `${location.origin}/s/${swarm.id}`
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: swarm.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setNotice('Link copied.')
      }
    } catch {}
  }
  const jump = () => {
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    box.current?.querySelector<HTMLInputElement>('#amount')?.focus({ preventScroll: true })
  }

  const updates: Update[] = [
    ...swarm.contributions.map((item, index): Update => ({ amount: item.amount, at: item.at, key: `c${index}-${item.hash}`, kind: 'backed', note: item.note, who: handle(item.contributor) })),
    ...props.messages.filter((item) => !item.author && !item.artifact && item.text.trim()).map((item): Update => ({ at: item.at, key: `m${item.id}`, kind: 'post', text: item.text })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 10)

  const behind: [Work, string, string][] = [
    ['transcript', 'Watch the AI work', 'Every step, live'],
    ['room', 'Chat with backers', props.watching > 0 ? `${props.watching} here now` : `${backers.length} backer${backers.length === 1 ? '' : 's'}`],
    ...(swarm.code ? [['code', 'Code', swarm.code.name] as [Work, string, string]] : []),
    ...(swarm.hands.length ? [['machines', 'Machines', `${swarm.hands.length} lent`] as [Work, string, string]] : []),
    ['about', 'Details', 'Models, wallet, data'],
  ]

  return (
    <div className="idea">
      <Link className="idea-back" to="/join">← All ideas</Link>
      <header className="idea-head">
        <Pill mood={stood.mood} word={stood.word} />
        <h1>{swarm.title}</h1>
        {lead(swarm.goal, swarm.title) && <p className="idea-pitch">{lead(swarm.goal, swarm.title)}</p>}
      </header>
      <div className="idea-grid">
        <aside className="box" id="back" ref={box}>
          <p className="box-raised"><b>{Answer.cash(raised)}</b> raised</p>
          <p className="box-people">
            {backers.length > 0 && <span className="box-faces">{backers.slice(0, 5).map((member) => <Avatar address={member.address} handle={member.handle} key={member.address} size="small" />)}</span>}
            {swarm.contributors > 0 ? `${swarm.contributors} backer${swarm.contributors === 1 ? '' : 's'}` : 'Be the first backer'}
          </p>
          {raised > 0 && (
            <p className="box-gauge">
              <Gauge left={left} raised={raised} />
              <span>{Answer.cash(left)} left to spend</span>
            </p>
          )}
          {stood.word !== 'Not started' && <p className="box-state">{line(stood.word)}</p>}
          <Fuel config={props.config} note={props.note} onDone={props.onBacked} onNote={props.onNote} prefill={props.prefill} target={() => Promise.resolve({ id: swarm.id, wallet: swarm.wallet })} />
          <div className="box-social">
            <button aria-pressed={saved} onClick={toggle} type="button">{saved ? 'Following ✓' : 'Follow'}</button>
            <button onClick={() => void share()} type="button">Share ↗</button>
          </div>
          {notice && <p className="box-notice" role="status">{notice}</p>}
        </aside>
        <div className="idea-main">
          <div className="idea-cover"><Cover id={swarm.id} mood={stood.mood} weight={raised} /></div>
          <section className="idea-section">
            <h2>Latest</h2>
            {swarm.answer ? (
              <>
                <p className="idea-latest">{Answer.gist(swarm.answer.text)}</p>
                <details className="idea-read">
                  <summary>Read the whole update</summary>
                  <Markdown text={swarm.answer.text} />
                </details>
              </>
            ) : (
              <p className="idea-quiet">Nothing yet. The first update shows up here once AI agents start.</p>
            )}
          </section>
          {props.artifacts.length > 0 && (
            <section className="idea-section">
              <h2>What it made</h2>
              <ul className="made">
                {props.artifacts.map((artifact) => (
                  <li key={artifact.slug}>
                    <button onClick={() => props.onArtifact(artifact.slug)} type="button">
                      <b>{artifact.title}</b>
                      {artifact.summary && <span>{artifact.summary}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="idea-section">
            <h2>Updates</h2>
            {updates.length ? (
              <ol className="news">
                {updates.map((update) => (
                  <li data-kind={update.kind} key={update.key}>
                    <span className="news-when">{ago(update.at, now)}</span>
                    {update.kind === 'backed' ? (
                      <p><b>{update.who}</b> backed it with {Answer.cash(Number(update.amount))}{update.note ? <span className="news-note"> “{update.note}”</span> : null}</p>
                    ) : (
                      <details>
                        <summary>{Answer.gist(update.text) || 'An update from the AI'}</summary>
                        <Markdown text={update.text} />
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="idea-quiet">No updates yet.</p>
            )}
          </section>
          <details className="idea-section idea-plan">
            <summary><h2>The plan</h2></summary>
            <p>{swarm.goal}</p>
          </details>
          <section className="idea-section">
            <h2>Behind the scenes</h2>
            <ul className="behind">
              {behind.map(([work, title, detail]) => (
                <li key={work}>
                  <button onClick={() => props.onWork(work)} type="button"><b>{title}</b><span>{detail}</span><i aria-hidden="true">→</i></button>
                </li>
              ))}
            </ul>
            <p className="idea-fine">Results are what the AI reports, not peer review. Backing pays for its work; it is not an investment.</p>
          </section>
        </div>
      </div>
      <div className="idea-bar" data-shown={past}>
        <span><b>{Answer.cash(raised)}</b> raised · {swarm.contributors} backer{swarm.contributors === 1 ? '' : 's'}</span>
        <button className="btn btn-high" onClick={jump} type="button">Back it</button>
      </div>
    </div>
  )
}
