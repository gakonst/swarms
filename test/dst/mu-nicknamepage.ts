import { registerHooks } from 'node:module'
import type { Summary } from '../../src/shared/Api.ts'
import type * as Share from '../../src/worker/Share.ts'
import type * as M1 from '../../src/worker/Share.ts'
import type * as Store from '../../src/worker/Store.ts'
import type * as M2 from '../../src/worker/Store.ts'
import type * as M3 from '../d1.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function nicknamepage(seed: string): Promise<Outcome> {
  const random = rng('nicknamepage', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Share = await load<typeof M1>('src/worker/Share.ts')
  const Store = await load<typeof M2>('src/worker/Store.ts')
  const { open } = await load<typeof M3>('test/d1.ts')

  const modules: Record<string, string> = {
    'cloudflare:workers': 'export const waitUntil = () => {}',
    '#ssr': 'export async function render() { return new ReadableStream() }',
    './Artifacts.ts': '',
    './Edge.ts': '',
    './Og.ts': '',
    './Operations.ts': '',
    './Share.ts': '',
  }

  registerHooks({
    resolve(specifier, context, next) {
      const source = context.parentURL?.endsWith('/src/worker/Page.ts') ? modules[specifier] : undefined
      return source === undefined ? next(specifier, context) : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) }
    },
  })

  const Page = await import('../../src/worker/Page.ts')

  const url = (path: string) => new Request(new URL(path, 'https://swarms.test'))

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'nickname pages render, and reserved or hex names stay off them',
      async (_t) => {
        for (const path of [
          '/pequalsnp',
          '/pequalsnp/',
          '/pequalsnp/chat',
          '/pequalsnp/code',
          '/pequalsnp/results',
          '/pequalsnp/n/0123456789',
          '/pequalsnp/t/0123456789',
          '/s/abc123abc123/t/0123456789',
          '/s/abc123abc123',
          '/new',
          '/board',
        ])
          a.ok(Page.rendered(path), path)
        for (const path of ['/v1', '/api', '/assets', '/fonts', '/favicon.ico', '/0123456789ab', '/ab', '/pequalsnp/other', '/Pequalsnp'])
          a.ok(!Page.rendered(path), path)
      },
    ],
    [
      '/s/<id> and a former nickname move to the nickname with the rest of the path, and /new?q moves to the name it slugs to',
      async (_t) => {
        const db = open()
        db.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run('abc123abc123', 'P vs NP', 'Settle it.')
        db.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run('def456def456', 'Plain', 'No name.')
        await Store.nickname(db.env, 'abc123abc123', 'p-vs-np')
        await Store.nickname(db.env, 'abc123abc123', 'pequalsnp')
        const env = db.env
        a.equal(await Page.renamed(env, url('/s/abc123abc123')), '/pequalsnp')
        a.equal(await Page.renamed(env, url('/s/abc123abc123/n/0123456789?ride')), '/pequalsnp/n/0123456789?ride')
        a.equal(await Page.renamed(env, url('/s/abc123abc123/chat/')), '/pequalsnp/chat')
        a.equal(await Page.renamed(env, url('/s/def456def456')), undefined)
        a.equal(await Page.renamed(env, url('/p-vs-np/results?r=chart')), '/pequalsnp/results?r=chart')
        a.equal(await Page.renamed(env, url('/pequalsnp')), undefined)
        a.equal(await Page.renamed(env, url('/nobody-has-this')), undefined)
        a.equal(await Page.renamed(env, url('/new?q=pq-signatures')), '/pq-signatures')
        a.equal(await Page.renamed(env, url('/new/?q=Faster%20JSON%20parsing&template=cheap')), '/faster-json-parsing?template=cheap')
        a.equal(await Page.renamed(env, url('/new?q=docs')), undefined)
        a.equal(await Page.renamed(env, url('/new?q=ab')), undefined)
        a.equal(await Page.renamed(env, url('/new')), undefined)
        a.equal(await Page.renamed(env, url('/new?fixture&q=pq-signatures')), undefined)
        a.equal(await Page.renamed(env, url('/docs')), undefined)
        await Store.nickname(db.env, 'abc123abc123', null)
        a.equal(await Page.renamed(env, url('/pequalsnp/chat')), '/s/abc123abc123/chat')
        a.equal(await Page.renamed(env, url('/s/abc123abc123')), undefined)
      },
    ],
    [
      'a nicknamed swarm shares, embeds and is canonical at its nickname',
      async (_t) => {
        const swarm = {
          answer: null,
          archivedAt: null,
          balance: '0',
          contributors: 0,
          cover: null,
          createdAt: 1,
          form: 'agent',
          goal: 'Settle it.',
          id: 'abc123abc123',
          machines: 0,
          nickname: 'pequalsnp',
          pool: '0',
          problem: null,
          remaining: '0',
          setup: null,
          spent: '0',
          status: 'funding',
          steering: 'open',
          title: 'P vs NP',
          updatedAt: 1,
          why: null,
        } satisfies Summary
        const shared = Share.share('https://paradigm.xyz/swarms', Share.swarm(swarm))
        a.equal(shared.url, 'https://paradigm.xyz/swarms/pequalsnp')
        a.equal(shared.oembed, 'https://paradigm.xyz/swarms/oembed?url=' + encodeURIComponent('https://paradigm.xyz/swarms/pequalsnp'))
        a.match(Share.tags(shared), /<link rel="canonical" href="https:\/\/paradigm\.xyz\/swarms\/pequalsnp">/)
        a.equal(Share.share('https://paradigm.xyz/swarms', Share.swarm({ ...swarm, nickname: null })).url, 'https://paradigm.xyz/swarms/s/abc123abc123')
        a.equal(
          Share.path({
            ...Share.tree('abc123abc123', {
              headline: { deadEnds: 0, frontier: 0, inFlight: 0, perProven: null, proven: 0, ridden: 0, spent: 0 } as never,
              nodes: [],
            }),
            name: 'pequalsnp',
          } as Share.Subject),
          '/pequalsnp',
        )
        const idea = Share.share('https://paradigm.xyz/swarms', Share.idea(Share.problem('pq-signatures')!))
        a.equal(idea.url, 'https://paradigm.xyz/swarms/pq-signatures')
        a.equal(Share.share('https://paradigm.xyz/swarms', Share.listing('new', []), { path: '/faster-json' }).url, 'https://paradigm.xyz/swarms/faster-json')
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { nicknamepage }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'nicknamepage.store',
      'src/worker/Store.ts',
      "return typeof parsed.url === 'string' && (parsed.form === 'page' || parsed.form === 'image') ? { form: parsed.form, url: parsed.url } : null",
      "return typeof parsed.url !== 'string' && (parsed.form === 'page' || parsed.form === 'image') ? { form: parsed.form, url: parsed.url } : null",
    ),
    invariant: '/s/<id> and a former nickname move to the nickname with the rest of the path, and /new?q moves to the name it slugs to',
    name: 'nicknamepage.store',
    scenario: 'nicknamepage',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'nicknamepage.share',
      'src/worker/Share.ts',
      "return `${count} rider${count === 1 ? '' : 's'}`",
      "return `${count} rider${count !== 1 ? '' : 's'}`",
    ),
    invariant: '/s/<id> and a former nickname move to the nickname with the rest of the path, and /new?q moves to the name it slugs to',
    name: 'nicknamepage.share',
    scenario: 'nicknamepage',
    seeds: ['1', '2', '3'],
  },
]
