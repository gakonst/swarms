import type { Address, Hex } from 'viem'
import type { Account, Config, Currency } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import * as Site from '../shared/Site.ts'
import * as Api from './api.ts'
import { fixture } from './api.ts'
import { boot, type Face, faceCookie, server } from './boot.ts'
import { pace, scene, visitor } from './stage.ts'

export type Session = { address: Address; token: string }

export type State = {
  account: Account | undefined
  address: Address | undefined
  balance: bigint | undefined
  balances: Partial<Record<Currency, bigint>>
  email: string | undefined
  pending: boolean
  session: Session | undefined
}

let instance: ReturnType<typeof load> | undefined

async function load(config: Config) {
  const { Accounts } = await import('accounts')
  return Accounts.create({ chain: config.chainId })
}

const chain = () => Promise.all([import('viem'), import('viem/tempo'), import('viem/tempo/chains')])

const kept = 'swarms.session'

function stored(): Session | undefined {
  if (server) return undefined
  if (fixture) return scene.has('in') ? { address: visitor, token: 'fixture' } : scene.has('expired') ? { address: visitor, token: 'expired' } : undefined
  try {
    const value = JSON.parse(localStorage.getItem(kept) ?? 'null') as Session | null
    return value?.address && value.token ? value : undefined
  } catch {
    return undefined
  }
}

const faced = 'swarms.face'


function face(): Face | undefined {
  if (server || fixture) return undefined
  try {
    const value = JSON.parse(localStorage.getItem(faced) ?? 'null') as Face | null
    return value?.address ? value : undefined
  } catch {
    return undefined
  }
}

const seen = face()

const session = stored()

const same = (address: Address | undefined) => !!address && seen?.address.toLowerCase() === address.toLowerCase()

function lower<T extends Address | undefined>(address: T) {
  return address?.toLowerCase() as T
}

let state: State = {
  account: session && same(session.address) ? seen?.account : undefined,
  address: lower(session?.address ?? (fixture ? undefined : seen?.address)),
  balance: same(session?.address ?? seen?.address) && seen?.balance !== undefined ? BigInt(seen.balance) : undefined,
  balances: {},
  email: same(session?.address ?? seen?.address) ? seen?.email : undefined,
  pending: !session && !!seen && !fixture,
  session: session && { ...session, address: lower(session.address) },
}

function mirror() {
  if (server || fixture) return
  const value = state.address ? encodeURIComponent(JSON.stringify({ account: state.account, address: state.address, balance: state.balance?.toString(), email: state.email } satisfies Face)) : ''
  document.cookie = value ? `${faceCookie}=${value}; path=/; max-age=31536000; samesite=lax` : `${faceCookie}=; path=/; max-age=0; samesite=lax`
}

mirror()

const seeds = new WeakMap<object, State>()

const empty: State = { account: undefined, address: undefined, balance: undefined, balances: {}, email: undefined, pending: false, session: undefined }

export function initial(): State {
  const current = boot()
  if (!current) return empty
  let seed = seeds.get(current)
  if (!seed) {
    const remembered = current.face
    seed = { ...empty, account: remembered?.account, address: remembered?.address, balance: remembered?.balance === undefined ? undefined : BigInt(remembered.balance), email: remembered?.email, pending: !!remembered }
    seeds.set(current, seed)
  }
  return seed
}

let checked = fixture

Api.authorize(state.session?.token)

const listeners = new Set<() => void>()

function wallet(config: Config) {
  instance ??= load(config)
  return instance
}

