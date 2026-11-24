import { type FormEvent, useEffect, useState } from 'react'
import type { Config, OwnAi as Read } from '../shared/Api.ts'
import * as Api from './api.ts'
import { message, useWallet } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Link } from './router.tsx'
import * as Wallet from './wallet.ts'

const providers = [
  ['anthropic', 'Anthropic', 'sk-ant-…'],
  ['openai', 'OpenAI', 'sk-…'],
] as const

export function OwnAi(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [read, setRead] = useState<Read>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [link, setLink] = useState<string>()
  const [code, setCode] = useState('')
  const address = wallet.address
  useEffect(() => {
    document.title = 'Your own AI · Swarms'
  }, [])
  useEffect(() => {
    if (address) Api.ownAi().then(setRead, (reason: unknown) => setError(message(reason)))
  }, [address])
  const run = (work: () => Promise<Read | undefined>) => {
    setBusy(true)
    setError(undefined)
    work()
      .then((next) => next && setRead(next), (reason: unknown) => setError(message(reason)))
      .finally(() => setBusy(false))
  }
  if (!address)
    return wallet.pending ? (
      <section aria-busy="true" className="page lost"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    ) : (
      <Lost title={error ?? 'Sign in to use your own AI.'}>
        <button className="lost-row" onClick={() => props.config && Wallet.signIn(props.config).catch((reason: unknown) => setError(message(reason)))} type="button">Sign in <span aria-hidden="true">→</span></button>
      </Lost>
    )
  const plan = read?.plans.claude.state
  const add = (provider: (typeof providers)[number][0]) => (event: FormEvent) => {
    event.preventDefault()
    const key = typed[provider]?.trim()
    if (!key) return
    run(async () => {
      const next = await Api.ownKey(provider, key)
      setTyped((now) => ({ ...now, [provider]: '' }))
      return next
    })
  }
  const complete = (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim()) return
    run(async () => {
      const next = await Api.ownSignedIn(code.trim())
      setLink(undefined)
      setCode('')
      return next
    })
  }
  return (
    <div aria-busy={busy || !read || undefined} className="page rider own">
      <header className="rider-name">
        <h1>Your own AI</h1>
        <p className="rider-address">Run the swarms you ride on your Claude plan or your API keys: their model calls then cost the swarm nothing.</p>
      </header>
      {error && <p className="own-error" role="alert">{error}</p>}
      <section aria-labelledby="own-plan" className="rider-band">
        <h2 id="own-plan">Subscription</h2>
        <div className="rider-list">
          <div className="rider-row own-row">
            <span className="rider-title">Claude plan</span>
            <span className="rider-meta">{plan === 'authenticated' ? 'Connected' : 'Pro or Max, for swarms on Claude'}</span>
            {plan === 'authenticated' ? (
              <button className="btn btn-medium own-act" disabled={busy} onClick={() => run(Api.ownSignOut)} type="button">Disconnect</button>
            ) : (
              !link && <button className="btn btn-medium own-act" disabled={busy || !read} onClick={() => run(async () => { setLink((await Api.ownSignIn()).url); return undefined })} type="button">Connect</button>
            )}
          </div>
          {link && plan !== 'authenticated' && (
            <form className="own-form" onSubmit={complete}>
              <a className="own-link" href={link} rel="noopener noreferrer" target="_blank">Open the Claude sign-in page ↗</a>
              <input aria-label="Code from the Claude page" autoComplete="off" className="own-input" onChange={(event) => setCode(event.target.value)} placeholder="Paste the code it shows" value={code} />
              <button className="btn btn-medium own-act" disabled={busy || !code.trim()} type="submit">Finish</button>
            </form>
          )}
        </div>
      </section>
      <section aria-labelledby="own-keys" className="rider-band">
        <h2 id="own-keys">API keys</h2>
        <div className="rider-list">
          {providers.map(([provider, name, hint]) => {
            const kept = read?.keys.find((key) => key.provider === provider)
            return kept ? (
              <div className="rider-row own-row" key={provider}>
                <span className="rider-title">{name}</span>
                <span className="rider-meta">••••{kept.hint}</span>
                <button className="btn btn-medium own-act" disabled={busy} onClick={() => run(() => Api.ownDrop(provider))} type="button">Remove</button>
              </div>
            ) : (
              <form className="rider-row own-row" key={provider} onSubmit={add(provider)}>
                <span className="rider-title">{name}</span>
                <input aria-label={name + ' API key'} autoComplete="off" className="own-input" onChange={(event) => setTyped((now) => ({ ...now, [provider]: event.target.value }))} placeholder={hint} type="password" value={typed[provider] ?? ''} />
                <button className="btn btn-medium own-act" disabled={busy || !read || !typed[provider]?.trim()} type="submit">Add</button>
              </form>
            )
          })}
        </div>
      </section>
      <p className="rider-none">Keys are checked with the provider, kept encrypted by the Tempo gateway and never shown again. Pick Run on my own AI when you ride a swarm: one on Claude needs the plan or an Anthropic key, one on Codex an OpenAI key.</p>
    </div>
  )
}

export function Host(props: { onChange: () => void; swarm: { ai?: { address: string } | null | undefined; id: string } }) {
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  if (!wallet.address) return null
  const mine = props.swarm.ai?.address.toLowerCase() === wallet.address.toLowerCase()
  const flip = () => {
    setBusy(true)
    setError(undefined)
    Api.hostAi(props.swarm.id, !mine)
      .then(props.onChange, (reason: unknown) => setError(message(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="own-host">
      <label className="own-toggle">
        <input checked={mine} disabled={busy} onChange={flip} type="checkbox" />
        <span>Run on my own AI <span className="own-free">no inference cost</span></span>
      </label>
      {error && <p className="own-error" role="alert">{error} {/own AI/.test(error) && <Link to="/me/ai">Use your own AI →</Link>}</p>}
    </div>
  )
}
