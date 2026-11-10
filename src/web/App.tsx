import { Component, lazy, type MouseEvent, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import * as Site from '../shared/Site.ts'
import { signed, usd } from './format.ts'
import { message, remember, remembered, useConfig, useWallet } from './hooks.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Home, Join } from './Home.tsx'
import { Link, navigate, usePath, warmer } from './router.tsx'
import { Lost } from './Lost.tsx'
import { page, preload } from './pages.ts'
import * as Wallet from './wallet.ts'

const New = page('new', () => import('./New.tsx').then((module) => module.New))

const Docs = page('docs', () => import('./Docs.tsx').then((module) => module.Docs))

const Swarm = page('swarm', () => import('./Swarm.tsx').then((module) => module.Swarm))

const fetching = new Map<string, number>()

function warmSwarm() {
  return import('./Swarm.tsx').then((module) => preload('swarm', module.Swarm))
}

if (typeof window !== 'undefined') {
  warmer((path) => {
    const route = path.replace(/[?#].*$/, '').replace(/\/$/, '')
    if (route === '/new') void import('./New.tsx').then((module) => preload('new', module.New))
    if (route === '/about') void import('./About.tsx').then((module) => preload('about', module.About))
    if (route === '/docs') void import('./Docs.tsx').then((module) => preload('docs', module.Docs))
    const id = /^\/s\/([^/?#]+)(?:\/chat|\/code|\/results)?\/?(?:[?#]|$)/.exec(path)?.[1]
    if (!id) return
    void warmSwarm()
    const swarm = decodeURIComponent(id)
    if (remembered(swarm) !== undefined || Date.now() - (fetching.get(swarm) ?? 0) < 10_000) return
    fetching.set(swarm, Date.now())
    Api.swarm(swarm, false).then((detail) => remember(swarm, detail), () => fetching.delete(swarm))
  })
  const idle = (window as { requestIdleCallback?: (run: () => void) => void }).requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
  idle(() => void warmSwarm())
}

const About = page('about', () => import('./About.tsx').then((module) => module.About))

const Board = lazy(() => import('./Board.tsx').then((module) => ({ default: module.Board })))

function WalletButton(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const token = wallet.session?.token
  const known = !!wallet.account

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

  const tap = (event: MouseEvent<HTMLAnchorElement>) => {
    if (open || !matchMedia('(hover: none)').matches) return event.currentTarget.blur()
    event.preventDefault()
    setOpen(true)
  }

  if (wallet.address)
    return (
      <div className="wallet-menu" data-open={open} ref={menu}>
        {wallet.pending ? (
          <span aria-busy="true" className="btn btn-medium wallet" onClick={() => setOpen(!open)}>
            <span>{signed(wallet.account, wallet.address)}</span>
            {wallet.balance !== undefined && <span className="wallet-balance">{usd(decimal(wallet.balance))}</span>}
          </span>
        ) : (
          <a className="btn btn-medium wallet" href={props.config ? `${props.config.explorer}/address/${wallet.address}` : undefined} onClick={tap} rel="noreferrer" target="_blank" title={wallet.account ? `@${wallet.account.handle} · ${wallet.address}` : 'Your Tempo Wallet'}>
            <span>{signed(wallet.account, wallet.address)}</span>
            {wallet.balance !== undefined && <span className="wallet-balance">{usd(decimal(wallet.balance))}</span>}
          </a>
        )}
        <div className="wallet-drop">
          <button
            className="wallet-out"
            onClick={() => {
              setOpen(false)
              void Wallet.disconnect()
            }}
            type="button"
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  return (
    <button
      className="btn btn-medium wallet"
      onClick={() => {
        if (props.config) Wallet.signIn(props.config).then(() => setError(undefined), (reason: unknown) => setError(message(reason)))
      }}
      title={error ?? 'Sign in with Tempo Wallet to post in rooms and see your balance'}
      type="button"
    >
      Sign in
    </button>
  )
}

function Header(props: { config: Config | undefined; path: string }) {
  return (
    <header className="game-header">
      <nav className="header-nav">
        <Link className={props.path === '/ideas' || props.path.startsWith('/s/') ? 'game-nav game-nav-on' : 'game-nav'} to="/ideas">All<span className="nav-long"> swarms</span></Link>
        <Link className={props.path === '/new' && !here().searchParams.has('q') ? 'game-nav game-nav-on' : 'game-nav'} to="/new">Start<span className="nav-long"> a swarm</span></Link>
        <Link className={props.path === '/about' ? 'game-nav game-nav-on' : 'game-nav'} to="/about">Swarm riders</Link>
      </nav>
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

export function App() {
  const path = usePath()
  const config = useConfig()
  const matched = /^\/s\/([^/]+)(\/chat|\/code|\/results)?\/?$/.exec(path)
  const swarm = matched?.[1]
  const view = matched?.[2] === '/chat' ? 'chat' : matched?.[2] === '/code' ? 'code' : matched?.[2] === '/results' ? 'results' : 'now'

  useEffect(() => {
    if (path === '/join') navigate(`/ideas${location.search}`, { replace: true })
  }, [path])

  useEffect(() => {
    if (!swarm && path !== '/board') document.title = path === '/new' ? 'Start a swarm · Swarms' : path === '/ideas' ? 'All swarms · Swarms' : path === '/about' ? 'Swarm riders · Swarms' : path === '/docs' ? 'API and MCP · Swarms' : path === '/' ? 'Swarms · Make a breakthrough. Ride a swarm.' : 'Not found · Swarms'
  }, [path, swarm])

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
    <div className="app" data-chat={view === 'chat' || undefined}>
      <Header config={config} path={path} />
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
        ) : swarm ? (
          <Swarm config={config} id={decodeURIComponent(swarm)} key={swarm} view={view} />
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
