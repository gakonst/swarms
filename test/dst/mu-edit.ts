import type * as M1 from '../run.ts'
import type * as Pictures from '../../src/shared/Picture.ts'
import type * as M2 from '../../src/shared/Picture.ts'
import type * as Setup from '../../src/shared/Setup.ts'
import type * as M3 from '../../src/shared/Setup.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as Store from '../../src/worker/Store.ts'
import type * as M4 from '../../src/worker/Store.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function edit(seed: string): Promise<Outcome> {
  const random = rng('edit', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { world } = await load<typeof M1>('test/run.ts')
  const Pictures = await load<typeof M2>('src/shared/Picture.ts')
  const Setup = await load<typeof M3>('src/shared/Setup.ts')
  const Store = await load<typeof M4>('src/worker/Store.ts')

  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')

  const operator = '0x00000000000000000000000000000000000000ee'
  const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
  const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

  const goal = 'Find out whether editing a swarm holds up end to end.'

  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

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

  function status<T>(result: { ok: true; value: T } | { ok: false; status: number }) {
    return result.ok ? 200 : result.status
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'a picture is one emoji or a small PNG, JPEG, WebP or GIF',
      async (_t) => {
        for (const emoji of ['🧪', '🇬🇷', '👩🏽‍🔬', '❤️']) a.equal(Pictures.emoji(emoji), true, emoji)
        for (const emoji of ['', 'a', '🧪🧪', 'ab', '1', '🧪 x']) a.equal(Pictures.emoji(emoji), false, emoji)
        a.equal(Pictures.sniff(png), 'image/png')
        a.equal(Pictures.sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
        a.equal(Pictures.sniff(new TextEncoder().encode('GIF89a')), 'image/gif')
        a.equal(Pictures.sniff(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
        a.equal(Pictures.sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), undefined)
      },
    ],
    [
      "only the swarm's admins and the operator edit its title, nickname and picture, in one write",
      async (_t) => {
        const w = setup()
        const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
        const other = await Operations.create(w.env, { goal, nickname: 'theirs', template: 'cheap', title: 'Theirs' }, bo)
        a.ok(made.ok && other.ok)
        const swarm = made.value.id
        a.equal(made.value.picture, null)

        a.equal(status(await Operations.edit(w.env, { swarm, title: 'Yours' })), 401)
        a.equal(status(await Operations.edit(w.env, { swarm, title: 'Yours' }, bo)), 403)
        a.equal(status(await Operations.edit(w.env, { swarm: 'nope', title: 'Yours' }, ana)), 404)
        a.equal(status(await Operations.edit(w.env, { swarm }, ana)), 400)
        a.equal(status(await Operations.edit(w.env, { swarm, title: '   ' }, ana)), 400)
        a.equal(status(await Operations.edit(w.env, { swarm, title: 'x'.repeat(81) }, ana)), 400)
        a.equal(status(await Operations.edit(w.env, { picture: { color: 'green', emoji: 'ab' }, swarm }, ana)), 400)
        a.equal(status(await Operations.edit(w.env, { picture: { color: 'plaid', emoji: '🧪' }, swarm }, ana)), 400)

        const both = await Operations.edit(w.env, { nickname: 'pequalsnp', picture: { color: 'violet', emoji: '🧪' }, swarm, title: ' Does P = NP? ' }, ana)
        a.ok(both.ok, JSON.stringify(both))
        a.equal(both.value.title, 'Does P = NP?')
        a.equal(both.value.nickname, 'pequalsnp')
        a.deepEqual(both.value.picture, { color: 'violet', emoji: '🧪' })
        const indexed = await w.env.DB.prepare("select title from search where swarm = ? and kind = 'swarm'").bind(swarm).all<{ title: string }>()
        a.deepEqual(
          indexed.results.map((row) => row.title),
          ['Does P = NP?'],
        )

        const clash = await Operations.edit(w.env, { nickname: 'theirs', swarm, title: 'Should not stick' }, ana)
        a.deepEqual(clash.ok ? undefined : [clash.status, clash.code], [409, 'conflict'])
        const kept = await Store.find(w.env, swarm)
        a.equal(kept?.title, 'Does P = NP?')
        a.equal(kept?.nickname, 'pequalsnp')

        const byOperator = await Operations.edit(w.env, { swarm, title: 'P versus NP' }, undefined, true)
        a.ok(byOperator.ok && byOperator.value.title === 'P versus NP' && byOperator.value.nickname === 'pequalsnp')
        const cleared = await Operations.edit(w.env, { picture: null, swarm }, ana)
        a.ok(cleared.ok && cleared.value.picture === null)
        const listed = await Store.list(w.env)
        a.ok(listed.every((row) => 'picture' in row))

        await Operations.archive(w.env, { swarm }, undefined, true)
        a.equal(status(await Operations.edit(w.env, { swarm, title: 'Again' }, ana)), 410)
      },
    ],
    [
      'an uploaded picture is checked by its bytes, capped at 64 KB, served by version and dropped with null',
      async (_t) => {
        const w = setup()
        const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
        a.ok(made.ok)
        const swarm = made.value.id
        a.equal(status(await Operations.picture(w.env, { swarm })), 404)
        a.equal(status(await Operations.paint(w.env, { data: png, swarm }, bo)), 403)
        a.equal(status(await Operations.paint(w.env, { data: new TextEncoder().encode('<svg onload="alert(1)"/>'), swarm }, ana)), 400)
        const big = new Uint8Array(Pictures.most + 1)
        big.set(png)
        a.equal(status(await Operations.paint(w.env, { data: big, swarm }, ana)), 400)

        const painted = await Operations.paint(w.env, { data: png, swarm }, ana)
        a.ok(painted.ok && painted.value.picture && 'url' in painted.value.picture, JSON.stringify(painted))
        const url = painted.value.picture.url
        a.match(url, new RegExp(`^/v1/swarms/${swarm}/picture\\?v=[0-9a-z]+$`))
        const served = await Operations.picture(w.env, { swarm })
        a.ok(served.ok)
        a.equal(served.value.type, 'image/png')
        a.deepEqual([...served.value.bytes], [...png])
        a.equal(url, Pictures.path(swarm, served.value.at))

        const emoji = await Operations.edit(w.env, { picture: { color: 'teal', emoji: '🛰️' }, swarm }, ana)
        a.ok(emoji.ok && emoji.value.picture && 'emoji' in emoji.value.picture)
        a.equal(status(await Operations.picture(w.env, { swarm })), 404)
      },
    ],
    [
      "the swarm's admins and the operator archive it, and nobody else",
      async (_t) => {
        const w = setup()
        const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
        const other = await Operations.create(w.env, { goal, template: 'cheap', title: 'Theirs' }, bo)
        a.ok(made.ok && other.ok)
        a.equal(status(await Operations.archive(w.env, { swarm: made.value.id })), 401)
        a.equal(status(await Operations.archive(w.env, { swarm: made.value.id }, bo)), 403)
        a.equal(status(await Operations.archive(w.env, { swarm: 'nope' }, ana)), 404)
        const archived = await Operations.archive(w.env, { swarm: made.value.id }, ana)
        a.ok(archived.ok && archived.value.archivedAt !== null)
        const again = await Operations.archive(w.env, { swarm: made.value.id }, ana)
        a.ok(again.ok && again.value.archivedAt === archived.value.archivedAt)
        const byOperator = await Operations.archive(w.env, { swarm: other.value.id }, operator as `0x${string}`)
        a.ok(byOperator.ok && byOperator.value.archivedAt !== null)
      },
    ],
  ]
  for (const [dstName, dstRun] of [...dstCases].sort(() => random.next() - 0.5)) {
    a.as(dstName)
    try {
      await dstRun({ after: (fn) => void afters.push(fn) })
    } catch (error) {
      fail(dstName, String((error as Error)?.stack ?? error).slice(0, 400))
    } finally {
      for (const fn of afters.splice(0).reverse()) await fn()
    }
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { edit }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('edit.operations', 'src/worker/Operations.ts', "const tree = parsed.value.form === 'tree'", "const tree = parsed.value.form !== 'tree'"),
    invariant: "only the swarm's admins and the operator edit its title, nickname and picture, in one write",
    name: 'edit.operations',
    scenario: 'edit',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'edit.store',
      'src/worker/Store.ts',
      "if (edits.picture === null) statements.push(env.DB.prepare('delete from swarm_pictures where swarm = ?').bind(swarm))",
      "if (edits.picture !== null) statements.push(env.DB.prepare('delete from swarm_pictures where swarm = ?').bind(swarm))",
    ),
    invariant: "only the swarm's admins and the operator edit its title, nickname and picture, in one write",
    name: 'edit.store',
    scenario: 'edit',
    seeds: ['1', '2', '3'],
  },
]
