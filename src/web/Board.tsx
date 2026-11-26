import { useEffect, useRef, useState } from 'react'
import * as Limits from '../shared/Limits.ts'
import * as Site from '../shared/Site.ts'
import * as Showing from './showing.ts'

type Step = { click: string } | { slide: [string, number] } | { scroll: string; to?: 'top' } | { type: [string, string] } | { wait: number }

type Frame = { name: string; note?: string; size?: 'card'; steps?: readonly Step[]; url: string }

type Flow = { frames: readonly Frame[]; id: string; title: string }

const idea = (id: string, rest = '') => `/s/${id}?fixture${rest}`

const chat = (id: string, rest = '') => `/s/${id}/chat?fixture${rest}`

const made = (id: string, rest = '') => `/s/${id}/results?fixture${rest}`

const code = (id: string, rest = '') => `/s/${id}/code?fixture${rest}`

const grove = (path = '', rest = '') => `/s/p-vs-np${path}?fixture${rest}`

const razb = '1583a1546a'

const refuted = '397998eb13'

const mono = 'd5d7313e5a'

const sun = '5a4868cdff'

const flows: readonly Flow[] = [
  {
    frames: [
      { name: 'Home', url: '/?fixture' },
      { name: 'Home, scrolled', note: 'scrolled', steps: [{ scroll: 'page' }], url: '/?fixture' },
      { name: 'Loading', url: '/?fixture&scene=wait' },
      { name: 'Nothing yet', url: '/?fixture&scene=empty' },
      { name: 'Offline', url: '/?fixture&scene=down' },
    ],
    id: 'home',
    title: 'Home',
  },
  {
    frames: [
      { name: 'All swarms', url: '/ideas?fixture' },
      { name: 'Working now', url: '/ideas?fixture&filter=running' },
      { name: 'Needs money', url: '/ideas?fixture&filter=money' },
      { name: 'No riders yet', url: '/ideas?fixture&filter=waiting' },
      { name: 'Scrolled', note: 'scrolled', steps: [{ scroll: 'page' }], url: '/ideas?fixture&scene=many' },
      { name: 'Loading', url: '/ideas?fixture&scene=wait' },
      { name: 'Offline', url: '/ideas?fixture&scene=down' },
    ],
    id: 'ideas',
    title: 'All swarms',
  },
  {
    frames: [
      { name: 'Your own problem', url: '/new?fixture' },
      { name: 'Typed', steps: [{ type: ['#question', 'Can a 1B model beat GPT-4 at chess puzzles?'] }], url: '/new?fixture' },
      { name: 'A problem from the list', url: '/new?fixture&q=pq-signatures' },
      { name: 'Moving the amount', steps: [{ slide: ['.fuel-slide', Limits.WebBoard.slideStop] }], url: '/new?fixture&q=pq-signatures' },
      { name: 'Check prompt', steps: [{ click: '.box .fuel-go' }, { click: '.box .fuel-go' }], url: '/new?fixture&q=pq-signatures&scene=hang,in' },
    ],
    id: 'start',
    title: 'Start a swarm',
  },
  {
    frames: [
      { name: 'Working now', url: idea('bench-coders') },
      { name: 'Just started', url: idea('rust-book-el') },
      { name: 'No riders yet', url: idea('speedrun-t4') },
      { name: 'Out of money', url: idea('dex-guide') },
      { name: 'A payment was refused', url: idea('dex-guide', '&scene=refused') },
      { name: 'Without a surface', url: idea('mev-map') },
      { name: 'One agent\'s traces', steps: [{ click: '.traces-who button:nth-child(3)' }], url: idea('bench-coders') },
      { name: 'A trace opened', steps: [{ click: '.trace-rows li:last-child button' }], url: idea('bench-coders') },
      { name: 'Results', url: made('bench-coders') },
      { name: 'Results, scrolled', note: 'scrolled', steps: [{ scroll: 'page' }], url: made('mev-map') },
      { name: 'A result opened', url: made('bench-coders', '&r=leaderboard') },
      { name: 'Scrolled, the ride bar', note: 'phone', steps: [{ scroll: 'page' }], url: idea('bench-coders') },
      { name: 'Loading', url: idea('bench-coders', '&scene=wait') },
      { name: 'Not found', url: '/s/nope?fixture' },
      { name: 'Offline', url: idea('bench-coders', '&scene=down') },
    ],
    id: 'idea',
    title: 'A swarm',
  },
  {
    frames: [
      { name: 'Signed out', url: chat('bench-coders') },
      { name: 'Rider', url: chat('bench-coders', '&scene=in') },
      { name: 'Telling the AI', steps: [{ click: '.chat-ai' }, { type: ['.chat-bar textarea', 'Try a second pass at temperature 0'] }], url: chat('bench-coders', '&scene=in') },
      { name: 'Quiet', url: chat('rust-book-el', '&scene=in') },
    ],
    id: 'chat',
    title: 'Chat',
  },

  {
    frames: [
      { name: 'Busy', url: grove() },
      { name: 'Seeded, statements under review', url: grove('', '&scene=seeded') },
      { name: 'Empty', url: grove('', '&scene=empty') },
      { name: 'A proof landing', note: 'live', steps: [{ wait: Limits.WebBoard.landingMs }], url: grove(`/n/${razb}`, '&scene=landing') },
      { name: 'A dead end, refuted', url: grove(`/n/${refuted}`) },
      { name: 'Since your last visit', url: grove('', '&scene=visit') },
      { name: 'Needs money', url: grove('', '&filter=money') },
      { name: 'Dead ends', url: grove('', '&filter=dead') },
      { name: 'One level, on a phone', note: 'phone', url: grove('', `&in=${mono}`) },
      { name: 'A lemma as a full panel', note: 'phone', url: grove(`/n/${sun}`) },
      { name: 'Offline', url: grove('', '&scene=down') },
    ],
    id: 'tree',
    title: 'The tree',
  },
  {
    frames: [
      { name: 'Ride this lemma', steps: [{ click: '.node-ride-btn' }], url: grove(`/n/${razb}`, '&scene=in') },
      { name: 'Ride the whole swarm', steps: [{ click: '.strip-ride' }], url: grove('', '&scene=in') },
      { name: 'Ride an agent swarm', steps: [{ click: '.strip-ride' }], url: idea('bench-coders', '&scene=in,open') },
      { name: 'Riding an agent swarm', steps: [{ click: '.strip-ride' }, { click: '.ride .fuel-go' }, { wait: Limits.WebBoard.rideMs }], url: idea('bench-coders', '&scene=in,open') },
      { name: 'Check prompt', steps: [{ click: '.node-ride-btn' }, { click: '.ride .fuel-go' }], url: grove(`/n/${razb}`, '&scene=hang,in') },
      { name: 'Riding', steps: [{ click: '.node-ride-btn' }, { click: '.ride .fuel-go' }, { wait: Limits.WebBoard.rideMs }], url: grove(`/n/${razb}`, '&scene=in') },
      { name: 'Sent, not counted yet', steps: [{ click: '.node-ride-btn' }, { click: '.ride .fuel-go' }, { wait: Limits.WebBoard.uncountedMs }], url: grove(`/n/${razb}`, '&scene=uncounted,in') },
      { name: 'Propose a lemma', steps: [{ click: '.node-acts .channel-add' }], url: grove(`/n/${mono}`, '&scene=in') },
      { name: 'An archived swarm', url: idea('dex-guide') },
    ],
    id: 'ride',
    title: 'Ride and propose',
  },

  {
    frames: [
      { name: 'Code', url: code('bench-coders') },
      { name: 'A folder', steps: [{ click: '.repo-list li:first-child button' }], url: code('bench-coders') },
      { name: 'A file', steps: [{ click: '.repo-list li:first-child button' }, { click: '.repo-list li:nth-child(2) button' }], url: code('bench-coders') },
      { name: 'No code yet', url: code('rust-book-el') },
    ],
    id: 'code',
    title: 'Code',
  },
  {
    frames: [
      { name: 'Swarm riders', url: '/about?fixture' },
      { name: 'For developers', url: '/docs?fixture' },
      { name: 'Not found', url: '/nowhere?fixture' },
    ],
    id: 'pages',
    title: 'Pages',
  },
]

