import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { Config, Detail, Me, Member, Room as RoomState, Said } from '../shared/Api.ts'
import * as Status from '../shared/Status.ts'
import * as Api from './api.ts'
import { useSurface, useWishes, Viewer } from './Artifacts.tsx'
import { here, seeded } from './boot.ts'
import { Box } from './Box.tsx'
import { lead, Pill } from './Card.tsx'
import { Code } from './Code.tsx'
import { asked } from './Contribute.tsx'
import { useMedia, usePoll } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Results } from './Results.tsx'
import { Room } from './Room.tsx'
import { Back, back, href, Link, navigate, useCanBack, useQuery } from './router.tsx'
import * as Wire from './wire.ts'

const detailMs = 10_000

const shelfMs = 60_000

export type View = 'chat' | 'code' | 'results'

export function Swarm(props: { config: Config | undefined; id: string; view: View }) {
  const id = props.id
  const view = props.view
  const base = `/s/${encodeURIComponent(id)}`
  const wired = Wire.useWire(id, 'room', (signal) => {
    if (signal.type === 'pulse') setDetail((data) => Wire.pulsed(data, signal))
    if (signal.type === 'artifacts') setShelf(() => ({ artifacts: signal.artifacts.map((artifact) => (artifact.url.startsWith('/') ? { ...artifact, url: location.origin + artifact.url } : artifact)) }))
    if (Wire.stirred(signal, 'detail')) reload()
    if (Wire.stirred(signal, 'artifacts')) {
      reshelve()
      reprogress()
    }
    if (Wire.stirred(signal, 'branches')) rebranch()
  })
  const [detail, reload, setDetail] = usePoll(() => Api.swarm(id, false), wired === 'down' ? detailMs : null, id)
  const [shelf, reshelve, setShelf] = usePoll(() => Api.artifacts(id), wired === 'down' ? shelfMs : null, `artifacts:${id}`)
  const [news, renews] = usePoll(() => Api.updates(id), null, `updates:${id}`)
  const [progress, reprogress] = usePoll(() => Api.progress(id), null, `progress:${id}`)
  const [tree, rebranch] = usePoll(() => Api.branches(id), wired === 'down' && detail.data?.status === 'running' ? 30_000 : null, `branches:${id}`)
  const wishes = useWishes(shelf.data?.artifacts)
  const surface = useSurface(shelf.data?.artifacts)
  const opened = useQuery('r')
  const phone = useMedia('(max-width: 899px)')
  const small = useMedia('(max-width: 799px)')
  const backed = useCanBack()
  const [prefill] = useState(() => asked())
  const [note, setNote] = useState(prefill.note)
  const [open, setOpen] = useState(() => !!prefill.note || here().searchParams.has('fund'))
  const [focus, setFocus] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [coded, setCoded] = useState(view === 'code')
  const [members, setMembers] = useState<readonly Member[]>(() => seeded<RoomState>(`room:${id}`)?.members ?? [])
  const [unread, setUnread] = useState(0)
  const box = useRef<HTMLElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const [past, setPast] = useState(false)

  useEffect(() => {
    if (location.hash === '#room') navigate(`${base}/chat`, { replace: true })
    else if (location.hash) history.replaceState(history.state, '', location.pathname + location.search)
  }, [base])

  const answered = detail.data?.answer?.at
  useEffect(() => {
    if (!answered) return
    renews()
    rebranch()
    reprogress()
  }, [answered])

  useEffect(() => {
    if (detail.data) document.title = `${detail.data.title} · Swarms`
  }, [detail.data?.title])

  useEffect(() => {
    if (view === 'code') setCoded(true)
  }, [view])

  useEffect(() => {
    const element = box.current
    if (!element || view !== 'results') return
    const watcher = new IntersectionObserver(([entry]) => setPast(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0))
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [view, !!detail.data])

  const heard = useCallback((_said: readonly Said[], _me: Me | null, list: readonly Member[]) => setMembers(list), [])

  const steer = (text: string) => {
    if (text) setNote(text)
    setFocus(Date.now())
    if (view !== 'results') return setSheet(true)
    setOpen(true)
    requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  if (!detail.data)
    return detail.error ? (
      <Lost title={/no swarm/i.test(detail.error) ? 'This idea is gone.' : "Can't reach Swarms."}>
        {!/no swarm/i.test(detail.error) && <button className="lost-row" onClick={() => location.reload()} type="button">Try again <span aria-hidden="true">↻</span></button>}
        <Link className="lost-row" replace to="/ideas">Browse ideas <span aria-hidden="true">→</span></Link>
      </Lost>
    ) : (
      <section className="page lost" aria-busy="true"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    )

  const swarm: Detail = detail.data
  const stood = Status.standing(swarm)
  const artifacts = shelf.data?.artifacts ?? []
  const viewing = opened ? artifacts.find((artifact) => artifact.slug === opened) : undefined
  const pitch = lead(swarm.goal, swarm.title)
  const show = (next: View) => {
    if (next === view) return
    if (next === 'chat' && small) return navigate(`${base}/chat`)
    const top = mark.current ? mark.current.getBoundingClientRect().top + scrollY - (document.querySelector('.game-header')?.getBoundingClientRect().height ?? 0) : 0
    navigate(next === 'results' ? base : `${base}/${next}`, { keep: true, replace: true })
    if (scrollY > top) scrollTo(0, top)
  }

  const boxed = (inline: boolean) => (
    <Box
      config={props.config}
      focus={focus}
      members={members}
      note={note}
      onDone={() => reload()}
      onNote={setNote}
      onOpen={() => steer('')}
      open={!inline || open || !phone}
      prefill={prefill}
      {...(inline ? { ref: box } : {})}
      swarm={swarm}
      target={() => Promise.resolve({ id: swarm.id })}
    />
  )
  const room = (
    <Room
      config={props.config}
      onArtifact={(slug) => navigate(`${base}?r=${encodeURIComponent(slug)}`)}
      onBack={steer}
      onMessages={heard}
      onResults={() => show('results')}
      onUnread={setUnread}
      swarm={swarm}
      visible={view === 'chat'}
    />
  )
  const tab = (to: View, label: string, extra?: ReactNode) => (
    <a aria-current={view === to ? 'page' : undefined} className="idea-tab" href={href(to === 'results' ? base : `${base}/${to}`)} onClick={(event) => { event.preventDefault(); show(to) }}>{label}{extra}</a>
  )
  const tabs = (
    <nav aria-label="Idea" className="idea-tabs">
      {tab('results', 'Results')}
      {tab('chat', 'Chat', unread > 0 && view !== 'chat' && <i className="idea-unread">{unread}</i>)}
      {tab('code', 'Code')}
      <span className="idea-tabs-back" data-shown={view !== 'results'}>
        <span><b>{usdShort(swarm.raised)}</b> raised</span>
        <button className="btn btn-high" onClick={() => steer('')} type="button">Back it</button>
      </span>
    </nav>
  )
  const backing = sheet && (
    <div className="sheet" onClick={(event) => event.target === event.currentTarget && setSheet(false)}>
      <div className="sheet-card">
        <button aria-label="Close" className="sheet-close" onClick={() => setSheet(false)} type="button">×</button>
        {boxed(false)}
      </div>
    </div>
  )

  if (view === 'chat' && small)
    return (
      <article className="chat-page">
        <header className="chat-top">
          <Back className="chat-back" label="Back" to={base}>←</Back>
          <Back className="chat-title" to={base}><b>{swarm.title}</b><Pill mood={stood.mood} word={stood.word} /></Back>
          <button className="btn btn-high chat-back-it" onClick={() => steer('')} type="button">Back it</button>
        </header>
        <div className="chat-room">{room}</div>
        {backing}
      </article>
    )

  return (
    <article className="page idea-page" data-view={view}>
      <div className="idea">
        <Back className="idea-back" to="/ideas">{backed ? '← Back' : '← All ideas'}</Back>
        <header className="idea-head">
          <Pill mood={stood.mood} word={stood.word} />
          <h1>{swarm.title}</h1>
          {pitch && <p className="idea-pitch">{pitch}</p>}
        </header>
        <div className="idea-mark" ref={mark} />
        {tabs}
        <div className="idea-results" hidden={view !== 'results'}>
          {boxed(true)}
          <div className="idea-main">
            <Results artifacts={shelf.data?.artifacts} branches={tree.data?.branches} progress={progress.data ? progress.data.progress : undefined} members={members} onChat={() => show('chat')} onOpen={(slug) => navigate(`${base}?r=${encodeURIComponent(slug)}`, { keep: true })} onSteer={steer} surface={surface} swarm={swarm} updates={news.data?.updates} wishes={wishes} />
          </div>
        </div>
        <div className="idea-chat" hidden={view !== 'chat'}>{room}</div>
        {coded && <div className="idea-code" hidden={view !== 'code'}><Code repo={swarm.code} swarm={swarm.id} /></div>}
      </div>
      {view !== 'chat' && (
        <div className="idea-bar" data-shown={(view === 'code' || past) && phone}>
          <span><b>{usdShort(swarm.raised)}</b> raised</span>
          <button className="btn btn-high" onClick={() => steer('')} type="button">Back it</button>
        </div>
      )}
      {backing}
      {viewing && <Viewer artifact={viewing} onClose={() => back(base)} />}
    </article>
  )
}

function usdShort(value: string) {
  const number = Number(value)
  return '$' + (number >= 100 ? Math.round(number).toLocaleString('en-US') : number.toFixed(2))
}
