import type { Overview } from '../../src/shared/Api.ts'
import type * as Tree from '../../src/shared/Tree.ts'
import type * as M1 from '../../src/shared/Tree.ts'
import type * as XFrames from '../../src/worker/XFrames.ts'
import type * as M2 from '../../src/worker/XFrames.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function xframes(seed: string): Promise<Outcome> {
  const random = rng('xframes', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Tree = await load<typeof M1>('src/shared/Tree.ts')
  const XFrames = await load<typeof M2>('src/worker/XFrames.ts')

  const overview = {
    answer: null,
    balance: '1.250000',
    code: null,
    contributions: [],
    contributors: 3,
    createdAt: 1,
    goal: 'Test <script> without placing markup in the player page.',
    hands: [],
    id: 'abc123',
    machines: 0,
    notes: [],
    pool: '0.000000',
    reason: null,
    remaining: '0.750000',
    spent: '0.500000',
    status: 'running',
    title: 'Safer <signatures>',
    updatedAt: 2,
    updates: [],
    working: null,
  } as unknown as Overview

  const usd = (value: number) => value.toFixed(6)

  function grown(id: string, over: Partial<Tree.Node> = {}): Tree.Node {
    const spent = over.money?.spent ?? '0.000000'
    return {
      by: { address: null, agent: null, handle: 'ana' },
      children: [],
      counts: { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0, [over.status ?? 'proposed']: 1 },
      createdAt: 1,
      end: null,
      form: 'lemma',
      funders: [],
      id,
      money: {
        committed: '0.000000',
        granted: '0.000000',
        inherited: '0.000000',
        left: '0.000000',
        pledged: '0.000000',
        spent,
        subtree: { left: '0.000000', pledged: '0.000000', spent },
      },
      needs: [],
      parent: 'root',
      proof: null,
      riders: 0,
      run: null,
      spec: id,
      statement: null,
      status: 'proposed',
      title: id,
      updatedAt: 1,
      ...over,
    } as Tree.Node
  }

  const check: Tree.Check = {
    at: 5,
    axioms: ['propext', 'Classical.choice', 'Quot.sound'],
    checker: 'lean4checker',
    command: 'lake build',
    commit: 'abc1234def5678',
    contentHash: 'f00d',
    durationMs: 1000,
    exitCode: 0,
    mathlib: '0123456789abcdef',
    repo: 'example/proofs',
    run: '42',
    statement: 'deadbeefdeadbeef',
    theorem: 'Pnp.N3fa91c2b0d',
    toolchain: 'leanprover/lean4:v4.22.0',
    url: 'https://github.com/example/proofs/actions/runs/42',
  }

  const lemmas = [
    grown('3fa91c2b0d', {
      money: {
        committed: '0.000000',
        granted: '0.000000',
        inherited: '4.000000',
        left: '0.000000',
        pledged: '0.000000',
        spent: '3.500000',
        subtree: { left: '0.000000', pledged: '0.000000', spent: '3.500000' },
      },
      proof: check,
      status: 'proven',
      title: 'Parity is not in <AC0> & co',
    }),
    grown('0a0a0a0a0a', {
      end: { at: 6, check: null, into: null, kind: 'barrier', why: 'Relativizes, so Baker-Gill-Solovay rules it out.' },
      status: 'dead end',
      title: 'Diagonalize against every machine',
    }),
    grown('1b1b1b1b1b', {
      run: { agent: 3, attempt: 1, budget: '5.000000', checking: false, k: 1, since: 1, spent: '1.000000', task: 'r:1b1b1b1b1b:1', until: 2 },
      status: 'in flight',
      title: 'A switching lemma for depth 3',
    }),
    grown('2c2c2c2c2c', { needs: ['3fa91c2b0d'], title: 'Monotone circuits for clique' }),
  ]

  const program = grown('9e9e9e9e9e', {
    children: lemmas.map((node) => node.id),
    counts: { 'dead end': 1, funded: 0, 'in flight': 1, proposed: 2, proven: 1 },
    form: 'program',
    riders: 3,
    title: 'Lower bounds toward P != NP',
  })

  const root = grown('root', { children: [program.id], form: 'goal', parent: null, title: 'Does P = NP?' })

  const nodes = [root, program, ...lemmas]

  const view = { headline: Tree.headline(nodes), nodes }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'start frame publishes an X player card that sends people to the swarm page to pay',
      async (_t) => {
        const response = XFrames.start('https://swarms.example')
        const html = await response.text()

        a.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
        a.match(html, /name="twitter:card" content="player"/)
        a.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x"/)
        a.match(html, /Open the swarm to pay/)
        a.match(html, /Launch/)
        a.match(html, /Quantum-safe signatures/)
      },
    ],
    [
      'card scripts parse',
      async (_t) => {
        const pages = [
          await XFrames.start('https://swarms.example', [], new URL('https://swarms.example/x?xframes-content=')).text(),
          await XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?xframes-content=')).text(),
        ]

        for (const html of pages) for (const found of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) a.doesNotThrow(() => new Function(found[1] ?? ''))
      },
    ],
    [
      'swarm frame escapes research text and points the player at its own route',
      async (_t) => {
        const response = XFrames.swarm('https://swarms.example', overview)
        const html = await response.text()

        a.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123"/)
        a.match(html, /Safer &lt;signatures&gt;/)
        a.match(html, /Test &lt;script&gt;/)
        a.doesNotMatch(html, /<script> without placing/)
        a.match(html, />Ride</)
      },
    ],
    [
      'a working swarm frame streams the agent live from when it started',
      async (_t) => {
        const working: Overview = {
          ...overview,
          updates: [{ at: 9, base: null, commits: [], done: false, excerpt: 'zstd <wins>', spent: '0.1' }],
          working: { since: 10 },
        }
        const html = await XFrames.swarm('https://swarms.example', working).text()

        a.match(html, /<title>Live: Safer &lt;signatures&gt;<\/title>/)
        a.match(html, /\/live\?after='\+seen/)
        a.match(html, /href="https:\/\/swarms\.example\/s\/abc123"/)
        a.match(html, /"live":\{"since":10\}/)
        a.match(html, /zstd &lt;wins&gt;/)
        a.doesNotMatch(html, /\b[Rr]ound \d|ROUND|[Ee]xplorer|[Rr]esearcher/)
        a.match(html, />Ride</)
      },
    ],
    [
      'a swarm frame that is not working shows the latest update',
      async (_t) => {
        const html = await XFrames.swarm('https://swarms.example', {
          ...overview,
          status: 'paused',
          updates: [{ at: 9, base: null, commits: [], done: false, excerpt: 'zstd wins on cost', spent: '0.1' }],
        }).text()

        a.match(html, /<title>Ride Safer/)
        a.match(html, /zstd wins on cost/)
        a.match(html, /"live":null/)
      },
    ],
    [
      'card image escapes its title',
      async (_t) => {
        const response = XFrames.card('Explore <science>')
        const svg = await response.text()

        a.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
        a.match(svg, /Explore &lt;science&gt;/)
        a.doesNotMatch(svg, /Explore <science>/)
      },
    ],
    [
      'the Telegram Mini App serves the card at its own origin with Telegram links',
      async (_t) => {
        const response = XFrames.start(
          'https://swarms.example',
          [{ ...overview, id: 'def456', status: 'running' }],
          new URL('https://swarms.example/tg'),
          'SwarmsBot',
        )
        const html = await response.text()
        a.doesNotMatch(response.headers.get('content-security-policy') ?? '', /sandbox/)
        a.match(response.headers.get('content-security-policy') ?? '', /https:\/\/telegram\.org/)
        a.match(html, /<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js/)
        a.match(html, /<body class="tg">/)
        a.doesNotMatch(html, /xframe-player/)
        a.match(html, /href="\/tg\/s\/def456"/)
        a.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x"/)
        a.match(html, /"base":"\/tg","bot":"SwarmsBot","hosted":false,"telegram":true,"url":"https:\/\/swarms\.example\/tg"/)

        const room = await XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/tg/s/abc123'), 'SwarmsBot').text()
        a.match(room, /"url":"https:\/\/swarms\.example\/tg\/s\/abc123"/)
        a.match(room, /t\.me\/share\/url/)

        const lost = await XFrames.lost('https://swarms.example', new URL('https://swarms.example/tg/s/nope')).text()
        a.match(lost, /href="\/tg\?view=join"/)

        const card = await XFrames.start(
          'https://swarms.example',
          [{ ...overview, id: 'def456', status: 'running' }],
          new URL('https://swarms.example/x?xframes-content='),
          'SwarmsBot',
        ).text()
        a.match(card, /href="\/x\/s\/def456"/)
        a.match(card, /"bot":null/)
      },
    ],
    [
      'a frame is served as a trusted player around its sandboxed card, as xframes does',
      async (_t) => {
        const outer = XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?view=fund'))
        const html = await outer.text()
        a.doesNotMatch(outer.headers.get('content-security-policy') ?? '', /sandbox/)
        a.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123"/)
        a.match(html, /<iframe id="xframe-player"[^>]*sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"/)
        a.match(html, /xframes-content/)
        a.doesNotMatch(html, />Ride</)

        const inner = XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?view=fund&xframes-content='))
        a.match(inner.headers.get('content-security-policy') ?? '', /^sandbox /)
        const card = await inner.text()
        a.match(card, /"hosted":true/)
        a.match(card, />Ride</)
      },
    ],
    [
      'a tree swarm plays as a frame with its headline, a square per lemma and its latest proofs and dead ends',
      async (_t) => {
        const response = XFrames.tree('https://swarms.example', 'pnp', view, new URL('https://swarms.example/x/s/pnp?xframes-content='))
        const html = await response.text()
        a.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/pnp"/)
        a.match(html, /<b data-count="proven">1<\/b>proven/)
        a.match(html, /<span data-count="frontier">2<\/span> on the frontier/)
        a.doesNotMatch(html, /of \d+ (lemmas|checked)/)
        a.equal([...html.matchAll(/<i data-cell="/g)].length, 4)
        a.match(html, /href="\/x\/s\/pnp\/n\/3fa91c2b0d"/)
        a.match(html, /Parity is not in &lt;AC0&gt; &amp; co<small>Proven · checked by Lean at abc1234<\/small>/)
        a.match(html, /Dead end · Stopped by a known barrier/)
        a.doesNotMatch(html, /Monotone circuits for clique/)
        a.match(html, /"ride":"\/s\/pnp"/)
        for (const found of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) a.doesNotThrow(() => new Function(found[1] ?? ''))
      },
    ],
    [
      'a node frame shows its status, why, money and the checked record, and shares a proof',
      async (_t) => {
        const proven = await XFrames.node(
          'https://swarms.example',
          'pnp',
          'Does P = NP?',
          lemmas[0]!,
          new URL('https://swarms.example/x/s/pnp/n/3fa91c2b0d?xframes-content='),
        ).text()
        a.match(proven, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/pnp\/n\/3fa91c2b0d"/)
        a.match(proven, /<dt>Theorem<\/dt><dd>Pnp\.N3fa91c2b0d<\/dd>/)
        a.match(proven, /href="https:\/\/github\.com\/example\/proofs\/actions\/runs\/42"/)
        a.match(proven, /href="https:\/\/x\.com\/intent\/post\?text=/)
        a.doesNotMatch(proven, /data-open="fund" type="button">Ride/)
        const open = await XFrames.node(
          'https://swarms.example',
          'pnp',
          'Does P = NP?',
          program,
          new URL('https://swarms.example/tg/s/pnp/n/9e9e9e9e9e'),
        ).text()
        a.match(open, /Under it: 1 proven · 1 in flight · 1 dead end · 1 open/)
        a.match(open, /<h1>Ride this program<\/h1>/)
        a.match(open, /"start":"pnp__9e9e9e9e9e"/)
        a.match(open, /"up":"\/tg\/s\/pnp"/)
        for (const page of [proven, open])
          for (const found of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) a.doesNotThrow(() => new Function(found[1] ?? ''))
      },
    ],
    [
      'a node frame marks a statement under review',
      async (_t) => {
        const html = await XFrames.node('https://swarms.example', 'pnp', 'Does P = NP?', { ...lemmas[3]!, review: true }).text()
        a.match(html, />Statement under review</)
        a.doesNotMatch(await XFrames.node('https://swarms.example', 'pnp', 'Does P = NP?', lemmas[3]!).text(), /under review/)
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { xframes }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'xframes.xframes',
      'src/worker/XFrames.ts',
      "return request?.pathname === '/tg' || request?.pathname.startsWith('/tg/') ? '/tg' : '/x'",
      "return request?.pathname !== '/tg' || request?.pathname.startsWith('/tg/') ? '/tg' : '/x'",
    ),
    invariant: 'a frame is served as a trusted player around its sandboxed card, as xframes does',
    name: 'xframes.xframes',
    scenario: 'xframes',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'xframes.tree',
      'src/shared/Tree.ts',
      "const proven = new Set(nodes.filter((node) => node.status === 'proven').map((node) => node.id))",
      "const proven = new Set(nodes.filter((node) => node.status !== 'proven').map((node) => node.id))",
    ),
    invariant: 'a tree swarm plays as a frame with its headline, a square per lemma and its latest proofs and dead ends',
    name: 'xframes.tree',
    scenario: 'xframes',
    seeds: ['1', '2', '3'],
  },
]
