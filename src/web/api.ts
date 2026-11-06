import type { Account, Artifact, Branch, Branches, BudgetRequested, Budgeted, Chatter, Config, Contributed, Currency, Detail, Entry, Issued, Lent, Live, Pledged, Posted, Problem, Requested, Room, Roster, Snapshot, Steering, Summary, Token } from '../shared/Api.ts'
import type * as Btw from '../shared/Btw.ts'
import { seeded } from './boot.ts'
import { visitor } from './stage.ts'

export const fixture = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fixture')

function staged<T>(run: (fixtures: typeof import('./fixtures.ts')) => T | Promise<T>): Promise<T> {
  return import('./fixtures.ts').then(run)
}

export class Failure extends Error {
  readonly code: string
  readonly status: number
  constructor(problem: Partial<Problem>, status: number) {
    super(problem.detail ?? `The server answered ${status}.`)
    this.code = problem.code ?? 'unknown'
    this.status = status
  }
}

let loaded: Promise<Config> | undefined

let bearer: string | undefined

export function authorize(token: string | undefined) {
  bearer = token
}

async function request<T>(path: string, body?: unknown, method?: 'DELETE'): Promise<T> {
  const headers: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : {}
  const response = await fetch(path, method ? { headers, method } : body === undefined ? { headers } : { body: JSON.stringify(body), headers: { ...headers, 'content-type': 'application/json' }, method: 'POST' })
  const data: unknown = await response.json().catch(() => undefined)
  if (response.ok) return data as T
  throw new Failure((data ?? {}) as Partial<Problem>, response.status)
}

function path(id: string) {
  return `/api/swarms/${encodeURIComponent(id)}`
}

export function config() {
  loaded ??= fixture ? staged((fixtures) => fixtures.config()) : request<Config>('/api/config')
  loaded.catch(() => {
    loaded = undefined
  })
  return loaded
}

export function swarms() {
  return fixture ? staged((fixtures) => fixtures.swarms()) : request<{ swarms: Summary[] }>('/api/swarms')
}

export function swarm(id: string, feed = true) {
  return fixture ? staged((fixtures) => fixtures.swarm(id)) : request<Detail>(feed ? path(id) : `${path(id)}?feed=0`)
}

const snapshots = new Map<string, { at: number; read: Promise<Snapshot | null>; value?: Snapshot | null }>()

export function code(id: string, fresh = false) {
  const known = snapshots.get(id)
  if (known && !fresh && Date.now() - known.at < 30_000) return known.read
  const entry: { at: number; read: Promise<Snapshot | null>; value?: Snapshot | null } = {
    at: Date.now(),
    read: fixture ? Promise.resolve(null) : request<{ snapshot: Snapshot | null }>(`${path(id)}/code`).then((body) => (entry.value = body.snapshot)),
  }
  entry.read.catch(() => snapshots.delete(id))
  snapshots.set(id, entry)
  return entry.read
}

export function coded(id: string) {
  return snapshots.get(id)?.value ?? seeded<Snapshot>(`code:${id}`)
}

export function feed(id: string, after: number, filter: { before?: number; who?: string } = {}) {
  const query = new URLSearchParams({ after: String(after) })
  if (filter.before !== undefined) query.set('before', String(filter.before))
  if (filter.who !== undefined) query.set('who', filter.who)
  return fixture ? staged((fixtures) => fixtures.feed(id, after, filter)) : request<{ entries: Entry[]; next: number }>(`${path(id)}/feed?${query}`)
}

export function live(id: string, listener: (event: Live) => void, after?: () => number, lost?: () => void) {
  if (fixture) {
    let stop: (() => void) | undefined
    let alive = true
    void staged((fixtures) => {
      if (alive) stop = fixtures.live(id, listener)
    })
    return () => {
      alive = false
      stop?.()
    }
  }
  let alive = true
  let source: EventSource | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let seen = 0
  const again = (ms: number) => {
    source?.close()
    if (alive) timer = setTimeout(open, ms)
  }
  const open = () => {
    const cursor = after ? Math.max(after(), seen) : undefined
    source = new EventSource(cursor === undefined ? `${path(id)}/live` : `${path(id)}/live?after=${cursor}`)
    source.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as Live
      if (event.type === 'entry') seen = Math.max(seen, event.entry.seq)
      listener(event)
      if (cursor === undefined && (event.type === 'end' || event.type === 'idle')) again(event.type === 'end' ? 1500 : 4000)
    }
    source.onerror = () => {
      if (lost) lost()
      else listener({ type: 'idle' })
      again(3000)
    }
  }
  open()
  return () => {
    alive = false
    source?.close()
    clearTimeout(timer)
  }
}

