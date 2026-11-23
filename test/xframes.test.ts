import assert from 'node:assert/strict'
import test from 'node:test'
import type { Overview } from '../src/shared/Api.ts'
import * as Tree from '../src/shared/Tree.ts'
import * as XFrames from '../src/worker/XFrames.ts'

const overview: Overview = {
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
  wallet: null,
  working: null,
}

test('start frame publishes an X player card that sends people to the swarm page to pay', async () => {
  const response = XFrames.start('https://swarms.example')
  const html = await response.text()

  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(html, /name="twitter:card" content="player"/)
  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x"/)
  assert.match(html, /Open the swarm to pay/)
  assert.match(html, /Launch/)
  assert.match(html, /Quantum-safe signatures/)
})

test('card scripts parse', async () => {
  const pages = [
    await XFrames.start('https://swarms.example', [], new URL('https://swarms.example/x?xframes-content=')).text(),
    await XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?xframes-content=')).text(),
  ]

  for (const html of pages) for (const found of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(found[1] ?? ''))
})

test('swarm frame escapes research text and points the player at its own route', async () => {
  const response = XFrames.swarm('https://swarms.example', overview)
  const html = await response.text()

  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123"/)
  assert.match(html, /Safer &lt;signatures&gt;/)
  assert.match(html, /Test &lt;script&gt;/)
  assert.doesNotMatch(html, /<script> without placing/)
  assert.match(html, />Ride</)
})

test('a working swarm frame streams the agent live from when it started', async () => {
  const working: Overview = { ...overview, updates: [{ at: 9, base: null, commits: [], done: false, excerpt: 'zstd <wins>', spent: '0.1' }], working: { since: 10 } }
  const html = await XFrames.swarm('https://swarms.example', working).text()

  assert.match(html, /<title>Live: Safer &lt;signatures&gt;<\/title>/)
  assert.match(html, /\/live\?after='\+seen/)
  assert.match(html, /href="https:\/\/swarms\.example\/s\/abc123"/)
  assert.match(html, /"live":\{"since":10\}/)
  assert.match(html, /zstd &lt;wins&gt;/)
  assert.doesNotMatch(html, /\b[Rr]ound \d|ROUND|[Ee]xplorer|[Rr]esearcher/)
  assert.match(html, />Ride</)
})

test('a swarm frame that is not working shows the latest update', async () => {
  const html = await XFrames.swarm('https://swarms.example', { ...overview, status: 'paused', updates: [{ at: 9, base: null, commits: [], done: false, excerpt: 'zstd wins on cost', spent: '0.1' }] }).text()

  assert.match(html, /<title>Ride Safer/)
  assert.match(html, /zstd wins on cost/)
  assert.match(html, /"live":null/)
})

test('card image escapes its title', async () => {
  const response = XFrames.card('Explore <science>')
  const svg = await response.text()

  assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
  assert.match(svg, /Explore &lt;science&gt;/)
  assert.doesNotMatch(svg, /Explore <science>/)
})

test('the Telegram Mini App serves the card at its own origin with Telegram links', async () => {
  const response = XFrames.start('https://swarms.example', [{ ...overview, id: 'def456', status: 'running' }], new URL('https://swarms.example/tg'), 'SwarmsBot')
  const html = await response.text()
  assert.doesNotMatch(response.headers.get('content-security-policy') ?? '', /sandbox/)
  assert.match(response.headers.get('content-security-policy') ?? '', /https:\/\/telegram\.org/)
  assert.match(html, /<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js/)
  assert.match(html, /<body class="tg">/)
  assert.doesNotMatch(html, /xframe-player/)
  assert.match(html, /href="\/tg\/s\/def456"/)
  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x"/)
  assert.match(html, /"base":"\/tg","bot":"SwarmsBot","hosted":false,"telegram":true,"url":"https:\/\/swarms\.example\/tg"/)

  const room = await XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/tg/s/abc123'), 'SwarmsBot').text()
  assert.match(room, /"url":"https:\/\/swarms\.example\/tg\/s\/abc123"/)
  assert.match(room, /t\.me\/share\/url/)

  const lost = await XFrames.lost('https://swarms.example', new URL('https://swarms.example/tg/s/nope')).text()
  assert.match(lost, /href="\/tg\?view=join"/)

  const card = await XFrames.start('https://swarms.example', [{ ...overview, id: 'def456', status: 'running' }], new URL('https://swarms.example/x?xframes-content='), 'SwarmsBot').text()
  assert.match(card, /href="\/x\/s\/def456"/)
  assert.match(card, /"bot":null/)
})

test('a frame is served as a trusted player around its sandboxed card, as xframes does', async () => {
  const outer = XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?view=fund'))
  const html = await outer.text()
  assert.doesNotMatch(outer.headers.get('content-security-policy') ?? '', /sandbox/)
  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123"/)
  assert.match(html, /<iframe id="xframe-player"[^>]*sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"/)
  assert.match(html, /xframes-content/)
  assert.doesNotMatch(html, />Ride</)

  const inner = XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?view=fund&xframes-content='))
  assert.match(inner.headers.get('content-security-policy') ?? '', /^sandbox /)
  const card = await inner.text()
  assert.match(card, /"hosted":true/)
  assert.match(card, />Ride</)
})

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
    money: { committed: '0.000000', granted: '0.000000', inherited: '0.000000', left: '0.000000', pledged: '0.000000', spent, subtree: { left: '0.000000', pledged: '0.000000', spent } },
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
  }
}

