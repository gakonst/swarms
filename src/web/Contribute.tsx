import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Config, Currency } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import { here } from './boot.ts'
import { mach, short, usd } from './format.ts'
import { message, useWallet } from './hooks.ts'
import { Alert, explain } from './Alert.tsx'
import * as Pay from './pay.ts'
import * as Wallet from './wallet.ts'

const stops = [1, 2, 3, 5, 8, 10, 15, 20, 25, 35, 50, 75, 100, 150, 250, 500] as const

function grown(marks: readonly number[], amount: string) {
  const next = [...marks]
  const value = Number(amount)
  while (next[next.length - 1]! <= (value > 0 ? value : 0)) next.push(next[next.length - 1]! * 2)
  return next
}

function nearest(amount: string, marks: readonly number[]) {
  const value = Number(amount)
  if (!(value > 0)) return 0
  return marks.reduce((best, mark, index) => (Math.abs(Math.log(mark / value)) < Math.abs(Math.log(marks[best]! / value)) ? index : best), 0)
}

const preferred: readonly Currency[] = ['mach', 'ousd', 'usdce', 'pathusd']

const smallest = '0.01'

export type Target = { id: string; nickname?: string | undefined; node?: string | undefined; parent?: string | undefined; title?: string | undefined }

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

const working = {
  counting: 'Counting…',
  creating: 'Setting up…',
  paying: 'Confirm in Tempo ID…',
  signing: 'Signing in…',
} as const

async function transfer(config: Config, target: Target, amount: bigint, note: string, token: Currency, started: boolean): Promise<Pay.Owed> {
  if (!config.credit) throw new Error('Riding is not available right now. Try again in a moment.')
  const { memo } = await import('../shared/Credit.ts')
  const hash = await Wallet.send(config, { amount, memo: memo(config.credit.owner, target.id, target.node ? `n:${target.node}` : note), to: config.credit.recipient, token })
  return { amount: decimal(amount), hash, note, swarm: target.id, ...(target.node ? { node: target.node } : {}), ...(target.parent ? { parent: target.parent } : {}), ...(target.title ? { title: target.title } : {}), ...(started ? { started } : {}) }
}

export function dollars(amount: string) {
  return `$${mach(decimal(units(amount)))}`.replace(/\.00$/, '')
}

export function Told(props: { act: Pay.Act; config: Config | undefined; onFund: () => void; onRetry: () => void; slot: string }) {
  const act = props.act
  if (act.at === 'counting') return <Alert title={`Counting your ${dollars(act.owed.amount)}…`} tone="warn">Sent. Nothing is paid twice.</Alert>
  if (act.at === 'owed')
    return (
      <Alert action={{ label: 'Try again', onClick: props.onRetry }} title="Sent, but not counted yet." tone="warn">
        {act.tries < Pay.retries.length ? 'Trying again by itself. Nothing is paid twice.' : 'Nothing is paid twice.'}
      </Alert>
    )
  if (act.at === 'counted') return <Alert action={{ label: 'Add more', onClick: () => Pay.forget(props.slot) }} title={`${act.started ? 'You started it' : "You're riding"}. ${dollars(act.amount)} is in.`} tone="good" />
  if (act.at === 'refused')
    return (
      <Alert action={props.config && { href: `${props.config.explorer}/tx/${act.owed.hash}`, label: short(act.owed.hash) }} title="Sent, but it cannot be counted." tone="bad">
        {act.error}
      </Alert>
    )
  if (act.at !== 'failed') return null
  if (act.why === 'cancelled') return <Alert title="Cancelled." tone="warn">Nothing was charged.</Alert>
  if (act.why === 'broke') return <Alert action={{ label: 'Add funds', onClick: props.onFund }} title="Not enough in your wallet." tone="bad">Nothing was charged.</Alert>
  const told = explain(act.error)
  return <Alert title={told.title} tone="bad">{told.detail}</Alert>
}

