import type { Address, Hex } from 'viem'
import type { Account, Config, Currency } from '../shared/Api.ts'
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
  pending: boolean
  session: Session | undefined
}

let provider: Promise<Awaited<ReturnType<typeof load>>['provider']> | undefined

async function load() {
  const { Mach, Provider, tempoWallet } = await import('accounts')
  return { Mach, provider: Provider.create({ adapter: tempoWallet(), mpp: false }) }
}

let known: Config | undefined

const keyDays = 30

const keyLimit = 100_000_000n

const transferWithMemo = '0x95777d59'

let keyless = false

function encoded(config: Config) {
  const stable = config.tokens.filter((token) => token.id !== 'mach')
  return {
    expiry: Math.floor(Date.now() / 1000) + keyDays * 86_400,
    limits: stable.map((token) => ({ limit: `0x${keyLimit.toString(16)}`, token: token.address })),
    scopes: stable.map((token) => ({ address: token.address, selector: transferWithMemo })),
  }
}

async function keyed(config: Config, calls: readonly { data: Hex; to: Address }[]) {
  if (!state.session || keyless) return
  const provider = await wallet()
  const status = await provider.getAccessKeyStatus({ calls }).catch(() => 'missing' as const)
  if (status !== 'missing' && status !== 'expired') return
  await provider.request({ method: 'wallet_authorizeAccessKey', params: [encoded(config)] } as never).catch((error: unknown) => {
    keyless = true
    if (!declined(error)) console.warn('Tempo Wallet did not authorize an access key', error)
  })
}

const chain = () => Promise.all([import('viem'), import('viem/tempo'), import('viem/tempo/chains')])

const kept = 'swarms.session'