const sizes = { card: { height: Limits.WebBoard.cardHeight, scale: Limits.WebBoard.cardScale, width: Limits.WebBoard.cardWidth }, desktop: { height: Limits.Web.desktopHeight, scale: Limits.WebBoard.desktopScale, width: Limits.Web.desktopWidth }, phone: { height: Limits.Web.phoneHeight, scale: Limits.WebBoard.phoneScale, width: Limits.Web.phoneWidth } } as const

type Size = 'phone' | 'desktop'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function find(doc: Document, selector: string) {
  for (let tries = 0; tries < Limits.Board.findTries; tries++) {
    const found = doc.querySelector(selector)
    if (found) return found as HTMLElement
    await sleep(Limits.Board.findMs)
  }
  return undefined
}

function scroller(element: HTMLElement | null, doc: Document) {
  for (let node = element; node; node = node.parentElement) {
    const overflow = doc.defaultView?.getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  const main = doc.querySelector<HTMLElement>('.app > main')
  return main && main.scrollHeight > main.clientHeight ? main : (doc.scrollingElement as HTMLElement)
}


const slots = { busy: 0, queue: [] as (() => void)[] }

function claim() {
  return new Promise<void>((resolve) => {
    if (slots.busy < Limits.WebBoard.slots) {
      slots.busy++
      resolve()
    } else slots.queue.push(resolve)
  })
}

function release() {
  const next = slots.queue.shift()
  if (next) next()
  else slots.busy = Math.max(0, slots.busy - 1)
}

async function play(frame: HTMLIFrameElement, steps: readonly Step[]) {
  const doc = frame.contentDocument
  if (doc) await find(doc, '.app > main > *')
  await sleep(Limits.Board.settleMs)
  for (const step of steps) {
    const doc = frame.contentDocument
    if (!doc) return
    if ('wait' in step) await sleep(step.wait * Limits.Board.pace)
    if ('click' in step) (await find(doc, step.click))?.click()
    if ('scroll' in step) {
      const target = scroller(step.scroll === 'page' ? null : ((await find(doc, step.scroll)) ?? null), doc)
      target.scrollTo({ behavior: 'smooth', top: step.to === 'top' ? 0 : target.scrollHeight })
      await sleep(Limits.Board.scrollMs)
    }
    if ('slide' in step) {
      const range = (await find(doc, step.slide[0])) as HTMLInputElement | undefined
      const view = doc.defaultView as (Window & typeof globalThis) | null
      if (range && view) {
        Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set?.call(range, String(step.slide[1]))
        range.dispatchEvent(new view.Event('input', { bubbles: true }))
      }
    }
    if ('type' in step) {
      const field = (await find(doc, step.type[0])) as HTMLInputElement | HTMLTextAreaElement | undefined
      if (!field) continue
      const view = doc.defaultView as (Window & typeof globalThis) | null
      const proto = field instanceof (view?.HTMLTextAreaElement ?? HTMLTextAreaElement) ? view?.HTMLTextAreaElement.prototype : view?.HTMLInputElement.prototype
      field.focus()
      proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, step.type[1])
      field.dispatchEvent(new (view?.Event ?? Event)('input', { bubbles: true }))
    }
    await sleep(Limits.Board.stepMs)
  }
}

