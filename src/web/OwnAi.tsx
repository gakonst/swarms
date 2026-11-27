import { type FormEvent, useEffect, useState } from 'react'
import type { Config, Plan, OwnAi as Read, SignIn } from '../shared/Api.ts'
import * as Api from './api.ts'
import * as Attempt from './attempt.ts'
import { useAttempt, useWallet } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Link } from './router.tsx'
import * as Wallet from './wallet.ts'
import * as Limits from '../shared/Limits.ts'

const plans = [
  ['claude', 'Claude plan', 'Claude', 'Claude', 'Pro or Max, for swarms on Claude', 'Paste the code it shows'],
  ['codex', 'ChatGPT plan', 'ChatGPT', 'ChatGPT', 'Plus or Pro, for swarms on Codex', 'Paste the code it shows'],
  ['antigravity', 'Antigravity', 'Antigravity', 'Google', 'Gemini, gemini-4-neon by default', 'Paste the address it lands on'],
] as const

const providers = [
  ['anthropic', 'Anthropic', 'sk-ant-…'],
  ['openai', 'OpenAI', 'sk-…'],
] as const

export function OwnAi(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [read, setRead] = useState<Read>()
  const [attempt, run] = useAttempt()
  const [entry, enter] = useAttempt()
  const busy = Attempt.busy(attempt)
  const error = Attempt.error(attempt)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [link, setLink] = useState<SignIn & { plan: Plan }>()
  const [code, setCode] = useState('')
  const [gone, setGone] = useState(false)
  const address = wallet.address
  const offered = props.config?.ownAi !== false && !gone
  const unavailable = (reason: unknown): never => {
    if (reason instanceof Api.Failure && reason.status === Limits.Http.unavailable && reason.code === 'unavailable') setGone(true)
    throw reason
  }
  useEffect(() => {
    document.title = 'Your own AI · Swarms'
  }, [])
  useEffect(() => {
    if (address && offered) void run(() => Api.ownAi().catch(unavailable)).then((done) => done && setRead(done.value))
  }, [address, offered, run])
  const act = (work: () => Promise<Read | undefined>) => {
    void run(() => work().catch(unavailable)).then((done) => done?.value && setRead(done.value))
  }
  if (!offered)
    return (
      <Lost title="Your own AI is not available yet.">
        <Link className="lost-row" to="/ideas">Ride a swarm <span aria-hidden="true">→</span></Link>
      </Lost>
    )
  if (!address)
    return wallet.pending ? (
      <section aria-busy="true" className="page lost"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    ) : (
      <Lost title={Attempt.error(entry) ?? 'Sign in to use your own AI.'}>
        <button className="lost-row" onClick={() => { const config = props.config; if (config) void enter(() => Wallet.signIn(config)) }} type="button">Sign in <span aria-hidden="true">→</span></button>
      </Lost>
    )
  const add = (provider: (typeof providers)[number][0]) => (event: FormEvent) => {
    event.preventDefault()
    const key = typed[provider]?.trim()
    if (!key) return
    act(async () => {
      const next = await Api.ownKey(provider, key)
      setTyped((now) => ({ ...now, [provider]: '' }))
      return next
    })
  }
  const complete = (pending: SignIn & { plan: Plan }) => (event: FormEvent) => {
    event.preventDefault()
    if (!pending.code && !code.trim()) return
    act(async () => {
      const next = await Api.ownSignedIn(pending.plan, code.trim())
      setLink(undefined)
      setCode('')
      return next
    })
  }
  return (
    <div aria-busy={busy || !read || undefined} className="page rider own">
      <header className="rider-name">
        <h1>Your own AI</h1>
        <p className="rider-address">Run the swarms you ride on your subscription or your API keys: their model calls then cost the swarm nothing.</p>
      </header>
      {error && <p className="own-error" role="alert">{error}</p>}
      <section aria-labelledby="own-plan" className="rider-band">
        <h2 id="own-plan">Subscription</h2>
        <div className="rider-list">
          {plans.map(([plan, title, brand, page, meta, paste]) => {
            const state = read?.plans[plan]
            const connected = state?.state === 'authenticated'
            const soon = read && (!state || state.state === 'unavailable')
            const pending = link?.plan === plan && !connected ? link : state?.state === 'pending' && state.verification_url ? { code: state.user_code, plan, url: state.verification_url } : undefined
            return (
              <div className="own-plan" key={plan}>
                <div className="rider-row own-row">
                  <span className="rider-title">{title}</span>
                  <span className="rider-meta">{connected ? (state.email ? 'Connected as ' + state.email : 'Connected') : soon ? 'Coming soon' : meta}</span>
                  {connected ? (
                    <button className="btn btn-medium own-act" disabled={busy} onClick={() => act(() => Api.ownSignOut(plan))} type="button">Sign out</button>
                  ) : (
                    state && !soon && !pending && <button className="btn btn-medium own-act" disabled={busy || !read} onClick={() => act(async () => { setCode(''); setLink({ ...(await Api.ownSignIn(plan)), plan }); return undefined })} type="button">Connect your {brand}</button>
                  )}
                </div>
                {pending && (
                  <form className="own-form" onSubmit={complete(pending)}>
                    <a className="own-link" href={pending.url} rel="noopener noreferrer" target="_blank">Open the {page} sign-in page ↗</a>
                    {pending.code ? (
                      <span className="own-code">Enter <code>{pending.code}</code> there</span>
                    ) : (
                      <input aria-label={'Code from the ' + page + ' page'} autoComplete="off" className="own-input" onChange={(event) => setCode(event.target.value)} placeholder={paste} value={code} />
                    )}
                    <button className="btn btn-medium own-act" disabled={busy || (!pending.code && !code.trim())} type="submit">Finish</button>
                  </form>
                )}
              </div>
            )
          })}
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
                <button className="btn btn-medium own-act" disabled={busy} onClick={() => act(() => Api.ownDrop(provider))} type="button">Remove</button>
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
      <p className="rider-none">Keys are checked with the provider, kept encrypted by the Tempo gateway and never shown again. Pick Run on my own AI when you ride a swarm: one on Claude runs on your Claude plan or an Anthropic key, one on Codex on your ChatGPT plan or an OpenAI key. Antigravity runs Gemini, gemini-4-neon by default: after Google's sign-in, paste the address the page lands on.</p>
      <Link className="own-back" to="/ideas">Ride a swarm <span aria-hidden="true">→</span></Link>
    </div>
  )
}

export function Host(props: { config: Config | undefined; onChange: () => void; swarm: { ai?: { address: string } | null | undefined; id: string } }) {
  const wallet = useWallet()
  const [attempt, run] = useAttempt()
  const busy = Attempt.busy(attempt)
  const error = Attempt.error(attempt)
  if (!wallet.address || props.config?.ownAi === false) return null
  const mine = props.swarm.ai?.address.toLowerCase() === wallet.address.toLowerCase()
  const flip = () => {
    void run(() => Api.hostAi(props.swarm.id, !mine)).then((done) => done && props.onChange())
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
