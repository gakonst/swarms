import type * as BoardModule from '../board.ts'
import type * as RunModule from '../run.ts'
import type * as HandsModule from '../../src/worker/Hands.ts'
import type * as MoneyModule from '../../src/worker/Money.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as StoreModule from '../../src/worker/Store.ts'
import type * as SetupModule from '../../src/shared/Setup.ts'
import { applied, load, mutant, pin, recorder, rng, type Canary, type Outcome, type Rng } from './mh-kit.ts'

export const limits = {
  ages: [0.1, 0.5, 0.9, 1.1, 2, 3, 4],
  calls: { least: 1, most: 4 },
  day: 86_400_000,
  down: 0.3,
  listings: { least: 3, most: 8 },
  machines: { least: 1, most: 6 },
  passes: [0, 0.04, 0.5, 0.9, 2],
  postFails: 0.1,
  rows: { spread: 3 },
  suffixes: [0x0a, 0x0b],
  unhands: { least: 6, most: 14 },
  wide: ['cap', 'idle', 'spare'],
}

type Entry = { connected: boolean; name: string; requests?: number }

type World = ReturnType<typeof RunModule.world>

type Kit = {
  Board: typeof BoardModule
  Hands: typeof HandsModule
  Money: typeof MoneyModule
  Operations: typeof OperationsModule
  Run: typeof RunModule
  Setup: typeof SetupModule
  Store: typeof StoreModule
}

async function kit(): Promise<Kit> {
  const Run = await load<typeof RunModule>('test/run.ts')
  const Board = await load<typeof BoardModule>('test/board.ts')
  const Hands = await load<typeof HandsModule>('src/worker/Hands.ts')
  const Money = await load<typeof MoneyModule>('src/worker/Money.ts')
  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')
  const Setup = await load<typeof SetupModule>('src/shared/Setup.ts')
  const Store = await load<typeof StoreModule>('src/worker/Store.ts')
  applied()
  return { Board, Hands, Money, Operations, Run, Setup, Store }
}

function hex(random: Rng, length: number) {
  return Array.from({ length }, () => random.int(0, 15).toString(16)).join('')
}

function address(random: Rng) {
  return ('0x' + hex(random, 40)) as `0x${string}`
}

function suffixes(source: () => number) {
  const real = crypto.getRandomValues.bind(crypto)
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T) => {
    if (!(array instanceof Uint8Array)) return real(array as never) as T
    for (let i = 0; i < array.length; i++) array[i] = source()
    return array
  }) as typeof crypto.getRandomValues
  return () => void (crypto.getRandomValues = real)
}

function counter() {
  let n = 0
  return () => n++ % 256
}

