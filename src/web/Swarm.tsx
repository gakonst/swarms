import { useCallback, useEffect, useState } from 'react'
import type { Config, Detail, Me, Member, Room as RoomState, Said, Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Site from '../shared/Site.ts'
import * as Crew from '../shared/Crew.ts'
import * as Status from '../shared/Status.ts'
import * as Api from './api.ts'
import { useSurface, useWishes, Viewer } from './Artifacts.tsx'
import { here, seeded } from './boot.ts'
import { Box } from './Box.tsx'
import { BranchChannel, tagged } from './Channel.tsx'
import { shareBranches } from './channels.ts'
import * as Prose from '../shared/Prose.ts'
import { line, pill } from './Card.tsx'
import { Code } from './Code.tsx'
import { asked } from './Contribute.tsx'
import { Divider } from './Divider.tsx'
import { useMedia, useNow, usePoll, useWallet } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Overlay } from './Overlay.tsx'
import { Host } from './OwnAi.tsx'
import * as Names from './names.ts'
import { Now } from './Now.tsx'
import { Results } from './Results.tsx'
import { Room } from './Room.tsx'
import * as Pay from './pay.ts'
import { useShown } from './Share.tsx'
import { Reins, steerer, useRoster } from './Steering.tsx'
import { at, backers, dollars, Explainer, Strip, type Tab, Tabs } from './Strip.tsx'
import { back, Link, navigate, useBase, useQuery } from './router.tsx'
import { stamp } from './format.ts'
import * as Wire from './wire.ts'

const detailMs = 10_000

const shelfMs = 60_000

