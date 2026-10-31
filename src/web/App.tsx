import { useEffect, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import { fixture } from './api.ts'
import { mach, short } from './format.ts'
import { Docs } from './Docs.tsx'
import { message, useConfig, useWallet } from './hooks.ts'
import { Home } from './Home.tsx'
import { New } from './New.tsx'
import { Link, navigate, usePath } from './router.tsx'
import { Swarm } from './Swarm.tsx'
import * as Wallet from './wallet.ts'

function WalletButton(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [error, setError] = useState<string>()
  if (wallet.address)
    return (
      <a className="btn btn-medium wallet" href={props.config ? `${props.config.explorer}/address/${wallet.address}` : undefined} rel="noreferrer" target="_blank" title="Your Tempo Wallet">
        <span>{short(wallet.address)}</span>
        {wallet.balance !== undefined && <span className="wallet-balance">{mach(decimal(wallet.balance))} MACH</span>}
      </a>
    )
  return (
    <button
      className="btn btn-medium wallet"
      disabled={!props.config}
      onClick={() => {
        if (props.config) Wallet.connect(props.config).then(() => setError(undefined), (reason: unknown) => setError(message(reason)))
      }}
      title={error ?? 'Connect Tempo Wallet'}
      type="button"
    >
      Connect
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
        <Link className={props.path === '/' ? 'game-nav game-nav-on' : 'game-nav'} to="/">World</Link>
        <Link className={props.path === '/new' ? 'game-nav game-nav-on' : 'game-nav'} to="/new">New quest</Link>
        {props.path.startsWith('/s/') && <WalletButton config={props.config} />}
      </div>
    </header>
  )
}

function Footer(props: { config: Config | undefined }) {
  return (
    <footer className="footer game-footer">
      <p>
        Open science. Powered by{' '}
        <a href={props.config?.gateway ?? 'https://gateway.tempo-dev.workers.dev'} rel="noreferrer" target="_blank">
          Tempo
        </a>
        .
      </p>
      <p>
        <Link to="/docs">For developers</Link>
      </p>
      {fixture && <p className="tag tag-on">Fixture data</p>}
    </footer>
  )
}

export function App() {
  const path = usePath()
  const config = useConfig()
  const swarm = /^\/s\/([^/]+)\/?$/.exec(path)?.[1]

  useEffect(() => {
    if (!swarm) document.title = path === '/new' ? 'Fund a new question · Swarms' : path === '/docs' ? 'API and MCP · Swarms' : 'Swarms · Fund breakthroughs'
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

  return (
    <div className="app">
      <Header config={config} path={path} />
      <main>
        {path === '/' ? (
          <Home />
        ) : path === '/new' ? (
          <New config={config} />
        ) : path === '/docs' ? (
          <Docs config={config} />
        ) : swarm ? (
          <Swarm config={config} id={decodeURIComponent(swarm)} key={swarm} />
        ) : (
          <section className="page missing">
            <h1 className="display">Nothing here</h1>
            <p className="lead">
              <Link to="/">See all swarms</Link>
            </p>
          </section>
        )}
      </main>
      <Footer config={config} />
    </div>
  )
}

