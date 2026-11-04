import { type ReactNode, useEffect, useState } from 'react'
import type { Config, Currency, Token } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import { memo } from '../shared/Transfer.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { mach, symbols } from './format.ts'
import { message, useWallet } from './hooks.ts'
import { Alert, explain } from './Alert.tsx'
import { amounts, code, pledge, steps as pledging, valid } from './Pledge.tsx'
import * as Wallet from './wallet.ts'

export type Mode = 'send' | 'budget' | 'pledge'

const preferred: readonly Currency[] = ['ousd', 'usdce', 'pathusd', 'mach']

const smallest = '0.01'

const funds = { budget: 'budget', pledge: 'pledge', transfer: 'send' } as const satisfies Record<string, Mode>

export type Target = { id: string; wallet: `0x${string}` | null }

export type Prefill = { amount: string; mode: Mode; note: string; token: Currency | undefined }

export function asked(fallback: Mode = 'send'): Prefill {
  const query = here().searchParams
  const fund = query.get('fund')
  const mode: Mode = fund && fund in funds ? funds[fund as keyof typeof funds] : fallback
  const token = query.get('token')?.toLowerCase()
  const amount = query.get('amount')?.trim()
  return {
    amount: amount && /^\d+(\.\d{1,6})?$/.test(amount) ? amount : '2',
    mode,
    note: query.get('note')?.slice(0, maxNote) ?? '',
    token: token && token in symbols && (mode === 'pledge' || token !== 'mach') ? (token as Currency) : undefined,
  }
}

function allowed(mode: Mode) {
  return preferred
}

function needed(amount: string) {
  return /^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(amount.trim()) ? units(amount.trim()) : 0n
}

export function choose(mode: Mode, amount: string, balances: Partial<Record<Currency, bigint>>) {
  const options = allowed(mode)
  const need = needed(amount)
  const enough = options.find((token) => (balances[token] ?? 0n) >= need && (balances[token] ?? 0n) > 0n)
  if (enough) return enough
  const most = options.reduce((best, token) => ((balances[token] ?? 0n) > (balances[best] ?? 0n) ? token : best))
  return (balances[most] ?? 0n) > 0n ? most : mode === 'pledge' ? 'mach' : 'usdce'
}

const working = {
  allow: 'Approve in Tempo Wallet…',
  ask: 'Setting up…',
  connect: 'Connecting Tempo Wallet…',
  create: 'Setting up…',
  keep: 'Recording…',
  record: 'Recording…',
  send: 'Approve in Tempo Wallet…',
  ...pledging,
  approve: 'Approve in Tempo Wallet…',
  confirm: 'Recording…',
  request: 'Setting up…',
} as const

type Working = keyof typeof working

type Flow = { at: 'idle' } | { at: 'busy'; step: Working } | { at: 'done'; hash?: string; text: string } | { at: 'failed'; error: string; short: boolean }

const idle: Flow = { at: 'idle' }

export async function recorded(swarm: string, hash: string, note: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await Api.contribute(swarm, { hash, ...(note ? { note } : {}) })
    } catch (error) {
      if (attempt >= 3 || code(error) !== 'not_found') throw error
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}

function dollars(amount: string) {
  return `$${mach(decimal(units(amount)))}`
}

export function terms(mode: Mode, token: Currency, amount: string, known: boolean, config: Config | undefined) {
  const paid = known ? `Paid in ${symbols[token]}` : 'Paid in the first of OUSD, USDC.e, pathUSD or MACH your wallet holds enough of'
  const capped = valid(amount, config, '0.000001') ? dollars(amount) : 'the amount'
  const approve = 'Tempo Wallet opens to approve it.'
  if (mode === 'budget') return `${paid}, charged now and again every ${Math.round((config?.budget.period ?? 2_592_000) / 86_400)} days for up to ${config?.budget.days ?? 365} days, until you revoke the key in Tempo Wallet. ${approve}`
  if (known && token === 'mach') return `${paid}: a key capped at ${capped} moves it into a payment channel for this swarm now, and what the swarm does not spend comes back. The key may also spend up to $0.10 of a stablecoin on network fees. ${approve}`
  return `${paid}, sent once to the swarm's own wallet. ${approve}`
}

