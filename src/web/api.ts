import type { Account, Artifact, Branch, Branches, Chatter, Config, Contributed, Detail, Entry, Hall, Heard, Issued, Lent, Listing, Live, Lobby, Named, NodeUpdates, NodeView, OwnAi, Plan, Posted, Problem, Profile, ProgressView, ProofsView, Proposed, Reacted, Replied, Room, Roster, Shouted, SignIn, Snapshot, Steering, Suggested, Summary, TreeView, Update } from '../shared/Api.ts'
import type * as Tree from '../shared/Tree.ts'
import type * as Btw from '../shared/Btw.ts'
import type { Progress } from '../shared/Progress.ts'
import type { Job, Listed, Logged, Machine, Shown } from '../shared/Fleet.ts'
import type { Color } from '../shared/Picture.ts'
import * as Site from '../shared/Site.ts'
import * as Connect from '../shared/Connect.ts'
import * as Limits from '../shared/Limits.ts'
import { boot, seeded } from './boot.ts'
import { visitor } from './stage.ts'
import { Capped } from './capped.ts'

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
    if (status !== Limits.Http.unauthorized || !renewal) throw error
    await renewal()
    return run()
  }
}

const reading = new Capped<string, { at: number; read: Promise<unknown> }>(Limits.WebCache.readsMost)

const together = Limits.WebApi.together

function request<T>(path: string, body?: unknown, method?: 'DELETE' | 'PATCH'): Promise<T> {
  if (body !== undefined || method) return send<T>(path, body, method)
  const key = `${bearer ?? ''} ${path}`
  const held = reading.get(key)
  if (held && Date.now() - held.at < together) return held.read as Promise<T>
  const read = send<T>(path).finally(() => {
    if (reading.get(key)?.read === read) reading.delete(key)
  })
  reading.set(key, { at: Date.now(), read })
  return read
}

async function send<T>(path: string, body?: unknown, method?: 'DELETE' | 'PATCH'): Promise<T> {
  const headers: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : {}
  const response = await fetch(Site.at(path), method === 'DELETE' ? { headers, method } : body === undefined ? { headers } : { body: JSON.stringify(body), headers: { ...headers, 'content-type': 'application/json' }, method: method ?? 'POST' })
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
  return fixture ? staged((fixtures) => fixtures.swarms()) : request<Listing>('/api/swarms')
}

export function swarm(id: string, feed = true) {
  return fixture ? staged((fixtures) => fixtures.swarm(id)) : request<Detail>(feed ? path(id) : `${path(id)}?feed=0`)
}

const snapshots = new Capped<string, { at: number; read: Promise<Snapshot | null>; value?: Snapshot | null }>(Limits.WebCache.snapshotsMost)

export function code(id: string, fresh = false) {
  const known = snapshots.get(id)
  if (known && !fresh && Date.now() - known.at < Limits.WebApi.freshMs) return known.read
  const entry: { at: number; read: Promise<Snapshot | null>; value?: Snapshot | null } = {
    at: Date.now(),
    read: fixture ? Promise.resolve(null) : request<{ snapshot: Snapshot | null }>(`${v1(id)}/code`).then((body) => (entry.value = body.snapshot)),
  }
  entry.read.catch(() => snapshots.delete(id))
  snapshots.set(id, entry)
  return entry.read
}

export function coded(id: string) {
  return snapshots.get(id)?.value ?? seeded<Snapshot>(`code:${id}`)
}

export function feed(id: string, after: number, filter: { before?: number; limit?: number; who?: string } = {}) {
  const query = new URLSearchParams({ after: String(after) })
  if (filter.before !== undefined) query.set('before', String(filter.before))
  if (filter.limit !== undefined) query.set('limit', String(filter.limit))
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
    source = new EventSource(Site.at(`${path(id)}/live?after=${Math.max(after(), seen)}`))
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
      if (alive) timer = setTimeout(open, fed || Date.now() - opened > Limits.Client.eventsSteadyMs ? 0 : Limits.Client.eventsRetryMs)
    }
  }
  open()
  return () => {
    alive = false
    source?.close()
    clearTimeout(timer)
  }
}

export function named(name: string) {
  return fixture ? Promise.resolve(null) : request<Named>(`/api/names/${encodeURIComponent(name)}`).catch((error: unknown) => {
    if (error instanceof Failure && error.status === Limits.Http.missing) return null
    throw error
  })
}

