import { useCallback, useEffect, useRef, useState } from 'react'
import type { Config, Detail, Me, Member, Room as RoomState, Said, Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Site from '../shared/Site.ts'
import * as Status from '../shared/Status.ts'
import * as Api from './api.ts'
import { useSurface, useWishes, Viewer } from './Artifacts.tsx'
import { here, seeded } from './boot.ts'
import { Box } from './Box.tsx'
import { lead, pill } from './Card.tsx'
import { Code } from './Code.tsx'
import { asked } from './Contribute.tsx'
import { useMedia, usePoll, useWallet } from './hooks.ts'
import { Lost } from './Lost.tsx'
import * as Names from './names.ts'
import { Now } from './Now.tsx'
import { Results } from './Results.tsx'
import { Room } from './Room.tsx'
import { Reins, steerer, useRoster } from './Steering.tsx'
import { at, backers, dollars, Explainer, Strip, type Tab, Tabs } from './Strip.tsx'
import { back, Link, navigate, useBase, useQuery } from './router.tsx'
import { stamp } from './format.ts'
import * as Wire from './wire.ts'

const detailMs = 10_000

const shelfMs = 60_000

export function Swarm(props: { config: Config | undefined; id: string; view: Tab }) {
  const id = props.id
  const view = props.view
  const base = useBase(id)
  const wired = Wire.useWire(id, 'room', (signal) => {
    if (signal.type === 'pulse') setDetail((data) => Wire.pulsed(data, signal))
    if (signal.type === 'artifacts') setShelf(() => ({ artifacts: signal.artifacts.map((artifact) => (artifact.url.startsWith('/') ? { ...artifact, url: location.origin + Site.at(artifact.url) } : artifact)) }))
    if (Wire.stirred(signal, 'detail')) reload()
    if (Wire.stirred(signal, 'artifacts')) {
      reshelve()
      reprogress()
    }
    if (Wire.stirred(signal, 'branches')) rebranch()
    if (Wire.stirred(signal, 'feed')) setStir((count) => count + 1)
  })
  const [detail, reload, setDetail] = usePoll(() => Api.swarm(id, false), wired === 'down' ? detailMs : null, id)
  const [shelf, reshelve, setShelf] = usePoll(() => Api.artifacts(id), wired === 'down' ? shelfMs : null, `artifacts:${id}`)
  const [news, renews] = usePoll(() => Api.updates(id), null, `updates:${id}`)
  const [progress, reprogress] = usePoll(() => Api.progress(id), null, `progress:${id}`)
  const [tree, rebranch] = usePoll(() => Api.branches(id), wired === 'down' && detail.data?.status === 'running' ? 30_000 : null, `branches:${id}`)
  const wishes = useWishes(shelf.data?.artifacts)
  const surface = useSurface(shelf.data?.artifacts, id)
  const opened = useQuery('r')
  const phone = useMedia('(max-width: 899px)')
  const [prefill] = useState(() => asked())
  const [note, setNote] = useState(prefill.note)
  const [open, setOpen] = useState(() => !!prefill.note || here().searchParams.has('fund'))
  const [focus, setFocus] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set([view]))
  const [stir, setStir] = useState(0)
  const [members, setMembers] = useState<readonly Member[]>(() => seeded<RoomState>(`room:${id}`)?.members ?? [])
  const [unread, setUnread] = useState(0)
  const box = useRef<HTMLElement>(null)
  const wallet = useWallet()
  const roster = useRoster(id, detail.data?.steering ?? 'open')
  const steers = steerer(roster?.steering ?? detail.data?.steering ?? 'open', roster, wallet.session?.address ?? wallet.address)

  useEffect(() => {
    if (location.hash === '#room') navigate(base, { replace: true })
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
    setSeen((current) => (current.has(view) ? current : new Set([...current, view])))
  }, [view])

  const heard = useCallback((_said: readonly Said[], _me: Me | null, list: readonly Member[]) => setMembers(list), [])

  const steer = (text: string) => {
    if (detail.data?.archivedAt) return
    if (text && steers) setNote(text)
    setFocus(Date.now())
    if (view !== 'board' || phone) return setSheet(true)
    setOpen(true)
    requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  if (!detail.data)
    return detail.error ? (
      <Lost title={/no swarm/i.test(detail.error) ? 'This swarm is gone.' : "Can't reach Swarms."}>
        {!/no swarm/i.test(detail.error) && <button className="lost-row" onClick={() => location.reload()} type="button">Try again <span aria-hidden="true">↻</span></button>}
        <Link className="lost-row" replace to="/ideas">All swarms <span aria-hidden="true">→</span></Link>
      </Lost>
    ) : (
      <section className="page lost" aria-busy="true"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    )

  const swarm: Detail = detail.data
  const archived = !!swarm.archivedAt
  const stood = Status.standing(swarm)
  const artifacts = shelf.data?.artifacts ?? []
  const viewing = opened ? artifacts.find((artifact) => artifact.slug === opened) : undefined
  const told = news.data?.updates.filter((update) => update.text.trim()).at(-1)?.text ?? swarm.answer?.text
  const latest = (told ? lead(told, swarm.title) : undefined) ?? lead(swarm.goal, swarm.title)
  const names = new Map(members.map((member) => [member.address.toLowerCase(), member.handle] as const))
  const named = (renamed: Summary) => {
    setDetail((data) => data && { ...data, nickname: renamed.nickname })
    if (swarm.nickname) Names.keep(swarm.nickname, { name: swarm.nickname, nickname: renamed.nickname, swarm: id })
    if (renamed.nickname) Names.keep(renamed.nickname, { name: renamed.nickname, nickname: renamed.nickname, swarm: id })
    navigate(`${Nickname.path(renamed)}${view === 'chat' ? '' : `/${view}`}${location.search}`, { keep: true, replace: true })
  }
  const show = (next: Tab) => {
    if (next !== view) navigate(at(base, next), { keep: true, replace: true })
  }

  const boxed = (inline: boolean) => (
    <Box
      config={props.config}
      focus={focus}
      members={members}
      note={steers ? note : ''}
      onDone={() => reload()}
      onNote={setNote}
      onOpen={() => steer('')}
      open={!inline || open || !phone}
      prefill={prefill}
      {...(inline ? { ref: box } : {})}
      steers={steers}
      swarm={swarm}
      target={() => Promise.resolve({ id: swarm.id })}
    />
  )

  return (
    <article className="swarm-shell" data-tab={view}>
      <Strip backers={backers(swarm.contributions, names)} latest={latest} onRide={archived ? undefined : () => steer('')} raised={swarm.balance} riders={swarm.contributors} title={swarm.title}>
        <span className="strip-mood" data-mood={archived ? 'new' : stood.mood}><i />{archived ? 'Archived' : pill(stood.word)}</span>
        <span><b>{dollars(swarm.spent)}</b> spent</span>
      </Strip>
      <Tabs base={base} onShow={show} unread={unread} view={view} />
      <div className="panel panel-chat" hidden={view !== 'chat'}>
        <Room
          config={props.config}
          onArtifact={(slug) => navigate(`${base}/results?r=${encodeURIComponent(slug)}`)}
          onBack={steer}
          onMessages={heard}
          onResults={() => show('results')}
          onUnread={setUnread}
          swarm={swarm}
          visible={view === 'chat'}
        />
      </div>
      <div className="panel panel-page idea-now" hidden={view !== 'board'}>
        {!archived && boxed(true)}
        <div className="idea-main">
          <Now artifacts={shelf.data?.artifacts} branches={tree.data?.branches} onChat={() => show('chat')} onSteer={steer} stir={stir} surface={surface} swarm={swarm} updates={news.data?.updates} visible={view === 'board'} />
        </div>
      </div>
      {seen.has('results') && (
        <div className="panel panel-page" hidden={view !== 'results'}>
          <Results artifacts={shelf.data?.artifacts} branches={tree.data?.branches} progress={progress.data ? progress.data.progress : undefined} members={members} onChat={() => show('chat')} onOpen={(slug) => navigate(`${base}/results?r=${encodeURIComponent(slug)}`, { keep: true })} onSteer={steers ? steer : undefined} swarm={swarm} updates={news.data?.updates} wishes={wishes} />
        </div>
      )}
      {seen.has('code') && <div className="panel panel-page" hidden={view !== 'code'}><Code repo={swarm.code} swarm={swarm.id} /></div>}
      {seen.has('about') && (
        <div className="panel panel-page" hidden={view !== 'about'}>
          <Explainer swarm={swarm} />
          {archived ? <Archived swarm={swarm} /> : <Reins onNamed={named} swarm={swarm} />}
        </div>
      )}
      {sheet && (
        <div className="sheet" onClick={(event) => event.target === event.currentTarget && setSheet(false)}>
          <div className="sheet-card">
            <button aria-label="Close" className="sheet-close" onClick={() => setSheet(false)} type="button">×</button>
            {boxed(false)}
          </div>
        </div>
      )}
      {viewing && <Viewer artifact={viewing} onClose={() => back(at(base, view))} />}
    </article>
  )
}

function Archived(props: { swarm: Detail }) {
  const swarm = props.swarm
  return (
    <div className="archived" role="note">
      <b>Archived{swarm.archivedAt ? ` ${stamp(swarm.archivedAt)}` : ''}.</b> Read-only: nothing here runs or takes rides.{' '}
      {Number(swarm.remaining) >= 0.005 ? <>{dollars(swarm.remaining)} is left of the {dollars(swarm.balance)} {swarm.contributors} rider{swarm.contributors === 1 ? '' : 's'} put in. It stays in the swarm's gateway credit, still theirs; archiving never spends it.</> : <>Nothing was left of the {dollars(swarm.balance)} riders put in.</>}
    </div>
  )
}