export function create(input: { goal: string; problem?: string; title: string }) {
  return fixture ? staged((fixtures) => fixtures.create(input)) : request<Summary>('/api/swarms', input)
}

export function backing(id: string, input: { amount: string; note?: string }) {
  return request<Pledged>(`/v1/swarms/${encodeURIComponent(id)}/backing`, input)
}

export function keyRequest() {
  return request<{ authorizeAccessKey: unknown; key: string }>('/v1/me/key', {})
}

export function keyApprove(key: string, keyAuthorization: unknown) {
  return request<{ expiresAt: number; key: string }>(`/v1/me/key/${encodeURIComponent(key)}`, { keyAuthorization })
}

export function pledge(id: string, input: { amount: string; note?: string; token: Currency }) {
  return fixture ? staged((fixtures) => fixtures.pledge(id, input)) : request<Requested>(`${path(id)}/pledges`, input)
}

export function contribute(id: string, input: { hash: string; note?: string }) {
  return fixture ? staged((fixtures) => fixtures.contribute(id, input)) : request<Contributed>(`${path(id)}/contributions`, input)
}

export function budget(id: string, input: { amount: string; note?: string; token: Token }) {
  return fixture ? staged((fixtures) => fixtures.budget(id, input)) : request<BudgetRequested>(`${path(id)}/budgets`, input)
}

export function allow(id: string, budget: string, keyAuthorization: unknown) {
  return fixture ? staged((fixtures) => fixtures.allow(id, budget)) : request<Budgeted>(`${path(id)}/budgets/${encodeURIComponent(budget)}`, { keyAuthorization })
}

export function hands(id: string) {
  return fixture ? staged((fixtures) => fixtures.lent(id)) : request<{ hands: Lent[] }>(`${path(id)}/hands`)
}

export function hand(id: string, label: string) {
  return fixture
    ? Promise.resolve({ cli: "nc hand 'https://gateway.tempo.xyz/v1/hands/attach' --token hand_demo_4f2a", command: 'curl -fsSL https://nanocode.xyz/install | sh && nc hand ...', label: label ?? '', library: "import { Hand } from 'nanocode'\nawait Hand.connect(url, { token })", name: (label || 'my-machine') + '-3c1f', npm: 'npm i nanocode@build-20f97e0', swarm: id, tab: null, token: 'hand_demo_4f2a', url: 'https://gateway.tempo.xyz/v1/hands/attach' } as Issued)
    : request<Issued>(`${path(id)}/hands`, label ? { label } : {})
}

export function artifacts(id: string) {
  return fixture ? staged((fixtures) => fixtures.artifacts(id)) : request<{ artifacts: Artifact[] }>(`${path(id)}/artifacts`)
}

export function account() {
  return fixture ? staged((fixtures) => fixtures.account(bearer ? visitor : undefined)) : request<Account>('/api/me')
}

export function rename(name: string | null) {
  return fixture ? staged((fixtures) => fixtures.rename(bearer ? visitor : undefined, name)) : request<Account>('/api/me', { name })
}

export function room(id: string, query: { after?: number; before?: number } = {}) {
  const search = new URLSearchParams()
  if (query.after) search.set('after', String(query.after))
  if (query.before) search.set('before', String(query.before))
  return fixture ? staged((fixtures) => fixtures.room(id, query, bearer ? visitor : undefined)) : request<Room>(`${path(id)}/chat?${search}`)
}