export function nickname(id: string, nickname: string | null) {
  return signed(() => (fixture ? Promise.reject(new Error('The fixture world keeps no nicknames.')) : request<Summary>(path(id), { nickname }, 'PATCH')))
}

export type Edits = { nickname?: string | null; picture?: { color: Color; emoji: string } | null; title?: string }

export function edit(id: string, edits: Edits) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.edit(id, who(), edits)) : request<Summary>(path(id), edits, 'PATCH')))
}

export function paint(id: string, image: Blob) {
  return signed(async () => {
    if (fixture) return staged((fixtures) => fixtures.paint(id, who(), image))
    const headers: Record<string, string> = bearer ? { authorization: 'Bearer ' + bearer } : {}
    const response = await fetch(Site.at(path(id) + '/picture'), { body: image, headers: { ...headers, 'content-type': image.type }, method: 'PUT' })
    const data: unknown = await response.json().catch(() => undefined)
    if (response.ok) return data as Summary
    throw new Failure((data ?? {}) as Partial<Problem>, response.status)
  })
}

export function create(input: { goal: string; nickname?: string; problem?: string; steering?: Steering; title: string }) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.create(input, who())) : request<Summary>('/api/swarms', input)))
}

export function contribute(id: string, input: { hash: string; note?: string }) {
  return fixture ? staged((fixtures) => fixtures.contribute(id, input)) : request<Contributed>(`${path(id)}/contributions`, input)
}

export function hands(id: string) {
  return fixture ? staged((fixtures) => fixtures.lent(id)) : request<{ hands: Lent[] }>(`${path(id)}/hands`)
}

export function machines(id: string) {
  return fixture ? Promise.resolve({ machines: [] as Machine[] }) : request<{ machines: Machine[] }>(`/v1/swarms/${encodeURIComponent(id)}/machines`)
}

function machined(id: string, machine: string) {
  return `/v1/swarms/${encodeURIComponent(id)}/machines/${encodeURIComponent(machine)}`
}

export function commands(id: string, machine: string, query: { cursor?: number | undefined; order: 'newest' | 'oldest' }) {
  const search = new URLSearchParams({ limit: '100', order: query.order, ...(query.cursor === undefined ? {} : { cursor: String(query.cursor) }) })
  return request<{ commands: Listed[]; next: number | null; total: number }>(`${machined(id, machine)}/commands?${search}`)
}

export function command(id: string, machine: string, seq: number) {
  return request<Shown>(`${machined(id, machine)}/commands/${seq}`)
}

export function job(id: string, machine: string, seq: number) {
  return request<Job>(`${machined(id, machine)}/commands/${seq}/log`)
}

export function machineLogs(id: string, machine: string, query: { before?: string | undefined; sandbox?: string | undefined }) {
  const search = new URLSearchParams({ ...(query.before ? { before: query.before } : {}), ...(query.sandbox ? { sandbox: query.sandbox } : {}) })
  return request<Logged>(`${machined(id, machine)}/logs?${search}`)
}

export function exported(id: string, machine?: string) {
  return machine ? `${machined(id, machine)}/export` : `/v1/swarms/${encodeURIComponent(id)}/machines/export`
}

export function hand(id: string, label: string) {
  return signed(() =>
    fixture
      ? Promise.resolve({ cli: "nc hand 'https://gateway.tempo.xyz/v1/hands/attach' --token hand_demo_4f2a", command: 'curl -fsSL https://nanocode.xyz/install | sh && nc hand ...', label: label ?? '', library: Connect.library({ name: (label || 'my-machine') + '-3c1f', token: 'hand_demo_4f2a', url: 'https://gateway.tempo.xyz/v1/hands/attach' }), name: (label || 'my-machine') + '-3c1f', npm: Connect.install, swarm: id, tab: null, token: 'hand_demo_4f2a', url: 'https://gateway.tempo.xyz/v1/hands/attach' } as Issued)
      : request<Issued>(`${path(id)}/hands`, label ? { label } : {}),
  )
}

export function unhand(id: string, hand: string) {
  return signed(() => (fixture ? Promise.resolve({ hand, removed: true as const, swarm: id }) : request<{ hand: string; removed: true; swarm: string }>(`${path(id)}/hands/${encodeURIComponent(hand)}`, undefined, 'DELETE')))
}

