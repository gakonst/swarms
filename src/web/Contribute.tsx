import { useEffect, useRef, useState } from 'react'
import type { Config, Currency } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { mach } from './format.ts'
import { message, useWallet } from './hooks.ts'
import { Alert, explain } from './Alert.tsx'
import * as Wallet from './wallet.ts'

export const amounts = ['2', '5', '10', '25'] as const

const preferred: readonly Currency[] = ['ousd', 'usdce', 'pathusd', 'mach']

const smallest = '0.01'

export type Target = { id: string; wallet: `0x${string}` | null }

export type Prefill = { amount: string; note: string; token: Currency | undefined }

export function asked(): Prefill {
  const query = here().searchParams
  const token = query.get('token')?.toLowerCase()
  const amount = query.get('amount')?.trim()
  return {
    amount: amount && /^\d+(\.\d{1,6})?$/.test(amount) ? amount : '5',
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

export type Unrecorded = { amount: bigint; hash: string; note: string; swarm: string; token: Currency }

type Flow = { at: 'idle' } | { at: 'busy'; step: Working } | { at: 'done'; hash?: string; text: string } | { at: 'failed'; error: string; short: boolean } | { at: 'unrecorded'; paid: Unrecorded; reason: string; target: Target }

const idle: Flow = { at: 'idle' }

function strayed(paid: Unrecorded, error: unknown) {
  return Object.assign(new Error(`Sent, but not counted yet. ${message(error)} Try again to count it; nothing is sent twice.`), { code: 'unrecorded', paid, reason: message(error) })
}

export function stray(error: unknown) {
  return code(error) === 'unrecorded' && typeof error === 'object' && error !== null && 'paid' in error && 'reason' in error ? { paid: error.paid as Unrecorded, reason: String(error.reason) } : undefined
}

export async function record(paid: Unrecorded) {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await Api.contribute(paid.swarm, { hash: paid.hash, ...(paid.note ? { note: paid.note } : {}) })).contribution.hash ?? paid.hash
    } catch (error) {
      if (code(error) === 'conflict') return paid.hash
      if (attempt < 3 && code(error) === 'not_found') {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        continue
      }
      throw strayed(paid, error)
    }
  }
}

export async function send(config: Config, target: Target, amount: bigint, note: string, token: Currency) {
  if (token === 'mach') {
    if (!config.channel) throw new Error('This way of paying is not available right now. Try again with another balance in your wallet.')
    const Channel = await import('../shared/Channel.ts')
    const hash = await Wallet.open(config, Channel.open(config.channel, target.id, amount, note))
    return record({ amount, hash, note, swarm: target.id, token })
  }
  if (!target.wallet) throw new Error('This swarm has no wallet yet. Try again in a moment.')
  const { memo } = await import('../shared/Transfer.ts')
  const hash = await Wallet.send(config, { amount, memo: memo(target.id, note), to: target.wallet, token })
  return record({ amount, hash, note, swarm: target.id, token })
}

function dollars(amount: string) {
  return `$${mach(decimal(units(amount)))}`.replace(/\.00$/, '')
}

export function Fuel(props: {
  config: Config | undefined
  focus?: number | undefined
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
  const told = useRef<HTMLDivElement>(null)
  const steer = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (flow.at === 'done' || flow.at === 'failed' || flow.at === 'unrecorded') told.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [flow.at])
  useEffect(() => {
    if (props.focus) steer.current?.focus({ preventScroll: true })
  }, [props.focus])
  const busy = flow.at === 'busy'
  const step = (next: Working) => setFlow({ at: 'busy', step: next })
  const token = picked ?? choose(amount, wallet.balances, props.config)
  const floor = least(props.config, token, props.least)
  const ok = valid(amount, floor)
  const ready = ok && props.note.length <= maxNote && !!props.config && !busy && !props.locked && flow.at !== 'unrecorded'
  const text = props.note.trim()
  const balance = wallet.balances[token]
  const low = balance !== undefined && ok && balance < units(amount)
  const custom = !amounts.includes(amount as (typeof amounts)[number])

  const submit = async () => {
    const config = props.config
    if (!config || !ready) return
    let target: Target | undefined
    try {
      let using = token
      if (!Wallet.snapshot().address) {
        step('connect')
        await Wallet.connect(config)
        await Wallet.refresh(config).catch(() => {})
        using = picked ?? choose(amount, Wallet.snapshot().balances, config)
      }
      target = await props.target((next) => step(next))
      step('send')
      const hash = await send(config, target, units(amount), text, using)
      setFlow({ at: 'done', hash, text: `You backed it with ${dollars(amount)}.` })
      props.onNote('')
      props.onDone(target)
    } catch (error) {
      const lost = stray(error)
      setFlow(lost && target ? { ...lost, at: 'unrecorded', target } : { at: 'failed', error: message(error), short: code(error) === 'insufficient_balance' })
    }
  }

  const retry = async (paid: Unrecorded, target: Target) => {
    step('record')
    try {
      const hash = await record(paid)
      setFlow({ at: 'done', hash, text: `You backed it with ${dollars(decimal(paid.amount))}.` })
      props.onNote('')
      props.onDone(target)
    } catch (error) {
      const lost = stray(error)
      setFlow(lost ? { ...lost, at: 'unrecorded', target } : { at: 'failed', error: message(error), short: false })
    }
  }

  return (
    <div className="fuel">
      <div className="fuel-seg" role="radiogroup" aria-label="Amount">
        {amounts.map((value) => (
          <button aria-checked={amount === value} disabled={busy} key={value} onClick={() => setAmount(value)} role="radio" type="button">${value}</button>
        ))}
        <label className="fuel-other" data-on={custom}>
          {custom && <span aria-hidden="true">$</span>}
          <input aria-label="Other amount" disabled={busy} id="amount" inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(',', '.').replace('$', ''))} placeholder="Other" value={custom ? amount : ''} />
        </label>
      </div>
      {floor !== smallest && !ok && <p className="fuel-least" data-bad={amount.trim() !== ''}>At least {dollars(floor)}</p>}
      <input aria-label="What should it try next?" className="fuel-steer" disabled={busy} maxLength={maxNote} onChange={(event) => props.onNote(event.target.value)} placeholder="What should it try next? (optional)" ref={steer} value={props.note} />
      <button className="btn btn-high fuel-go" disabled={!ready} onClick={() => void submit()} type="button">
        {flow.at === 'busy' ? working[flow.step] : ok ? `Back it · ${dollars(amount)}` : 'Back it'}
      </button>
      <div className="fuel-told" ref={told}>
        {low && flow.at !== 'failed' && <Alert title="Not enough in your wallet." tone="warn">Add money in Tempo Wallet first.</Alert>}
        {flow.at === 'done' && <Alert action={{ label: 'Back again', onClick: () => setFlow(idle) }} title={flow.text} tone="good">Thank you!</Alert>}
        {flow.at === 'unrecorded' && (
          <Alert action={{ label: 'Try again', onClick: () => void retry(flow.paid, flow.target) }} title="Sent, but not counted yet." tone="warn">
            Nothing is paid twice.
          </Alert>
        )}
        {flow.at === 'failed' && (
          <Alert title={explain(flow.error).title} tone="bad">
            {explain(flow.error).detail}
          </Alert>
        )}
      </div>
    </div>
  )
}