function members(found: { address: string; ways: readonly string[] }[]) {
  return found.map((member) => [member.address.toLowerCase(), [...member.ways]]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
}

function machineLines(w: World) {
  return w.sql
    .exec("SELECT text FROM feed WHERE kind = 'machine'")
    .toArray()
    .map((row) => String(row['text']))
}

type Lent = { contributor: `0x${string}`; label: string; name: string }

type ListingPlan = { kept: string[]; lent: Lent[]; listings: (Entry[] | 503)[] }

const machine = 'mbp-abc123'

function listingPlans(random: Rng, rider: `0x${string}`): ListingPlan[] {
  const count = random.int(limits.machines.least, limits.machines.most)
  const pool = Array.from({ length: count }, (_, n) => random.pick(['mbp', 'box', 'idle', 'rig']) + '-' + n + hex(random, 4))
  const lent = pool.filter(() => random.chance(0.5)).map((name) => ({ contributor: address(random), label: random.pick(['laptop', 'box', 'studio']), name }))
  const kept = pool.filter(() => random.chance(0.3))
  const listings = Array.from({ length: random.int(limits.listings.least, limits.listings.most) }, (): Entry[] | 503 =>
    random.chance(limits.down)
      ? 503
      : random
          .shuffle(pool)
          .flatMap((name): Entry[] => (random.chance(0.5) ? [{ connected: true, name }] : random.chance(0.3) ? [{ connected: false, name }] : [])),
  )
  return [
    { kept: [machine], lent: [], listings: [503, [{ connected: true, name: machine }], []] },
    { kept: [], lent: [], listings: [[{ connected: true, name: machine }], 503, [{ connected: true, name: machine }]] },
    { kept: [], lent: [{ contributor: rider, label: 'laptop', name: machine }], listings: [[{ connected: true, name: machine }]] },
    { kept, lent, listings },
  ]
}

async function listing(seed: string): Promise<Outcome> {
  const random = rng(seed, 'world-listing')
  const { fail, same, violations } = recorder()
  const unpin = pin(random)
  let steps = 0
  try {
    const { Money, Run, Store } = await kit()
    const id = Run.id
    for (const plan of listingPlans(random, Run.rider)) {
      const state: { listed: Entry[] | 503 } = { listed: 503 }
      const w = Run.world((_request, url) =>
        url.pathname === '/v1/hands' ? (state.listed === 503 ? new Response('upstream', { status: 503 }) : Response.json({ hands: state.listed })) : undefined,
      )
      try {
        await w.seed('0')
        for (const one of plan.lent)
          await w.env.DB.prepare('insert into hands (swarm, name, label, contributor, created_at) values (?, ?, ?, ?, ?)')
            .bind(id, one.name, one.label, one.contributor, Date.now())
            .run()
        if (plan.kept.length) {
          w.swarm.kv.put(
            'hands',
            plan.kept.map((name) => ({ connected: true, name })),
          )
          await w.env.DB.prepare('update swarms set machines = ? where id = ?').bind(plan.kept.length, id).run()
        }
        let previous = [...plan.kept]
        let count = plan.kept.length
        let lines: string[] = []
        const seen = new Set<string>()
        const riders = async (when: string) => {
          const want = [...new Set(plan.lent.filter((one) => seen.has(one.name)).map((one) => one.contributor.toLowerCase()))]
            .map((one) => [one, ['machine']])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
          same('lender rides', 'riders ' + when, members(await Store.members(w.env, id)), want)
        }
        await riders('before any listing')
        for (const listed of plan.listings) {
          steps++
          state.listed = listed
          const row = await Store.find(w.env, id)
          if (!row) {
            fail('machine count', 'the swarm row is gone')
            break
          }
          await Money.refresh(w.swarm, row, { credit: false, hands: true })
          const all = machineLines(w)
          const added = all.slice(lines.length)
          lines = all
          const held = (w.swarm.kv.get<{ name: string }[]>('hands') ?? []).map((hand) => hand.name)
          const machines = Number((await Store.find(w.env, id))?.machines)
          if (listed === 503) {
            same('listing down keeps machines', 'lines after a failed listing', added, [])
            same('listing down keeps machines', 'hands after a failed listing', held, previous)
            same('listing down keeps machines', 'machines after a failed listing', machines, count)
            await riders('after a failed listing')
            continue
          }
          const connected = listed.filter((hand) => hand.connected).map((hand) => hand.name)
          const arrived = connected.filter((name) => !previous.includes(name))
          const gone = previous.filter((name) => !connected.includes(name))
          if (arrived.length) for (const name of connected) seen.add(name)
          const want = [
            ...arrived.map((name) => {
              const guest = plan.lent.find((one) => one.name === name)
              return guest ? "A contributor's machine joined the swarm as hand " + name + ' (' + guest.label + ').' : 'Machine ' + name + ' joined the swarm.'
            }),
            ...gone.map((name) => 'Machine ' + name + ' left.'),
          ]
          same('machine lines', 'lines for listing ' + JSON.stringify(listed), added, want)
          if (arrived.length || gone.length) previous = connected
          same('machine lines', 'hands for listing ' + JSON.stringify(listed), held, previous)
          count = connected.length
          same('machine count', 'machines for listing ' + JSON.stringify(listed), machines, count)
          await riders('after listing ' + JSON.stringify(listed))
        }
      } finally {
        w.restore()
      }
    }
    return { steps, violations }
  } finally {
    unpin()
  }
}

type Pre = { contributor: string | null; created: number; label: string; name: string; seen: number | null }

type Call = { down: boolean; issuer: `0x${string}` | null; label: string; passMs: number; unlist?: string[] }

type EvictPlan = { entries: Entry[]; mintedConnected: boolean; name: string; postFails: number; random: boolean; rows: Pre[]; calls: Call[] }

function evictPlans(random: Rng, unseenMs: number, limit: number): EvictPlan[] {
  const now = Date.now()
  const day = limits.day
  const lender = ('0x' + 'ab'.repeat(20)) as string
  const issuer = ('0x' + 'cd'.repeat(20)) as `0x${string}`
  const call = (down = false, passMs = 0, unlist?: string[]): Call => ({ down, issuer, label: 'laptop', passMs, ...(unlist ? { unlist } : {}) })
  const labels = ['laptop', 'box']
  const sizes = [0, 2, limit - 1, limit, limit + 1, limit + limits.rows.spread]
  const size = Math.max(0, random.pick(sizes) + random.int(-1, 1))
  const rows: Pre[] = Array.from({ length: size }, () => {
    const created = now - Math.round(random.pick(limits.ages) * unseenMs)
    const seen = random.chance(0.4) ? null : Math.min(now, created + Math.round(random.next() * (now - created)))
    const label = random.pick(labels)
    const name = label + '-' + Array.from({ length: 3 }, () => random.pick(limits.suffixes).toString(16).padStart(2, '0')).join('')
    return { contributor: random.chance(0.5) ? address(random) : null, created, label, name, seen }
  }).filter((row, n, all) => all.findIndex((other) => other.name === row.name) === n)
  const entries = rows.flatMap((row): Entry[] => {
    const kind = random.int(0, 3)
    return kind === 0
      ? []
      : kind === 1
        ? [{ connected: false, name: row.name }]
        : kind === 2
          ? [{ connected: false, name: row.name, requests: 1 }]
          : [{ connected: true, name: row.name }]
  })
  const calls = Array.from({ length: random.int(limits.calls.least, limits.calls.most) }, (): Call => ({
    down: random.chance(limits.down),
    issuer: random.chance(0.2) ? null : address(random),
    label: random.pick(labels),
    passMs: Math.round(random.pick(limits.passes) * unseenMs),
    ...(random.chance(0.3) ? { unlist: random.shuffle(rows.map((row) => row.name)).slice(0, random.int(0, 3)) } : {}),
  }))
  const fresh = Array.from({ length: limit }, (_, n): Pre => ({ contributor: null, created: now, label: 'laptop', name: 'fresh-' + n, seen: now }))
  return [
    {
      calls: [call(true)],
      entries: [],
      mintedConnected: true,
      name: 'down',
      postFails: 0,
      random: false,
      rows: [{ contributor: null, created: now - 3 * day, label: 'live-1', name: 'live-1', seen: now - 2 * day }],
    },
    {
      calls: [call()],
      entries: [
        { connected: false, name: 'gone-1' },
        { connected: true, name: 'live-1' },
      ],
      mintedConnected: true,
      name: 'up',
      postFails: 0,
      random: false,
      rows: [
        { contributor: null, created: now - 3 * day, label: 'gone-1', name: 'gone-1', seen: null },
        { contributor: null, created: now - 3 * day, label: 'live-1', name: 'live-1', seen: now - 2 * day },
        { contributor: null, created: now, label: 'new-1', name: 'new-1', seen: null },
      ],
    },
    {
      calls: [call(), call()],
      entries: [],
      mintedConnected: false,
      name: 'idle',
      postFails: 0,
      random: false,
      rows: [
        { contributor: lender, created: now - 3 * day, label: machine, name: machine, seen: now - 2 * day },
        { contributor: lender, created: now - 3 * day, label: 'never-1', name: 'never-1', seen: null },
        ...Array.from({ length: limit - 1 }, (_, n): Pre => ({
          contributor: null,
          created: now - 4 * day,
          label: 'used-' + n,
          name: 'used-' + n,
          seen: now - 3 * day,
        })),
      ],
    },
    {
      calls: [...Array.from({ length: limit + 1 }, () => call()), call(false, 2 * unseenMs, ['@first'])],
      entries: [],
      mintedConnected: true,
      name: 'cap',
      postFails: 0,
      random: false,
      rows: [],
    },
    {
      calls: [call()],
      entries: fresh.map((row, n) => (n === 0 ? { connected: false, name: row.name, requests: 1 } : { connected: true, name: row.name })),
      mintedConnected: true,
      name: 'spare',
      postFails: 0,
      random: false,
      rows: fresh,
    },
    { calls, entries, mintedConnected: random.chance(0.5), name: 'random', postFails: limits.postFails, random: true, rows },
  ]
}

async function evict(seed: string, wide: boolean): Promise<Outcome> {
  const random = rng(seed, wide ? 'world-cap' : 'world-evict')
  const { fail, same, violations } = recorder()
  const unpin = pin(random)
  let steps = 0
  try {
    const { Hands, Operations, Run, Store } = await kit()
    const id = Run.id
    for (const plan of evictPlans(random, Hands.unseenMs, Hands.limit).filter((one) => limits.wide.includes(one.name) === wide)) {
      const unsuffix = suffixes(plan.random ? () => random.pick(limits.suffixes) : counter())
      const state = { down: false, entries: new Map(plan.entries.map((entry) => [entry.name, entry])) }
      const detached: string[] = []
      const posted: string[] = []
      const w = Run.world((request, url) => {
        if (url.pathname === '/v1/hands' && request.method === 'POST') {
          const name = url.searchParams.get('name') ?? ''
          posted.push(name)
          if (random.chance(plan.postFails)) return Response.json({ error: 'no' }, { status: 500 })
          state.entries.set(name, { connected: plan.mintedConnected, name })
          return Response.json({ command: 'connect', short: name, token: 'hand_' + name, url: 'https://gateway.test/v1/hands/attach' })
        }
        if (url.pathname === '/v1/hands') return state.down ? new Response('upstream', { status: 503 }) : Response.json({ hands: [...state.entries.values()] })
        if (url.pathname.startsWith('/v1/hands/') && request.method === 'DELETE') {
          detached.push(decodeURIComponent(url.pathname.split('/').at(-1) ?? ''))
          return Response.json({ disconnected: true })
        }
        return undefined
      })
      ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
      try {
        await w.seed('0')
        for (const row of plan.rows)
          await w.env.DB.prepare('insert into hands (swarm, name, label, contributor, created_at, seen_at) values (?, ?, ?, ?, ?, ?)')
            .bind(id, row.name, row.label, row.contributor, row.created, row.seen)
            .run()
        const minted: string[] = []
        for (const call of plan.calls) {
          steps++
          w.pass(call.passMs)
          for (const name of call.unlist ?? []) {
            const target = name === '@first' ? minted[0] : name
            const entry = target && state.entries.get(target)
            if (entry) state.entries.set(entry.name, { connected: false, name: entry.name })
          }
          state.down = call.down
          const before = await Hands.list(w.env, id)
          const names = new Set([...before.map((row) => row.name), ...posted])
          const from = { detached: detached.length, posted: posted.length }
          const result = await Operations.hand(w.env, { label: call.label, swarm: id }, call.issuer ?? undefined, call.issuer === null)
          if (result.ok) minted.push(result.value.name)
          const at = Date.now()
          const out = detached.slice(from.detached)
          const tried = posted.slice(from.posted)
          const connected = new Set([...state.entries.values()].filter((entry) => entry.connected).map((entry) => entry.name))
          const tasks = (await w.swarm.board.tasks()).filter((task) => task.labels['hands'] === Hands.slot.hands)
          const holding = tasks.filter((task) => task.phase === 'claimed' && (task.untilMs ?? 0) > at)
          const after = await Hands.list(w.env, id)
          const what = plan.name + ' call ' + steps + ' (' + (result.ok ? 'ok' : result.status) + ')'
          if (call.down && out.length) fail('listing down evicts none', what + ' detached ' + out.join(', ') + ' while the hands listing failed')
          for (const name of out) {
            if (connected.has(name)) fail('evicts only idle', what + ' detached ' + name + ', which is connected')
            if (!before.some((row) => row.name === name && row.returned_at === null))
              fail('evicts only idle', what + ' detached ' + name + ', which was not lent')
          }
          if (result.ok && holding.length > Hands.limit) fail('cap', what + ' issued a hand with ' + holding.length + ' slots held')
          const ghosts = tasks.filter((task) => task.phase === 'done' && !after.some((row) => 'hand:' + row.name === task.id))
          if (!result.ok && result.status === 409 && !(plan.random && ghosts.length)) {
            const held = call.down ? holding.length : holding.filter((task) => connected.has(task.id.slice('hand:'.length))).length
            if (held < Hands.limit) fail('cap', what + ' refused as full with ' + held + ' slots held by machines in use')
          }
          if (!call.down && !(!result.ok && result.status === 409)) {
            const lapsed = tasks.filter(
              (task) => (task.phase === 'open' || task.phase === 'claimed') && !holding.includes(task) && !connected.has(task.id.slice('hand:'.length)),
            )
            if (lapsed.length) fail('lapsed returned', what + ' left lapsed idle hands lent: ' + lapsed.map((task) => task.id).join(', '))
          }
          const riders = members(await Store.members(w.env, id))
          for (const name of out) {
            const was = before.find((row) => row.name === name)
            const now = after.find((row) => row.name === name)
            if (was?.seen_at === null && now) fail('evicted released', what + ' kept the never seen hand ' + name)
            if (was && was.seen_at !== null && now?.returned_at == null) fail('evicted released', what + ' did not return the used hand ' + name)
            const task = tasks.find((one) => one.id === 'hand:' + name)
            if (task && task.phase !== 'done') fail('evicted released', what + ' left the slot of ' + name + ' ' + task.phase)
            if (was?.contributor && was.seen_at !== null && !riders.some(([one, ways]) => one === was.contributor && (ways as string[]).includes('machine')))
              fail('evicted released', what + ' dropped the lender of ' + name + ' from the riders')
          }
          for (const row of before)
            if (row.returned_at === null && !out.includes(row.name) && !after.some((one) => one.name === row.name && one.returned_at === null))
              fail('rows kept', what + ' returned ' + row.name + ' without detaching it')
          for (const name of tried) if (names.has(name)) fail('name never reissued', what + ' asked the gateway for ' + name + ' again')
          for (const name of tried) names.add(name)
          if (plan.name === 'idle' && result.ok && steps > 0)
            try {
              await w.env.DB.prepare('update hands set returned_at = 1 where name = ?').bind(result.value.name).run()
              fail('evicted released', what + ' let an unseen hand ' + result.value.name + ' be marked returned')
            } catch {
              steps++
            }
        }
        if (plan.name === 'cap') {
          const rows = await Hands.list(w.env, id)
          same('cap', 'rows after the cap', [rows.length, rows.filter((row) => row.returned_at === null).length], [Hands.limit + 1, Hands.limit])
          same('evicted released', 'slot of the first hand', (await w.swarm.board.task('hand:' + minted[0]))?.phase, 'done')
        }
      } finally {
        w.restore()
        unsuffix()
      }
    }
    steps += wide ? await adopted(random, { fail, same }, await kit()) : await lapse({ fail, same }, await kit())
    return { steps, violations }
  } finally {
    unpin()
  }
}

type Checks = Pick<ReturnType<typeof recorder>, 'fail' | 'same'>

async function adopted(random: Rng, { same }: Checks, { Board, Hands, Run }: Kit) {
  const id = Run.id
  const names = random.shuffle(Array.from({ length: Hands.limit }, (_, n) => 'old-' + n))
  let posted = 0
  const w = Run.world((request, url) => {
    if (url.pathname !== '/v1/hands') return undefined
    if (request.method === 'POST') return (posted++, Response.json({ error: 'no' }, { status: 500 }))
    return Response.json({ hands: names.map((name) => ({ connected: true, name })) })
  })
  try {
    await w.seed('0')
    const old = await Board.open((w.swarm as never as { ctx: { storage: object } }).ctx.storage, 'swarm:' + id + ':hands', 'swarm:' + id)
    for (const name of names) {
      await w.env.DB.prepare('insert into hands (swarm, name, label, contributor, created_at, seen_at) values (?, ?, ?, ?, ?, ?)')
        .bind(id, name, 'laptop', Run.rider, Date.now(), Date.now())
        .run()
      await old.post({ id: 'hand:' + name, labels: Hands.slot, spec: 'laptop' })
      await old.claim('hand:' + name, { cap: Hands.limit, leaseMs: Hands.unseenMs })
    }
    same('old claims kept', 'lending at the cap', await w.swarm.lend(id, 'laptop', Run.rider), { ok: false, reason: 'full' })
    const held = (await w.swarm.board.held()).filter((found) => found.labels['hands'] === Hands.slot.hands)
    same('old claims kept', 'held slots', held.map((found) => found.id).toSorted(), names.map((name) => 'hand:' + name).toSorted())
    w.pass(Hands.unseenMs / 2)
    const { rows } = await w.swarm.lent(id)
    same('old claims kept', 'lent rows at half the lease', rows.filter((row) => row.returned_at === null).length, Hands.limit)
    w.pass(Hands.unseenMs * 0.9)
    same('old claims kept', 'lending past the first lease', await w.swarm.lend(id, 'laptop', Run.rider), { ok: false, reason: 'full' })
    same('old claims kept', 'lent rows past the first lease', (await Hands.list(w.env, id)).filter((row) => row.returned_at === null).length, Hands.limit)
    same('old claims kept', 'hands asked of the gateway', posted, 0)
    return names.length
  } finally {
    w.restore()
  }
}

async function lapse({ same }: Checks, { Hands, Run, Store }: Kit) {
  const id = Run.id
  const w = Run.world(() => undefined)
  try {
    await w.seed('0')
    await w.env.DB.prepare('insert into hands (swarm, name, label, contributor, created_at) values (?, ?, ?, ?, ?)')
      .bind(id, machine, 'laptop', Run.rider, Date.now())
      .run()
    await Hands.seen(w.swarm, id, await Hands.list(w.env, id), [{ connected: true, name: machine }])
    same('lapsed returned', 'evictable while fresh', await Hands.evictable(w.swarm.board, [], Date.now()), [])
    w.pass(2 * Hands.unseenMs)
    same('lapsed returned', 'evictable once lapsed', await Hands.evictable(w.swarm.board, [], Date.now()), [machine])
    await Hands.free(w.swarm, id, machine)
    same('evicted released', 'slot once freed', (await w.swarm.board.task('hand:' + machine))?.phase, 'done')
    same('lapsed returned', 'evictable once freed', await Hands.evictable(w.swarm.board, [], Date.now()), [])
    same(
      'evicted released',
      'lent rows once freed',
      (await Hands.list(w.env, id)).filter((row) => row.returned_at === null),
      [],
    )
    same('evicted released', 'riders once freed', members(await Store.members(w.env, id)), [[Run.rider.toLowerCase(), ['machine']]])
  } finally {
    w.restore()
  }
  const down = Run.world((_request, url) => (url.pathname === '/v1/hands' ? Response.json({ error: 'down' }, { status: 503 }) : undefined))
  try {
    await down.seed('0')
    await down.env.DB.prepare('insert into hands (swarm, name, label, contributor, created_at) values (?, ?, ?, ?, ?)')
      .bind(id, machine, 'laptop', Run.rider, Date.now() - 2 * Hands.unseenMs)
      .run()
    const { listed } = await down.swarm.lent(id)
    same('listing down evicts none', 'listing while down', listed, undefined)
    same('listing down evicts none', 'evictable while down', await Hands.evictable(down.swarm.board, listed, Date.now()), [])
  } finally {
    down.restore()
  }
  return 2
}

type Actor = 'admin' | 'anonymous' | 'operated' | 'operator' | 'rider'

async function unhand(seed: string): Promise<Outcome> {
  const random = rng(seed, 'world-unhand')
  const { fail, same, violations } = recorder()
  const unpin = pin(random)
  let steps = 0
  try {
    const { Hands, Operations, Run, Setup } = await kit()
    const operator = '0x00000000000000000000000000000000000000ee' as const
    const ana = address(random)
    const riders = Array.from({ length: random.int(1, 3) }, () => address(random))
    const modes = new Map<string, 'down' | 'gone' | 'ok'>()
    const minted: string[] = []
    const tried: string[] = []
    const listed = new Set<string>()
    const w = Run.world((request, url) => {
      if (url.pathname === '/v1/models')
        return Response.json({
          data: [Setup.flash, Setup.glmFlash].map((one) => ({ id: one, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })),
        })
      if (url.pathname === '/api/keys/me') return Response.json({ wallet: operator })
      if (url.pathname === '/v1/hands' && request.method === 'POST') {
        const name = url.searchParams.get('name') ?? ''
        minted.push(name)
        listed.add(name)
        return Response.json({ command: 'nc hand', short: 'nc', token: 'hand_' + name, url: 'wss://gateway.test/v1/hands/' + name })
      }
      if (url.pathname === '/v1/hands') return Response.json({ hands: [...listed].map((name) => ({ connected: true, name, requests: 1 })) })
      const named = /^\/v1\/hands\/([^/]+)$/.exec(url.pathname)
      if (named && request.method === 'DELETE') {
        const name = decodeURIComponent(named[1] ?? '')
        tried.push(name)
        const mode = modes.get(name) ?? 'ok'
        if (mode === 'down') return Response.json({ detail: 'boom' }, { status: 500 })
        if (mode === 'gone') return Response.json({ detail: 'No such hand' }, { status: 404 })
        listed.delete(name)
        return Response.json({ disconnected: true })
      }
      return undefined
    })
    ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
    const code = (result: { ok: true } | { code?: string; ok: false; status: number }) => (result.ok ? 200 : result.status)
    try {
      const made = await Operations.create(w.env, { goal: 'Find out whether lending a machine holds up end to end.', template: 'cheap', title: 'Lend' }, ana)
      if (!made.ok) {
        fail('hand auth', 'creating the swarm failed: ' + JSON.stringify(made))
        return { steps, violations }
      }
      const swarm = made.value.id
      for (const label of ['laptop', 'bad label!', random.pick(['box', 'rig'])]) {
        steps++
        const anonymous = await Operations.hand(w.env, { label, swarm })
        same('hand auth', 'anonymous lending ' + label, anonymous.ok ? 200 : [anonymous.status, anonymous.code], [401, 'unauthorized'])
      }
      same('hand auth', 'hands minted for anonymous callers', minted, [])
      const live: string[] = []
      const labels = random.shuffle(['laptop', 'box', 'down', 'gone', 'rig', 'studio']).slice(0, random.int(2, 5))
      for (const label of labels) {
        steps++
        const operated = random.chance(0.3)
        const issued = await Operations.hand(w.env, { label, swarm }, operated ? undefined : random.pick(riders), operated)
        if (!issued.ok) {
          fail('hand auth', (operated ? 'the operator' : 'a rider') + ' could not lend ' + label + ': ' + JSON.stringify(issued))
          continue
        }
        if (!new RegExp('^' + label + '-[0-9a-f]{6}$').test(issued.value.name)) fail('hand auth', 'lent hand named ' + issued.value.name + ' for ' + label)
        live.push(issued.value.name)
        modes.set(issued.value.name, label === 'down' ? 'down' : label === 'gone' ? 'gone' : random.pick(['ok', 'ok', 'down', 'gone'] as const))
      }
      same('hand auth', 'hands minted for signed in callers', minted.length, live.length)
      w.swarm.kv.put(
        'hands',
        live.map((name) => ({ connected: true, name })),
      )
      const removed: string[] = []
      const actors: Actor[] = ['admin', 'anonymous', 'operated', 'operator', 'rider']
      const look = async (what: string) => {
        const hands = await Operations.hands(w.env, { swarm })
        same('removed leaves hands', 'hands ' + what, hands.ok ? hands.value.hands.map((hand) => hand.name).toSorted() : hands.status, live.toSorted())
        const machines = await Operations.machines(w.env, { swarm })
        same(
          'removed leaves machines',
          'machines ' + what,
          machines.ok ? machines.value.machines.map((one) => one.name).toSorted() : machines.status,
          live.toSorted(),
        )
      }
      await look('before any removal')
      const fixed: [Actor, string][] = live.length
        ? [
            ['anonymous', live[0] as string],
            ['rider', live[0] as string],
            ['admin', 'NOT A NAME'],
            ['admin', 'never-issued'],
            ['admin', '@missing'],
          ]
        : []
      const random_ = Array.from({ length: random.int(limits.unhands.least, limits.unhands.most) }, (): [Actor, string] => [
        random.pick(actors),
        random.chance(0.6) && live.length ? random.pick(live) : random.pick([...removed, 'NOT A NAME', 'never-issued', '@missing', ...live]),
      ])
      for (const [actor, target] of [
        ...fixed,
        ...random_,
        ...live.map((name): [Actor, string] => [random.pick(['admin', 'operated', 'operator'] as const), name]),
      ]) {
        steps++
        const missingSwarm = target === '@missing'
        const hand = missingSwarm ? (live[0] ?? 'never-issued') : target
        const input = { hand, swarm: missingSwarm ? 'nonexistent0' : swarm }
        const who = actor === 'admin' ? ana : actor === 'operator' ? operator : actor === 'rider' ? (riders[0] as typeof ana) : undefined
        const from = tried.length
        const result = await Operations.unhand(w.env, input, who, actor === 'operated')
        const what = actor + ' removing ' + target
        const valid = /^[a-z0-9-]+$/.test(hand)
        const want =
          actor === 'anonymous'
            ? 401
            : !valid
              ? 400
              : missingSwarm
                ? 404
                : actor === 'rider'
                  ? 403
                  : !live.includes(hand)
                    ? 404
                    : modes.get(hand) === 'down'
                      ? 502
                      : 200
        if (want !== 200 && want !== 502) {
          same('unhand auth', what, code(result), want)
          if (tried.length !== from) fail('unhand auth', what + ' reached the gateway: ' + tried.slice(from).join(', '))
          continue
        }
        if (want === 502) {
          same('revoke failure keeps hand', what, result.ok ? 200 : [result.status, result.code], [502, 'upstream_failed'])
          await look('after ' + what)
          continue
        }
        same(modes.get(hand) === 'gone' ? 'revoke gone removes' : 'unhand auth', what, result, { ok: true, value: { hand, removed: true, swarm } })
        live.splice(live.indexOf(hand), 1)
        removed.push(hand)
        await look('after ' + what)
        same('removed leaves hands', what + ' again', code(await Operations.unhand(w.env, input, ana)), 404)
      }
    } finally {
      w.restore()
    }
    return { steps, violations }
  } finally {
    unpin()
  }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  world_cap: (seed) => evict(seed, true),
  world_evict: (seed) => evict(seed, false),
  world_listing: listing,
  world_unhand: unhand,
}

const all = ['1', '2', '3']

export const canaries: Canary[] = [
  {
    flip: mutant(
      'world.listing.down',
      'src/worker/Money.ts',
      'hands.value.hands.filter((hand) => hand.connected) : undefined',
      'hands.value.hands.filter((hand) => hand.connected) : []',
    ),
    invariant: 'listing down keeps machines',
    name: 'world.listing.down',
    scenario: 'world_listing',
    seeds: all,
  },
  {
    flip: mutant('world.listing.left', 'src/worker/Money.ts', "self.log('machine', `Machine ${name} left.`)", 'void name'),
    invariant: 'machine lines',
    name: 'world.listing.left',
    scenario: 'world_listing',
    seeds: all,
  },
  {
    flip: mutant('world.listing.guest', 'src/worker/Money.ts', "guest.label ? ` (${guest.label})` : ''", "''"),
    invariant: 'machine lines',
    name: 'world.listing.guest',
    scenario: 'world_listing',
    seeds: all,
  },
  {
    flip: mutant(
      'world.listing.count',
      'src/worker/Money.ts',
      'machines: connected?.length ?? previous.length',
      'machines: hands?.ok ? hands.value.hands.length : previous.length',
    ),
    invariant: 'machine count',
    name: 'world.listing.count',
    scenario: 'world_listing',
    seeds: all,
  },
  {
    flip: mutant('world.listing.rider', 'src/worker/Hands.ts', 'if (!names.length) return rows', 'if (names.length >= 0) return rows'),
    invariant: 'lender rides',
    name: 'world.listing.rider',
    scenario: 'world_listing',
    seeds: all,
  },
  {
    flip: mutant('world.evict.down', 'src/worker/Hands.ts', 'if (!listed) return []', 'listed ??= []'),
    invariant: 'listing down evicts none',
    name: 'world.evict.down',
    scenario: 'world_evict',
    seeds: all,
  },
  {
    flip: mutant(
      'world.cap.connected',
      'src/worker/Hands.ts',
      'const idle = all.filter((found) => !listed.find((hand) => hand.name === named(found))?.connected)',
      'const idle = all',
    ),
    invariant: 'evicts only idle',
    name: 'world.cap.connected',
    scenario: 'world_cap',
    seeds: all,
  },
  {
    flip: mutant(
      'world.evict.stale',
      'src/worker/Hands.ts',
      'const stale = idle.filter((found) => !holds(found, now))',
      'const stale = idle.filter(() => false)',
    ),
    invariant: 'lapsed returned',
    name: 'world.evict.stale',
    scenario: 'world_evict',
    seeds: all,
  },
  {
    flip: mutant('world.cap.spare', 'src/worker/Hands.ts', 'spare.slice(0, holding - limit + 1)', 'spare.slice(0, holding - limit)'),
    invariant: 'cap',
    name: 'world.cap.spare',
    scenario: 'world_cap',
    seeds: all,
  },
  {
    flip: mutant(
      'world.evict.released',
      'src/worker/Hands.ts',
      "'update hands set returned_at = ? where swarm = ? and name = ? and returned_at is null'",
      "'update hands set seen_at = ? where swarm = ? and name = ? and returned_at is null'",
    ),
    invariant: 'evicted released',
    name: 'world.evict.released',
    scenario: 'world_evict',
    seeds: all,
  },
  {
    flip: mutant(
      'world.evict.rows',
      'src/worker/Hands.ts',
      "'delete from hands where swarm = ? and name = ? and seen_at is null'",
      "'delete from hands where swarm = ? and (name = ? or 1) and seen_at is null'",
    ),
    invariant: 'rows kept',
    name: 'world.evict.rows',
    scenario: 'world_evict',
    seeds: all,
  },
  {
    flip: mutant('world.evict.names', 'src/worker/Hands.ts', 'if (all.some((row) => row.name === name)) continue', 'if (all.length < 0) continue'),
    invariant: 'name never reissued',
    name: 'world.evict.names',
    scenario: 'world_evict',
    seeds: all,
  },
  {
    flip: mutant('world.cap.adopt', 'src/worker/Hands.ts', 'await board.renew(found.id, found.claim, unseenMs)', 'undefined'),
    invariant: 'old claims kept',
    name: 'world.cap.adopt',
    scenario: 'world_cap',
    seeds: all,
  },
  {
    flip: mutant(
      'world.unhand.anonymous',
      'src/worker/Operations.ts',
      "if (!contributor && !operated) return Problem.fail(401, 'unauthorized', \"Sign in with Tempo ID to lend",
      "if (!contributor && operated) return Problem.fail(401, 'unauthorized', \"Sign in with Tempo ID to lend",
    ),
    invariant: 'hand auth',
    name: 'world.unhand.anonymous',
    scenario: 'world_unhand',
    seeds: all,
  },
  {
    flip: mutant(
      'world.unhand.owner',
      'src/worker/Operations.ts',
      'owned(env, row, address, operated, "Only the swarm\'s admins and the operator remove a hand.")',
      'owned(env, row, address, true, "Only the swarm\'s admins and the operator remove a hand.")',
    ),
    invariant: 'unhand auth',
    name: 'world.unhand.owner',
    scenario: 'world_unhand',
    seeds: all,
  },
  {
    flip: mutant('world.unhand.failed', 'src/worker/Hands.ts', 'if (!revoked.ok && revoked.status !== 404) {', 'if (!revoked.ok && revoked.status === 0) {'),
    invariant: 'revoke failure keeps hand',
    name: 'world.unhand.failed',
    scenario: 'world_unhand',
    seeds: all,
  },
  {
    flip: mutant('world.unhand.gone', 'src/worker/Hands.ts', 'if (!revoked.ok && revoked.status !== 404) {', 'if (!revoked.ok && revoked.status !== 0) {'),
    invariant: 'revoke gone removes',
    name: 'world.unhand.gone',
    scenario: 'world_unhand',
    seeds: all,
  },
  {
    flip: mutant('world.unhand.hands', 'src/worker/Operations.ts', 'lending.delete(row.id)\n  fleets.delete(row.id)', 'fleets.delete(row.id)'),
    invariant: 'removed leaves hands',
    name: 'world.unhand.hands',
    scenario: 'world_unhand',
    seeds: all,
  },
  {
    flip: mutant('world.unhand.machines', 'src/worker/Operations.ts', 'lending.delete(row.id)\n  fleets.delete(row.id)', 'lending.delete(row.id)'),
    invariant: 'removed leaves machines',
    name: 'world.unhand.machines',
    scenario: 'world_unhand',
    seeds: all,
  },
]
