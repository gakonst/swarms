import { useState } from 'react'
import * as Mention from '../shared/Mention.ts'
import { message } from './hooks.ts'
import * as Wallet from './wallet.ts'

export function Username(props: { why: string }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const wrong = name.length >= 3 ? Mention.invalid(name) : undefined

  const save = async () => {
    if (busy || name.length < 3 || wrong) return
    setBusy(true)
    setError(undefined)
    try {
      await Wallet.rename(name)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="rename username" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <p className="username-why">{props.why}</p>
      <div className="username-row">
        <label className="rename-field">
          <span aria-hidden="true">@</span>
          <input aria-label="Username" autoCapitalize="none" autoComplete="username" disabled={busy} maxLength={Mention.maxName} onChange={(event) => setName(event.target.value.replace(/^@/, '').toLowerCase().trim())} placeholder="pick a username" spellCheck={false} value={name} />
        </label>
        <button className="btn btn-high" disabled={busy || name.length < 3 || !!wrong} type="submit">{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {(error ?? wrong) && <p className="error" role="alert">{error ?? wrong}</p>}
    </form>
  )
}
