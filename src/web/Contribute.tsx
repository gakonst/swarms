import { type ReactNode, useState } from 'react'
import type { Config, Currency } from '../shared/Api.ts'
import * as Channel from '../shared/Channel.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import { memo } from '../shared/Transfer.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { mach, symbols } from './format.ts'
import { message, useWallet } from './hooks.ts'
import { Alert, explain } from './Alert.tsx'
import * as Wallet from './wallet.ts'

export const amounts = ['2', '5', '10'] as const

const preferred: readonly Currency[] = ['ousd', 'usdce', 'pathusd', 'mach']

const smallest = '0.01'

export type Target = { id: string; wallet: `0x${string}` | null }

export type Prefill = { amount: string; note: string; token: Currency | undefined }

export function asked(): Prefill {
  const query = here().searchParams
  const token = query.get('token')?.toLowerCase()
  const amount = query.get('amount')?.trim()
  return {
    amount: amount && /^\d+(\.\d{1,6})?$/.test(amount) ? amount : '2',
    note: query.get('note')?.slice(0, maxNote) ?? '',
    token: token && (preferred as readonly string[]).includes(token) ? (token as Currency) : undefined,
  }
}

function needed(amount: string) {
  return /^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(amount.trim()) ? units(amount.trim()) : 0n
}

export function choose(amount: string, balances: Partial<Record<Currency, bigint>>, config: Config | undefined): Currency {
  const need = needed(amount)
  const offered = preferred.filter((token) => token !== 'mach' || (!!config?.channel && need >= units(config.channel.least)))
  const enough = offered.find((token) => (balances[token] ?? 0n) >= need && (balances[token] ?? 0n) > 0n)
  if (enough) return enough
  const most = offered.reduce((best, token) => ((balances[token] ?? 0n) > (balances[best] ?? 0n) ? token : best))
  return (balances[most] ?? 0n) > 0n ? most : 'usdce'
}

export function least(config: Config | undefined, token: Currency, floor = smallest) {
  const channel = token === 'mach' ? config?.channel?.least : undefined
  return channel && units(channel) > units(floor) ? channel : floor
}

export function valid(amount: string, minimum = smallest) {
  const text = amount.trim()
  if (!/^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(text)) return false
  return units(text) >= units(minimum)
}

export function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

const working = {
  connect: 'Connecting Tempo Wallet…',
  create: 'Setting up…',
  record: 'Recording…',
  send: 'Approve in Tempo Wallet…',
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

export async function send(config: Config, target: Target, amount: bigint, note: string, token: Currency) {
  if (token === 'mach') {
    if (!config.channel) throw new Error('MACH is not offered right now. Send USDC.e, OUSD or pathUSD instead.')
    const transaction = await Wallet.open(config, Channel.open(config.channel, target.id, amount, note))
    const counted = await Api.contribute(target.id, { transaction, ...(note ? { note } : {}) }).catch((error: unknown) => {
      throw /validity|valid before|expired/i.test(message(error)) ? Object.assign(new Error('Tempo Wallet took too long to approve, so the gateway did not send it. Nothing was charged; approve again.'), { code: 'expired' }) : error
    })
    return counted.contribution.hash ?? ''
  }
  if (!target.wallet) throw new Error('This swarm has no wallet yet. Try again in a moment.')
  const hash = await Wallet.send(config, { amount, memo: memo(target.id, note), to: target.wallet, token })
  await recorded(target.id, hash, note)
  return hash
}

function dollars(amount: string) {
  return `$${mach(decimal(units(amount)))}`
}

export function terms(token: Currency, known: boolean) {
  if (known && token === 'mach') return 'Paid in MACH, into a payment channel the gateway spends for this swarm and closes back to you. Tempo Wallet opens to approve it, and the gateway pays the network fee.'
  const paid = known ? `Paid in ${symbols[token]}` : 'Paid in the first of OUSD, USDC.e, pathUSD or MACH your wallet holds enough of'
  return `${paid}, sent once to the swarm's own wallet. Tempo Wallet opens to approve it.`
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
  const [amount, setAmount] = useState(props.prefill.amount)
  const [picked] = useState<Currency | undefined>(props.prefill.token)
  const [flow, setFlow] = useState<Flow>(idle)
  const busy = flow.at === 'busy'
  const step = (next: Working) => setFlow({ at: 'busy', step: next })
  const token = picked ?? choose(amount, wallet.balances, props.config)
  const floor = least(props.config, token, props.least)
  const ok = valid(amount, floor)
  const ready = ok && props.note.length <= maxNote && !!props.config && !busy && !props.locked && flow.at !== 'done'
  const text = props.note.trim()
  const balance = wallet.balances[token]
  const low = balance !== undefined && ok && balance < units(amount)
  const label = ok ? `Pay ${dollars(amount)}` : 'Pay'

  const submit = async () => {
    const config = props.config
    if (!config || !ready) return
    try {
      let using = token
      if (!Wallet.snapshot().address) {
        step('connect')
        await Wallet.connect(config)
        await Wallet.refresh(config).catch(() => {})
        using = picked ?? choose(amount, Wallet.snapshot().balances, config)
      }
      const target = await props.target((next) => step(next))
      step('send')
      const hash = await send(config, target, units(amount), text, using)
      setFlow({ at: 'done', hash, text: `You're in. Sent ${dollars(amount)}.` })
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
      </div>
      <div className="fuel-seg" role="radiogroup">
        {amounts.map((value) => (
          <button aria-checked={amount === value} disabled={busy} key={value} onClick={() => setAmount(value)} role="radio" type="button">${value}</button>
        ))}
      </div>
      {floor !== smallest && <p className="fuel-least" data-bad={!ok && amount.trim() !== ''}>Minimum ${mach(floor)}{token === 'mach' ? ' in MACH' : ''}</p>}
      {text && (
        <button className="fuel-behind" disabled={busy} onClick={() => props.onNote('')} title="Stop backing this idea" type="button">
          <span>Backing</span> “{text}” <b aria-hidden="true">×</b>
        </button>
      )}
      {low && flow.at !== 'failed' && (
        <Alert title={`You have ${mach(decimal(balance ?? 0n))} ${symbols[token]}.`} tone="warn">
          That is less than {dollars(amount)}. Swarms take USDC.e, OUSD or pathUSD.
        </Alert>
      )}
      <p className="fuel-terms">{terms(token, balance !== undefined)}</p>
      <button className="btn btn-high fuel-go" disabled={!ready} onClick={() => void submit()} type="button">
        {flow.at === 'busy' ? working[flow.step] : flow.at === 'failed' && flow.short ? 'Try again' : (props.action ?? ((value: string) => value))(label)}
      </button>
      {flow.at === 'done' && <Alert action={{ label: 'Send more', onClick: () => setFlow(idle) }} title={flow.text} tone="good">{flow.hash && props.config ? <a href={`${props.config.explorer}/tx/${flow.hash}`} rel="noreferrer" target="_blank">Receipt ↗</a> : undefined}</Alert>}
      {flow.at === 'failed' && (
        <Alert title={explain(flow.error).title} tone="bad">
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
