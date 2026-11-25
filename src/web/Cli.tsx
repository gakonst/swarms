import { type FormEvent, useEffect, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import * as Site from '../shared/Site.ts'
import { here } from './boot.ts'
import { Lost } from './Lost.tsx'
import * as Wallet from './wallet.ts'

type State = { kind: 'idle' } | { kind: 'busy' } | { address: string; kind: 'done' } | { error: string; kind: 'failed' }

export function CliLogin(props: { config: Config | undefined }) {
  const [code, setCode] = useState(() => here().searchParams.get('code') ?? '')
  const [state, setState] = useState<State>({ kind: 'idle' })
  useEffect(() => {
    document.title = 'Sign in to the CLI · Swarms'
  }, [])
  const approve = async (event: FormEvent) => {
    event.preventDefault()
    const config = props.config
    if (!config || state.kind === 'busy' || !code.trim()) return
    setState({ kind: 'busy' })
    try {
      const session = await Wallet.mint(config)
      const response = await fetch(Site.at('/v1/auth/device/approve'), { body: JSON.stringify({ code }), headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, method: 'POST' })
      const body = (await response.json().catch(() => ({}))) as { address?: string; detail?: string }
      if (!response.ok) throw new Error(body.detail ?? `The server answered ${response.status}.`)
      setState({ address: body.address ?? session.address, kind: 'done' })
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error), kind: 'failed' })
    }
  }
  if (state.kind === 'done')
    return (
      <Lost title="The CLI is signed in. Go back to your terminal.">
        <span className="lost-row">{state.address.slice(0, 6)}…{state.address.slice(-4)}</span>
      </Lost>
    )
  return (
    <Lost title={state.kind === 'failed' ? state.error : 'Sign in to the Swarms CLI'}>
      <form className="cli-login" onSubmit={approve}>
        <label className="lost-row">
          Code
          <input autoCapitalize="characters" autoComplete="off" name="code" onChange={(event) => setCode(event.target.value)} placeholder="BCDF-GHJK" spellCheck={false} value={code} />
        </label>
        <button className="lost-row" disabled={state.kind === 'busy' || !props.config || !code.trim()} type="submit">
          {state.kind === 'busy' ? 'Signing in…' : 'Sign in with Tempo ID'} <span aria-hidden="true">→</span>
        </button>
        <p className="cli-login-note">Only continue if you ran swarms login yourself and it shows this code.</p>
      </form>
    </Lost>
  )
}
