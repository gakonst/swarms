import { useEffect, useRef, useState } from 'react'

type Step = { click: string } | { scroll: string; to?: 'top' } | { type: [string, string] } | { wait: number }

type Frame = { name: string; note?: string; size?: 'card'; steps?: readonly Step[]; url: string }

type Flow = { frames: readonly Frame[]; id: string; title: string }

const swarm = (id: string, rest = '') => `/s/${id}?fixture${rest}`

const flows: readonly Flow[] = [
  {
    frames: [
      { name: 'Home', url: '/?fixture' },
      { name: 'Loading', url: '/?fixture&scene=wait' },
      { name: 'Nothing to join yet', url: '/?fixture&scene=empty' },
      { name: 'Offline', url: '/?fixture&scene=down' },
    ],
    id: 'home',
    title: 'Home',
  },
  {
    frames: [
      { name: 'Open swarms', url: '/join?fixture' },
      { name: 'Tapped open', note: 'tap again to go in', steps: [{ click: '.tiles-swarm li:nth-child(2) .tile-swarm' }], url: '/join?fixture' },
      { name: 'Running', url: '/join?fixture&filter=running' },
      { name: 'Resting', url: '/join?fixture&filter=resting' },
      { name: 'Not started', url: '/join?fixture&filter=waiting' },
      { name: 'Needs money', url: '/join?fixture&filter=money' },
      { name: 'A long list', url: '/join?fixture&scene=many' },
      { name: 'A long list, scrolled', note: 'scrolled', steps: [{ scroll: '.tiles-swarm' }], url: '/join?fixture&scene=many' },
      { name: 'Loading', url: '/join?fixture&scene=wait' },
      { name: 'No swarms yet', url: '/join?fixture&scene=empty' },
      { name: 'Offline', url: '/join?fixture&scene=down' },
    ],
    id: 'join',
    title: 'Be part of the future',
  },
  {
    frames: [
      { name: 'Ideas', url: '/new?fixture' },
      { name: 'Tapped open', note: 'brief is editable', steps: [{ click: '.ideas li:nth-child(1) .tile-swarm' }], url: '/new?fixture' },
      { name: 'Editing the brief', steps: [{ click: '.ideas li:nth-child(2) .tile-swarm' }, { type: ['.tile-edit textarea', 'Speed up one open-source scientific workload without losing accuracy.'] }], url: '/new?fixture' },
      { name: 'Your own idea', steps: [{ click: '.ideas li:last-child .tile-swarm' }, { type: ['#question', 'Can a 1B model beat GPT-4 at chess puzzles?'] }], url: '/new?fixture' },
      { name: 'More ideas', steps: [{ click: '.ideas li:nth-last-child(2) .tile-swarm' }], url: '/new?fixture' },
      { name: 'Ideas, scrolled', note: 'scrolled', steps: [{ scroll: 'page' }], url: '/new?fixture' },
      { name: 'Fund it, one time', url: '/new?fixture&q=pq-signatures' },
      { name: 'Signed out, launching', note: 'connects the wallet first', steps: [{ click: '.fuel-go' }], url: '/new?fixture&q=pq-signatures&scene=hang' },
      { name: 'Approve in Tempo Wallet', steps: [{ click: '.fuel-go' }], url: '/new?fixture&q=pq-signatures&scene=hang,in' },
      { name: 'Declined in the wallet', steps: [{ click: '.fuel-go' }, { wait: 1600 }], url: '/new?fixture&q=pq-signatures&scene=deny,in' },
      { name: 'Not enough money', steps: [{ click: '.fuel-go' }, { wait: 2600 }], url: '/new?fixture&q=pq-signatures&scene=broke,in' },
    ],
    id: 'start',
    title: 'Start a breakthrough',
  },
  {
    frames: [
      { name: 'Loading', url: swarm('bench-coders', '&scene=wait') },
      { name: 'Live', url: swarm('bench-coders') },
      { name: 'Just started', url: swarm('rust-book-el') },
      { name: 'Not started yet', url: swarm('speedrun-t4') },
      { name: 'Paused, out of money', url: swarm('dex-guide') },
      { name: 'Next step costs more than any backer', url: swarm('dex-guide', '&scene=costly') },
      { name: 'Resting after errors', url: swarm('dex-guide', '&scene=rest') },
      { name: 'Resting after a result', url: swarm('mev-map') },
      { name: 'Waking it with money', steps: [{ click: 'button.energy-fund' }], url: swarm('mev-map', '&scene=in') },
      { name: 'Not found', url: '/s/nope?fixture' },
      { name: 'Offline', url: swarm('bench-coders', '&scene=down') },
    ],
    id: 'swarm',
    title: 'A swarm',
  },
  {
    frames: [
      { name: 'Everyone', url: swarm('bench-coders') },
      { name: 'Only the agent', steps: [{ click: '.transcript-who button:nth-child(2)' }], url: swarm('bench-coders') },
      { name: 'Following an explorer', url: swarm('bench-coders', '&who=rust-subset') },
      { name: 'A command opened', steps: [{ wait: 600 }, { click: '.beat-step-row' }], url: swarm('bench-coders') },
      { name: 'A thought opened', steps: [{ wait: 600 }, { click: ".beat[data-kind='thinking'][data-more='true']" }], url: swarm('bench-coders') },
      { name: 'Scrolled back', note: 'scrolled', steps: [{ wait: 600 }, { scroll: '.timeline', to: 'top' }], url: swarm('bench-coders') },
      { name: 'Steers and money in the flow', note: 'bubbles and $ rows', url: swarm('bench-coders', '&scene=in') },
      { name: 'Nothing yet', url: swarm('speedrun-t4') },
    ],
    id: 'transcript',
    title: 'Transcript',
  },
  {
    frames: [
      { name: 'Signed out', note: 'composer signs in', url: swarm('bench-coders') },
      { name: 'Signing in', steps: [{ click: '.say-gate .room-cta-main' }], url: swarm('bench-coders', '&scene=hang') },
      { name: 'Backer, ready', url: swarm('bench-coders', '&scene=in') },
      { name: 'Typing, amount chips', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Picked $5', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }, { click: '.say-stake button:nth-child(3)' }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Your own amount', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }, { type: ['.say-own input', '12'] }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Not a backer yet', steps: [{ type: ['.say-box textarea', 'Add a Go subset'] }], url: swarm('json-terabyte', '&scene=in') },
      { name: 'Approving new money', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }, { click: '.say-send' }], url: swarm('bench-coders', '&scene=in,hang') },
      { name: 'Sending', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }, { click: '.say-send' }], url: swarm('bench-coders', '&scene=in,stall') },
      { name: 'Sent', note: 'bubble with its $ chip', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }, { click: '.say-send' }, { wait: 900 }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Declined', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }, { click: '.say-send' }, { wait: 1600 }], url: swarm('bench-coders', '&scene=in,deny') },
      { name: 'Could not send', steps: [{ type: ['.say-box textarea', 'Try a second pass at temperature 0'] }, { click: '.say-send' }, { wait: 1200 }], url: swarm('bench-coders', '&scene=in,mute') },
      { name: 'Paused, still steerable', url: swarm('dex-guide', '&scene=in') },
      { name: 'Resting, a note wakes it', url: swarm('mev-map', '&scene=in') },
    ],
    id: 'steer',
    title: 'Steer with @swarm',
  },
  {
    frames: [
      { name: 'Signed out', url: swarm('bench-coders', '#room') },
      { name: 'Signing in', steps: [{ click: '.room-gate .room-cta-main' }], url: swarm('bench-coders', '&scene=hang#room') },
      { name: 'Signed in, not a backer', url: swarm('json-terabyte', '&scene=in#room') },
      { name: 'Backer', note: 'presence in the tab', url: swarm('bench-coders', '&scene=in#room') },
      { name: 'Mentioning someone', steps: [{ type: ['.composer textarea', 'nice catch @'] }], url: swarm('bench-coders', '&scene=in#room') },
      { name: '@swarm from the room', note: 'drafts it in the transcript', steps: [{ type: ['.composer textarea', '@swarm try a second pass at temperature 0'] }, { click: '.room-send' }, { wait: 600 }], url: swarm('bench-coders', '&scene=in#room') },
      { name: 'Scrolled back', note: 'scrolled', steps: [{ wait: 600 }, { scroll: '.room-list', to: 'top' }], url: swarm('bench-coders', '&scene=in#room') },
      { name: 'Quiet room', url: swarm('rust-book-el', '#room') },
      { name: 'Resting after a result', url: swarm('mev-map', '&scene=in#room') },
    ],
    id: 'room',
    title: 'Room',
  },
  {
    frames: [
      { name: 'Copying from a $ chip', steps: [{ wait: 800 }, { click: 'button.said-backed' }], url: swarm('bench-coders', '&scene=in#room') },
    ],
    id: 'backed',
    title: 'Backed notes',
  },
  {
    frames: [
      { name: 'A branch', note: 'the transcript filtered to it, its budget and backers on top', url: swarm('bench-coders', '&scene=in&who=swe-bench-lite') },
      { name: 'Signed out, opened', steps: [{ wait: 600 }, { click: '.lane-row' }], url: swarm('bench-coders', '&who=rust-subset') },
      { name: 'Out of budget, funded again', steps: [{ wait: 600 }, { click: '.say-go' }, { wait: 1500 }], url: swarm('bench-coders', '&scene=in&who=latency-probe') },
      { name: 'Steering a branch', note: 'with new money', steps: [{ wait: 600 }, { type: ['.say-box textarea', 'Skip the tasks that need network access; every model fails them.'] }], url: swarm('bench-coders', '&scene=in&who=swe-bench-lite') },
      { name: 'Steered', note: 'budget raised', steps: [{ wait: 600 }, { type: ['.say-box textarea', 'Skip the tasks that need network access; every model fails them.'] }, { click: '.say-go' }, { wait: 3000 }], url: swarm('bench-coders', '&scene=in&who=swe-bench-lite') },
      { name: 'Stopped', note: 'unspent goes back', steps: [{ wait: 600 }, { click: '.say-go' }, { wait: 10000 }, { click: '.lane-row' }, { click: '.lane-stop' }, { wait: 5000 }], url: swarm('bench-coders', '&scene=in&who=swe-bench-lite') },
      { name: 'Finished, with its result', steps: [{ wait: 600 }, { click: '.lane-row' }, { click: '.lane-result summary' }], url: swarm('bench-coders', '&scene=in&who=license-check') },
      { name: 'A subagent under a branch', note: 'steering goes to its branch', steps: [{ wait: 600 }, { click: '.lane-row' }], url: swarm('bench-coders', '&scene=in&who=parser-tasks') },
      { name: 'Proposing a branch', steps: [{ wait: 600 }, { click: '.transcript-new' }], url: swarm('bench-coders', '&scene=in') },
    ],
    id: 'branches',
    title: 'Branches',
  },
  {
    frames: [
      { name: 'Signed out', note: 'desktop header', steps: [{ click: '.side-open' }], url: swarm('bench-coders', '') },
      { name: 'The agent', note: 'from the composer', steps: [{ click: '.say-side' }], url: swarm('bench-coders', '&scene=in') },
      { name: 'From /btw in the composer', note: 'prefilled', steps: [{ type: ['.say-box textarea', '/btw how close are we?'] }, { click: '.say-box .say-send' }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Answered', steps: [{ click: '.say-side' }, { type: ['.side-box textarea', 'How close are we to a leaderboard?'] }, { click: '.side-box .say-send' }, { wait: 2500 }], url: swarm('bench-coders', '&scene=in') },
      { name: 'A branch', note: 'from its filtered transcript', steps: [{ wait: 600 }, { click: '.say-side' }, { type: ['.side-box textarea', 'Which tasks fail on every model?'] }, { click: '.side-box .say-send' }, { wait: 2500 }], url: swarm('bench-coders', '&scene=in&who=swe-bench-lite') },
      { name: 'Asked for an artifact', steps: [{ click: '.say-side' }, { type: ['.side-box textarea', 'How close are we to a leaderboard?'] }, { click: '.side-box .say-send' }, { wait: 2500 }, { click: '.side-modes button:nth-child(2)' }, { click: '.side-send' }, { wait: 3000 }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Ready to /collapse', note: 'what it sends and costs', steps: [{ click: '.say-side' }, { type: ['.side-box textarea', 'How close are we to a leaderboard?'] }, { click: '.side-box .say-send' }, { wait: 2500 }, { type: ['.side-box textarea', '/collapse 1'] }, { click: '.side-box .say-send' }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Collapsed', note: 'money and the thread sent', steps: [{ click: '.say-side' }, { type: ['.side-box textarea', 'How close are we to a leaderboard?'] }, { click: '.side-box .say-send' }, { wait: 2500 }, { click: '.side-send' }, { wait: 3000 }], url: swarm('bench-coders', '&scene=in') },
      { name: '/collapse before asking', steps: [{ type: ['.say-box textarea', '/collapse'] }, { click: '.say-box .say-send' }], url: swarm('bench-coders', '&scene=in') },
    ],
    id: 'side',
    title: 'On the side',
  },
  {
    frames: [
      { name: 'From the head', note: 'card rises from below', steps: [{ click: 'button.energy-fund' }], url: swarm('bench-coders', '&scene=in') },
      { name: 'Behind a note', url: swarm('bench-coders', '&scene=in&fund&note=Try%20a%20second%20pass%20at%20temperature%200') },
      { name: 'Approve in Tempo Wallet', steps: [{ click: 'button.energy-fund' }, { click: '.fuel-go' }], url: swarm('dex-guide', '&scene=hang,in') },
      { name: 'Declined', steps: [{ click: 'button.energy-fund' }, { click: '.fuel-go' }, { wait: 1600 }], url: swarm('dex-guide', '&scene=deny,in') },
      { name: 'Not enough money', steps: [{ click: 'button.energy-fund' }, { click: '.fuel-go' }, { wait: 2600 }], url: swarm('dex-guide', '&scene=broke,in') },
      { name: 'Sent, not counted yet', note: 'the transfer left the wallet', steps: [{ click: 'button.energy-fund' }, { click: '.fuel-go' }, { wait: 2600 }], url: swarm('dex-guide', '&scene=uncounted,in') },
      { name: 'In MACH', note: 'a channel the gateway spends', steps: [{ click: 'button.energy-fund' }, { click: '.fuel-go' }, { wait: 3000 }], url: swarm('dex-guide', '&scene=in&token=mach') },
      { name: 'Counted on Record it', note: 'posts the same transaction again', steps: [{ click: 'button.energy-fund' }, { click: '.fuel-go' }, { wait: 2600 }, { click: '.alert-go' }, { wait: 1500 }], url: swarm('dex-guide', '&scene=uncounted,in') },
      { name: 'Funded, in the flow', note: 'shows as a $ row', steps: [{ click: 'button.energy-fund' }, { click: '.fuel-go' }, { wait: 3000 }], url: swarm('bench-coders', '&scene=in') },
    ],
    id: 'fund',
    title: 'Fund',
  },
  {
    frames: [
      { name: 'Machines', note: 'desktop tab', url: swarm('bench-coders', '#machines') },
      { name: 'A sandbox opened', note: 'config and commands', steps: [{ wait: 800 }, { click: '.machine-row' }, { click: '.run button' }], url: swarm('bench-coders', '#machines') },
      { name: 'A lent machine', note: 'price and payout', steps: [{ wait: 8000 }, { click: ".machine-glyph[data-kind='hand']" }], url: swarm('bench-coders', '#machines') },
      { name: 'No machines', url: swarm('speedrun-t4', '#machines') },
      { name: 'Code', note: 'tree, file, commits', url: swarm('mev-map', '#code') },
      { name: 'Code, no repository yet', url: swarm('bench-coders', '#code') },
      { name: 'About', url: swarm('bench-coders', '#about') },
    ],
    id: 'tabs',
    title: 'Machines, code and the rest',
  },
  {
    frames: [
      { name: 'Home: two doors', size: 'card', url: '/x?demo' },
      { name: 'Start: pick an idea', size: 'card', url: '/x?view=start' },
      { name: 'Start: idea picked', size: 'card', url: '/x?view=start&pick=1' },
      { name: 'Start: your own idea', size: 'card', steps: [{ type: ['#custom', 'Can a 1B model beat GPT-4 at chess puzzles?'] }], url: '/x?xframes-content&view=start' },
      { name: 'Join: open swarms', size: 'card', url: '/x?demo&view=join' },
      { name: 'Join: none yet', size: 'card', url: '/x?view=join' },
      { name: 'Swarm: transcript', size: 'card', url: '/x/s/0569016a538a?demo' },
      { name: 'Swarm: room', size: 'card', url: '/x/s/0569016a538a?demo&tab=chat' },
      { name: 'Swarm: steering with $', size: 'card', url: '/x/s/0569016a538a?demo&note=Rerun%20with%20cold%20caches' },
      { name: 'Swarm: fund', size: 'card', url: '/x/s/0569016a538a?demo&view=fund' },
      { name: 'Pay on the swarm page', size: 'card', url: '/x/s/0569016a538a?scene=wait&view=fund&go' },
      { name: 'Launching from home', size: 'card', url: '/x?scene=wait&view=start&pick=0&go' },
      { name: 'Not found', size: 'card', url: '/x/s/nope' },
      { name: 'Home, phone width', url: '/x' },
      { name: 'Swarm, phone width', url: '/x/s/0569016a538a?demo' },
    ],
    id: 'x',
    title: 'X cards',
  },
  {
    frames: [
      { name: 'About', url: '/about?fixture' },
      { name: 'For developers', url: '/docs?fixture' },
      { name: 'For developers, scrolled', note: 'scrolled', steps: [{ scroll: 'page' }], url: '/docs?fixture' },
      { name: 'Nothing here', url: '/nowhere?fixture' },
    ],
    id: 'edges',
    title: 'Other pages',
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
            src={props.frame.url}
            style={{ height: box.height, transform: `scale(${box.scale})`, width: box.width }}
            tabIndex={-1}
            title={props.frame.name}
          />
        )}
      </div>
      <figcaption>
        <span className="shot-index">{props.index}</span>
        <a href={props.frame.url} rel="noreferrer" target="_blank">{props.frame.name} ↗</a>
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
