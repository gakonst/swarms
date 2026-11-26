import { readdirSync, readFileSync } from 'node:fs'
import type * as M1 from '../run.ts'
import type * as M2 from '../d1.ts'
import type * as M3 from '../../src/shared/Nickname.ts'
import type * as M4 from '../../src/shared/Setup.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as M5 from '../../src/worker/Store.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function nickname(seed: string): Promise<Outcome> {
  const random = rng('nickname', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { world } = await load<typeof M1>('test/run.ts')
  const { open } = await load<typeof M2>('test/d1.ts')
  const Nickname = await load<typeof M3>('src/shared/Nickname.ts')
  const Setup = await load<typeof M4>('src/shared/Setup.ts')
  const Store = await load<typeof M5>('src/worker/Store.ts')
  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')
  applied()

  const operator = '0x00000000000000000000000000000000000000ee'
  const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
  const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

  function swarm(db: ReturnType<typeof open>, id: string) {
    db.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run(id, 'Swarm ' + id, 'The goal of swarm ' + id)
  }

  function setup() {
    const w = world(async (_request, url) => {
      if (url.pathname === '/v1/models')
        return Response.json({
          data: [Setup.flash, Setup.glmFlash].map((id) => ({ id, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })),
        })
      if (url.pathname === '/api/keys/me') return Response.json({ wallet: operator })
      return undefined
    })
    ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
    return w
  }

  const goal = 'Find out whether the new nickname flow holds up end to end.'

  const cases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'a nickname is 3 to 40 lowercase letters, digits and inner hyphens, and never a route or a hex id',
      async (_t) => {
        for (const name of ['pequalsnp', 'pq-signatures', 'p-vs-np', 'abc', 'a1b', '2x4', 'x'.repeat(40)]) a.equal(Nickname.invalid(name), undefined, name)
        for (const name of [
          'ab',
          'x'.repeat(41),
          'PQ',
          'Pq-signatures',
          '-abc',
          'abc-',
          'a_b',
          'a.b',
          'a b',
          'añb',
          'new',
          'ideas',
          'docs',
          'api',
          'v1',
          'board',
          'about',
          'faq',
          'join',
          'feedback',
          'telegram',
          'oembed',
          'openapi',
          'assets',
          'fonts',
          'favicon',
          'favicon-96x96',
          'deadbeef',
          '0123456789ab',
          'abcdef012345678',
        ])
          a.notEqual(Nickname.invalid(name), undefined, name)
        a.equal(Nickname.usable('abcdef0'), true)
        a.equal(Nickname.usable('abcdefg1'), true)
      },
    ],
    [
      'every top-level route the Worker or its assets answer is reserved',
      async (_t) => {
        const config = readFileSync('wrangler.jsonc', 'utf8')
        const first = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(config)?.[1] ?? '[]') as string[]
        const segments = new Set(first.map((path) => path.split('/')[1] ?? '').filter(Boolean))
        for (const name of ['board', 'new', 'ideas', 'about', 'docs', 'faq']) segments.add(name)
        for (const file of readdirSync('public')) segments.add(file.replace(/\.[^.]+$/, ''))
        segments.add('assets')
        for (const segment of segments) a.ok(!Nickname.usable(segment), segment)
      },
    ],
    [
      'a topic slugs to a nickname with its hyphens, and pages parse back to their nickname',
      async (_t) => {
        a.equal(Nickname.slug('pq-signatures'), 'pq-signatures')
        a.equal(Nickname.slug('Quantum-safe signatures'), 'quantum-safe-signatures')
        a.equal(Nickname.slug('  Héllo, Wörld!  '), 'hello-world')
        a.equal(Nickname.slug('a'.repeat(39) + ' bcd'), 'a'.repeat(39))
        a.equal(Nickname.topic('faster-json--parser'), 'faster json parser')
        a.deepEqual(Nickname.parse('/pequalsnp'), { name: 'pequalsnp', tail: '' })
        a.deepEqual(Nickname.parse('/pequalsnp/n/0123456789/'), { name: 'pequalsnp', tail: '/n/0123456789' })
        a.deepEqual(Nickname.parse('/pequalsnp/t/0123456789'), { name: 'pequalsnp', tail: '/t/0123456789' })
        a.deepEqual(Nickname.parse('/pequalsnp/chat'), { name: 'pequalsnp', tail: '/chat' })
        for (const path of ['/new', '/s/abc', '/v1/swarms', '/pequalsnp/other', '/favicon.ico', '/', '/0123456789ab'])
          a.equal(Nickname.parse(path), undefined, path)
        a.equal(Nickname.path({ id: 'abc123abc123', nickname: 'pequalsnp' }), '/pequalsnp')
        a.equal(Nickname.path({ id: 'abc123abc123', nickname: null }), '/s/abc123abc123')
      },
    ],
    [
      'a nickname is unique, a rename frees the old one, which keeps naming the swarm until another swarm takes it',
      async (_t) => {
        const db = open()
        swarm(db, 'one')
        swarm(db, 'two')
        await Store.nickname(db.env, 'one', 'first')
        a.equal(await Store.nicknamed(db.env, 'one'), 'first')
        a.equal((await Store.find(db.env, 'one'))?.nickname, 'first')
        a.equal(Store.summary((await Store.find(db.env, 'two'))!).nickname, null)
        await a.rejects(Store.nickname(db.env, 'two', 'first'), Store.Taken)
        a.equal(await Store.nicknamed(db.env, 'two'), null)

        await Store.nickname(db.env, 'one', 'second')
        a.deepEqual(await Store.called(db.env, 'first'), { current: 'second', swarm: 'one' })
        a.deepEqual(await Store.called(db.env, 'second'), { current: 'second', swarm: 'one' })
        a.equal(await Store.called(db.env, 'third'), null)

        await a.rejects(Store.nickname(db.env, 'two', 'second'), Store.Taken)
        await Store.nickname(db.env, 'two', 'first')
        a.deepEqual(await Store.called(db.env, 'first'), { current: 'first', swarm: 'two' })
        a.equal(await Store.nicknamed(db.env, 'one'), 'second')

        await Store.nickname(db.env, 'one', null)
        a.equal(await Store.nicknamed(db.env, 'one'), null)
        a.deepEqual(await Store.called(db.env, 'second'), { current: null, swarm: 'one' })
        await Store.nickname(db.env, 'one', 'second')
        a.equal(await Store.nicknamed(db.env, 'one'), 'second')
        a.deepEqual(
          db.sqlite
            .prepare('select name, swarm, current from swarm_names order by name')
            .all()
            .map((row) => ({ ...row })),
          [
            { current: 1, name: 'first', swarm: 'two' },
            { current: 1, name: 'second', swarm: 'one' },
          ],
        )
        a.throws(() => db.sqlite.prepare("insert into swarm_names (name, swarm, current, created_at) values ('third', 'one', 1, 1)").run(), /UNIQUE/)
      },
    ],
    [
      'a swarm created with a taken nickname is not created at all',
      async (_t) => {
        const db = open()
        swarm(db, 'one')
        await Store.nickname(db.env, 'one', 'taken')
        const input = { creator: null, goal: 'A goal of ten words or so.', id: 'two', problem: null, steering: 'open' as const, title: 'Two' }
        await a.rejects(Store.insert(db.env, { ...input, nickname: 'taken' }), Store.Taken)
        a.equal(await Store.find(db.env, 'two'), null)
        const made = await Store.insert(db.env, { ...input, nickname: 'fresh' })
        a.equal(made?.nickname, 'fresh')
        a.equal((await Store.find(db.env, 'two'))?.nickname, 'fresh')
      },
    ],
    [
      'POST /v1/swarms takes a nickname, normalized and checked, and refuses one another swarm has',
      async (_t) => {
        const w = setup()
        const made = await Operations.create(w.env, { goal, nickname: ' PQ-Signatures ', template: 'cheap', title: 'Signatures' }, ana)
        a.ok(made.ok, JSON.stringify(made))
        a.equal(made.value.nickname, 'pq-signatures')
        const again = await Operations.create(w.env, { goal, nickname: 'pq-signatures', template: 'cheap', title: 'Again' }, bo)
        a.deepEqual(again.ok ? undefined : [again.status, again.code], [409, 'conflict'])
        for (const nickname of ['docs', 'ab', 'a_b', '0123456789ab']) {
          const refused = await Operations.create(w.env, { goal, nickname, template: 'cheap', title: 'Refused' }, bo)
          a.equal(refused.ok ? 200 : refused.status, 400, nickname)
        }
        const plain = await Operations.create(w.env, { goal, template: 'cheap', title: 'Plain' }, bo)
        a.ok(plain.ok && plain.value.nickname === null)
        const named = await Operations.named(w.env, { name: 'PQ-signatures' })
        a.deepEqual(named, { ok: true, value: { name: 'pq-signatures', nickname: 'pq-signatures', swarm: made.value.id } })
        for (const name of ['nobody-here', 'docs', 'x']) {
          const missing = await Operations.named(w.env, { name })
          a.equal(missing.ok ? 200 : missing.status, 404, name)
        }
      },
    ],
    [
      "only the swarm's admins and the operator set its nickname, and a rename keeps the old name pointing at it",
      async (_t) => {
        const w = setup()
        const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
        const other = await Operations.create(w.env, { goal, nickname: 'theirs', template: 'cheap', title: 'Theirs' }, bo)
        a.ok(made.ok && other.ok)
        const swarm = made.value.id
        const unsigned = await Operations.nickname(w.env, { nickname: 'mine', swarm })
        a.equal(unsigned.ok ? 200 : unsigned.status, 401)
        const stranger = await Operations.nickname(w.env, { nickname: 'mine', swarm }, bo)
        a.equal(stranger.ok ? 200 : stranger.status, 403)
        const missing = await Operations.nickname(w.env, { nickname: 'mine', swarm: 'nope' }, ana)
        a.equal(missing.ok ? 200 : missing.status, 404)
        const bad = await Operations.nickname(w.env, { nickname: 'v1', swarm }, ana)
        a.equal(bad.ok ? 200 : bad.status, 400)
        const absent = await Operations.nickname(w.env, { swarm }, ana)
        a.equal(absent.ok ? 200 : absent.status, 400)

        const set = await Operations.nickname(w.env, { nickname: 'mine', swarm }, ana)
        a.ok(set.ok && set.value.nickname === 'mine')
        const same = await Operations.nickname(w.env, { nickname: 'mine', swarm }, ana)
        a.ok(same.ok && same.value.nickname === 'mine')
        const taken = await Operations.nickname(w.env, { nickname: 'theirs', swarm }, ana)
        a.deepEqual(taken.ok ? undefined : [taken.status, taken.code], [409, 'conflict'])

        const renamed = await Operations.nickname(w.env, { nickname: 'pequalsnp', swarm }, operator)
        a.ok(renamed.ok && renamed.value.nickname === 'pequalsnp')
        a.deepEqual(await Operations.named(w.env, { name: 'mine' }), { ok: true, value: { name: 'mine', nickname: 'pequalsnp', swarm } })
        const claimed = await Operations.nickname(w.env, { nickname: 'mine', swarm: other.value.id }, undefined, true)
        a.ok(claimed.ok && claimed.value.nickname === 'mine')
        a.deepEqual(await Operations.named(w.env, { name: 'mine' }), { ok: true, value: { name: 'mine', nickname: 'mine', swarm: other.value.id } })
        a.deepEqual(await Operations.named(w.env, { name: 'theirs' }), { ok: true, value: { name: 'theirs', nickname: 'mine', swarm: other.value.id } })

        const dropped = await Operations.nickname(w.env, { nickname: null, swarm }, ana)
        a.ok(dropped.ok && dropped.value.nickname === null)
        a.deepEqual(await Operations.named(w.env, { name: 'pequalsnp' }), { ok: true, value: { name: 'pequalsnp', nickname: null, swarm } })
        const read = await Operations.get(w.env, { swarm: other.value.id })
        a.ok(read.ok && read.value.nickname === 'mine')
        a.deepEqual(read.ok && [read.value.failure, read.value.reason], [null, null])
        const listed = await Store.list(w.env)
        a.ok(listed.every((row) => 'nickname' in row))

        await Operations.archive(w.env, { swarm }, undefined, true)
        const archived = await Operations.nickname(w.env, { nickname: 'again', swarm }, ana)
        a.equal(archived.ok ? 200 : archived.status, 410)
      },
    ],
  ]
  for (const [name, run] of [...cases].sort(() => random.next() - 0.5)) {
    a.as(name)
    try {
      await run({ after: (fn) => void afters.push(fn) })
    } catch (error) {
      fail(name, String((error as Error)?.stack ?? error).slice(0, 400))
    } finally {
      for (const fn of afters.splice(0).reverse()) await fn()
    }
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { nickname }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('nickname.hex', 'src/shared/Nickname.ts', 'if (reserved.has(name) || hex.test(name))', 'if (reserved.has(name))'),
    invariant: 'a nickname is 3 to 40 lowercase letters, digits and inner hyphens, and never a route or a hex id',
    name: 'nickname.hex',
    scenario: 'nickname',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'nickname.letting',
      'src/worker/Store.ts',
      'await (name ? env.DB.batch([freeing(env, name), letting, claiming(env, name, swarm, at)])',
      'await (name ? env.DB.batch([freeing(env, name), claiming(env, name, swarm, at)])',
    ),
    invariant: 'a nickname is unique, a rename frees the old one, which keeps naming the swarm until another swarm takes it',
    name: 'nickname.letting',
    scenario: 'nickname',
    seeds: ['1', '2', '3'],
  },
]
