import type { Account, Artifact, Branch, Branches, Chatter, Config, Contributed, Detail, Entry, Issued, Lent, Live, Lobby, Posted, Problem, Room, Roster, Snapshot, Steering, Summary } from '../shared/Api.ts'
import type * as Btw from '../shared/Btw.ts'
import type * as Setup from '../shared/Setup.ts'
import type { Machine } from '../shared/Fleet.ts'
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

function who() {
  return bearer && bearer !== 'expired' ? visitor : undefined
}

let renewal: (() => Promise<string>) | undefined

export function renew(handler: () => Promise<string>) {
  renewal = handler
}

async function signed<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (status !== 401 || !renewal) throw error
    await renewal()
    return run()
  }
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

export function live(id: string, after: () => number, listener: (event: Live | { type: 'lost' | 'open' }) => void) {
  if (fixture) {
    let stop: (() => void) | undefined
    let alive = true
    void staged((fixtures) => {
      if (alive) stop = fixtures.live(id, after(), listener)
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
  const open = () => {
    const opened = Date.now()
    let fed = false
    source = new EventSource(`${path(id)}/live?after=${Math.max(after(), seen)}`)
    source.onopen = () => listener({ type: 'open' })
    source.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as Live
      if (event.type === 'entry' && event.entry.seq > seen) {
        seen = event.entry.seq
        fed = true
      }
      listener(event)
    }
    source.onerror = () => {
      source?.close()
      listener({ type: 'lost' })
      if (alive) timer = setTimeout(open, fed || Date.now() - opened > 30_000 ? 0 : 3000)
    }
  }
  open()
  return () => {
    alive = false
    source?.close()
    clearTimeout(timer)
  }
}

export function create(input: { goal: string; problem?: string; title: string } & Partial<Setup.Choice>) {
  return fixture ? staged((fixtures) => fixtures.create(input)) : request<Summary>('/api/swarms', input)
}

export function contribute(id: string, input: { hash?: string; note?: string; transaction?: string }) {
  return fixture ? staged((fixtures) => fixtures.contribute(id, input)) : request<Contributed>(`${path(id)}/contributions`, input)
}

export function hands(id: string) {
  return fixture ? staged((fixtures) => fixtures.lent(id)) : request<{ hands: Lent[] }>(`${path(id)}/hands`)
}

export function machines(id: string) {
  return fixture ? Promise.resolve({ machines: [] as Machine[] }) : request<{ machines: Machine[] }>(`/v1/swarms/${encodeURIComponent(id)}/machines`)
}

export function hand(id: string, label: string) {
  return signed(() =>
    fixture
      ? Promise.resolve({ cli: "nc hand 'https://gateway.tempo.xyz/v1/hands/attach' --token hand_demo_4f2a", command: 'curl -fsSL https://nanocode.xyz/install | sh && nc hand ...', label: label ?? '', library: "import { Hand } from 'nanocode'\nawait Hand.connect(url, { token })", name: (label || 'my-machine') + '-3c1f', npm: 'npm i nanocode@build-20f97e0', swarm: id, tab: null, token: 'hand_demo_4f2a', url: 'https://gateway.tempo.xyz/v1/hands/attach' } as Issued)
      : request<Issued>(`${path(id)}/hands`, label ? { label } : {}),
  )
}

export function artifacts(id: string) {
  return fixture ? staged((fixtures) => fixtures.artifacts(id)) : request<{ artifacts: Artifact[] }>(`${path(id)}/artifacts`)
}

export function account() {
  return fixture ? staged((fixtures) => fixtures.account(bearer ? visitor : undefined)) : request<Account>('/api/me')
}

export function rename(name: string | null) {
  return signed(() => fixture ? staged((fixtures) => fixtures.rename(who(), name)) : request<Account>('/api/me', { name }))
}

export function room(id: string, query: { after?: number; before?: number } = {}) {
  const search = new URLSearchParams()
  if (query.after) search.set('after', String(query.after))
  if (query.before) search.set('before', String(query.before))
  return fixture ? staged((fixtures) => fixtures.room(id, query, bearer ? visitor : undefined)) : request<Room>(`${path(id)}/chat?${search}`)
}

export function say(id: string, input: { artifact?: boolean; btw?: readonly Btw.Exchange[]; steer?: string; text: string }) {
  return signed(() => fixture ? staged((fixtures) => fixtures.say(id, input, who())) : request<Posted>(`${path(id)}/chat`, input))
}

export function team(id: string) {
  return fixture ? staged((fixtures) => fixtures.team(id)) : request<Roster>(`${path(id)}/team`)
}

export function steering(id: string, input: { memberBudget?: number | null; steering?: Steering }) {
  return signed(() => fixture ? staged((fixtures) => fixtures.govern(id, input, who())) : request<Roster>(`${path(id)}/team`, input))
}

export function seat(id: string, input: { budget?: number | null; member: string; role: 'admin' | 'member' }) {
  return signed(() => fixture ? staged((fixtures) => fixtures.seat(id, input, who())) : request<Roster>(`${path(id)}/team/members`, input))
}

export function unseat(id: string, member: string) {
  return signed(() => fixture ? staged((fixtures) => fixtures.unseat(id, member, who())) : request<Roster>(`${path(id)}/team/members/${encodeURIComponent(member)}`, undefined, 'DELETE'))
}

export function branches(id: string) {
  return fixture ? staged((fixtures) => fixtures.branches(id)) : request<Branches>(`${path(id)}/branches`)
}

export function fund(id: string, branch: number, input: { amount: string; artifact?: boolean; message?: string }) {
  return signed(() => fixture ? staged((fixtures) => fixtures.fund(id, branch, input, who())) : request<Branch>(`${path(id)}/branches/${branch}/fund`, input))
}

export function stop(id: string, branch: number) {
  return signed(() => fixture ? staged((fixtures) => fixtures.stop(id, branch, who())) : request<Branch>(`${path(id)}/branches/${branch}/stop`, {}))
}

export function move(id: string, branch: number, input: { amount: string; to: number }) {
  return signed(() => fixture ? staged((fixtures) => fixtures.move(id, branch, input, who())) : request<Branch[]>(`${path(id)}/branches/${branch}/move`, input))
}

export function btw(id: string, input: { branch?: number; question: string; thread: readonly Btw.Exchange[] }) {
  return signed(() => fixture ? staged((fixtures) => fixtures.btw(id, input, who())) : request<Btw.Exchange>(`${path(id)}/btw`, input))
}

export type Line = { close: () => void; hello: () => void; typing: () => void }

function socket(url: string, listener: (event: { data: string } | { type: 'open' | 'closed' }) => void, opened?: (send: (data: string) => void) => void) {
  let alive = true
  let line: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  const send = (data: string) => {
    if (line?.readyState === WebSocket.OPEN) line.send(data)
  }
  const open = () => {
    line = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${url}`)
    line.onopen = () => {
      opened?.(send)
      listener({ type: 'open' })
      ping = setInterval(() => send('ping'), 30_000)
    }
    line.onmessage = (message) => {
      if (message.data !== 'pong') listener({ data: String(message.data) })
    }
    line.onclose = () => {
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
      line?.close()
    },
    send,
  }
}

export function chatter(id: string, listen: boolean, listener: (event: Chatter | { type: 'open' | 'closed' }) => void): Line {
  if (fixture) {
    let line: Line | undefined
    let closed = false
    let greeted = false
    void staged((fixtures) => {
      if (closed) return
      line = fixtures.chatter(id, listen, listener)
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
  const hello = (send: (data: string) => void) => send(JSON.stringify({ token: bearer ?? '', type: 'hello' }))
  const line = socket(`${path(id)}/chat/live${listen ? '?listen=1' : ''}`, (event) => listener('data' in event ? (JSON.parse(event.data) as Chatter) : event), (send) => {
    if (bearer && !listen) hello(send)
  })
  return {
    close: line.close,
    hello: () => {
      if (!listen) hello(line.send)
    },
    typing: () => line.send('{"type":"typing"}'),
  }
}

export function lobby(listener: (event: Lobby | { type: 'open' | 'closed' }) => void) {
  if (fixture) {
    let stop: (() => void) | undefined
    let alive = true
    void staged((fixtures) => {
      if (alive) stop = fixtures.lobby(listener)
    })
    return () => {
      alive = false
      stop?.()
    }
  }
  return socket('/api/swarms/live', (event) => listener('data' in event ? (JSON.parse(event.data) as Lobby) : event)).close
}
