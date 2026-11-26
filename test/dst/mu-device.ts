import type * as M1 from '../run.ts'
import type * as M2 from '../../src/worker/Device.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function device(seed: string): Promise<Outcome> {
  const random = rng('device', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { world } = await load<typeof M1>('test/run.ts')
  const Device = await load<typeof M2>('src/worker/Device.ts')
  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'a device sign-in code is used once, expires, and waits for a signed-in approval',
      async (_t) => {
        const w = world(async () => undefined)
        const started = await Device.start(w.env, 'https://swarms.new/v1/auth/device')
        a.ok(started.ok)
        a.match(started.value.user_code, /^[A-Z]{4}-[A-Z]{4}$/)
        a.equal(started.value.verification_uri_complete, `https://swarms.new/cli/login?code=${started.value.user_code}`)
        a.equal(Device.normal(started.value.user_code.toLowerCase().replace('-', ' ')), started.value.user_code)
        a.deepEqual(await Device.poll(w.env, { device_code: started.value.device_code }), { ok: true, value: { status: 'pending' } })
        const unsigned = await Device.approve(
          w.env,
          { code: started.value.user_code },
          new Request('https://swarms.new/v1/auth/device/approve', { method: 'POST' }),
        )
        a.equal(unsigned.ok ? 200 : unsigned.status, 401)
        const malformed = await Device.poll(w.env, { device_code: 'nope' })
        a.equal(malformed.ok ? 200 : malformed.status, 400)
        const unknown = await Device.poll(w.env, { device_code: '0'.repeat(64) })
        a.equal(unknown.ok ? 200 : unknown.status, 410)
        await w.env.DB.prepare('update sessions set expires_at = 1 where key = ?').bind(`cli:device:${started.value.device_code}`).run()
        const expired = await Device.poll(w.env, { device_code: started.value.device_code })
        a.equal(expired.ok ? 200 : expired.status, 410)
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { device }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'device.pending',
      'src/worker/Device.ts',
      "if (polled.next.at === 'pending') return Problem.ok({ status: 'pending' })",
      "if (polled.next.at !== 'pending') return Problem.ok({ status: 'pending' })",
    ),
    invariant: 'a device sign-in code is used once, expires, and waits for a signed-in approval',
    name: 'device.pending',
    scenario: 'device',
    seeds: ['1', '2', '3'],
  },
]