export function Fuel(props: {
  config: Config | undefined
  ask?: string | undefined
  compact?: boolean | undefined
  creates?: boolean | undefined
  ended?: string | undefined
  extra?: ReactNode
  first?: boolean | undefined
  focus?: number | undefined
  least?: string | undefined
  locked?: boolean | undefined
  note: string
  onDone: (target: Target) => void
  onNote: (note: string) => void
  onSent?: ((target: Target) => void) | undefined
  prefill: Prefill
  slot: string
  steers?: boolean | undefined
  target: () => Promise<Target>
  verb?: string | undefined
  wants?: string | undefined
}) {
  const wallet = useWallet()
  const [amount, setAmount] = useState(props.prefill.amount)
  const [picked] = useState<Currency | undefined>(props.prefill.token)
  const [funding, setFunding] = useState(false)
  const [added, setAdded] = useState(false)
  const act = Pay.useFlow(props.slot)
  const told = useRef<HTMLDivElement>(null)
  const steer = useRef<HTMLInputElement>(null)
  const sum = useRef<HTMLInputElement>(null)
  const was = useRef(act.at)
  const done = useRef(props.onDone)
  done.current = props.onDone
  useEffect(() => {
    const moved = was.current !== act.at
    was.current = act.at
    if (moved && act.at === 'counted') done.current({ id: act.swarm, ...(act.node ? { node: act.node } : {}), ...(act.parent ? { parent: act.parent } : {}), ...(act.title ? { title: act.title } : {}) })
    if (moved && (act.at === 'counted' || act.at === 'failed' || act.at === 'owed' || act.at === 'refused')) told.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [act])
  useEffect(() => {
    if (props.focus && !matchMedia('(pointer: coarse)').matches) (props.steers === false || props.first ? sum : steer).current?.focus({ preventScroll: true })
  }, [props.focus])
  useEffect(() => {
    if (!props.config) return
    Wallet.warm(props.config)
    void import('../shared/Credit.ts')
  }, [props.config])
  const busy = Pay.busy(act)
  const token = picked ?? choose(amount, wallet.balances)
  const floor = props.least ?? smallest
  const ok = valid(amount, floor)
  const signed = !!wallet.session
  const ready = ok && props.note.length <= maxNote && !!props.config && !busy && !props.locked && !props.ended && act.at !== 'owed' && !funding
  const text = props.note.trim()
  const least = Math.ceil(Number(floor) * 100) / 100
  const marks = grown(least > stops[0] ? [least, ...stops.filter((stop) => stop > least)] : stops, amount)
  const at = nearest(amount, marks)
  const verb = props.first ? 'Start it' : (props.verb ?? 'Ride it')
  const said = props.creates && !signed ? `Sign in and ${verb.charAt(0).toLowerCase()}${verb.slice(1)}` : verb

  const fund = async () => {
    if (!props.config || funding) return
    setFunding(true)
    setAdded(false)
    try {
      if ((await Wallet.fund(props.config)) !== 'received') return
      if (Pay.flow(props.slot).at === 'failed') Pay.forget(props.slot)
      setAdded(true)
    } catch {
    } finally {
      setFunding(false)
    }
  }

  const retry = () => void Pay.retry(props.slot)

  const submit = async () => {
    const config = props.config
    const start = { creates: !!props.creates, signed: !!Wallet.snapshot().session, type: 'start' } as const
    if (!config || !ready || !Pay.can(props.slot, start)) return
    Pay.move(props.slot, start)
    setAdded(false)
    try {
      if (start.creates && !start.signed) {
        await Wallet.signIn(config)
        Pay.move(props.slot, { type: 'signed' })
      }
      const target = await props.target()
      if (start.creates) Pay.move(props.slot, { type: 'created' })
      const owed = await transfer(config, target, units(amount), text, token, start.creates)
      props.onNote('')
      void Pay.record(owed, props.slot)
      props.onSent?.(target)
    } catch (error) {
      const failed = { error: message(error), type: 'failed' } as const
      if (Pay.can(props.slot, failed)) Pay.move(props.slot, failed)
    }
  }

  return (
    <div className="fuel" data-at={act.at} data-size={props.compact ? 'compact' : undefined}>
      <div className="fuel-amount">
        <label className="fuel-sum">
          <span aria-hidden="true">$</span>
          <input aria-label="Amount in dollars" disabled={busy} id="amount" inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(',', '.').replace('$', ''))} ref={sum} style={{ width: `${Math.max(1, amount.length) + 0.4}ch` }} value={amount} />
        </label>
        <input aria-label="Amount" aria-valuetext={dollars(String(marks[at]))} className="fuel-slide" disabled={busy} max={marks.length - 1} min={0} onChange={(event) => setAmount(String(marks[Number(event.target.value)]))} step={1} style={{ '--fill': `${(at / (marks.length - 1)) * 100}%` } as CSSProperties} type="range" value={at} />
        <p className="fuel-ends"><span>{dollars(String(marks[0]))}</span><span>{dollars(String(marks[marks.length - 1]))}</span></p>
      </div>
      {floor !== smallest && !ok && <p className="fuel-least" data-bad={amount.trim() !== ''}>At least {dollars(floor)}</p>}
      {props.extra}
      {!props.first && props.steers !== false && <input aria-label={props.ask ?? 'What should it try next?'} className="fuel-steer" disabled={busy} maxLength={maxNote} onChange={(event) => props.onNote(event.target.value)} placeholder={`${props.ask ?? 'What should it try next?'} (optional)`} ref={steer} value={props.note} />}
      <button aria-busy={busy || undefined} className="btn btn-high fuel-go" disabled={!ready} onClick={() => void submit()} type="button">
        {busy ? working[act.at as keyof typeof working] : funding ? 'Adding funds…' : props.ended ? 'Ended' : props.locked && props.wants ? props.wants : ok ? `${said} · ${dollars(amount)}` : said}
      </button>
      <div className="fuel-told" ref={told}>
        {props.ended && (act.at === 'idle' || act.at === 'failed') ? <Alert title={props.ended} tone="warn" /> : added && act.at === 'idle' ? <Alert title="Funds added." tone="good">{wallet.balance === undefined ? 'Ride it now.' : `Your wallet has ${usd(decimal(wallet.balance))}. Ride it now.`}</Alert> : <Told act={act} config={props.config} onFund={() => void fund()} onRetry={retry} slot={props.slot} />}
      </div>
    </div>
  )
}
