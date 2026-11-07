import { type KeyboardEvent as Press, lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Config, Detail, Entry, Me, Member, Room as RoomState, Said } from '../shared/Api.ts'
import { merge } from '../shared/Trail.ts'
import * as Api from './api.ts'
import { here, seeded } from './boot.ts'
import { Artifacts } from './Artifacts.tsx'
import { Side } from './Side.tsx'
import { Connect } from './Connect.tsx'
import { Contributors } from './Contributors.tsx'
import { asked, Fund } from './Contribute.tsx'
import { short } from './format.ts'
import { remembered, useLive, useMedia, usePoll, useStable, useVisible } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Presence } from './Ideas.tsx'
import { Machines } from './Machines.tsx'
import { Facts } from './Models.tsx'
import { Room } from './Room.tsx'
import { Link } from './router.tsx'
import { Transcript } from './Transcript.tsx'
import { Dot, Energy } from './Visual.tsx'
import * as Wire from './wire.ts'

let loaded: typeof import('./Code.tsx') | undefined

function load() {
  return import('./Code.tsx').then((module) => (loaded = module))
}

const Code = lazy(() => load().then((module) => ({ default: module.Code })))

const trails = new Map<string, { entries: readonly Entry[]; seq: number }>()

const detailMs = 10_000

const feedMs = 5000

const shelfMs = 60_000

const tabs = ['transcript', 'room', 'artifacts', 'contributors', 'code', 'machines', 'about'] as const

type Tab = (typeof tabs)[number]

function chosen() {
  return here().searchParams.get('artifact') ?? undefined
}


function subscribe(listener: () => void) {
  addEventListener('hashchange', listener)
  addEventListener('popstate', listener)
  return () => {
    removeEventListener('hashchange', listener)
    removeEventListener('popstate', listener)
  }
}