export function Fuel(props: {
  action?: ((label: string) => string) | undefined
  config: Config | undefined
  after?: ReactNode
  least?: string | undefined
  locked?: boolean | undefined
  note: string
  onDone: (target: Target) => void
  onNote: (note: string) => void
  prefill: Prefill
  target: (step: (step: 'create') => void) => Promise<Target>
}) {
  const wallet = useWallet()
  const [mode, setMode] = useState<Mode>(props.prefill.mode === 'budget' ? 'budget' : 'send')
  const [amount, setAmount] = useState(props.prefill.amount)
  const [picked, setPicked] = useState<Currency | undefined>(props.prefill.token)
  const [flow, setFlow] = useState<Flow>(idle)
  const busy = flow.at === 'busy'
  const step = (next: Working) => setFlow({ at: 'busy', step: next })
  const token = picked && allowed(mode).includes(picked) ? picked : choose(mode, amount, wallet.balances)
  const least = props.least ?? (mode === 'send' && token !== 'mach' ? smallest : mode === 'budget' ? props.config?.budget.min : props.config?.minPledge)
  const ok = valid(amount, props.config, least)
  const ready = ok && props.note.length <= maxNote && !!props.config && !busy && !props.locked && flow.at !== 'done'
  const text = props.note.trim()
  const balance = wallet.balances[token]
  const low = balance !== undefined && ok && balance < units(amount)
  const label = !ok ? 'Pay' : mode === 'budget' ? `Pay ${dollars(amount)} a month` : `Pay ${dollars(amount)}`

  const submit = async () => {
    const config = props.config
    if (!config || !ready) return
    try {
      let using = token
      if (!Wallet.snapshot().address) {
        step('connect')
        await Wallet.connect(config)
        await Wallet.refresh(config).catch(() => {})
        using = picked && allowed(mode).includes(picked) ? picked : choose(mode, amount, Wallet.snapshot().balances)
      }
      const target = await props.target((next) => step(next))
      const value = decimal(units(amount))
      if (mode === 'send' && using !== 'mach') {
        if (!target.wallet) throw new Error('This swarm has no wallet yet. Try again in a moment.')
        step('send')
        const hash = await Wallet.send(config, { amount: units(amount), memo: memo(target.id, text), to: target.wallet, token: using })
        step('record')
        await recorded(target.id, hash, text)
        setFlow({ at: 'done', hash, text: `You're in. Sent ${dollars(value)}.` })
      } else if (mode === 'budget') {
        step('ask')
        const requested = await Api.budget(target.id, { amount: value, token: using as Token, ...(text ? { note: text } : {}) })
        step('allow')
        const approved = await Wallet.authorize(config, requested.authorizeAccessKey)
        step('keep')
        await Api.allow(target.id, requested.budget, approved.keyAuthorization)
        setFlow({ at: 'done', text: `You're in. ${dollars(value)} a month, the first one now.` })
      } else {
        await pledge(config, target.id, amount, props.note, using, (next) => step(next))
        setFlow({ at: 'done', text: `You're in. Pledged ${dollars(value)}.` })
      }
      props.onNote('')
      props.onDone(target)
    } catch (error) {
      setFlow({ at: 'failed', error: message(error), short: code(error) === 'insufficient_balance' })
    }
  }

  return (
    <div className="fuel">
      <div className="fuel-amount">
        <label className="fuel-dollar" htmlFor="amount">$</label>
        <input disabled={busy} id="amount" inputMode="decimal" style={{ width: `${Math.max(1, amount.length) * 0.62 + 0.2}em` }} onChange={(event) => setAmount(event.target.value.replace(',', '.').replace('$', ''))} value={amount} />
        {mode === 'budget' && <span className="fuel-per">a month</span>}
      </div>
      <div className="fuel-seg" role="radiogroup">
        {amounts.map((value) => (
          <button aria-checked={amount === value} disabled={busy} key={value} onClick={() => setAmount(value)} role="radio" type="button">${value}</button>
        ))}
      </div>
      {least && <p className="fuel-least" data-bad={!ok && amount.trim() !== ''}>Minimum ${mach(least)}</p>}
      <div className="fuel-seg" role="radiogroup">
        {([['once', 'One time'], ['budget', 'Monthly']] as const).map(([key, name]) => (
          <button aria-checked={(key === 'budget') === (mode === 'budget')} disabled={busy} key={key} onClick={() => { setMode(key === 'budget' ? 'budget' : 'send'); if (flow.at !== 'busy') setFlow(idle) }} role="radio" type="button">{name}</button>
        ))}
      </div>
      {text && (
        <button className="fuel-behind" disabled={busy} onClick={() => props.onNote('')} title="Stop backing this idea" type="button">
          <span>Backing</span> “{text}” <b aria-hidden="true">×</b>
        </button>
      )}
      {low && flow.at !== 'failed' && (
        <Alert action={token === 'mach' ? { label: 'Add MACH', onClick: () => void Wallet.fund(units(amount) - (balance ?? 0n)).then(() => props.config && Wallet.refresh(props.config)) } : undefined} title={`You have ${mach(decimal(balance ?? 0n))} ${symbols[token]}.`} tone="warn">
          That is less than {dollars(amount)}.
        </Alert>
      )}
      <p className="fuel-terms">{terms(mode, token, amount, balance !== undefined, props.config)}</p>
      <button className="btn btn-high fuel-go" disabled={!ready} onClick={() => void submit()} type="button">
        {flow.at === 'busy' ? working[flow.step] : flow.at === 'failed' && flow.short ? 'Try again' : (props.action ?? ((value: string) => value))(label)}
      </button>
      {flow.at === 'done' && <Alert action={{ label: 'Fund again', onClick: () => setFlow(idle) }} title={flow.text} tone="good">{flow.hash && props.config ? <a href={`${props.config.explorer}/tx/${flow.hash}`} rel="noreferrer" target="_blank">Receipt ↗</a> : undefined}</Alert>}
      {flow.at === 'failed' && (
        <Alert action={flow.short && token === 'mach' ? { label: 'Add MACH', onClick: () => void Wallet.fund(units(amount) - (Wallet.snapshot().balances.mach ?? 0n)) } : undefined} title={explain(flow.error).title} tone="bad">
          {explain(flow.error).detail}
        </Alert>
      )}
      {props.after}
    </div>
  )
}

export function Fund(props: {
  action?: (label: string) => string
  config: Config | undefined
  least?: string | undefined
  locked?: boolean
  note: string
  onChange?: () => void
  onDone: (target: Target) => void
  onNote: (note: string) => void
  prefill: Prefill
  target: (step: (step: 'create') => void) => Promise<Target>
  title: string
}) {
  return (
    <div className="fund">
      <ol className="tiles-swarm fund-what">
        <li>
          {props.onChange ? (
            <button className="tile-swarm" onClick={props.onChange} type="button"><i className="tile-mark" /><span className="tile-title">{props.title}</span><span className="tile-raised">Change</span></button>
          ) : (
            <div className="tile-swarm"><i className="tile-mark" /><span className="tile-title">{props.title}</span></div>
          )}
        </li>
      </ol>
      <Fuel action={props.action} config={props.config} least={props.least} locked={props.locked} note={props.note} onDone={props.onDone} onNote={props.onNote} prefill={props.prefill} target={props.target} />
    </div>
  )
}