export function Swarm(props: { channel?: string | undefined; config: Config | undefined; id: string; view: Tab }) {
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
    if (signal.type === 'said' && props.channel) rechat()
  })
  const [detail, reload, setDetail] = usePoll(() => Api.swarm(id, false), wired === 'down' ? detailMs : null, id)
  const [shelf, reshelve, setShelf] = usePoll(() => Api.artifacts(id), wired === 'down' ? shelfMs : null, `artifacts:${id}`)
  const [news, renews] = usePoll(() => Api.updates(id), null, `updates:${id}`)
  const [progress, reprogress] = usePoll(() => Api.progress(id), null, `progress:${id}`)
  const [tree, rebranch] = usePoll(() => Api.branches(id), wired === 'down' && detail.data?.status === 'running' ? 30_000 : null, `branches:${id}`)
  const [chat, rechat] = usePoll(() => Api.room(id), null, `room:${id}`)
  const now = useNow(30_000)
  const phone = useMedia('(max-width: 899px)')
  const wishes = useWishes(shelf.data?.artifacts)
  const surface = useSurface(shelf.data?.artifacts, id)
  const opened = useQuery('r')
  const [prefill] = useState(() => asked())
  const [note, setNote] = useState(prefill.note)
  const [focus, setFocus] = useState(0)
  const [riding, setRiding] = useState<{ anchor?: HTMLElement | undefined } | undefined>(() => (prefill.note || here().searchParams.has('fund') ? {} : undefined))
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set([view]))
  const [stir, setStir] = useState(0)
  const [members, setMembers] = useState<readonly Member[]>(() => seeded<RoomState>(`room:${id}`)?.members ?? [])
  const [unread, setUnread] = useState(0)
  const wallet = useWallet()
  const roster = useRoster(id, detail.data?.steering ?? 'open')
  const steers = steerer(roster?.steering ?? detail.data?.steering ?? 'open', roster, wallet.session?.address ?? wallet.address)

  useEffect(() => {
    if (location.hash === '#room') navigate(base, { replace: true })
    else if (location.hash) history.replaceState(history.state, '', location.pathname + location.search)
  }, [base])

  useEffect(() => {
    if (tree.data) shareBranches(id, tree.data.branches)
  }, [tree.data, id])

  const answered = detail.data?.answer?.at
  useEffect(() => {
    if (!answered) return
    renews()
    rebranch()
    reprogress()
  }, [answered])

  useEffect(() => {
    if (detail.data) document.title = `${Prose.plain(detail.data.title)} · Swarms`
  }, [detail.data?.title])

  useEffect(() => {
    setSeen((current) => (current.has(view) ? current : new Set([...current, view])))
  }, [view])

  const heard = useCallback((_said: readonly Said[], _me: Me | null, list: readonly Member[]) => setMembers(list), [])

  useShown(detail.data)
  Pay.useKept(id, () => setRiding((current) => current ?? {}))

  const steer = (text: string, anchor?: HTMLElement) => {
    if (detail.data?.archivedAt) return
    if (text && steers) setNote(text)
    setFocus(Date.now())
    setRiding({ anchor })
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
  const branch = props.channel ? tree.data?.branches.find((each) => String(each.id) === props.channel) : undefined


  return (
    <article className="swarm-shell" data-room={branch ? '' : undefined} data-tab={view}>
      {!branch && <Strip backers={backers(swarm.contributions, names)} onRide={archived ? undefined : (anchor) => steer('', anchor)} raised={swarm.balance} riders={swarm.contributors} title={swarm.title} topic={swarm.goal}>
        <span><b>{dollars(swarm.spent)}</b> spent</span>
        <span><b>{dollars(swarm.remaining)}</b> left</span>
        <span className="strip-mood" data-mood={stood.mood} title={line(stood.word)}><i />{pill(stood.word)}</span>
        {swarm.ai && <span className="strip-ai">on ${swarm.ai.handle}'s own AI</span>}
      </Strip>}
      {!branch && <Tabs base={base} board="Board" onShow={show} unread={unread} view={view} />}
      {branch && (
        <BranchChannel
          base={base}
          branch={branch}
          branches={tree.data?.branches ?? []}
          config={props.config}
          names={names}
          now={now}
          onPost={async (text) => {
            await Api.say(id, { text: tagged(Crew.title(branch)) + text })
            rechat()
          }}
          onRide={archived ? undefined : (anchor) => steer('', anchor)}
          said={chat.data?.messages ?? []}
          swarmTitle={swarm.title}
        />
      )}
      <div className="panel panel-chat" hidden={!!branch}>
        <Room
          config={props.config}
          onArtifact={(slug) => navigate(`${base}/results?r=${encodeURIComponent(slug)}`)}
          onBack={steer}
          onMessages={heard}
          onResults={() => show('results')}
          onUnread={setUnread}
          swarm={swarm}
          visible={!branch && (view === 'chat' || view === 'board' || !phone)}
        />
      </div>
      <div className="panel panel-page panel-board" hidden={(view !== 'board' && view !== 'chat') || !!branch}>
        <Now artifacts={shelf.data?.artifacts} branches={tree.data?.branches} onChat={() => show('chat')} onSteer={steer} stir={stir} surface={surface} swarm={swarm} updates={news.data?.updates} visible={view === 'board' || view === 'chat'} />
      </div>
      <Divider hidden={(view !== 'board' && view !== 'chat') || !!branch} />
      {seen.has('results') && (
        <div className="panel panel-page" hidden={view !== 'results' || !!branch}>
          <Results artifacts={shelf.data?.artifacts} branches={tree.data?.branches} progress={progress.data ? progress.data.progress : undefined} members={members} onChat={() => show('chat')} onOpen={(slug) => navigate(`${base}/results?r=${encodeURIComponent(slug)}`, { keep: true })} onSteer={steers ? steer : undefined} swarm={swarm} updates={news.data?.updates} wishes={wishes} />
        </div>
      )}
      {seen.has('code') && <div className="panel panel-page" hidden={view !== 'code' || !!branch}><Code repo={swarm.code} swarm={swarm.id} /></div>}
      {seen.has('about') && (
        <div className="panel panel-page" hidden={view !== 'about' || !!branch}>
          <Explainer swarm={swarm} />
          {archived ? <Archived swarm={swarm} /> : <Reins onNamed={named} swarm={swarm} />}
        </div>
      )}
      {riding && !archived && (
        <Overlay anchor={riding.anchor} className="ride ride-box" label="Ride it" onClose={() => setRiding(undefined)}>
          <Box
            config={props.config}
            focus={focus}
            members={members}
            note={steers ? note : ''}
            onDone={() => {
              setRiding(undefined)
              reload()
            }}
            onNote={setNote}
            onOpen={() => steer('')}
            open
            prefill={prefill}
            shared={false}
            steers={steers}
            swarm={swarm}
            target={() => Promise.resolve({ id: swarm.id })}
          />
          <Host onChange={reload} swarm={swarm} />
        </Overlay>
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
