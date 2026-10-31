import { type RefObject, useEffect, useState } from 'react'
import type { Config, Currency, Detail, Token } from '../shared/Api.ts'
import { decimal, maxNote, memo, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { mach, short, symbols } from './format.ts'
import { message } from './hooks.ts'
import { Amount, code, disclosure, NoteField, pledge, steps as pledging, Tokens, valid, WalletLine } from './Pledge.tsx'
import * as Wallet from './wallet.ts'

export type Mode = 'send' | 'budget' | 'pledge'

const modes = [
  ['send', 'Send once'],
  ['budget', 'Daily budget'],
  ['pledge', 'Pledge'],
] as const satisfies readonly (readonly [Mode, string])[]

const smallest = '0.01'

const funds = { budget: 'budget', pledge: 'pledge', transfer: 'send' } as const satisfies Record<string, Mode>

function asked() {
  const query = new URLSearchParams(location.search)
  const fund = query.get('fund')
  const mode: Mode = fund && fund in funds ? funds[fund as keyof typeof funds] : 'send'
  const token = query.get('token')?.toLowerCase()
  const amount = query.get('amount')?.trim()
  return {
    amount: amount && /^\d+(\.\d{1,6})?$/.test(amount) ? amount : '0.25',
    mode,
    note: query.get('note')?.slice(0, maxNote) ?? '',
    token: (token && token in symbols && (mode === 'pledge' || token !== 'mach') ? token : mode === 'pledge' ? 'mach' : 'usdce') as Currency,
  }
}

const working = {
  allow: 'Approve the budget key in Tempo Wallet…',
  ask: 'Preparing the budget…',
  keep: 'Recording the budget…',
  record: 'Recording the contribution…',
  send: 'Approve the transfer in Tempo Wallet…',
  ...pledging,
} as const

type Working = keyof typeof working

type State = { done?: { hash?: string; text: string }; error?: string; short?: boolean; step?: Working }

function told(mode: Mode, amount: string, token: Currency, config: Config | undefined, noted: boolean) {
  const symbol = symbols[token]
  if (mode === 'send')
    return `Sends ${amount || '…'} ${symbol} from your wallet to this swarm's wallet in one transaction${noted ? ', with a memo that commits to your note' : ''}. The swarm spends it on its rounds, and when it is done it returns what it did not spend to everyone who sent or was pulled, in proportion. MACH only reaches merchants, so it cannot be sent to a swarm: pledge MACH instead.`
  if (mode === 'budget')
    return `Tempo Wallet approves a key that can move at most ${amount || '…'} ${symbol} a day from your wallet, only to this swarm's wallet, for ${config?.budget.days ?? 30} days. Its transfer fees come out of the same daily amount. The swarm pulls only what its rounds need, rotating across everyone's budgets, and you can revoke the key in Tempo Wallet at any time.`
  return disclosure(token)
}

async function recorded(swarm: string, hash: string, note: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await Api.contribute(swarm, { hash, ...(note ? { note } : {}) })
    } catch (error) {
      if (attempt >= 3 || code(error) !== 'not_found') throw error
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}

export function Box(props: { config: Config | undefined; note: string; noteRef: RefObject<HTMLDivElement | null>; onDone: () => void; onNote: (note: string) => void; swarm: Detail }) {
  const [prefill] = useState(asked)
  const [mode, setMode] = useState<Mode>(prefill.mode)
  const [amount, setAmount] = useState(prefill.amount)
  const [token, setToken] = useState<Currency>(prefill.token)
  const onNote = props.onNote

  useEffect(() => {
    if (prefill.note) onNote(prefill.note)
  }, [onNote, prefill.note])
  const [state, setState] = useState<State>({})
  const busy = state.step !== undefined
  const least = mode === 'send' ? smallest : mode === 'budget' ? props.config?.budget.min : props.config?.minPledge
  const wallet = props.swarm.wallet
  const ready = valid(amount, props.config, least) && props.note.length <= maxNote && !!props.config && !busy && (mode === 'pledge' || !!wallet)
  const symbol = symbols[token]
  const text = props.note.trim()

  const choose = (next: Mode) => {
    setMode(next)
    setState({})
    if (next === 'pledge') setToken('mach')
    else if (token === 'mach') setToken('usdce')
  }

  const submit = async () => {
    const config = props.config
    if (!config) return
    const value = decimal(units(amount))
    try {
      if (mode === 'send' && wallet) {
        setState({ step: 'send' })
        const hash = await Wallet.send(config, { amount: units(amount), memo: memo(props.swarm.id, text), to: wallet, token })
        setState({ step: 'record' })
        await recorded(props.swarm.id, hash, text)
        setState({ done: { hash, text: `Sent ${mach(value)} ${symbol}.${text ? ' Your note counts with it.' : ''}` } })
      } else if (mode === 'budget') {
        setState({ step: 'ask' })
        const requested = await Api.budget(props.swarm.id, { amount: value, token: token as Token, ...(text ? { note: text } : {}) })
        setState({ step: 'allow' })
        const approved = await Wallet.authorize(config, requested.authorizeAccessKey)
        setState({ step: 'keep' })
        await Api.allow(props.swarm.id, requested.budget, approved.keyAuthorization)
        setState({ done: { text: `Approved up to ${mach(value)} ${symbol} a day. The swarm pulls from it when its rounds need money.` } })
      } else {
        const pledged = await pledge(config, props.swarm.id, amount, props.note, token, (step) => setState({ step }))
        setState({ done: { text: `Pledged ${mach(pledged.pledge.amount)} ${symbol}. The swarm spends it as it works; what it does not spend goes back to you.` } })
      }
      props.onNote('')
      props.onDone()
    } catch (error) {
      setState({ error: message(error), short: code(error) === 'insufficient_balance' })
    }
  }

  const heading = props.swarm.status === 'paused' ? 'Help this research continue' : props.swarm.status === 'funding' ? 'Fund the first research round' : props.swarm.status === 'done' ? 'This research run is complete' : 'Fund this research'
  const action = mode === 'send' ? `Send ${valid(amount, props.config, least) ? mach(decimal(units(amount))) : ''} ${symbol}` : mode === 'budget' ? `Approve ${valid(amount, props.config, least) ? mach(decimal(units(amount))) : ''} ${symbol} a day` : `Pledge ${valid(amount, props.config, least) ? mach(decimal(units(amount))) : ''} ${symbol}`

  return (
    <div className="pledge" id="pledge" ref={props.noteRef}>
      <h3 className="label">{heading}</h3>
      {props.swarm.status === 'done' && <p className="fine">It takes no more money. What it did not spend went back: pledges through their channels, and the pool to everyone who sent or was pulled, in proportion.</p>}
      {props.swarm.status !== 'done' && (
        <>
          <div className="modes" role="tablist">
            {modes.map(([key, label]) => (
              <button aria-selected={mode === key} className={mode === key ? 'mode mode-on' : 'mode'} disabled={busy} key={key} onClick={() => choose(key)} role="tab" type="button">
                {label}
              </button>
            ))}
          </div>
          {mode !== 'pledge' && wallet && (
            <p className="address">
              <span>Swarm wallet</span>
              {props.config ? (
                <a href={`${props.config.explorer}/address/${wallet}`} rel="noreferrer" target="_blank" title={wallet}>
                  {short(wallet)} ↗
                </a>
              ) : (
                <span>{short(wallet)}</span>
              )}
              <button className="btn btn-minimal" onClick={() => void navigator.clipboard?.writeText(wallet)} type="button">
                Copy
              </button>
            </p>
          )}
          <Tokens config={props.config} onChange={setToken} value={token} {...(mode === 'pledge' ? {} : { only: 'pool' as const })} />
          <Amount config={props.config} label={mode === 'budget' ? 'Per day' : 'Amount'} least={least ?? smallest} onChange={setAmount} suffix={mode === 'budget' ? `${symbol} a day` : symbol} value={amount} />
          <NoteField hint="Steers the swarm in proportion to the money behind it. The same text backs an existing note." onChange={props.onNote} value={props.note} />
          <WalletLine amount={amount} config={props.config} token={token} />
          <button className="btn btn-high btn-wide" disabled={!ready} onClick={() => void submit()} type="button">
            {state.step ? working[state.step] : state.short ? 'Try again' : action}
          </button>
          {state.done && (
            <p className="notice">
              {state.done.text}{' '}
              {state.done.hash && props.config && (
                <a href={`${props.config.explorer}/tx/${state.done.hash}`} rel="noreferrer" target="_blank">
                  View the transfer
                </a>
              )}
            </p>
          )}
          {state.error && (
            <p className="error">
              {state.error}
              {state.short && token === 'mach' && (
                <>
                  {' '}
                  <button className="btn btn-minimal" onClick={() => void Wallet.fund(units(amount) - (Wallet.snapshot().balances.mach ?? 0n))} type="button">
                    Add MACH
                  </button>
                </>
              )}
            </p>
          )}
          <p className="fine">{told(mode, valid(amount, props.config, least) ? mach(decimal(units(amount))) : '', token, props.config, text.length > 0)}</p>
        </>
      )}
    </div>
  )
}