export function progress(id: string) {
  return fixture ? staged((fixtures) => fixtures.progress(id)) : request<{ progress: Progress | null }>(`${path(id)}/progress`)
}

export function updates(id: string) {
  return fixture ? staged((fixtures) => fixtures.updates(id)) : request<{ updates: Update[] }>(`/v1/swarms/${encodeURIComponent(id)}/updates?limit=30`)
}

export function artifacts(id: string) {
  return fixture ? staged((fixtures) => fixtures.artifacts(id)) : request<{ artifacts: Artifact[] }>(`${path(id)}/artifacts`)
}

export function following<T>(route: string, listener: (value: T) => void) {
  if (fixture || typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(Site.at(route))
  source.addEventListener('snapshot', (event) => listener(JSON.parse(String(event.data)) as T))
  return () => source.close()
}

export function rider(who: string) {
  return fixture ? staged((fixtures) => fixtures.rider(who)) : request<Profile>(`/api/riders/${encodeURIComponent(who)}`)
}

export function account() {
  return fixture ? staged((fixtures) => fixtures.account(bearer ? visitor : undefined)) : request<Account>('/api/me')
}

export function ownAi() {
  return signed(() => (fixture ? staged((fixtures) => fixtures.ownAi(who())) : request<OwnAi>('/api/me/ai')))
}

export function ownKey(provider: 'anthropic' | 'openai', key: string) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.ownKey(provider, key, who())) : request<OwnAi>('/api/me/ai/keys/' + provider, { key })))
}

export function ownDrop(provider: 'anthropic' | 'openai') {
  return signed(() => (fixture ? staged((fixtures) => fixtures.ownDrop(provider, who())) : request<OwnAi>('/api/me/ai/keys/' + provider, undefined, 'DELETE')))
}

export function ownSignIn(plan: Plan) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.ownSignIn(plan, who())) : request<SignIn>('/api/me/ai/' + plan, {})))
}

export function ownSignedIn(plan: Plan, code: string) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.ownSignedIn(plan, code, who())) : request<OwnAi>('/api/me/ai/' + plan + '/complete', { code })))
}

export function ownSignOut(plan: Plan) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.ownSignOut(plan, who())) : request<OwnAi>('/api/me/ai/' + plan, undefined, 'DELETE')))
}

export function hostAi(swarm: string, on: boolean) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.hostAi(swarm, on, who())) : request<Summary>(path(swarm) + '/ai', { on })))
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

export function say(id: string, input: { artifact?: boolean; btw?: readonly Btw.Exchange[]; parent?: number; steer?: string; text: string }) {
  return signed(() => fixture ? staged((fixtures) => fixtures.say(id, input, who())) : request<Posted>(`${path(id)}/chat`, input))
}

export function replies(id: string, message: number, after = 0) {
  return fixture ? staged((fixtures) => fixtures.replies(id, message, after, bearer ? visitor : undefined)) : request<Replied>(`${path(id)}/chat/${message}${after ? `?after=${after}` : ''}`)
}

export function react(id: string, message: number, input: { emoji: string; on: boolean }) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.react(id, message, input, who())) : request<Reacted>(`${path(id)}/chat/${message}/reactions`, input)))
}

export function general(query: { after?: number; before?: number } = {}) {
  const search = new URLSearchParams()
  if (query.after) search.set('after', String(query.after))
  if (query.before) search.set('before', String(query.before))
  return fixture ? staged((fixtures) => fixtures.general(query)) : request<Hall>(`/api/general/chat?${search}`)
}