function set(change: Partial<State>) {
  const next = { ...change, ...(change.address ? { address: lower(change.address) } : {}), ...(change.session ? { session: { ...change.session, address: lower(change.session.address) } } : {}) }
  state = { ...state, ...next }
  if ('session' in next) {
    Api.authorize(next.session?.token)
    if (!fixture) {
      if (next.session) localStorage.setItem(kept, JSON.stringify(next.session))
      else localStorage.removeItem(kept)
    }
  }
  if (!fixture) {
    if (state.address) localStorage.setItem(faced, JSON.stringify({ account: state.account, address: state.address, balance: state.balance?.toString(), email: state.email } satisfies Face))
    else localStorage.removeItem(faced)
    mirror()
  }
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function snapshot() {
  return state
}

function asked() {
  if (scene.has('hang')) return new Promise<never>(() => {})
  if (scene.has('deny')) return new Promise<never>((_, reject) => setTimeout(() => reject(new Error('You declined the request in Tempo ID.')), 900 * pace))
  return new Promise((resolve) => setTimeout(resolve, 1200 * pace))
}

export async function restore(config: Config) {
  if (!checked) {
    checked = true
    if (state.pending) set({ pending: false })
  }
  if (state.address) await refresh(config)
}

function declined(error: unknown): never {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if ((error instanceof Error && error.name === 'AbortError') || code === 'access_denied') throw new Error('You declined the request in Tempo ID.')
  throw error
}

async function post<T>(config: Config, path: string, body: object, signal?: AbortSignal) {
  const response = await fetch(Site.at(config.auth + path), { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST', ...(signal ? { signal } : {}) })
  const answer = (await response.json().catch(() => ({}))) as T & { detail?: string }
  if (!response.ok) throw new Api.Failure(answer, response.status)
  return answer
}

type Challenge = { id: string; message: string }

let ready: { at: number; challenge: Promise<Challenge> } | undefined

function challenge(config: Config, take = false) {
  if (!ready || Date.now() - ready.at > 5 * 60_000) {
    const flight = { at: Date.now(), challenge: post<Challenge>(config, '/challenge', {}) }
    flight.challenge.catch(() => {
      if (ready === flight) ready = undefined
    })
    ready = flight
  }
  const held = ready.challenge
  if (take) ready = undefined
  return held
}

export function warm(config: Config) {
  if (fixture || server) return
  void wallet(config)
  if (!state.session) void challenge(config).catch(() => {})
}

let renewing: Promise<string> | undefined

Api.renew(() => {
  renewing ??= Api.config()
    .then((config) => signIn(config))
    .then((session) => session.token)
    .finally(() => {
      renewing = undefined
    })
  return renewing
})

export async function signIn(config: Config) {
  if (fixture) {
    await asked()
    const session = { address: visitor, token: 'fixture' } satisfies Session
    set({ address: session.address, pending: false, session })
    void identify()
    return session
  }
  const [accounts, asking] = await Promise.all([wallet(config), challenge(config, true)])
  const signed = await accounts.dialog.signIn({ challenge: asking.message }).catch(declined)
  void accounts.signOut().catch(() => {})
  if (!signed.address || !signed.challengeSignature) throw new Error('Tempo ID returned no signature.')
  const { token } = await post<{ token: string }>(config, '', { address: signed.address, id: asking.id, message: asking.message, signature: signed.challengeSignature })
  const session = { address: signed.address, token }
  set({ account: undefined, address: signed.address, email: signed.user.email, pending: false, session })
  void refresh(config).catch(() => {})
  void identify()
  return session
}

let identifying: { promise: Promise<Account | undefined>; token: string } | undefined

let renamed = 0

export function identify() {
  const token = state.session?.token
  if (!token) return Promise.resolve(undefined)
  if (identifying?.token === token) return identifying.promise
  const at = renamed
  const flight = { promise: read(token, at), token }
  identifying = flight
  void flight.promise.finally(() => {
    if (identifying === flight) identifying = undefined
  })
  return flight.promise
}

async function read(token: string, at: number) {
  try {
    const account = await Api.account()
    if (state.session?.token !== token) return undefined
    if (renamed !== at) return state.account
    set({ account })
    return account
  } catch (error) {
    if (error instanceof Api.Failure && error.status === 401 && state.session?.token === token) signOut()
    return undefined
  }
}

export async function named() {
  const account = state.account ?? (await identify())
  if (state.session && !account?.name) throw Object.assign(new Error('Pick a username first: people see it beside what you steer.'), { code: 'username_required' })
}

export async function rename(name: string | null) {
  const account = await Api.rename(name)
  renamed += 1
  set({ account })
  return account
}

export function signOut() {
  const token = state.session?.token
  set({ account: undefined, session: undefined })
  if (token && !fixture) void fetch(Site.at('/v1/auth/logout'), { headers: { authorization: `Bearer ${token}` }, method: 'POST' }).catch(() => {})
}

export function disconnect() {
  signOut()
  set({ address: undefined, balance: undefined, balances: {}, email: undefined, pending: false })
}

export async function send(config: Config, input: { amount: bigint; memo: Hex; to: Address; token: Currency }) {
  if (fixture) {
    const [fixtures] = await Promise.all([import('./fixtures.ts'), asked()])
    if (fixtures.balances[input.token] < input.amount) throw Object.assign(new Error(`Your wallet holds less than this.`), { code: 'insufficient_balance' })
    const hash = `0x${Date.now().toString(16).padStart(64, '5')}` as Hex
    fixtures.sent.set(hash, { amount: input.amount, token: input.token })
    if (!state.session) set({ address: visitor, pending: false, session: { address: visitor, token: 'fixture' } })
    return hash
  }
  const token = config.tokens.find((item) => item.id === input.token)
  if (!token) throw new Error('That token is not offered.')
  const payment = { amount: decimal(input.amount), memo: input.memo, to: input.to, token: token.address }
  const accounts = await wallet(config)
  if (state.session) {
    const { transaction } = await accounts.pay({ ...payment, account: state.session.address }).catch(declined)
    void refresh(config).catch(() => {})
    return transaction
  }
  const asking = await challenge(config, true)
  const paid = await accounts.pay({ ...payment, challenge: asking.message }).catch((error) => {
    warm(config)
    return declined(error)
  })
  const switched = paid.address.toLowerCase() !== state.address
  set({ ...(switched ? { account: undefined, balance: undefined, balances: {}, email: undefined } : {}), address: paid.address, pending: false })
  await post<{ token: string }>(config, '', { address: paid.address, id: asking.id, message: asking.message, signature: paid.challengeSignature }).then(
    ({ token }) => {
      set({ session: { address: paid.address, token } })
      void identify()
    },
    () => {},
  )
  void refresh(config).catch(() => {})
  return paid.transaction
}

export async function refresh(config: Config) {
  const address = state.address
  if (!address) return undefined
  const [loaded, fixtures] = fixture ? [undefined, await import('./fixtures.ts')] : [await chain(), undefined]
  const client = loaded ? loaded[1].createClient({ chain: loaded[2].tempo, transport: loaded[1].http(config.rpc) }) : undefined
  const read = (token: Config['tokens'][number]) =>
    !loaded || !client
      ? Promise.resolve(fixtures?.balances[token.id])
      : loaded[1].Actions.token.getBalance(client, { account: address, token: token.address }).then((balance) => balance.amount)
  const entries = await Promise.all(config.tokens.map(async (token) => [token.id, await read(token).catch(() => undefined)] as const))
  const balances = Object.fromEntries(entries.filter((entry): entry is readonly [Currency, bigint] => entry[1] !== undefined)) as Partial<Record<Currency, bigint>>
  const balance = Object.values(balances).reduce((sum, value) => sum + value, 0n)
  if (state.address === address) set({ balance, balances })
  return balance
}
