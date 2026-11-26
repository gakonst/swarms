import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as M2 from '../../cli/src/commands/completion.ts'
import type * as M3 from '../../cli/src/context.ts'
import type * as M4 from '../../cli/src/run.ts'
import type * as M5 from '../../cli/src/version.ts'
import type * as M6 from '../../cli/src/commands/fund.ts'
import type { Overview } from '../../cli/src/commands/swarms.ts'
import type * as M7 from '../../cli/src/commands/swarms.ts'
import type * as Status from '../../src/shared/Status.ts'
import type * as M8 from '../../src/shared/Status.ts'
import type * as M9 from '../../cli/src/auth.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function cli(seed: string): Promise<Outcome> {
  const random = rng('cli', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { completion } = await load<typeof M2>('cli/src/commands/completion.ts')
  const { context, Failure, host, swarm } = await load<typeof M3>('cli/src/context.ts')
  const { aliases, commands, parse, usage } = await load<typeof M4>('cli/src/run.ts')
  const { version } = await load<typeof M5>('cli/src/version.ts')
  const { asked } = await load<typeof M6>('cli/src/commands/fund.ts')
  const { said, state } = await load<typeof M7>('cli/src/commands/swarms.ts')
  const Status = await load<typeof M8>('src/shared/Status.ts')

  const base: Overview = {
    archivedAt: null,
    balance: '56.710051',
    contributors: 7,
    form: 'agent',
    goal: 'Solve it',
    id: '06cf5d7c8f92',
    machines: 0,
    nickname: null,
    reason: null,
    remaining: '27.973444',
    spent: '28.736607',
    status: 'running',
    title: 'Solve P = NP.',
    updatedAt: 0,
    updates: [],
    why: null,
    working: null,
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'the CLI parses flags, aliases and its host the way its help says',
      async (_t) => {
        a.deepEqual(parse(['fund', 'p-vs-np', '5', '--yes', '--note=more lemmas', '--json', '-y']), {
          args: ['fund', 'p-vs-np', '5'],
          flags: { json: true, note: 'more lemmas', yes: true },
        })
        a.deepEqual(parse(['new', 'x', '--goal', 'find it', '--', '--not-a-flag']), { args: ['new', 'x', '--not-a-flag'], flags: { goal: 'find it' } })
        a.equal(host({}, {}), 'https://swarms.new')
        a.equal(host({}, { SWARMS_HOST: 'http://127.0.0.1:8787/swarms/' }), 'http://127.0.0.1:8787/swarms')
        a.equal(host({ host: 'paradigm.xyz/swarms' }, { SWARMS_HOST: 'ignored.example' }), 'https://paradigm.xyz/swarms')
        a.throws(() => host({ host: 'http://' }, {}), Failure)
        for (const name of Object.keys(usage)) a.ok(commands[name], name)
        for (const target of Object.values(aliases)) a.ok(usage[target], target)
      },
    ],
    [
      'the CLI version is the package version',
      async (_t) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname + '/..', '..', 'cli', 'package.json'), 'utf8')) as {
          bin: Record<string, string>
          name: string
          version: string
        }
        a.equal(manifest.version, version)
        a.deepEqual(manifest.bin, { swarms: 'dist/cli/src/main.js' })
      },
    ],
    [
      'a swarm is named by its nickname, its id, or its address on either site',
      async (_t) => {
        const asked: string[] = []
        const ctx = {
          ...context({ args: [], flags: {} }, {}),
          api: async <T>(_method: string, route: string) => (asked.push(route), { swarm: 'abcdef012345' }) as T,
        }
        a.equal(await swarm(ctx, 'abcdef012345'), 'abcdef012345')
        a.equal(await swarm(ctx, 'https://swarms.new/s/0123456789ab'), '0123456789ab')
        a.equal(await swarm(ctx, 'https://www.paradigm.xyz/swarms/s/0123456789ab/chat'), '0123456789ab')
        a.equal(await swarm(ctx, 'https://swarms.new/P-vs-NP'), 'abcdef012345')
        a.equal(await swarm(ctx, '@riemann'), 'abcdef012345')
        a.deepEqual(asked, ['/v1/names/p-vs-np', '/v1/names/riemann'])
      },
    ],
    [
      'completion scripts name every command for bash, zsh and fish',
      async (_t) => {
        for (const shell of ['bash', 'zsh', 'fish']) {
          let script = ''
          const ctx = {
            ...context({ args: ['completion', shell], flags: { json: true } }, {}),
            out: (value: unknown) => void (script = (value as { script: string }).script),
          }
          await completion(ctx)
          for (const name of Object.keys(usage)) a.ok(script.includes(name), `${shell} ${name}`)
          a.ok(script.includes('swarms __names'), shell)
        }
        await a.rejects(
          completion(context({ args: ['completion', 'tcsh'], flags: {} }, {})),
          (error: unknown) => error instanceof Failure && error.exit === 2 && /bash\|zsh\|fish/.test(error.next ?? ''),
        )
      },
    ],
    [
      'the token file is private to its owner',
      async (_t) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarms-cli-'))
        const kept = { ...process.env }
        Object.assign(process.env, { SWARMS_CONFIG_DIR: path.join(dir, 'swarms'), SWARMS_KEYCHAIN: '0' })
        delete process.env['SWARMS_TOKEN']
        try {
          const Auth = await load<typeof M9>('cli/src/auth.ts')
          a.equal(await Auth.load('https://swarms.new'), undefined)
          a.equal(await Auth.save('https://swarms.new', { address: '0xabc', token: 'secret-token-1' }), 'file')
          a.equal(fs.statSync(Auth.file()).mode & 0o777, 0o600)
          a.equal(fs.statSync(Auth.dir()).mode & 0o777, 0o700)
          a.deepEqual(await Auth.load('https://swarms.new'), { address: '0xabc', token: 'secret-token-1', where: 'file' })
          a.equal(await Auth.load('http://127.0.0.1:1'), undefined)
          process.env['SWARMS_TOKEN'] = 'from-env-token'
          a.deepEqual(await Auth.load('https://swarms.new'), { token: 'from-env-token', where: 'env' })
          delete process.env['SWARMS_TOKEN']
          a.equal(await Auth.remove('https://swarms.new'), true)
          a.equal(await Auth.load('https://swarms.new'), undefined)
        } finally {
          process.env = kept
          fs.rmSync(dir, { force: true, recursive: true })
        }
      },
    ],
    [
      "swarms status and swarms ls say what the page's pill says, from src/shared/Status.ts",
      async (_t) => {
        const now = 1_000_000_000
        const waiting: Overview = {
          ...base,
          failure: {
            at: 0,
            code: 'api_error',
            message: "Tempo Agents cannot pay the network fee to open your key's channel right now: its fee sponsor is out of funds.",
            route: 'Messages',
            status: 503,
          },
          reason: Status.reasons.sponsor,
          waiting: 'tempo',
          why: 'stuck',
          working: { since: now - 240_000, stalled: false },
        }
        a.deepEqual(said(waiting, now), { status: 'Waiting on Tempo', why: Status.reasons.sponsor })
        a.equal(said(waiting, now).status, Status.badge(waiting as Parameters<typeof Status.badge>[0]))
        a.equal(state(waiting), 'Waiting on Tempo')
        const stuck: Overview = { ...waiting, failure: null, reason: Status.reasons.stalled, waiting: null }
        a.deepEqual(said(stuck, now), { status: 'Retrying', why: Status.reasons.stalled })
        const broke: Overview = { ...base, reason: Status.reasons.broke, remaining: '0.010000', status: 'paused', why: 'money' }
        a.deepEqual(said(broke, now), { status: 'Needs money', why: Status.reasons.broke })
        a.equal(state(broke), 'Needs money')
        const working: Overview = { ...base, working: { since: now - 240_000 } }
        a.deepEqual(said(working, now), { status: 'Working now · working for 4m', why: null })
        a.equal(said({ ...working, working: { since: now - 240_000, stalled: true } }, now).status, 'Working now · working for 4m (stalled)')
        a.equal(state({ ...base, archivedAt: 1 }), 'Archived')
        a.equal(state({ ...base, balance: '0', remaining: '0', status: 'funding', why: 'unfunded' }), 'No riders yet')
        a.equal(state({ ...base, status: 'paused', why: 'idle' }, { inFlight: 2 }), 'Working now')
      },
    ],
    [
      'the ride prompt asks one question even when the title ends in punctuation',
      async (_t) => {
        a.equal(asked('Solve P = NP.'), 'Solve P = NP')
        a.equal(asked('Is it prime?  '), 'Is it prime')
        a.equal(asked('Megakernel for Muse Spark Open (Frontier Mix)'), 'Megakernel for Muse Spark Open (Frontier Mix)')
        a.equal(asked('...'), '...')
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { cli }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'cli.host',
      'cli/src/context.ts',
      'const full = /^https?:\\/\\//i.test(given) ? given : `https://${given}`',
      'const full = !/^https?:\\/\\//i.test(given) ? given : `https://${given}`',
    ),
    invariant: 'the CLI parses flags, aliases and its host the way its help says',
    name: 'cli.host',
    scenario: 'cli',
    seeds: ['1', '2', '3'],
  },
]
