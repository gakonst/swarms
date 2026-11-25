import { useEffect, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import * as Site from '../shared/Site.ts'
import * as Attempt from './attempt.ts'
import { useAttempt, useWallet } from './hooks.ts'
import { Lost } from './Lost.tsx'
import * as Wallet from './wallet.ts'

type Asked = { client_name: string; redirect_host: string; scopes: { meaning: string; scope: string }[] }

type Refused = { error_description: string }

const busy = <section aria-busy="true" className="page lost"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>

export function Authorize(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [asked, setAsked] = useState<Asked | Refused>()
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [entry, enter] = useAttempt()
  const [sent, send] = useAttempt()
  useEffect(() => {
    document.title = 'Connect an app · Swarms'
    void fetch(Site.at('/oauth/request') + location.search, { headers: { accept: 'application/json' } })
      .then((response) => response.json() as Promise<Asked | Refused>)
      .then(
        (value) => {
          setAsked(value)
          if ('scopes' in value) setGranted(new Set(value.scopes.map((each) => each.scope)))
        },
        () => setAsked({ error_description: 'Swarms did not answer. Try again.' }),
      )
  }, [])
  if (!asked) return busy
  if (!('scopes' in asked))
    return (
      <Lost title={asked.error_description}>
        <a className="lost-row" href={Site.at('/docs#mcp')}>Connecting an app <span aria-hidden="true">→</span></a>
      </Lost>
    )
  const token = wallet.session?.token
  if (!wallet.address || !token)
    return wallet.pending ? busy : (
      <Lost title={Attempt.error(entry) ?? `Sign in to connect ${asked.client_name}.`}>
        <button className="lost-row" onClick={() => { const config = props.config; if (config) void enter(() => Wallet.signIn(config)) }} type="button">Sign in with Tempo ID <span aria-hidden="true">→</span></button>
      </Lost>
    )
  const answer = (allow: boolean) =>
    void send(async () => {
      const params = Object.fromEntries(new URLSearchParams(location.search))
      const response = await fetch(Site.at('/oauth/approve'), { body: JSON.stringify({ ...params, allow, granted: [...granted].join(' ') }), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, method: 'POST' })
      const value = (await response.json().catch(() => ({}))) as { error_description?: string; redirect?: string }
      if (!response.ok || !value.redirect) throw new Error(value.error_description ?? 'Swarms did not connect the app.')
      location.assign(value.redirect)
      return value.redirect
    })
  const toggle = (scope: string) => setGranted((now) => {
    const next = new Set(now)
    if (next.has(scope)) next.delete(scope)
    else next.add(scope)
    return next
  })
  return (
    <section className="page lost">
      <h1>Connect {asked.client_name}</h1>
      <p>It acts as you on Swarms, then returns to {asked.redirect_host}.</p>
      <nav aria-label="What it may do" className="lost-actions">
        {asked.scopes.map((each) => (
          <label className="lost-row" key={each.scope}>
            <span>{each.meaning}</span>
            <input aria-label={each.scope} checked={granted.has(each.scope)} disabled={each.scope === 'swarms:read'} onChange={() => toggle(each.scope)} type="checkbox" />
          </label>
        ))}
        <button className="lost-row" disabled={Attempt.busy(sent)} onClick={() => answer(true)} type="button">Allow <span aria-hidden="true">→</span></button>
        <button className="lost-row" disabled={Attempt.busy(sent)} onClick={() => answer(false)} type="button">Cancel</button>
      </nav>
      {Attempt.error(sent) ? <p role="alert">{Attempt.error(sent)}</p> : null}
    </section>
  )
}
