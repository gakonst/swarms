import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Config, Currency } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { mach, short } from './format.ts'
import { message, useWallet } from './hooks.ts'
import { Alert, explain } from './Alert.tsx'
import * as Pay from './pay.ts'
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

const working = {
  connect: 'Connecting Tempo Wallet…',
  create: 'Setting up…',
  record: 'Recording…',
  send: 'Approve in Tempo Wallet…',
} as const satisfies Record<Pay.Working, string>

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

async function transfer(config: Config, target: Target, amount: bigint, note: string, token: Currency): Promise<Pay.Owed> {
  if (!config.credit) throw new Error('Riding is not available right now. Try again in a moment.')
  const { memo } = await import('../shared/Credit.ts')
  const hash = await Wallet.send(config, { amount, memo: memo(config.credit.owner, target.id, note), to: config.credit.recipient, token })
  return { amount: decimal(amount), hash, note, swarm: target.id }
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
  onSent?: ((target: Target) => void) | undefined
  prefill: Prefill
  sign?: boolean | undefined
  slot: string
  steers?: boolean | undefined
  target: (step: (step: 'create') => void) => Promise<Target>
}) {
  const wallet = useWallet()
  const [amount, setAmount] = useState(props.prefill.amount)
  const [picked] = useState<Currency | undefined>(props.prefill.token)
  const flow = Pay.useFlow(props.slot)
  const told = useRef<HTMLDivElement>(null)
  const steer = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (flow.at === 'done' || flow.at === 'failed' || flow.at === 'unrecorded') told.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [flow.at])
  useEffect(() => {
    if (props.focus) steer.current?.focus({ preventScroll: true })
  }, [props.focus])
  const busy = flow.at === 'busy'
  const step = (next: Pay.Working) => Pay.move(props.slot, { at: 'busy', step: next })
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

  const record = async (owed: Pay.Owed) => {
    const target = { id: owed.swarm }
    const counting = Pay.record(owed, props.slot)
    props.onNote('')
    props.onSent?.(target)
    if ((await counting).at === 'counted') props.onDone(target)
  }

  const submit = async () => {
    const config = props.config
    if (!config || !ready) return
    try {
      let using = token
      if (props.sign ? !Wallet.snapshot().session : !Wallet.snapshot().address) {
        step('connect')
        await (props.sign ? Wallet.signIn(config) : Wallet.connect(config))
        await Wallet.refresh(config).catch(() => {})
        using = picked ?? choose(amount, Wallet.snapshot().balances)
      }
      const held = Wallet.snapshot().balances[using]
      if (held !== undefined && held < units(amount)) throw Object.assign(new Error('Your wallet holds less than this.'), { code: 'insufficient_balance' })
      const target = await props.target((next) => step(next))
      step('send')
      const approved = approves(units(amount), using) ? await approve(config, target, units(amount), text) : undefined
      if (!approved) return await record(await transfer(config, target, units(amount), text, using))
      Pay.move(props.slot, { amount: decimal(units(amount)), at: 'done', kept: true })
      props.onNote('')
      props.onSent?.(target)
      props.onDone(target)
    } catch (error) {
      Pay.move(props.slot, { at: 'failed', error: message(error) })
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
      {!props.first && props.steers !== false && <input aria-label="What should it try next?" className="fuel-steer" disabled={busy} maxLength={maxNote} onChange={(event) => props.onNote(event.target.value)} placeholder="What should it try next? (optional)" ref={steer} value={props.note} />}
      <button className="btn btn-high fuel-go" disabled={!ready} onClick={() => void submit()} type="button">
        {flow.at === 'busy' ? working[flow.step] : ok ? `${props.first ? 'Start it' : 'Ride it'} · ${dollars(amount)}` : props.first ? 'Start it' : 'Ride it'}
      </button>
      <div className="fuel-told" ref={told}>
        {low && flow.at !== 'failed' && <Alert title="Not enough in your wallet." tone="warn">Add money in Tempo Wallet first.</Alert>}
        {flow.at === 'done' && <Alert action={{ label: 'Add more', onClick: () => Pay.move(props.slot, Pay.idle) }} title={`You're riding. ${dollars(flow.amount)} is in.`} tone="good">{flow.kept ? 'Thank you! It stays in your wallet until the AI spends it.' : 'Thank you!'}</Alert>}
        {flow.at === 'unrecorded' && (
          <Alert action={{ label: 'Try again', onClick: () => void record(flow.owed) }} title="Sent, but not counted yet." tone="warn">
            Nothing is paid twice.
          </Alert>
        )}
        {flow.at === 'failed' && !flow.hash && (
          <Alert title={explain(flow.error).title} tone="bad">
            {explain(flow.error).detail}
          </Alert>
        )}
        {flow.at === 'failed' && flow.hash && (
          <Alert action={props.config && { href: `${props.config.explorer}/tx/${flow.hash}`, label: short(flow.hash) }} title="Sent, but it cannot be counted." tone="bad">
            {flow.error}
          </Alert>
        )}
      </div>
    </div>
  )
}
