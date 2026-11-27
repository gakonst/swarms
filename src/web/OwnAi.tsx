import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { Config, Plan, OwnAi as Read } from '../shared/Api.ts'
import * as Api from './api.ts'
import * as Attempt from './attempt.ts'
import { useAttempt, useWallet } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Link } from './router.tsx'
import * as Wallet from './wallet.ts'
import * as Limits from '../shared/Limits.ts'

const plans = [
  ['claude', 'Claude plan', 'Claude', 'Pro or Max, for swarms on Claude', 'Paste the code Claude shows'],
  ['codex', 'ChatGPT plan', 'ChatGPT', 'Plus or Pro, for swarms on Codex', ''],
  ['antigravity', 'Antigravity', 'Antigravity', 'Gemini, gemini-4-neon by default', 'Paste the address Google lands on'],
] as const

const providers = [
  ['anthropic', 'Anthropic', 'sk-ant-…'],
  ['openai', 'OpenAI', 'sk-…'],
] as const

type Flow = { blocked: boolean; code?: string | undefined; copied: boolean; expired: boolean; plan: Plan; poll: number; until: number; url: string }

const features = `popup,width=${Limits.OwnAiFlow.popupWidth},height=${Limits.OwnAiFlow.popupHeight}`

function pasted(plan: Plan, text: string) {
  const value = text.trim()
  if (plan === 'claude') return /^[^\s#]+#[^\s#]+$/.test(value)
  if (plan === 'antigravity') {
    if (/^4\/\S+$/.test(value)) return true
    try {
      return !!new URL(value).searchParams.get('code')
    } catch {
      return false
    }
  }
  return false
}

function coded(url: string, code: string) {
  const next = new URL(url)
  next.searchParams.set('user_code', code)
  return next.href
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function clipboard() {
  try {
    const allowed = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })
    return allowed.state === 'granted' ? await navigator.clipboard.readText() : undefined
  } catch {
    return undefined
  }
}