function Shot(props: { frame: Frame; index: string; size: Size }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [shot, setShot] = useState<Showing.Showing>('away')
  const live = useRef(shot)
  const [key, setKey] = useState(0)
  const box = sizes[props.frame.size ?? props.size]
  const holder = useRef<HTMLDivElement>(null)
  const move = (step: (now: Showing.Showing) => Showing.Showing) => {
    const next = step(live.current)
    if (Showing.holds(live.current) && !Showing.holds(next)) release()
    live.current = next
    setShot(next)
  }

  useEffect(() => {
    const element = holder.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => move((now) => Showing.seen(now, !!entry?.isIntersecting)), { rootMargin: '300px' })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (Showing.holds(live.current)) release()
    }
  }, [])

  useEffect(() => {
    if (shot !== 'queued') return
    let alive = true
    void claim().then(() => (alive && live.current === 'queued' ? move(Showing.granted) : release()))
    return () => {
      alive = false
    }
  }, [shot])

  return (
    <figure className="shot" data-size={props.frame.size ?? props.size}>
      <div className="shot-screen" ref={holder} style={{ height: box.height * box.scale, width: box.width * box.scale }}>
        {Showing.framed(shot) && (
          <iframe
            key={key}
            onLoad={() => {
              move(Showing.loaded)
              if (ref.current && props.frame.steps) void play(ref.current, props.frame.steps)
            }}
            ref={ref}
            src={Site.at(props.frame.url)}
            style={{ height: box.height, transform: `scale(${box.scale})`, width: box.width }}
            tabIndex={-1}
            title={props.frame.name}
          />
        )}
      </div>
      <figcaption>
        <span className="shot-index">{props.index}</span>
        <a href={Site.at(props.frame.url)} rel="noreferrer" target="_blank">{props.frame.name} ↗</a>
        {props.frame.note && <span className="shot-note">{props.frame.note}</span>}
        <button aria-label={`Replay ${props.frame.name}`} className="shot-replay" onClick={() => setKey(key + 1)} type="button">↻</button>
      </figcaption>
    </figure>
  )
}