export function say(id: string, input: { artifact?: boolean; btw?: readonly Btw.Exchange[]; steer?: string; text: string }) {
  return fixture ? staged((fixtures) => fixtures.say(id, input, bearer ? visitor : undefined)) : request<Posted>(`${path(id)}/chat`, input)
}

export function team(id: string) {
  return fixture ? staged((fixtures) => fixtures.team(id)) : request<Roster>(`${path(id)}/team`)
}

export function steering(id: string, input: { memberBudget?: number | null; steering?: Steering }) {
  return fixture ? staged((fixtures) => fixtures.govern(id, input, bearer ? visitor : undefined)) : request<Roster>(`${path(id)}/team`, input)
}

export function seat(id: string, input: { budget?: number | null; member: string; role: 'admin' | 'member' }) {
  return fixture ? staged((fixtures) => fixtures.seat(id, input, bearer ? visitor : undefined)) : request<Roster>(`${path(id)}/team/members`, input)
}

export function unseat(id: string, member: string) {
  return fixture ? staged((fixtures) => fixtures.unseat(id, member, bearer ? visitor : undefined)) : request<Roster>(`${path(id)}/team/members/${encodeURIComponent(member)}`, undefined, 'DELETE')
}

export function branches(id: string) {
  return fixture ? staged((fixtures) => fixtures.branches(id)) : request<Branches>(`${path(id)}/branches`)
}

export function fund(id: string, branch: number, input: { amount: string; message?: string }) {
  return fixture ? staged((fixtures) => fixtures.fund(id, branch, input, bearer ? visitor : undefined)) : request<Branch>(`${path(id)}/branches/${branch}/fund`, input)
}

export function stop(id: string, branch: number) {
  return fixture ? staged((fixtures) => fixtures.stop(id, branch, bearer ? visitor : undefined)) : request<Branch>(`${path(id)}/branches/${branch}/stop`, {})
}

export function move(id: string, branch: number, input: { amount: string; to: number }) {
  return fixture ? staged((fixtures) => fixtures.move(id, branch, input, bearer ? visitor : undefined)) : request<Branch[]>(`${path(id)}/branches/${branch}/move`, input)
}

export function btw(id: string, input: { branch?: number; question: string; thread: readonly Btw.Exchange[] }) {
  return fixture ? staged((fixtures) => fixtures.btw(id, input, bearer ? visitor : undefined)) : request<Btw.Exchange>(`${path(id)}/btw`, input)
}

export type Line = { close: () => void; hello: () => void; typing: () => void }

export function chatter(id: string, listener: (event: Chatter | { type: 'open' | 'closed' }) => void): Line {
  if (fixture) {
    let line: Line | undefined
    let closed = false
    let greeted = false
    void staged((fixtures) => {
      if (closed) return
      line = fixtures.chatter(id, listener)
      if (greeted) line.hello()
    })
    return {
      close: () => {
        closed = true
        line?.close()
      },
      hello: () => {
        greeted = true
        line?.hello()
      },
      typing: () => line?.typing(),
    }
  }
  let alive = true
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  const send = (data: string) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(data)
  }
  const hello = () => send(JSON.stringify({ token: bearer ?? '', type: 'hello' }))
  const open = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path(id)}/chat/live`)
    socket.onopen = () => {
      if (bearer) hello()
      listener({ type: 'open' })
      ping = setInterval(() => send('ping'), 30_000)
    }
    socket.onmessage = (message) => {
      if (message.data !== 'pong') listener(JSON.parse(String(message.data)) as Chatter)
    }
    socket.onclose = () => {
      clearInterval(ping)
      listener({ type: 'closed' })
      if (alive) timer = setTimeout(open, 3000)
    }
  }
  open()
  return {
    close: () => {
      alive = false
      clearTimeout(timer)
      clearInterval(ping)
      socket?.close()
    },
    hello,
    typing: () => send('{"type":"typing"}'),
  }
}

export function confirm(id: string, pledge: string, keyAuthorization: unknown) {
  return fixture ? staged((fixtures) => fixtures.confirm(id, pledge)) : request<Pledged>(`${path(id)}/pledges/${encodeURIComponent(pledge)}`, { keyAuthorization })
}