export function OwnAi(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [read, setRead] = useState<Read>()
  const [attempt, run] = useAttempt()
  const [entry, enter] = useAttempt()
  const busy = Attempt.busy(attempt)
  const error = Attempt.error(attempt)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [flow, setFlow] = useState<Flow>()
  const [code, setCode] = useState('')
  const [gone, setGone] = useState(false)
  const popups = useRef(new Map<Plan, Window>())
  const sent = useRef('')
  const address = wallet.address
  const offered = props.config?.ownAi !== false && !gone
  const unavailable = (reason: unknown): never => {
    if (reason instanceof Api.Failure && reason.status === Limits.Http.unavailable && reason.code === 'unavailable') setGone(true)
    throw reason
  }
  const shut = (plan: Plan) => {
    popups.current.get(plan)?.close()
    popups.current.delete(plan)
  }
  useEffect(() => {
    document.title = 'Your own AI · Swarms'
  }, [])
  useEffect(() => {
    if (address && offered) void run(() => Api.ownAi().catch(unavailable)).then((done) => done && setRead(done.value))
  }, [address, offered, run])
  useEffect(() => {
    if (!flow || flow.plan !== 'codex' || flow.expired) return
    let live = true
    let gap = flow.poll
    let timer = 0
    const tick = async () => {
      if (!live) return
      if (Date.now() >= flow.until) {
        shut('codex')
        setFlow({ ...flow, expired: true })
        return
      }
      const next = await Api.ownAi().catch(() => undefined)
      if (!live) return
      if (next?.plans.codex?.state === 'authenticated') {
        shut('codex')
        setRead(next)
        setFlow(undefined)
        return
      }
      gap = Math.min(gap * Limits.OwnAiFlow.pollBackoff, Limits.OwnAiFlow.pollCeilingMs)
      timer = window.setTimeout(() => void tick(), Math.max(0, Math.min(gap, flow.until - Date.now(), Limits.OwnAiFlow.pollCeilingMs)))
    }
    timer = window.setTimeout(() => void tick(), Math.min(gap, Limits.OwnAiFlow.pollCeilingMs))
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [flow])
  const act = (work: () => Promise<Read | undefined>) => {
    void run(() => work().catch(unavailable)).then((done) => done?.value && setRead(done.value))
  }
  const finish = (plan: Plan, text: string) => {
    const value = text.trim()
    if (!pasted(plan, value) || sent.current === plan + value) return
    sent.current = plan + value
    act(async () => {
      const next = await Api.ownSignedIn(plan, value)
      shut(plan)
      setFlow(undefined)
      setCode('')
      return next
    })
  }
  useEffect(() => {
    if (!flow || flow.plan === 'codex') return
    const plan = flow.plan
    const back = () => void clipboard().then((text) => text && finish(plan, text))
    window.addEventListener('focus', back)
    return () => window.removeEventListener('focus', back)
  })
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
  const connect = (plan: Plan) => {
    const popup = window.open('', 'plan-' + plan, features)
    shut(plan)
    if (popup) popups.current.set(plan, popup)
    sent.current = ''
    setCode('')
    setFlow(undefined)
    act(async () => {
      try {
        const started = await Api.ownSignIn(plan)
        const url = started.code ? coded(started.url, started.code) : started.url
        if (popup && !popup.closed) popup.location.href = url
        const copied = started.code ? await copy(started.code) : false
        setFlow({ blocked: !popup, code: started.code, copied, expired: false, plan, poll: started.poll_after_ms ?? Limits.OwnAiFlow.pollMs, until: started.expires_at ?? Date.now() + Limits.OwnAiFlow.signInMs, url })
        return undefined
      } catch (reason) {
        shut(plan)
        throw reason
      }
    })
  }
  const reopen = (open: Flow) => {
    const popup = window.open(open.url, 'plan-' + open.plan, features)
    if (popup) popups.current.set(open.plan, popup)
    if (open.code) void copy(open.code)
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
          {plans.map(([plan, title, brand, meta, paste]) => {
            const state = read?.plans[plan]
            const connected = state?.state === 'authenticated'
            const soon = !!read && (!state || state.state === 'unavailable')
            const open = flow?.plan === plan && !connected ? flow : undefined
            const status = connected ? (state.email ? `Connected as ${state.email} ✓` : 'Connected ✓') : soon ? 'Coming soon' : undefined
            return (
              <div className="own-plan" key={plan}>
                <div className="rider-row own-row">
                  <span className="rider-title">{title}</span>
                  <span className="rider-meta own-stack">
                    <span className={status ? 'own-ghost' : undefined}>{meta}</span>
                    <span className={status ? undefined : 'own-ghost'}>{status ?? 'Connected ✓'}</span>
                  </span>
                  {open?.plan === 'codex' && open.expired ? (
                    <button className="btn btn-medium own-act" disabled={busy} onClick={() => connect(plan)} type="button">Didn't finish. Try again</button>
                  ) : open?.plan === 'codex' && open.code ? (
                    <button className="btn btn-medium own-act own-waiting" onClick={() => reopen(open)} title={'Open the ChatGPT sign-in page again'} type="button">
                      <span aria-live="polite">Code <code>{open.code}</code> {open.copied ? 'copied' : 'to enter'}</span>
                    </button>
                  ) : (
                    <button aria-hidden={soon || undefined} className={'btn btn-medium own-act own-stack' + (read ? '' : ' own-wait') + (soon ? ' own-ghost' : '')} disabled={busy || !read || soon} onClick={() => (connected ? act(() => Api.ownSignOut(plan)) : connect(plan))} tabIndex={soon ? -1 : undefined} type="button">
                      <span className={connected ? 'own-ghost' : undefined}>Connect your {brand}</span>
                      <span className={connected ? undefined : 'own-ghost'}>Sign out</span>
                    </button>
                  )}
                </div>
                {open && plan !== 'codex' && (
                  <div className="own-form own-paste">
                    {open.blocked && <a className="own-link" href={open.url} rel="noopener noreferrer" target="_blank">Open the {plan === 'antigravity' ? 'Google' : brand} sign-in page ↗</a>}
                    <input
                      aria-label={paste}
                      autoComplete="off"
                      autoFocus
                      className="own-input"
                      onChange={(event) => {
                        setCode(event.target.value)
                        finish(plan, event.target.value)
                      }}
                      placeholder={paste}
                      value={code}
                    />
                  </div>
                )}
                {open?.plan === 'codex' && open.blocked && !open.expired && <a className="own-link own-blocked" href={open.url} rel="noopener noreferrer" target="_blank">Open the ChatGPT sign-in page ↗</a>}
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
              <div className="rider-row own-row own-key" key={provider}>
                <span className="rider-title">{name}</span>
                <span className="rider-meta own-kept">••••{kept.hint}</span>
                <button className="btn btn-medium own-act" disabled={busy} onClick={() => act(() => Api.ownDrop(provider))} type="button">Remove</button>
              </div>
            ) : (
              <form className="rider-row own-row own-key" key={provider} onSubmit={add(provider)}>
                <span className="rider-title">{name}</span>
                <input aria-label={name + ' API key'} autoComplete="off" className="own-input" onChange={(event) => setTyped((now) => ({ ...now, [provider]: event.target.value }))} placeholder={hint} type="password" value={typed[provider] ?? ''} />
                <button className="btn btn-medium own-act" disabled={busy || !read || !typed[provider]?.trim()} type="submit">Add</button>
              </form>
            )
          })}
        </div>
      </section>
      <p className="rider-none">Keys are checked with the provider, kept encrypted by the Tempo gateway and never shown again. Pick Run on my own AI when you ride a swarm: one on Claude runs on your Claude plan or an Anthropic key, one on Codex on your ChatGPT plan or an OpenAI key. Antigravity runs Gemini, gemini-4-neon by default.</p>
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