function useTab() {
  const hash = useSyncExternalStore(subscribe, () => location.hash.slice(1), () => '')
  const tab: Tab = (tabs as readonly string[]).includes(hash) ? (hash as Tab) : 'transcript'
  const choose = (next: Tab) => {
    history.replaceState(null, '', `${location.pathname}${location.search}${next === 'transcript' ? '' : `#${next}`}`)
    dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return [tab, choose] as const
}

export function Swarm(props: { config: Config | undefined; id: string }) {
  const [entries, setEntries] = useState<readonly Entry[]>(() => trails.get(props.id)?.entries ?? remembered<Detail>(props.id)?.feed ?? seeded<Detail>(props.id)?.feed ?? [])
  const first = useRef(entries.length === 0)
  const wired = Wire.useWire(props.id, 'room', (signal) => {
    if (signal.type === 'pulse') setDetail((data) => Wire.pulsed(data, signal))
    if (signal.type === 'artifacts') setShelf(() => ({ artifacts: signal.artifacts.map((artifact) => (artifact.url.startsWith('/') ? { ...artifact, url: location.origin + artifact.url } : artifact)) }))
    if (Wire.stirred(signal, 'detail')) reload()
    if (Wire.stirred(signal, 'artifacts')) reshelve()
    if (Wire.stirred(signal, 'feed') && stream.at === 'off') void read()
  })
  const [detail, reload, setDetail] = usePoll(() => {
    const full = first.current
    first.current = false
    return Api.swarm(props.id, full)
  }, wired === 'down' ? detailMs : null, props.id)
  const last = useRef(trails.get(props.id)?.seq ?? highest(entries))
  useEffect(() => {
    if (entries.length) trails.set(props.id, { entries: entries.slice(-400), seq: last.current })
  }, [entries, props.id])
  const [note, setNote] = useState(() => asked().note)
  const [tab, setTab] = useTab()
  const [unread, setUnread] = useState(0)
  const [titled, setTitled] = useState(false)
  const [prefill] = useState(() => asked())
  const [draft, setDraft] = useState({ at: 0, text: '' })
  const [side, setSide] = useState<{ branch: number | null; open: boolean; question: { at: number; text: string } }>({ branch: null, open: false, question: { at: 0, text: '' } })
  const [chat, setChat] = useState<{ handles: ReadonlyMap<string, string>; me: Me | null; members: readonly Member[]; online: readonly string[]; said: readonly Said[]; watching: number }>(() => {
    const room = seeded<RoomState>(`room:${props.id}`)
    return { handles: new Map((room?.members ?? []).map((member) => [member.address, member.handle])), me: null, members: room?.members ?? [], online: [], said: room?.messages ?? [], watching: 0 }
  })
  const heard = useCallback((said: readonly Said[], me: Me | null, members: readonly Member[], online: readonly string[], watching: number) => setChat((previous) => ({ handles: new Map(members.map((member) => [member.address, member.handle])), me, members, online, watching, said: [...said, ...previous.said.filter((item) => !said.some((other) => other.id === item.id) && item.id > (said.at(-1)?.id ?? 0))] })), [])
  const [funding, setFunding] = useState(() => here().searchParams.has('fund'))
  const [artifact, setArtifact] = useState(chosen)
  const visible = useVisible()
  const wide = useMedia('(min-width: 1100px)')
  const phone = useMedia('(max-width: 799px)')
  const running = detail.data?.status === 'running'
  const loaded = detail.data !== undefined
  const [shelf, reshelve, setShelf] = usePoll(() => Api.artifacts(props.id), wired === 'down' ? shelfMs : null, `artifacts:${props.id}`)
  const stream = useLive(props.id, running && visible, (entry) => {
    last.current = Math.max(last.current, entry.seq)
    setEntries((previous) => merge(previous, [entry]))
  }, () => last.current)
  const coded = !!detail.data?.code
  useEffect(() => {
    if (!coded) return
    const timer = setTimeout(() => void Api.code(props.id).catch(() => undefined), 300)
    return () => clearTimeout(timer)
  }, [coded, props.id])
  const warm = (item: Tab) => (item === 'code' && coded ? { onFocus: () => void load(), onPointerEnter: () => void load(), onTouchStart: () => void load() } : {})

  useEffect(() => {
    if (!detail.data) return
    last.current = Math.max(last.current, highest(detail.data.feed))
    setEntries((previous) => merge(previous, detail.data?.feed ?? []))
  }, [detail.data])

  useEffect(() => {
    if (detail.data) document.title = `${detail.data.title} · Swarms`
  }, [detail.data?.title])

  useEffect(() => {
    const url = new URL(location.href)
    if (artifact) url.searchParams.set('artifact', artifact)
    else url.searchParams.delete('artifact')
    history.replaceState(null, '', url)
  }, [artifact])

  const pace = stream.at !== 'off' || (wired !== 'down' && !running) ? null : running ? feedMs : detailMs
  const fed = useRef({ at: Date.now(), reading: false })
  const read = useStable(async () => {
    if (fed.current.reading) return
    fed.current = { at: Date.now(), reading: true }
    try {
      const { entries: next } = await Api.feed(props.id, last.current)
      last.current = Math.max(last.current, highest(next))
      setEntries((previous) => merge(previous, next))
    } catch {}
    fed.current = { ...fed.current, reading: false }
  })
  useEffect(() => {
    if (!loaded || !visible || pace === null) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = () => {
      timer = setTimeout(() => void read().then(() => alive && loop()), Math.max(0, fed.current.at + pace - Date.now()))
    }
    loop()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [loaded, props.id, pace, visible])

  const back = useStable((text: string) => {
    setTab('transcript')
    if (text.trim()) {
      setFunding(false)
      return setDraft({ at: Date.now(), text })
    }
    setNote('')
    setFunding(true)
  })
  const backNote = useStable((text: string) => back(text || note))
  const ask = useStable((branch: number | null, text?: string) => setSide({ branch, open: true, question: { at: Date.now(), text: text ?? '' } }))

  if (!detail.data)
    return detail.error ? (
      <Lost title={/no swarm/i.test(detail.error) ? 'This swarm drifted off.' : "Can't reach Swarms."}>
        {!/no swarm/i.test(detail.error) && <button className="lost-row" onClick={() => location.reload()} type="button">Try again <span aria-hidden="true">↻</span></button>}
        <Link className="lost-row" to="/new">Start a swarm <span aria-hidden="true">→</span></Link>
        <Link className="lost-row" to="/join">Join a swarm <span aria-hidden="true">→</span></Link>
      </Lost>
    ) : (
      <section className="page lost" aria-busy="true"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    )

  const swarm = detail.data
  const live = swarm.status === 'running'
  const shown: Tab = wide && tab === 'room' ? 'transcript' : tab
  const connected = swarm.hands.filter((hand) => hand.connected).length
  const fund = <Fund config={props.config} note={note} onDone={() => { reload(); setFunding(false) }} onNote={setNote} prefill={prefill} target={() => Promise.resolve({ id: swarm.id, wallet: swarm.wallet })} title={swarm.title} />
  const open = (slug: string) => {
    setArtifact(slug)
    setTab('artifacts')
  }
  const room = <Room config={props.config} onArtifact={open} onBack={back} onMessages={heard} onSteered={reload} onTranscript={() => setTab('transcript')} onUnread={setUnread} swarm={swarm} visible={wide || shown === 'room'} />
  const shelved = shelf.data?.artifacts.length ?? 0
  const backers = chat.members.filter((member) => Number(member.backed) > 0).length
  const labels: Record<Tab, ReactNode> = {
    about: 'About',
    artifacts: <>Artifacts{shelved > 0 && <span className="tab-count tab-quiet">{shelved}</span>}</>,
    code: 'Code',
    contributors: <>Contributors{backers > 0 && <span className="tab-count tab-quiet">{backers}</span>}</>,
    machines: <>Machines{connected > 0 && <span className="tab-count tab-quiet">{connected}</span>}</>,
    room: <>Room<Presence members={chat.members} online={chat.online} watching={chat.watching} />{unread > 0 && <span className="tab-count">{unread}</span>}</>,
    transcript: 'Transcript',
  }
  const strip = tabs.filter((item) => item !== 'room' || !wide)
  const arrows = (event: Press<HTMLElement>) => {
    const at = strip.indexOf(shown)
    const next = event.key === 'ArrowRight' ? strip[(at + 1) % strip.length] : event.key === 'ArrowLeft' ? strip[(at + strip.length - 1) % strip.length] : event.key === 'Home' ? strip[0] : event.key === 'End' ? strip.at(-1) : undefined
    if (!next) return
    event.preventDefault()
    const list = event.currentTarget
    setTab(next)
    requestAnimationFrame(() => list.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus())
  }
  const tablist = (className: string) => (
    <nav aria-label="Swarm" className={className} onKeyDown={arrows} role="tablist">
      {strip.map((item) => (
        <button aria-controls={`panel-${item}`} aria-selected={shown === item} data-tab={item} id={`tab-${item}`} key={item} onClick={() => setTab(item)} role="tab" tabIndex={shown === item ? 0 : -1} type="button" {...warm(item)}>
          {labels[item]}
        </button>
      ))}
    </nav>
  )

  return (
    <article className="page swarm room-page" data-status={swarm.status}>
      <header className="swarm-head">
        <div className="swarm-title">
          <Link aria-label="All swarms" className="swarm-home" to="/join">←</Link>
          <Dot swarm={swarm} />
          <h1 data-open={titled} onClick={() => setTitled(!titled)} title={swarm.title}>{swarm.title}</h1>
        </div>
        <Energy onFund={() => back(note)} swarm={swarm} />
        {!phone && tablist('room-tabs')}
        {!phone && <button className="side-open" onClick={() => (side.open ? setSide((current) => ({ ...current, open: false })) : ask(null))} type="button">{side.open ? 'Close the side pane' : 'Ask on the side'}</button>}
      </header>
      <div className="room-layout">
        <section className="room-main">
          {phone && tablist('phone-views')}
          <div aria-labelledby="tab-transcript" className="room-panel" data-tab={shown} hidden={shown !== 'transcript'} id="panel-transcript" role="tabpanel">
            <Transcript
              artifacts={shelf.data?.artifacts}
              config={props.config}
              draft={draft}
              entries={entries}
              onSide={(question, branch) => (question === '/close' ? setSide((current) => ({ ...current, open: false })) : ask(branch, question))}
              handles={chat.handles}
              live={stream}
              me={chat.me}
              onClose={() => setFunding(false)}
              onEmpty={() => back(note)}
              onFund={backNote}
              onArtifact={open}
              onEntries={(next) => setEntries((previous) => merge(previous, next))}
              onPeople={() => {
                if (!wide) return setTab('room')
                document.querySelector<HTMLTextAreaElement>('.room .composer textarea')?.focus()
              }}
              onSaid={(said) => {
                setChat((previous) => ({ ...previous, said: [...previous.said.filter((item) => item.id !== said.id), said] }))
                reload()
              }}
              people={!phone && !wide}
              said={chat.said}
              swarm={swarm}
              tray={funding ? fund : undefined}
            />
          </div>
          {shown !== 'transcript' && shown !== 'room' && (
            <div aria-labelledby={`tab-${shown}`} className="room-panel room-page-panel" data-tab={shown} id={`panel-${shown}`} role="tabpanel">
              {shown === 'artifacts' && <Artifacts artifacts={shelf.data?.artifacts} error={shelf.error} onSelect={setArtifact} selected={artifact} working={live} />}
              {shown === 'contributors' && <Contributors me={chat.me} members={chat.members} online={chat.online} />}
              {shown === 'code' && <Repository config={props.config} swarm={swarm} />}
              {shown === 'machines' && (
                <>
                  <Machines entries={entries} hands={swarm.hands} live={live} swarm={swarm.id} />
                  <Connect swarm={swarm} />
                </>
              )}
              {shown === 'about' && <About config={props.config} swarm={swarm} />}
            </div>
          )}
        </section>
        <aside aria-labelledby={wide ? undefined : 'tab-room'} className="room-side" data-docked={!wide} hidden={!wide && shown !== 'room'} id="panel-room" role={wide ? undefined : 'tabpanel'}>
          {room}
        </aside>
      </div>
      {side.open && (
        <Side
          branch={side.branch}
          config={props.config}
          onBranch={(branch) => setSide((current) => ({ ...current, branch }))}
          onClose={() => setSide((current) => ({ ...current, open: false }))}
          onSaid={(said) => {
            setChat((previous) => ({ ...previous, said: [...previous.said.filter((item) => item.id !== said.id), said] }))
            reload()
          }}
          question={side.question}
          swarm={swarm}
        />
      )}
    </article>
  )
}

function highest(entries: readonly Entry[]) {
  return entries.reduce((most, entry) => Math.max(most, entry.seq), 0)
}

function About(props: { config: Config | undefined; swarm: Detail }) {
  const swarm = props.swarm
  const created = new Date(swarm.createdAt)
  const clone = swarm.code ? `git clone ${swarm.code.clone} ${swarm.code.name}` : null
  return (
    <div className="about-swarm">
      <section className="panel-section">
        <h2 className="panel-head">The question</h2>
        <h3 className="about-title">{swarm.title}</h3>
        <p className="about-goal">{swarm.goal}</p>
      </section>
      <dl className="about-facts">
        <div><dt>Started</dt><dd><time dateTime={created.toISOString()}>{created.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</time></dd></div>
        <div><dt>Raised</dt><dd>{Answer.cash(Number(swarm.raised))}</dd></div>
        <div><dt>Spent</dt><dd>{Answer.cash(Number(swarm.spent))}</dd></div>
        <div><dt>Backers</dt><dd>{swarm.contributors}</dd></div>
        <Facts setup={swarm.setup} />
        {swarm.wallet && (
          <div className="about-wide">
            <dt>Its wallet</dt>
            <dd>{props.config ? <a href={`${props.config.explorer}/address/${swarm.wallet}`} rel="noreferrer" target="_blank">{short(swarm.wallet)} ↗</a> : short(swarm.wallet)}</dd>
          </div>
        )}
        {swarm.code && clone && (
          <div className="about-wide">
            <dt>Code</dt>
            <dd>
              <span>{swarm.code.name}</span>
              <code className="about-clone">{clone}</code>
            </dd>
          </div>
        )}
      </dl>
      <nav className="lost-actions about-more">
        <a className="lost-row" href={`/v1/swarms/${swarm.id}`} rel="noreferrer" target="_blank">Its data as JSON <span aria-hidden="true">↗</span></a>
        <Link className="lost-row" to="/docs">Use it from code or MCP <span aria-hidden="true">→</span></Link>
        <Link className="lost-row" to="/about">How swarms work <span aria-hidden="true">→</span></Link>
      </nav>
    </div>
  )
}

function Repository(props: { config: Config | undefined; swarm: Detail }) {
  const code = props.swarm.code
  if (!code || !props.config)
    return (
      <p className="machine-none">No code yet. A repository shows up here once the agent creates one.</p>
    )
  if (loaded) return <loaded.Code gateway={props.config.gateway} repo={code} swarm={props.swarm.id} updates={props.swarm.updates} />
  return (
    <Suspense fallback={<p className="empty">Loading the code…</p>}>
      <Code gateway={props.config.gateway} repo={code} swarm={props.swarm.id} updates={props.swarm.updates} />
    </Suspense>
  )
}