function stored(): Session | undefined {
  if (server) return undefined
  if (fixture) return scene.has('in') ? { address: visitor, token: 'fixture' } : undefined
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

let state: State = {
  account: session && same(session.address) ? seen?.account : undefined,
  address: session?.address ?? (fixture ? undefined : seen?.address),
  balance: same(session?.address ?? seen?.address) && seen?.balance !== undefined ? BigInt(seen.balance) : undefined,
  balances: {},
  pending: !session && !!seen && !fixture,
  session,
}

function mirror() {
  if (server || fixture) return
  const value = state.address ? encodeURIComponent(JSON.stringify({ account: state.account, address: state.address, balance: state.balance?.toString() } satisfies Face)) : ''
  document.cookie = value ? `${faceCookie}=${value}; path=/; max-age=31536000; samesite=lax` : `${faceCookie}=; path=/; max-age=0; samesite=lax`
}

mirror()

const seeds = new WeakMap<object, State>()

const empty: State = { account: undefined, address: undefined, balance: undefined, balances: {}, pending: false, session: undefined }

export function initial(): State {
  const current = boot()
  if (!current) return empty
  let seed = seeds.get(current)
  if (!seed) {
    const remembered = current.face
    seed = { ...empty, account: remembered?.account, address: remembered?.address, balance: remembered?.balance === undefined ? undefined : BigInt(remembered.balance), pending: !!remembered }
    seeds.set(current, seed)
  }
  return seed
}

let checked = fixture

let parted = 0

Api.authorize(state.session?.token)

const listeners = new Set<() => void>()

function wallet() {
  provider ??= load().then((loaded) => loaded.provider)
  return provider
}

const remembered = 'swarms.wallet'

function set(next: Partial<State>) {
  state = { ...state, ...next }
  if (next.address && !fixture) localStorage.setItem(remembered, next.address)
  if ('session' in next) {
    Api.authorize(next.session?.token)
    if (!fixture) {
      if (next.session) localStorage.setItem(kept, JSON.stringify(next.session))
      else localStorage.removeItem(kept)
    }
  }
  if (!fixture) {
    if (state.address) localStorage.setItem(faced, JSON.stringify({ account: state.account, address: state.address, balance: state.balance?.toString() } satisfies Face))
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
  if (scene.has('deny')) return new Promise<never>((_, reject) => setTimeout(() => reject(new Error('You declined the request in Tempo Wallet.')), 900 * pace))
  return new Promise((resolve) => setTimeout(resolve, 1200 * pace))
}

function declined(error: unknown) {
  return (error as { code?: number } | undefined)?.code === 4001 || /reject|declin|denied|cancel/i.test(String((error as Error | undefined)?.message ?? error))
}

export async function restore(config: Config) {
  known = config
  if (!checked) {
    checked = true
    if (state.session) {
      if (state.pending) set({ pending: false })
      return void refresh(config).catch(() => {})
    }
    if (!state.address && !localStorage.getItem(remembered)) return
    const at = parted
    const accounts = await (await wallet())
      .request({ method: 'eth_accounts' })
      .catch(() => [] as readonly Address[])
    if (parted !== at) return
    const address = accounts[0]
    if (state.pending) set({ pending: false })
    if (!address) return set({ account: undefined, address: undefined, balance: undefined, balances: {} })
    if (address.toLowerCase() !== state.address?.toLowerCase()) set({ account: undefined, address, balance: undefined, balances: {} })
  }
  if (state.address) await refresh(config)
}

export async function connect(config: Config) {
  known = config
  if (fixture) {
    if (!state.address) set({ address: visitor })
    return state.address ?? visitor
  }
  const provider = await wallet()
  const listed = (await provider.request({ method: 'eth_accounts' }).catch(() => [] as readonly Address[]))[0]
  const address = listed ?? (await provider.request({ method: 'eth_requestAccounts' }))[0]
  if (!address) throw new Error('Tempo Wallet returned no account.')
  if (address.toLowerCase() === state.address?.toLowerCase()) return state.address
  const switched = !!state.session && state.session.address.toLowerCase() !== address.toLowerCase()
  set({ account: switched ? undefined : state.account, address, ...(switched ? { session: undefined } : {}) })
  void refresh(config).catch(() => {})
  return address
}

export async function authorize(config: Config, authorizeAccessKey: unknown) {
  if (fixture) {
    await asked()
    set({ address: visitor })
    return { address: visitor, keyAuthorization: {} as unknown }
  }
  const result = (await (await wallet()).request({ method: 'wallet_connect', params: [{ capabilities: { authorizeAccessKey }, chainId: config.chainId }] } as never)) as {
    accounts: readonly { address: Address; capabilities?: { keyAuthorization?: unknown } }[]
  }
  const account = result.accounts[0]
  const keyAuthorization = account?.capabilities?.keyAuthorization
  if (!account || !keyAuthorization) throw new Error('Tempo Wallet returned no approval.')
  set({ address: account.address })
  return { address: account.address, keyAuthorization }
}

export async function signIn(config: Config) {
  if (fixture) {
    await asked()
    const session = { address: visitor, token: 'fixture' } satisfies Session
    set({ address: session.address, session })
    void identify()
    return session
  }
  known = config
  const provider = await wallet()
  const connect = (capabilities: Record<string, unknown>) =>
    provider.request({ method: 'wallet_connect', params: [{ capabilities: { auth: { returnToken: true, url: config.auth }, ...capabilities }, chainId: config.chainId }] } as never) as Promise<{
      accounts: readonly { address: Address; capabilities?: { auth?: { token?: string } } }[]
    }>
  const result = await connect({ authorizeAccessKey: encoded(config) }).catch((error: unknown) => {
    if (declined(error)) throw error
    return connect({})
  })
  const account = result.accounts[0]
  const token = account?.capabilities?.auth?.token
  if (!account || !token) throw new Error('Tempo Wallet returned no session.')
  const session = { address: account.address.toLowerCase() as Address, token }
  set({ account: undefined, address: account.address, session })
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
  if (token && !fixture) void fetch('/v1/auth/logout', { headers: { authorization: `Bearer ${token}` }, method: 'POST' }).catch(() => {})
}

export async function disconnect() {
  parted += 1
  keyless = false
  signOut()
  set({ address: undefined, balance: undefined, balances: {}, pending: false })
  if (fixture) return
  localStorage.removeItem(remembered)
  await (await wallet()).request({ method: 'wallet_disconnect' }).catch(() => {})
}

export async function send(config: Config, input: { amount: bigint; memo: Hex; to: Address; token: Currency }) {
  if (fixture) {
    const [fixtures] = await Promise.all([import('./fixtures.ts'), asked()])
    if (fixtures.balances[input.token] < input.amount) throw Object.assign(new Error(`Your wallet holds less than this.`), { code: 'insufficient_balance' })
    const hash = `0x${Date.now().toString(16).padStart(64, '5')}` as Hex
    fixtures.sent.set(hash, input.amount)
    return hash
  }
  const address = await connect(config)
  const token = config.tokens.find((item) => item.id === input.token)
  if (!token) throw new Error('That token is not offered.')
  const [{ encodeFunctionData }, { Abis }] = await chain()
  const calls = [{ data: encodeFunctionData({ abi: Abis.tip20, args: [input.to, input.amount, input.memo], functionName: 'transferWithMemo' }), to: token.address }]
  await keyed(config, calls)
  const receipt = (await (await wallet()).request({
    method: 'eth_sendTransactionSync',
    params: [{ calls, feeToken: token.address, from: address }],
  } as never)) as { status?: string; transactionHash?: Hex }
  if (!receipt.transactionHash) throw new Error('Tempo Wallet returned no transaction.')
  if (receipt.status && receipt.status !== 'success' && receipt.status !== '0x1') throw new Error('The transfer reverted.')
  void refresh(config).catch(() => {})
  return receipt.transactionHash
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
  if (state.address === address) set({ balance: balances.mach, balances })
  return balances.mach
}

export function fund(shortfall?: bigint) {
  const address = state.address
  if (fixture || !address) return Promise.resolve()
  const cents = shortfall === undefined ? 0n : (shortfall + 9_999n) / 10_000n
  const amount = cents > 0n ? `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` : undefined
  return Promise.all([import('accounts'), wallet()]).then(([{ Mach }, connected]) => Mach.fund(connected, { address, displayName: 'Swarms', ...(amount ? { amount } : {}) }))
}
