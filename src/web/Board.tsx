import { useEffect, useRef, useState } from 'react'
import * as Site from '../shared/Site.ts'

type Step = { click: string } | { scroll: string; to?: 'top' } | { type: [string, string] } | { wait: number }

type Frame = { name: string; note?: string; size?: 'card'; steps?: readonly Step[]; url: string }

type Flow = { frames: readonly Frame[]; id: string; title: string }

const idea = (id: string, rest = '') => `/s/${id}?fixture${rest}`

const chat = (id: string, rest = '') => `/s/${id}/chat?fixture${rest}`

const made = (id: string, rest = '') => `/s/${id}/results?fixture${rest}`

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
      { name: 'All ideas', url: '/ideas?fixture' },
      { name: 'Working now', url: '/ideas?fixture&filter=running' },
      { name: 'Needs funding', url: '/ideas?fixture&filter=money' },
      { name: 'New', url: '/ideas?fixture&filter=waiting' },
      { name: 'Scrolled', note: 'scrolled', steps: [{ scroll: 'page' }], url: '/ideas?fixture&scene=many' },
      { name: 'Loading', url: '/ideas?fixture&scene=wait' },
      { name: 'Offline', url: '/ideas?fixture&scene=down' },
    ],
    id: 'ideas',
    title: 'All ideas',
  },
  {
    frames: [
      { name: 'Your own idea', url: '/new?fixture' },
      { name: 'Typed', steps: [{ type: ['#question', 'Can a 1B model beat GPT-4 at chess puzzles?'] }], url: '/new?fixture' },
      { name: 'An idea from the list', url: '/new?fixture&q=pq-signatures' },
      { name: 'Backing it', steps: [{ click: '.box .fuel-go' }], url: '/new?fixture&q=pq-signatures' },
      { name: 'Approve in Tempo Wallet', steps: [{ click: '.box .fuel-go' }, { click: '.box .fuel-go' }], url: '/new?fixture&q=pq-signatures&scene=hang,in' },
    ],
    id: 'start',
    title: 'Start an idea',
  },
  {
    frames: [
      { name: 'Working now', url: idea('bench-coders') },
      { name: 'Just started', url: idea('rust-book-el') },
      { name: 'New, nobody backed it', url: idea('speedrun-t4') },
      { name: 'Out of money', url: idea('dex-guide') },
      { name: 'Without a surface', url: idea('mev-map') },
      { name: 'One agent\'s traces', steps: [{ click: '.traces-who button:nth-child(3)' }], url: idea('bench-coders') },
      { name: 'A trace opened', steps: [{ click: '.trace-rows li:last-child button' }], url: idea('bench-coders') },
      { name: 'Results', url: made('bench-coders') },
      { name: 'Results, scrolled', note: 'scrolled', steps: [{ scroll: 'page' }], url: made('mev-map') },
      { name: 'A result opened', url: made('bench-coders', '&r=leaderboard') },
      { name: 'Scrolled, the back bar', note: 'phone', steps: [{ scroll: 'page' }], url: idea('bench-coders') },
      { name: 'Loading', url: idea('bench-coders', '&scene=wait') },
      { name: 'Not found', url: '/s/nope?fixture' },
      { name: 'Offline', url: idea('bench-coders', '&scene=down') },
    ],
    id: 'idea',
    title: 'An idea',
  },
  {
    frames: [
      { name: 'Signed out', url: chat('bench-coders') },
      { name: 'Backer', url: chat('bench-coders', '&scene=in') },
      { name: 'Telling the AI', steps: [{ click: '.chat-ai' }, { type: ['.chat-bar textarea', 'Try a second pass at temperature 0'] }], url: chat('bench-coders', '&scene=in') },
      { name: 'Back it from the chat', steps: [{ click: '.chat-back-it' }], url: chat('bench-coders', '&scene=in') },
      { name: 'Quiet', url: chat('rust-book-el', '&scene=in') },
    ],
    id: 'chat',
    title: 'Chat',
  },
  {
    frames: [
      { name: 'Back it open', steps: [{ click: '.box .fuel-go' }], url: idea('bench-coders', '&scene=in') },
      { name: 'With a direction', url: idea('bench-coders', '&scene=in&fund&note=Try%20a%20second%20pass%20at%20temperature%200') },
      { name: 'Backing a direction', steps: [{ click: '.asked button' }], url: made('bench-coders', '&scene=in') },
      { name: 'Approve in Tempo Wallet', steps: [{ click: '.box .fuel-go' }, { click: '.box .fuel-go' }], url: idea('dex-guide', '&scene=hang,in') },
      { name: 'Declined', steps: [{ click: '.box .fuel-go' }, { click: '.box .fuel-go' }, { wait: 1600 }], url: idea('dex-guide', '&scene=deny,in') },
      { name: 'Not enough money', steps: [{ click: '.box .fuel-go' }, { click: '.box .fuel-go' }, { wait: 2600 }], url: idea('dex-guide', '&scene=broke,in') },
      { name: 'Sent, not counted yet', steps: [{ click: '.box .fuel-go' }, { click: '.box .fuel-go' }, { wait: 2600 }], url: idea('dex-guide', '&scene=uncounted,in') },
      { name: 'Backed', steps: [{ click: '.box .fuel-go' }, { click: '.box .fuel-go' }, { wait: 3000 }], url: idea('bench-coders', '&scene=in') },
    ],
    id: 'back',
    title: 'Back it',
  },
  {
    frames: [
      { name: 'How it works', url: '/about?fixture' },
      { name: 'For developers', url: '/docs?fixture' },
    ],
    id: 'pages',
    title: 'Pages',
  },
]

const sizes = { card: { height: 450, scale: 0.42, width: 800 }, desktop: { height: 900, scale: 0.3, width: 1440 }, phone: { height: 844, scale: 0.42, width: 390 } } as const

type Size = 'phone' | 'desktop'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function find(doc: Document, selector: string) {
  for (let tries = 0; tries < 60; tries++) {
    const found = doc.querySelector(selector)
    if (found) return found as HTMLElement
    await sleep(100)
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

const pace = 0.2

const slots = { busy: 0, queue: [] as (() => void)[] }

function claim() {
  return new Promise<void>((resolve) => {
    if (slots.busy < 6) {
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
  await sleep(150)
  for (const step of steps) {
    const doc = frame.contentDocument
    if (!doc) return
    if ('wait' in step) await sleep(step.wait * pace)
    if ('click' in step) (await find(doc, step.click))?.click()
    if ('scroll' in step) {
      const target = scroller(step.scroll === 'page' ? null : ((await find(doc, step.scroll)) ?? null), doc)
      target.scrollTo({ behavior: 'smooth', top: step.to === 'top' ? 0 : target.scrollHeight })
      await sleep(300)
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
    await sleep(80)
  }
}

function Shot(props: { frame: Frame; index: string; size: Size }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [seen, setSeen] = useState(false)
  const [ready, setReady] = useState(false)
  const [key, setKey] = useState(0)
  const box = sizes[props.frame.size ?? props.size]
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = holder.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setSeen(!!entry?.isIntersecting), { rootMargin: '300px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!seen) return setReady(false)
    if (ready) return
    let alive = true
    void claim().then(() => (alive ? setReady(true) : release()))
    return () => {
      alive = false
    }
  }, [seen, ready])

  return (
    <figure className="shot" data-size={props.frame.size ?? props.size}>
      <div className="shot-screen" ref={holder} style={{ height: box.height * box.scale, width: box.width * box.scale }}>
        {ready && (
          <iframe
            key={key}
            onLoad={() => {
              release()
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
