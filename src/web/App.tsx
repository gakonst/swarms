import { Component, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Site from '../shared/Site.ts'
import { signed, usd } from './format.ts'
import { message, remember, remembered, useConfig, usePoll, useWallet } from './hooks.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Home, Join } from './Home.tsx'
import { Base, Link, navigate, usePath, warmer } from './router.tsx'
import { Lost } from './Lost.tsx'
import * as Names from './names.ts'
import { Cheered, ShareSwarm } from './Share.tsx'
import { page, preload } from './pages.ts'
import { problems } from './research.ts'
import * as Wallet from './wallet.ts'

const New = page('new', () => import('./New.tsx').then((module) => module.New))

const Docs = page('docs', () => import('./Docs.tsx').then((module) => module.Docs))

const Faq = page('faq', () => import('./Faq.tsx').then((module) => module.Faq))

const Swarm = page('swarm', () => import('./Swarm.tsx').then((module) => module.Swarm))

const TreePage = page('tree', () => import('./TreePage.tsx').then((module) => module.TreePage))

const fetching = new Map<string, number>()

function warmDetail(swarm: string) {
  if (remembered(swarm) !== undefined || Date.now() - (fetching.get(swarm) ?? 0) < 10_000) return
  fetching.set(swarm, Date.now())
  Api.swarm(swarm, false).then((detail) => remember(swarm, detail), () => fetching.delete(swarm))
}

function warmSwarm() {
  return Promise.all([import('./Swarm.tsx').then((module) => preload('swarm', module.Swarm)), import('./TreePage.tsx').then((module) => preload('tree', module.TreePage))])
}

if (typeof window !== 'undefined') {
  warmer((path) => {
    const route = path.replace(/[?#].*$/, '').replace(/\/$/, '')
    if (route === '/new') void import('./New.tsx').then((module) => preload('new', module.New))
    if (route === '/about') void import('./About.tsx').then((module) => preload('about', module.About))
    if (route === '/docs') void import('./Docs.tsx').then((module) => preload('docs', module.Docs))
    if (route === '/faq') void import('./Faq.tsx').then((module) => preload('faq', module.Faq))
    const id = /^\/s\/([^/?#]+)(?:\/chat|\/code|\/results|\/board|\/about|\/n\/[^/?#]+)?\/?(?:[?#]|$)/.exec(path)?.[1]
    const named = Nickname.parse(route)
    if (named) void warmSwarm().then(() => Names.warm(named.name)).then((found) => found && warmDetail(found.swarm), () => {})
    if (!id) return
    void warmSwarm()
    warmDetail(decodeURIComponent(id))
  })
  const idle = (window as { requestIdleCallback?: (run: () => void) => void }).requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
  idle(() => void warmSwarm())
}

const About = page('about', () => import('./About.tsx').then((module) => module.About))

const Board = lazy(() => import('./Board.tsx').then((module) => ({ default: module.Board })))

function profile(account: { name: string | null } | undefined, address: string) {
  return `/u/${account?.name ?? address}`
}

function WalletButton(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  const [funding, setFunding] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const token = wallet.session?.token
  const known = !!wallet.account
  const out = !wallet.address

  useEffect(() => {
    if (!props.config || !out) return
    const config = props.config
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const id = idle(() => Wallet.warm(config), { timeout: 1500 })
    return () => cancel(id)
  }, [props.config, out])

  useEffect(() => {
    if (token && !known) void Wallet.identify()
  }, [token, known])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    addEventListener('pointerdown', close)
    return () => removeEventListener('pointerdown', close)
  }, [open])

  const prime = () => {
    if (props.config) Wallet.prime(props.config)
  }

  const close = () => {
    setOpen(false)
    if (document.activeElement instanceof HTMLElement && menu.current?.contains(document.activeElement)) document.activeElement.blur()
  }

  const fund = () => {
    if (!props.config) return
    setFunding(true)
    Wallet.fund(props.config).then(
      () => setError(undefined),
      (reason: unknown) => setError(message(reason)),
    ).finally(() => setFunding(false))
  }

  if (wallet.address)
    return (
      <div className="wallet-menu" data-open={open} onPointerEnter={() => props.config && Wallet.primeFunds(props.config)} ref={menu}>
        <button aria-busy={wallet.pending || funding || undefined} aria-expanded={open} aria-haspopup="menu" className="btn btn-medium wallet" onClick={() => setOpen(!open)} title={error ?? (wallet.account ? `@${wallet.account.handle} · ${wallet.address}` : wallet.email ? `${wallet.email} · ${wallet.address}` : 'Your Tempo ID')} type="button">
          <span>{signed(wallet.account, wallet.address, wallet.email)}</span>
          {wallet.balance !== undefined && <span className="wallet-balance">{usd(decimal(wallet.balance))}</span>}
        </button>
        <div className="wallet-drop">
          <div className="wallet-list" onClick={close} role="menu">
            <button className="wallet-out" onClick={fund} role="menuitem" type="button">Add funds</button>
            <Link className="wallet-out" to={profile(wallet.account, wallet.address)}>Your profile</Link>
            <button className="wallet-out" onClick={() => Wallet.disconnect()} role="menuitem" type="button">Sign out</button>
          </div>
        </div>
      </div>
    )
  return (
    <button
      className="btn btn-medium wallet"
      onClick={() => {
        if (props.config) Wallet.signIn(props.config).then(() => setError(undefined), (reason: unknown) => setError(message(reason)))
      }}
      onFocus={prime}
      onPointerDown={prime}
      onPointerEnter={prime}
      title={error ?? 'Sign in with Tempo ID to post in rooms and see your balance'}
      type="button"
    >
      Sign in
    </button>
  )
}

function Header(props: { config: Config | undefined; free: boolean; path: string; swarm: string | undefined }) {
  const links = (
    <>
      <Link className={props.path === '/ideas' || props.path.startsWith('/s/') || (!props.free && Nickname.parse(props.path) !== undefined) ? 'game-nav game-nav-on' : 'game-nav'} to="/ideas">All swarms</Link>
      <Link className={(props.path === '/new' && !here().searchParams.has('q')) || props.free ? 'game-nav game-nav-on' : 'game-nav'} to="/new">Start a swarm</Link>
      <Link className={props.path === '/about' ? 'game-nav game-nav-on' : 'game-nav'} to="/about">Swarm riders</Link>
      <Link className={props.path === '/faq' ? 'game-nav game-nav-on' : 'game-nav'} to="/faq">FAQ</Link>
    </>
  )
  return (
    <header className="game-header">
      <nav className="header-nav">{links}</nav>
      <details className="header-menu" key={props.path}>
        <summary className="game-nav">Menu</summary>
        <nav>
          {links}
          <a className="game-nav" href={Site.essay}>Swarm riding, by Paradigm</a>
        </nav>
      </details>
      <p className="brand">
        <a aria-label="Paradigm" className="brand-mark" href={Site.paradigm}>
          <svg aria-hidden="true" viewBox="0 0 25 29"><path d="m9.249 28.39-1.632-.986v-2.516l-2.21 1.258-1.632-.952v-2.516l-2.142 1.224L0 22.916V5.236l1.53-.85 2.244 1.292V3.094l1.598-.884 2.244 1.292V.918L9.249 0l15.334 8.806v1.87l-2.21 1.292 2.21 1.258v1.904l-2.176 1.258 2.176 1.258v1.904zm-.068-1.87 13.838-7.888-2.278-1.292-11.56 6.63zm-3.774-2.244 2.21-1.258v-2.55l-2.21 1.258zm-3.808-2.21 2.176-1.258V7.548L1.599 6.29zm3.808-2.176 2.21-1.292v-8.84L5.407 8.5zm0-13.26 2.21 1.258v-2.55L5.407 4.08zM9.18 22.1l9.962-5.712-2.244-1.292L9.18 19.55zm0-4.386 6.12-3.536-6.12-3.536zm0-8.942 7.752 4.488 2.244-1.292L9.18 6.256zm0-4.386 11.594 6.664 2.244-1.292L9.18 1.836zm9.35 9.792 2.244 1.292 2.244-1.292-2.278-1.292z" fill="currentColor" /></svg>
        </a>
        <i aria-hidden="true">/</i>
        <Link className="wordmark" to="/">
          Swarms
        </Link>
      </p>
      <div className="header-end">
        <a className="game-nav header-essay" href={Site.essay}>Swarm riding, by Paradigm</a>
        {props.swarm && <ShareSwarm id={props.swarm} key={props.swarm} />}
        <WalletButton config={props.config} />
      </div>
    </header>
  )
}

class Caught extends Component<{ children: ReactNode; path: string }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidUpdate(previous: { path: string }) {
    if (this.state.failed && previous.path !== this.props.path) this.setState({ failed: false })
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <Lost title="This page did not load.">
        <button className="lost-row" onClick={() => location.reload()} type="button">Try again <span aria-hidden="true">↻</span></button>
        <Link className="lost-row" to="/ideas">All swarms <span aria-hidden="true">→</span></Link>
      </Lost>
    )
  }
}

function Busy() {
  return <section aria-busy="true" className="page lost"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
}

type Tab = 'chat' | 'board' | 'results' | 'code' | 'about'

function Picked(props: { base: string; config: Config | undefined; id: string; nid: string | undefined; tail: string; view: Tab }) {
  const [detail] = usePoll(() => Api.swarm(props.id, false), null, props.id)
  const data = detail.data
  const nickname = data?.nickname
  useEffect(() => {
    if (nickname === undefined) return
    const wanted = Nickname.path({ id: props.id, nickname })
    if (wanted === props.base) return
    if (nickname) Names.keep(nickname, { name: nickname, nickname, swarm: props.id })
    navigate(`${wanted}${props.tail}${location.search}`, { keep: true, replace: true })
  }, [nickname])
  const page = data?.form === 'tree' && !data.archivedAt ? <TreePage config={props.config} detail={data} id={props.id} nid={props.nid} view={props.view} /> : !data && !detail.error ? <Busy /> : props.nid && data ? <Lost title="This swarm has no tree."><Link className="lost-row" replace to={props.base}>Open it <span aria-hidden="true">→</span></Link></Lost> : <Swarm config={props.config} id={props.id} view={props.view} />
  return <Base value={props.base}>{page}</Base>
}

export function App() {
  const path = usePath()
  const config = useConfig()
  const matched = /^\/s\/([^/]+)((?:\/chat|\/code|\/results|\/board|\/about)|\/n\/([^/]+))?\/?$/.exec(path)
  const named = matched ? undefined : Nickname.parse(path)
  const found = Names.useNamed(named?.name)
  const swarm = matched?.[1] ? decodeURIComponent(matched[1]) : typeof found === 'object' && found ? found.swarm : undefined
  const tail = (matched ? matched[2] : named?.tail) ?? ''
  const node = /^\/n\/([^/]+)$/.exec(tail)?.[1]
  const view: Tab = node || tail === '/board' ? 'board' : tail === '/code' ? 'code' : tail === '/results' ? 'results' : tail === '/about' ? 'about' : 'chat'
  const free = !!named && found === null

  useEffect(() => {
    if (path === '/join') navigate(`/ideas${location.search}`, { replace: true })
  }, [path])

  useEffect(() => {
    if (free) {
      const problem = problems.find((each) => each.id === named?.name)
      document.title = `${problem ? problem.title : `Start a swarm on ${Nickname.topic(named?.name ?? '')}`} · Swarms`
    } else if (!swarm && !named && path !== '/board') document.title = path === '/new' ? 'Start a swarm · Swarms' : path === '/ideas' ? 'All swarms · Swarms' : path === '/about' ? 'Swarm riders · Swarms' : path === '/docs' ? 'API and MCP · Swarms' : path === '/faq' ? 'Questions · Swarms' : path === '/' ? 'Swarms · Make a breakthrough. Ride a swarm.' : 'Not found · Swarms'
  }, [path, swarm, free])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable]')) return
      if (event.key === 'n' || event.key === 'N') navigate('/new')
      if (event.key === 'd' || event.key === 'D') navigate('/docs')
    }
    addEventListener('keydown', listener)
    return () => removeEventListener('keydown', listener)
  }, [])

  if (path === '/board')
    return (
      <Suspense fallback={null}>
        <Board />
      </Suspense>
    )

  return (
    <div className="app">
      <Header config={config} free={free} path={path} swarm={swarm} />
      <Cheered />
      <main>
        <Caught path={path}>
        <Suspense fallback={<section aria-busy="true" className="page lost" />}>
        {path === '/' ? (
          <Home />
        ) : path === '/ideas' || path === '/join' ? (
          <Join />
        ) : path === '/new' ? (
          <New config={config} />
        ) : path === '/about' ? (
          <About />
        ) : path === '/docs' ? (
          <Docs config={config} />
        ) : path === '/faq' ? (
          <Faq />
        ) : swarm ? (
          <Picked base={named ? `/${named.name}` : `/s/${encodeURIComponent(swarm)}`} config={config} id={swarm} key={swarm} nid={node && decodeURIComponent(node)} tail={tail} view={view} />
        ) : named && found === undefined ? (
          <Busy />
        ) : free && !tail ? (
          <New config={config} key={named.name} name={named.name} />
        ) : named && found === 'failed' ? (
          <Lost title="This page did not load.">
            <button className="lost-row" onClick={() => location.reload()} type="button">Try again <span aria-hidden="true">↻</span></button>
          </Lost>
        ) : (
          <Lost title="Nothing out here.">
            <Link className="lost-row" to="/join">All swarms <span aria-hidden="true">→</span></Link>
            <Link className="lost-row" to="/new">Start a swarm <span aria-hidden="true">→</span></Link>
          </Lost>
        )}
        </Suspense>
        </Caught>
      </main>
    </div>
  )
}
