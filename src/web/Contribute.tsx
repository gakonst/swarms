import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Config, Currency } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { mach } from './format.ts'
import { message, useWallet } from './hooks.ts'
import { Alert, explain } from './Alert.tsx'
import * as Wallet from './wallet.ts'

const stops = [1, 2, 3, 5, 8, 10, 15, 20, 25, 35, 50, 75, 100, 150, 250, 500] as const

function nearest(amount: string, marks: readonly number[]) {
  const value = Number(amount)
  if (!(value > 0)) return 0
  return marks.reduce((best, mark, index) => (Math.abs(Math.log(mark / value)) < Math.abs(Math.log(marks[best]! / value)) ? index : best), 0)
}

const preferred: readonly Currency[] = ['mach', 'ousd', 'usdce', 'pathusd']

const smallest = '0.01'

const approvable = 1_000_000n

export type Target = { id: string }

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

export function choose(amount: string, balances: Partial<Record<Currency, bigint>>): Currency {
  const need = needed(amount)
  const enough = preferred.find((token) => (balances[token] ?? 0n) >= need && (balances[token] ?? 0n) > 0n)
  return enough ?? preferred.reduce((best, token) => ((balances[token] ?? 0n) > (balances[best] ?? 0n) ? token : best))
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

type Flow = { at: 'idle' } | { at: 'busy'; step: Working } | { at: 'done'; hash?: string; kept?: boolean; text: string } | { at: 'failed'; error: string; short: boolean } | { at: 'unrecorded'; paid: Unrecorded; reason: string; target: Target }

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

export function approves(amount: bigint, token: Currency) {
  return token === 'mach' && amount >= approvable && !Api.fixture
}

async function approve(config: Config, target: Target, amount: bigint, note: string) {
  const approved = await Api.back(target.id, { amount: decimal(amount), ...(note ? { note } : {}) })
    .then(async (prepared) => ({ id: prepared.id, keyAuthorization: (await Wallet.authorize(config, prepared.authorizeAccessKey)).keyAuthorization }))
    .catch((error: unknown) => {
      if (Wallet.declined(error)) throw error
      console.warn('The approval could not be asked for, so the money is sent instead', error)
      return undefined
    })
  if (!approved) return undefined
  const counted = await Api.approved(target.id, approved.id, { keyAuthorization: approved.keyAuthorization, ...(note ? { note } : {}) })
  return counted.contribution.hash ?? approved.id
}

export async function send(config: Config, target: Target, amount: bigint, note: string, token: Currency) {
  const approved = approves(amount, token) ? await approve(config, target, amount, note) : undefined
  if (approved) return { hash: approved, kept: true }
  return { hash: await transfer(config, target, amount, note, token), kept: false }
}

async function transfer(config: Config, target: Target, amount: bigint, note: string, token: Currency) {
  if (!config.credit) throw new Error('Riding is not available right now. Try again in a moment.')
  const { memo } = await import('../shared/Credit.ts')
  const hash = await Wallet.send(config, { amount, memo: memo(config.credit.owner, target.id, note), to: config.credit.recipient, token })
  return record({ amount, hash, note, swarm: target.id, token })
}

function dollars(amount: string) {
  return `$${mach(decimal(units(amount)))}`.replace(/\.00$/, '')
}

export function Fuel(props: {
  config: Config | undefined
  extra?: ReactNode
  first?: boolean | undefined
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
  const token = picked ?? choose(amount, wallet.balances)
  const floor = props.least ?? smallest
  const ok = valid(amount, floor)
  const ready = ok && props.note.length <= maxNote && !!props.config && !busy && !props.locked && flow.at !== 'unrecorded'
  const text = props.note.trim()
  const balance = wallet.balances[token]
  const low = balance !== undefined && ok && balance < units(amount)
  const least = Math.ceil(Number(floor) * 100) / 100
  const marks = least > stops[0] ? [least, ...stops.filter((stop) => stop > least)] : stops
  const at = nearest(amount, marks)

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
        using = picked ?? choose(amount, Wallet.snapshot().balances)
      }
      const held = Wallet.snapshot().balances[using]
      if (held !== undefined && held < units(amount)) throw Object.assign(new Error('Your wallet holds less than this.'), { code: 'insufficient_balance' })
      target = await props.target((next) => step(next))
      step('send')
      const sent = await send(config, target, units(amount), text, using)
      setFlow({ at: 'done', hash: sent.hash, kept: sent.kept, text: `You're riding. ${dollars(amount)} is in.` })
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
      setFlow({ at: 'done', hash, text: `You're riding. ${dollars(decimal(paid.amount))} is in.` })
      props.onNote('')
      props.onDone(target)
    } catch (error) {
      const lost = stray(error)
      setFlow(lost ? { ...lost, at: 'unrecorded', target } : { at: 'failed', error: message(error), short: false })
    }
  }

  return (
    <div className="fuel">
      <div className="fuel-amount">
        <label className="fuel-sum">
          <span aria-hidden="true">$</span>
          <input aria-label="Amount in dollars" disabled={busy} id="amount" inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(',', '.').replace('$', ''))} style={{ width: `${Math.max(1, amount.length) + 0.4}ch` }} value={amount} />
        </label>
        <input aria-label="Amount" aria-valuetext={dollars(String(marks[at]))} className="fuel-slide" disabled={busy} max={marks.length - 1} min={0} onChange={(event) => setAmount(String(marks[Number(event.target.value)]))} step={1} style={{ '--fill': `${(at / (marks.length - 1)) * 100}%` } as CSSProperties} type="range" value={at} />
        <p className="fuel-ends"><span>{dollars(String(marks[0]))}</span><span>{dollars(String(marks[marks.length - 1]))}</span></p>
      </div>
      {floor !== smallest && !ok && <p className="fuel-least" data-bad={amount.trim() !== ''}>At least {dollars(floor)}</p>}
      {props.extra}
      {!props.first && <input aria-label="What should it try next?" className="fuel-steer" disabled={busy} maxLength={maxNote} onChange={(event) => props.onNote(event.target.value)} placeholder="What should it try next? (optional)" ref={steer} value={props.note} />}
      <button className="btn btn-high fuel-go" disabled={!ready} onClick={() => void submit()} type="button">
        {flow.at === 'busy' ? working[flow.step] : ok ? `${props.first ? 'Start it' : 'Ride it'} · ${dollars(amount)}` : props.first ? 'Start it' : 'Ride it'}
      </button>
      <div className="fuel-told" ref={told}>
        {low && flow.at !== 'failed' && <Alert title="Not enough in your wallet." tone="warn">Add money in Tempo Wallet first.</Alert>}
        {flow.at === 'done' && <Alert action={{ label: 'Add more', onClick: () => setFlow(idle) }} title={flow.text} tone="good">{flow.kept ? 'Thank you! It stays in your wallet until the AI spends it.' : 'Thank you!'}</Alert>}
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