const check: Tree.Check = { at: 5, axioms: ['propext', 'Classical.choice', 'Quot.sound'], checker: 'lean4checker', command: 'lake build', commit: 'abc1234def5678', contentHash: 'f00d', durationMs: 1000, exitCode: 0, mathlib: '0123456789abcdef', repo: 'example/proofs', run: '42', statement: 'deadbeefdeadbeef', theorem: 'Pnp.N3fa91c2b0d', toolchain: 'leanprover/lean4:v4.22.0', url: 'https://github.com/example/proofs/actions/runs/42' }

const lemmas = [
  grown('3fa91c2b0d', { money: { committed: '0.000000', granted: '0.000000', inherited: '4.000000', left: '0.000000', pledged: '0.000000', spent: '3.500000', subtree: { left: '0.000000', pledged: '0.000000', spent: '3.500000' } }, proof: check, status: 'proven', title: 'Parity is not in <AC0> & co' }),
  grown('0a0a0a0a0a', { end: { at: 6, check: null, into: null, kind: 'barrier', why: 'Relativizes, so Baker-Gill-Solovay rules it out.' }, status: 'dead end', title: 'Diagonalize against every machine' }),
  grown('1b1b1b1b1b', { run: { agent: 3, attempt: 1, budget: '5.000000', checking: false, k: 1, since: 1, spent: '1.000000', task: 'r:1b1b1b1b1b:1', until: 2 }, status: 'in flight', title: 'A switching lemma for depth 3' }),
  grown('2c2c2c2c2c', { needs: ['3fa91c2b0d'], title: 'Monotone circuits for clique' }),
]

const program = grown('9e9e9e9e9e', { children: lemmas.map((node) => node.id), counts: { 'dead end': 1, funded: 0, 'in flight': 1, proposed: 2, proven: 1 }, form: 'program', riders: 3, title: 'Lower bounds toward P != NP' })

const root = grown('root', { children: [program.id], form: 'goal', parent: null, title: 'Does P = NP?' })

const nodes = [root, program, ...lemmas]

const view = { headline: Tree.headline(nodes), nodes }

test('a tree swarm plays as a frame with its headline, a square per lemma and its latest proofs and dead ends', async () => {
  const response = XFrames.tree('https://swarms.example', 'pnp', view, new URL('https://swarms.example/x/s/pnp?xframes-content='))
  const html = await response.text()
  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/pnp"/)
  assert.match(html, /<b data-count="proven">1<\/b>proven/)
  assert.match(html, /<span data-count="frontier">2<\/span> on the frontier/)
  assert.doesNotMatch(html, /of \d+ (lemmas|checked)/)
  assert.equal([...html.matchAll(/<i data-cell="/g)].length, 4)
  assert.match(html, /href="\/x\/s\/pnp\/n\/3fa91c2b0d"/)
  assert.match(html, /Parity is not in &lt;AC0&gt; &amp; co<small>Proven · checked by Lean at abc1234<\/small>/)
  assert.match(html, /Dead end · Stopped by a known barrier/)
  assert.doesNotMatch(html, /Monotone circuits for clique/)
  assert.match(html, /"ride":"\/s\/pnp"/)
  for (const found of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(found[1] ?? ''))
})

test('a node frame shows its status, why, money and the checked record, and shares a proof', async () => {
  const proven = await XFrames.node('https://swarms.example', 'pnp', 'Does P = NP?', lemmas[0]!, new URL('https://swarms.example/x/s/pnp/n/3fa91c2b0d?xframes-content=')).text()
  assert.match(proven, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/pnp\/n\/3fa91c2b0d"/)
  assert.match(proven, /<dt>Theorem<\/dt><dd>Pnp\.N3fa91c2b0d<\/dd>/)
  assert.match(proven, /href="https:\/\/github\.com\/example\/proofs\/actions\/runs\/42"/)
  assert.match(proven, /href="https:\/\/x\.com\/intent\/post\?text=/)
  assert.doesNotMatch(proven, /data-open="fund" type="button">Ride/)
  const open = await XFrames.node('https://swarms.example', 'pnp', 'Does P = NP?', program, new URL('https://swarms.example/tg/s/pnp/n/9e9e9e9e9e')).text()
  assert.match(open, /Under it: 1 proven · 1 in flight · 1 dead end · 1 open/)
  assert.match(open, /<h1>Ride this program<\/h1>/)
  assert.match(open, /"start":"pnp__9e9e9e9e9e"/)
  assert.match(open, /"up":"\/tg\/s\/pnp"/)
  for (const page of [proven, open]) for (const found of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(found[1] ?? ''))
})


test('a node frame marks a statement under review', async () => {
  const html = await XFrames.node('https://swarms.example', 'pnp', 'Does P = NP?', { ...lemmas[3]!, review: true }).text()
  assert.match(html, />Statement under review</)
  assert.doesNotMatch(await XFrames.node('https://swarms.example', 'pnp', 'Does P = NP?', lemmas[3]!).text(), /under review/)
})