const inks = [['--bg', 'Page'], ['--wash', 'Wash'], ['--line', 'Line'], ['--rule', 'Rule'], ['--edge', 'Edge'], ['--muted', 'Muted'], ['--soft', 'Soft'], ['--fg', 'Text'], ['--green', 'Live'], ['--warn', 'Needs money'], ['--red', 'Error'], ['--blue', 'Link']] as const

function Design() {
  return (
    <section className="board-flow board-design">
      <h2><span>00</span>The look</h2>
      <div className="design">
        <div className="design-type">
          <p className="design-event">Make a breakthrough. Ride a swarm.</p>
          <p className="design-intro">A swarm is many AI agents working one hard problem, in the open. A rider points it.</p>
          <p className="design-headline">Benchmark every open-weight coding model</p>
          <p className="design-body">Body text, names, navigation and section labels are all Paradigm Serif at 16 px. Links are underlined. Whitespace separates sections.</p>
          <p className="design-mono">$9.04 balance · 9 riders · updated 3 min ago</p>
          <ol className="go">
            <li><a href="#"><b>[1]</b><span>Start a swarm</span></a></li>
            <li><a href="#"><b>[2]</b><span>Ride a swarm</span></a></li>
          </ol>
        </div>
        <div className="design-side">
          <div className="design-buttons">
            <button className="btn btn-high" type="button">Ride it</button>
            <button className="btn btn-medium" type="button">Share</button>
            <span className="pill" data-mood="live"><i />Working now</span>
            <span className="pill" data-mood="stuck"><i />Retrying</span>
            <span className="pill" data-mood="money"><i />Needs money</span>
            <span className="pill" data-mood="new"><i />No riders yet</span>
          </div>
          <ul className="design-inks">
            {inks.map(([token, name]) => (
              <li key={token}><i style={{ background: `var(${token})` }} /><b>{name}</b><span>{token}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export function Board() {
  const [size, setSize] = useState<Size>(() => (new URLSearchParams(location.search).get('size') === 'desktop' ? 'desktop' : 'phone'))
  const [only, setOnly] = useState<string>(() => new URLSearchParams(location.search).get('flow') ?? 'all')
  const total = flows.reduce((sum, flow) => sum + flow.frames.length, 0)

  useEffect(() => {
    document.title = 'Storyboard · Swarms'
    const url = new URL(location.href)
    url.searchParams.set('size', size)
    if (only === 'all') url.searchParams.delete('flow')
    else url.searchParams.set('flow', only)
    history.replaceState(null, '', url)
  }, [size, only])

  return (
    <div className="board">
      <header className="board-head">
        <div>
          <h1>Storyboard</h1>
          <p>{total} states, live from the fixture world. Click a name to open it.</p>
        </div>
        <div className="board-controls">
          <div className="board-chips" role="tablist">
            {(['phone', 'desktop'] as const).map((item) => (
              <button aria-selected={size === item} className="chip" key={item} onClick={() => setSize(item)} role="tab" type="button">{item === 'phone' ? 'Phone' : 'Desktop'}</button>
            ))}
          </div>
          <div className="board-chips" role="tablist">
            {[{ id: 'all', title: 'Everything' }, ...flows].map((flow) => (
              <button aria-selected={only === flow.id} className="chip" key={flow.id} onClick={() => setOnly(flow.id)} role="tab" type="button">{flow.title}</button>
            ))}
          </div>
        </div>
      </header>
      {only === 'all' && <Design />}
      {flows.filter((flow) => only === 'all' || only === flow.id).map((flow) => (
        <section className="board-flow" key={`${flow.id}-${size}`}>
          <h2><span>{String(flows.indexOf(flow) + 1).padStart(2, '0')}</span>{flow.title}</h2>
          <div className="board-row">
            {flow.frames.map((frame, index) => <Shot frame={frame} index={`${flows.indexOf(flow) + 1}.${index + 1}`} key={frame.name} size={size} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