export function shout(text: string) {
  return signed(() => fixture ? staged((fixtures) => fixtures.shout(text, who())) : request<Shouted>('/api/general/chat', { text }))
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

function v1(id: string) {
  return `/v1/swarms/${encodeURIComponent(id)}`
}

function noded(id: string, node: string) {
  return `${v1(id)}/nodes/${encodeURIComponent(node)}`
}

export function tree(id: string, query: { depth?: number; root?: string } = {}) {
  const search = new URLSearchParams()
  if (query.root) search.set('root', query.root)
  if (query.depth !== undefined) search.set('depth', String(query.depth))
  return fixture ? staged((fixtures) => fixtures.treeView(id, query)) : request<TreeView>(`${v1(id)}/tree${search.size ? `?${search}` : ''}`)
}

export function node(id: string, node: string) {
  return fixture ? staged((fixtures) => fixtures.nodeView(id, node)) : request<NodeView>(noded(id, node))
}

export function nodeUpdates(id: string, node: string, after = 0) {
  return fixture ? staged((fixtures) => fixtures.nodeUpdates(id, node)) : request<NodeUpdates>(`${noded(id, node)}/updates?after=${after}`)
}

export function deltas(id: string, after: number, limit: number) {
  return fixture ? Promise.resolve<NodeUpdates>({ deltas: [], next: after }) : request<NodeUpdates>(`${v1(id)}/deltas?after=${after}&limit=${limit}`)
}

export function burn(id: string) {
  return fixture ? staged((fixtures) => fixtures.burn(id)) : request<ProgressView>(`${v1(id)}/progress?every=hour`)
}

export function proofs(id: string) {
  return fixture ? staged((fixtures) => fixtures.proofs(id)) : request<ProofsView>(`${v1(id)}/proofs`)
}

export function ride(id: string, input: { hash: string; node: string }) {
  return fixture ? staged((fixtures) => fixtures.ride(id, input)) : request<Contributed>(`${v1(id)}/contributions`, input)
}

export function propose(id: string, input: { form: Tree.Form; parent: string; said?: string; spec: string; statement?: string; title: string }) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.propose(id, input, who())) : request<Proposed>(`${v1(id)}/nodes`, input)))
}

export function suggest(id: string, input: { parent: string; text: string }) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.suggest(id, input, who())) : request<Suggested>(`${v1(id)}/ideas`, input)))
}

export function steerNode(id: string, node: string, input: { amount: string; note: string }) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.steerNode(id, node, input, who())) : request<Tree.Node>(`${noded(id, node)}/steer`, input)))
}

export function moveNode(id: string, node: string, input: { amount: string; to: string }) {
  return signed(() => (fixture ? staged((fixtures) => fixtures.moveNode(id, node, input, who())) : request<Tree.Node>(`${noded(id, node)}/move`, input)))
}

export type Line = { close: () => void; hello: () => void; typing: () => void }



function socket(url: string, listener: (event: { data: string } | { type: 'open' | 'closed' }) => void, opened?: (send: (data: string) => void) => void) {
  let alive = true
  let line: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  let quiet: ReturnType<typeof setTimeout> | undefined
  const send = (data: string) => {
    if (line?.readyState === WebSocket.OPEN) line.send(data)
  }
  const lost = (from: WebSocket) => {
    if (line !== from) return
    line = undefined
    clearInterval(ping)
    clearTimeout(quiet)
    from.close()
    listener({ type: 'closed' })
    if (alive) timer = setTimeout(open, Limits.Client.socketRetryMs)
  }
  const probe = () => {
    const probed = line
    if (probed?.readyState !== WebSocket.OPEN) return
    probed.send('ping')
    clearTimeout(quiet)
    quiet = setTimeout(() => lost(probed), Limits.Client.pongMs)
  }
  const open = () => {
    const made = new WebSocket(`${boot()?.socket ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${Site.root()}`}${url}`)
    line = made
    made.onopen = () => {
      opened?.(send)
      listener({ type: 'open' })
      ping = setInterval(probe, Limits.Client.pingMs)
    }
    made.onmessage = (message) => {
      if (line !== made) return
      clearTimeout(quiet)
      if (message.data !== 'pong') listener({ data: String(message.data) })
    }
    made.onclose = () => lost(made)
  }
  open()
  addEventListener('online', probe)
  document.addEventListener('visibilitychange', probe)
  return {
    close: () => {
      alive = false
      clearTimeout(timer)
      clearInterval(ping)
      clearTimeout(quiet)
      removeEventListener('online', probe)
      document.removeEventListener('visibilitychange', probe)
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

export function hall(listener: (event: Heard | { type: 'open' | 'closed' }) => void) {
  if (fixture) {
    let stop: (() => void) | undefined
    let alive = true
    void staged((fixtures) => {
      if (alive) stop = fixtures.hall(listener)
    })
    return () => {
      alive = false
      stop?.()
    }
  }
  return socket('/api/general/chat/live', (event) => listener('data' in event ? (JSON.parse(event.data) as Heard) : event)).close
}
