import { lazy, Suspense, useEffect, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import { mach, short } from './format.ts'
import { message, remember, remembered, useConfig, useWallet } from './hooks.ts'
import * as Api from './api.ts'
import { Home, Join } from './Home.tsx'
import { Link, navigate, usePath, warmer } from './router.tsx'
import { Lost } from './Lost.tsx'
import { page, preload } from './pages.tsx'
import * as Wallet from './wallet.ts'

const Repo = page('repo', () => import('./Repo.tsx').then((module) => module.Repo))

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
    const browsed = /^\/s\/([^/?#]+)\/code\/?(?:[?#]|$)/.exec(path)?.[1]
    if (browsed) {
      void import('./Repo.tsx').then((module) => preload('repo', module.Repo))
      void Api.code(decodeURIComponent(browsed)).catch(() => undefined)
    }
    const id = /^\/s\/([^/?#]+)\/?(?:[?#]|$)/.exec(path)?.[1]
    if (!id) return
    void warmSwarm()
    const swarm = decodeURIComponent(id)
    if (remembered(swarm) !== undefined || Date.now() - (fetching.get(swarm) ?? 0) < 10_000) return
    fetching.set(swarm, Date.now())
    Api.swarm(swarm).then((detail) => remember(swarm, detail), () => fetching.delete(swarm))
  })
  const idle = (window as { requestIdleCallback?: (run: () => void) => void }).requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
  idle(() => void warmSwarm())
}

const About = page('about', () => import('./About.tsx').then((module) => module.About))

const Board = lazy(() => import('./Board.tsx').then((module) => ({ default: module.Board })))

function WalletButton(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [error, setError] = useState<string>()
  const token = wallet.session?.token
  const known = !!wallet.account

  useEffect(() => {
    if (token && !known) void Wallet.identify()
  }, [token, known])

  if (wallet.address && wallet.pending)
    return (
      <span aria-busy="true" className="btn btn-medium wallet">
        <span>{wallet.account ? '@' + wallet.account.handle : short(wallet.address)}</span>
        {wallet.balance !== undefined && <span className="wallet-balance">{mach(decimal(wallet.balance))} MACH</span>}
      </span>
    )
  if (wallet.address)
    return (
      <a className="btn btn-medium wallet" href={props.config ? `${props.config.explorer}/address/${wallet.address}` : undefined} rel="noreferrer" target="_blank" title={wallet.account ? `@${wallet.account.handle} · ${wallet.address}` : 'Your Tempo Wallet'}>
        <span>{wallet.account?.name ? `@${wallet.account.name}` : short(wallet.address)}</span>
        {wallet.balance !== undefined && <span className="wallet-balance">{mach(decimal(wallet.balance))} MACH</span>}
      </a>
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
    <header className="header game-header">
      <p className="brand">
        <Link className="wordmark" to="/">
          Swarms
        </Link>
      </p>
      <div className="header-end">
        <Link className={props.path === '/about' ? 'game-nav game-nav-on' : 'game-nav'} to="/about">About</Link>
        <Link className={props.path === '/new' ? 'game-nav game-nav-on' : 'game-nav'} to="/new">Start<span className="nav-long"> a swarm</span></Link>
        <Link className={props.path === '/join' || props.path.startsWith('/s/') ? 'game-nav game-nav-on' : 'game-nav'} to="/join">Join<span className="nav-long"> a swarm</span></Link>
        <WalletButton config={props.config} />
      </div>
    </header>
  )
}

export function App() {
  const path = usePath()
  const config = useConfig()
  const swarm = /^\/s\/([^/]+)\/?$/.exec(path)?.[1]
  const code = /^\/s\/([^/]+)\/code\/?$/.exec(path)?.[1]

  useEffect(() => {
    if (!swarm && !code && path !== '/board') document.title = path === '/new' ? 'Start a breakthrough · Swarms' : path === '/join' ? 'Be part of the future · Swarms' : path === '/about' ? 'About · Swarms' : path === '/docs' ? 'API and MCP · Swarms' : path === '/' ? 'Swarms · Fund breakthroughs' : 'Not found · Swarms'
  }, [path, swarm, code])

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
      <Header config={config} path={path} />
      <main>
        <Suspense fallback={<section aria-busy="true" className="page lost" />}>
        {path === '/' ? (
          <Home />
        ) : path === '/join' ? (
          <Join />
        ) : path === '/new' ? (
          <New config={config} />
        ) : path === '/about' ? (
          <About />
        ) : path === '/docs' ? (
          <Docs config={config} />
        ) : code ? (
          <Suspense fallback={<section className="page"><p className="empty">Loading the code browser…</p></section>}>
            <Repo config={config} id={decodeURIComponent(code)} key={code} />
          </Suspense>
        ) : swarm ? (
          <Swarm config={config} id={decodeURIComponent(swarm)} key={swarm} />
        ) : (
          <Lost title="Nothing out here.">
            <Link className="lost-row" to="/new">Start a swarm <span aria-hidden="true">→</span></Link>
            <Link className="lost-row" to="/join">Join a swarm <span aria-hidden="true">→</span></Link>
          </Lost>
        )}
        </Suspense>
      </main>
    </div>
  )
}
