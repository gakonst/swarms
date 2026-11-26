import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import type { Summary } from '../../src/shared/Api.ts'
import type * as Cards from '../../src/worker/Cards.ts'
import type * as M1 from '../../src/worker/Cards.ts'
import type * as Film from '../../src/worker/Film.ts'
import type * as M2 from '../../src/worker/Film.ts'
import type * as Glyphs from '../../src/worker/Glyphs.ts'
import type * as M3 from '../../src/worker/Glyphs.ts'
import type * as Mp4 from '../../src/worker/Mp4.ts'
import type * as M4 from '../../src/worker/Mp4.ts'
import type * as Paint from '../../src/worker/Paint.ts'
import type * as M5 from '../../src/worker/Paint.ts'
import type * as Share from '../../src/worker/Share.ts'
import type * as M6 from '../../src/worker/Share.ts'
import type * as Tree from '../../src/shared/Tree.ts'
import type * as M7 from '../../src/shared/Tree.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function og(seed: string): Promise<Outcome> {
  const random = rng('og', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Cards = await load<typeof M1>('src/worker/Cards.ts')
  const Film = await load<typeof M2>('src/worker/Film.ts')
  const Glyphs = await load<typeof M3>('src/worker/Glyphs.ts')
  const Mp4 = await load<typeof M4>('src/worker/Mp4.ts')
  const Paint = await load<typeof M5>('src/worker/Paint.ts')
  const Share = await load<typeof M6>('src/worker/Share.ts')
  const Tree = await load<typeof M7>('src/shared/Tree.ts')

  const buffer = (path: string) => {
    const data = readFileSync(new URL(path, import.meta.url).pathname)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }

  const fonts = {
    mono: Glyphs.face(buffer('../../src/worker/fonts/mono.bin'), 'Paradigm Semi Mono Beta'),
    serif: Glyphs.face(buffer('../../src/worker/fonts/serif.bin'), 'Paradigm Serif'),
  }

  const swarm = {
    answer: null,
    balance: '80.000000',
    contributors: 2,
    createdAt: 1,
    goal: 'Beat "SGLang" on <muse_decode_layer>.\n\nWork in the open.',
    id: 'abc123',
    machines: 0,
    pool: '0',
    problem: null,
    remaining: '0.031000',
    setup: null,
    spent: '79.969000',
    status: 'paused',
    steering: 'open',
    title: 'Megakernel for "Muse" <Spark> & co',
    updatedAt: 2,
    why: 'money',
  } as Summary

  function boxes(data: Uint8Array, start = 0, end = data.length) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const found: { at: number; size: number; type: string }[] = []
    for (let at = start; at < end;) {
      const size = view.getUint32(at)
      found.push({ at, size, type: String.fromCharCode(...data.subarray(at + 4, at + 8)) })
      a.ok(size >= 8, 'every box has a size')
      at += size
    }
    return found
  }

  const headers: Record<string, number> = { avc1: 86, stsd: 16 }

  function find(data: Uint8Array, path: string[]) {
    let range = { at: 0, size: data.length, type: '' }
    for (const type of path) {
      const next = boxes(data, range.at + (range.type ? (headers[range.type] ?? 8) : 0), range.at + range.size).find((item) => item.type === type)
      a.ok(next, `found ${type}`)
      range = next
    }
    return range
  }

  const cards = () => {
    const field = Share.field([swarm])
    return [
      Cards.swarm(fonts, Cards.item(swarm), 1200, 630),
      Cards.swarm(fonts, Cards.idea({ hint: 'x', id: 'port-to-rust', title: 'Port a C library to safe Rust' } as never), 1200, 630),
      Cards.home(fonts, field, 1200, 630),
      Cards.ideas(fonts, field, 1200, 630),
      Cards.start(fonts, field, 1200, 630),
      Cards.about(fonts, 1200, 630),
      Cards.docs(fonts, 1200, 630),
    ]
  }

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
      'a swarm shares its own title, numbers, card, poster, video and X player',
      async (_t) => {
        const shared = Share.share('https://swarms.example', Share.swarm(swarm))
        const html = Share.tags(shared)
        a.equal(shared.url, 'https://swarms.example/s/abc123')
        a.equal(shared.title, 'Megakernel for "Muse" <Spark> & co · Swarms')
        a.match(shared.description, /^Needs money · \$80\.00 balance from 2 riders\. Beat "SGLang" on <muse_decode_layer>\.$/)
        a.match(html, /<meta property="og:title" content="Megakernel for &quot;Muse&quot; &lt;Spark&gt; &amp; co · Swarms">/)
        a.doesNotMatch(html, /<Spark>/)
        a.match(html, /<meta property="og:image" content="https:\/\/swarms\.example\/og\/s\/abc123\/card\.png\?v=[a-z0-9]+">/)
        a.match(html, /<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">/)
        a.match(html, /<meta property="og:video:type" content="video\/mp4">/)
        a.match(html, /<meta name="twitter:card" content="player">/)
        a.match(html, /<meta name="twitter:image" content="https:\/\/swarms\.example\/og\/s\/abc123\/poster\.png\?v=/)
        a.match(html, /<meta name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123">/)
        a.match(html, /<meta name="twitter:label2" content="Balance"><meta name="twitter:data2" content="\$80\.00 from 2 riders">/)
        a.match(
          html,
          /<link rel="alternate" type="application\/json\+oembed" href="https:\/\/swarms\.example\/oembed\?url=https%3A%2F%2Fswarms\.example%2Fs%2Fabc123"/,
        )
      },
    ],
    [
      'X gets a 1200x675 poster and the film stays 1280x720',
      async (_t) => {
        a.deepEqual(Share.card, { height: 630, width: 1200 })
        a.deepEqual(Share.poster, { height: 675, width: 1200 })
        const html = Share.tags(Share.share('https://swarms.example', Share.swarm(swarm)))
        a.match(html, /<meta property="og:video:width" content="1280"><meta property="og:video:height" content="720">/)
      },
    ],
    [
      'pages without a moving picture share a large image and no player',
      async (_t) => {
        const html = Share.tags(Share.share('https://swarms.example', Share.plain('docs')))
        a.match(html, /<meta name="twitter:card" content="summary_large_image">/)
        a.match(html, /<meta name="twitter:image" content="https:\/\/swarms\.example\/og\/docs\/card\.png/)
        a.doesNotMatch(html, /og:video|twitter:player/)
      },
    ],
    [
      'a preview keeps its version while only cents move, and changes with money, backers or state',
      async (_t) => {
        const version = Share.version(Share.swarm(swarm))
        a.equal(Share.version(Share.swarm({ ...swarm, remaining: '0.030000', spent: '79.970000', updatedAt: 9 })), version)
        a.notEqual(Share.version(Share.swarm({ ...swarm, balance: '82.000000' })), version)
        a.notEqual(Share.version(Share.swarm({ ...swarm, contributors: 3 })), version)
        a.notEqual(Share.version(Share.swarm({ ...swarm, remaining: '2.310000', status: 'running', why: null })), version)
      },
    ],
    [
      'page urls map to preview keys, and only known ideas get one',
      async (_t) => {
        const at = (path: string) => Share.page(new URL(path, 'https://swarms.example'))
        a.equal(at('/'), 'home')
        a.equal(at('/ideas/'), 'ideas')
        a.equal(at('/s/abc123/chat'), 's/abc123')
        a.equal(at('/new?q=port-to-rust'), 'new/port-to-rust')
        a.equal(at('/new?q=nope'), undefined)
        a.equal(at('/s/a b'), undefined)
        a.equal(at('/board'), undefined)
      },
    ],
    [
      'link preview crawlers are told apart from people',
      async (_t) => {
        const asks = (agent: string) => Share.bot(new Request('https://swarms.example/', { headers: { 'user-agent': agent } }))
        for (const agent of [
          'Twitterbot/1.0',
          'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
          'Slackbot-LinkExpanding 1.0',
          'Mozilla/5.0 (compatible; Discordbot/2.0)',
          'TelegramBot (like TwitterBot)',
          'WhatsApp/2.23',
          'LinkedInBot/1.0',
          'Mastodon/4.3',
        ])
          a.ok(asks(agent), agent)
        a.ok(!asks('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'))
      },
    ],
    [
      'text wraps inside its width and ends with an ellipsis when it runs out of lines',
      async (_t) => {
        const lines = Glyphs.wrap(fonts.serif, swarm.title.repeat(4), 48, 500, 2)
        a.equal(lines.length, 2)
        for (const line of lines) a.ok(Glyphs.width(fonts.serif, line, 48) <= 500, line)
        a.match(lines.at(-1) ?? '', /…$/)
        a.deepEqual(Glyphs.wrap(fonts.serif, 'Short title', 48, 500, 2), ['Short title'])
      },
    ],
    [
      'cards escape what people wrote',
      async (_t) => {
        const scene = Cards.swarm(fonts, Cards.item(swarm), 1200, 630)
        const svg = Film.svg(scene)
        a.doesNotMatch(svg, /<Spark>|<muse_decode_layer>/)
        a.match(svg, /&lt;Spark&gt;/)
        a.match(svg, /\$80\.00 ridden · 2 riders/)
        a.ok(scene.marks.length > 40)
      },
    ],
    [
      'every card is a flat grey page with a black serif title at the left and no button, border or gradient',
      async (_t) => {
        for (const scene of cards()) {
          const svg = Film.svg(scene)
          a.match(svg, /^<svg [^>]*><rect width="1200" height="630" fill="#F6F6F6"\/>/)
          a.equal([...svg.matchAll(/<rect /g)].length, 1, 'one rect: the page')
          a.doesNotMatch(svg, /Gradient|stroke=|rx=|→|Ride it|Start it/)
          a.match(svg, /<text x="15\d\.\d" y="[\d.]+" font-family="Paradigm Serif" font-size="[\d.]+"[^>]* fill="#000000">/)
          const right = scene.marks.filter((mark) => mark.x > 600)
          a.ok(right.length > 40, 'a drawing of marks on the right half')
          a.ok(
            right.every((mark) => mark.color === '#000000' && mark.size === 9),
            'black 9 px marks',
          )
        }
      },
    ],
    [
      'the first frame of a film is the still card, and the marks move after it',
      async (_t) => {
        const scene = Cards.home(fonts, Share.field([swarm]), 1280, 720)
        for (const mark of scene.marks) a.deepEqual(Film.where(scene, mark, 0), { x: Math.floor(mark.x) + 0.5, y: Math.floor(mark.y) + 0.5 })
        a.ok(scene.marks.some((mark) => Math.hypot(Film.where(scene, mark, 1.5).x - mark.x, Film.where(scene, mark, 1.5).y - mark.y) > 1))
      },
    ],
    [
      'a picture is a valid PNG of its canvas',
      async (_t) => {
        const canvas = { data: new Uint8Array(4 * 3 * 2).fill(255), height: 2, width: 3 }
        Paint.disc(canvas, 1.5, 1, 1, [0, 0, 0])
        const png = await Paint.png(canvas)
        a.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        const view = new DataView(png.buffer, png.byteOffset)
        a.equal(view.getUint32(16), 3)
        a.equal(view.getUint32(20), 2)
        const length = view.getUint32(33)
        a.equal(String.fromCharCode(...png.subarray(37, 41)), 'IDAT')
        a.equal(inflateSync(png.subarray(41, 41 + length)).length, (3 * 3 + 1) * 2)
      },
    ],
    [
      'a film is a fast-start MP4 whose samples and key frames match its H.264 stream',
      async (_t) => {
        const encoder = Film.encoder(
          new (WebAssembly.Module as unknown as new (bytes: Uint8Array) => WebAssembly.Module)(
            readFileSync(new URL('../../src/worker/h264/encoder.wasm', import.meta.url).pathname),
          ),
        )(64, 48, 4)
        const frames: Uint8Array[] = []
        for (let index = 0; index < 6; index++) {
          encoder.pixels().fill(index * 40)
          frames.push(encoder.encode(25, index % 4 === 0))
        }
        const mp4 = Mp4.mux(frames, { fps: 24, height: 48, width: 64 })
        a.deepEqual(
          boxes(mp4).map((item) => item.type),
          ['ftyp', 'moov', 'mdat'],
        )
        const stsz = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz'])
        const view = new DataView(mp4.buffer, mp4.byteOffset)
        a.equal(view.getUint32(stsz.at + 16), 6)
        const sizes = Array.from({ length: 6 }, (_, index) => view.getUint32(stsz.at + 20 + index * 4))
        const mdat = boxes(mp4).find((item) => item.type === 'mdat')!
        a.equal(
          mdat.size - 8,
          sizes.reduce((sum, size) => sum + size, 0),
        )
        const stco = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])
        a.equal(view.getUint32(stco.at + 16), mdat.at + 8)
        const stss = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stss'])
        a.deepEqual([view.getUint32(stss.at + 12), view.getUint32(stss.at + 16), view.getUint32(stss.at + 20)], [2, 1, 5])
        const avcc = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC'])
        a.equal(mp4[avcc.at + 8], 1)
        a.equal(mp4[avcc.at + 9], 66)
      },
    ],
    [
      'the field counts the money swarms have left to spend, not everything riders ever sent',
      async (_t) => {
        const base = { ...swarm, status: 'running', why: null }
        const field = Share.field([
          { ...base, balance: '200.000000', id: 'a', remaining: '1.500000' },
          { ...base, balance: '88.000000', id: 'b', remaining: '-0.200000' },
        ] as never)
        a.equal(field.balance, 1.5)
      },
    ],
    [
      'a tree swarm shares its headline count, never a total, with a card and an X player',
      async (_t) => {
        const shared = Share.share('https://swarms.example', Share.tree('pnp', view))
        const html = Share.tags(shared)
        a.equal(shared.url, 'https://swarms.example/s/pnp')
        a.equal(shared.title, 'Does P = NP? · Swarms')
        a.equal(
          shared.description,
          '1 proven · 2 on the frontier · 1 in flight · 1 dead end · $3.50 spent. Ride a lemma, a program or the whole swarm. Lean decides what is proven, and every dead end is kept.',
        )
        a.doesNotMatch(shared.description, / of /)
        a.match(html, /<meta property="og:image" content="https:\/\/swarms\.example\/og\/s\/pnp\/card\.png\?v=[a-z0-9]+">/)
        a.match(html, /<meta name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/pnp">/)
        a.match(html, /<meta name="twitter:label1" content="Proven"><meta name="twitter:data1" content="1">/)
        a.doesNotMatch(html, /og:video/)
      },
    ],
    [
      'the swarm card draws its tree as one mark per node, coloured by how each stands, and its numbers small',
      async (_t) => {
        const item = Cards.grove('pnp', view)
        a.deepEqual(item.cells, ['proven', 'dead', 'flight', 'open'])
        a.deepEqual(item.twigs, [
          { cell: 'open', up: -1 },
          { cell: 'open', up: 0 },
          { cell: 'proven', up: 1 },
          { cell: 'dead', up: 1 },
          { cell: 'flight', up: 1 },
          { cell: 'open', up: 1 },
        ])
        const scene = Cards.tree(fonts, item, 1200, 630)
        const drawn = scene.marks.filter((mark) => mark.x > 600)
        a.equal(drawn.length, nodes.length)
        a.deepEqual(drawn.map((mark) => mark.color).sort(), ['#000000', '#00E10A', '#999999', '#CCCCCC', '#CCCCCC', '#CCCCCC'])
        const svg = Film.svg(scene)
        a.match(svg, />1 proven<\/text>/)
        a.match(svg, />1 in flight<\/text>/)
        a.match(svg, />1 dead end<\/text>/)
        a.match(svg, />\$3\.50 spent<\/text>/)
        a.doesNotMatch(svg, / of \d|Ride|→/)
      },
    ],
    [
      'a big tree still gets one mark per node, none on top of another, inside the right half',
      async (_t) => {
        const many = Array.from({ length: 640 }, (_, index) => grown(`m${index}`, { status: index % 3 ? 'proposed' : 'proven' }))
        const big = [grown('root', { children: many.map((node) => node.id), form: 'goal', parent: null }), ...many]
        for (const size of [
          { height: 630, width: 1200 },
          { height: 675, width: 1200 },
        ]) {
          const scene = Cards.tree(fonts, Cards.grove('big', { headline: Tree.headline(big), nodes: big }), size.width, size.height)
          const drawn = scene.marks.filter((mark) => mark.x > 600)
          a.equal(drawn.length, big.length)
          a.ok(drawn.every((mark) => mark.x > 640 && mark.x < size.width - 40 && mark.y > 40 && mark.y < size.height - 40))
          let closest = Infinity
          for (let a = 0; a < drawn.length; a++)
            for (let b = a + 1; b < drawn.length; b++) closest = Math.min(closest, Math.hypot(drawn[a]!.x - drawn[b]!.x, drawn[a]!.y - drawn[b]!.y))
          a.ok(closest >= 8, `marks ${closest.toFixed(1)} px apart`)
        }
      },
    ],
    [
      'a node card says its status, why, what is under it and, when proven, the commit Lean checked',
      async (_t) => {
        const proven = Cards.leaf('Does P = NP?', lemmas[0]!)
        a.equal(proven.checked, 'abc1234')
        const svg = Film.svg(Cards.node(fonts, proven, 1200, 630))
        a.match(svg, /Proven · checked by Lean · abc1234/)
        a.match(svg, /Parity is not in &lt;AC0&gt; &amp; co/)
        a.doesNotMatch(svg, /<AC0>/)
        const dead = Film.svg(Cards.node(fonts, Cards.leaf('Does P = NP?', lemmas[1]!), 1200, 630))
        a.match(dead, />Dead end<\/text>/)
        a.match(dead, /Stopped by a known barrier/)
        const parent = Cards.leaf('Does P = NP?', program)
        a.equal(Cards.below(parent.counts), '1 proven · 1 in flight · 1 dead end · 1 open')
        a.match(Film.svg(Cards.node(fonts, parent, 1200, 630)), /Under it: 1 proven · 1 in flight · 1 dead end · 1 open/)
        a.doesNotMatch(Film.svg(Cards.node(fonts, parent, 1200, 630)), /Ride|→/)
        a.equal(Cards.ask('goal'), 'Ride the whole swarm')
        const placed = Cards.leaf('Does P = NP?', lemmas[2]!, view)
        a.equal(placed.at, 4)
        const scene = Cards.node(fonts, placed, 1200, 630)
        const ringed = scene.marks.filter((mark) => mark.ring)
        a.equal(ringed.length, 1)
        a.equal(ringed[0]!.color, '#000000')
        a.equal(scene.marks.filter((mark) => mark.x > 600).length, nodes.length)
      },
    ],
    [
      'a node page shares its own card and player, and keys map both ways',
      async (_t) => {
        const subject = Share.node('pnp', 'Does P = NP?', lemmas[0]!)
        const shared = Share.share('https://swarms.example', subject)
        a.equal(shared.url, 'https://swarms.example/s/pnp/t/3fa91c2b0d')
        a.equal(shared.player, 'https://swarms.example/x/s/pnp/n/3fa91c2b0d')
        a.equal(shared.image.card.split('?')[0], 'https://swarms.example/og/s/pnp/n/3fa91c2b0d/card.png')
        a.match(Share.tags(shared), /content="Proven, checked by Lean at abc1234"/)
        a.equal(Share.page(new URL('https://swarms.example/s/pnp/n/3fa91c2b0d')), 's/pnp/n/3fa91c2b0d')
        a.equal(Share.page(new URL('https://swarms.example/s/pnp/n/root')), 's/pnp/n/root')
        a.equal(Share.page(new URL('https://swarms.example/s/pnp/t/3fa91c2b0d')), 's/pnp/n/3fa91c2b0d')
        a.equal(Share.page(new URL('https://swarms.example/s/pnp/n/NOPE!')), undefined)
      },
    ],
    [
      'a card keeps its version while cents move, and changes when a lemma is proven',
      async (_t) => {
        const version = Share.version(Share.tree('pnp', view))
        const cents = nodes.map((node) =>
          node.id === '1b1b1b1b1b' ? { ...node, money: { ...node.money, spent: '0.010000', subtree: { ...node.money.subtree, spent: '0.010000' } } } : node,
        )
        a.equal(Share.version(Share.tree('pnp', { headline: Tree.headline(cents), nodes: cents })), version)
        const more = nodes.map((node) => (node.id === '2c2c2c2c2c' ? { ...node, proof: check, status: 'proven' as const } : node))
        a.notEqual(Share.version(Share.tree('pnp', { headline: Tree.headline(more), nodes: more })), version)
      },
    ],
    [
      'proofs and dead ends are announced with links to their node, and nothing else is',
      async (_t) => {
        const proven = Share.announce('https://swarms.example', 'pnp', 'Does P = NP?', { at: 9, event: 'proven', node: lemmas[0]!, seq: 1, text: '' })
        a.equal(proven?.text, 'Does P = NP?\nProven, checked by Lean at abc1234: Parity is not in <AC0> & co')
        a.equal(proven?.url, 'https://swarms.example/s/pnp/t/3fa91c2b0d')
        a.equal(proven?.frame, 'https://swarms.example/x/s/pnp/n/3fa91c2b0d')
        a.match(
          proven?.intent ?? '',
          /^https:\/\/x\.com\/intent\/post\?text=Does%20P%20%3D%20NP%3F%0AProven.*&url=https%3A%2F%2Fswarms\.example%2Fx%2Fs%2Fpnp%2Fn%2F3fa91c2b0d$/,
        )
        const dead = Share.announce('https://swarms.example', 'pnp', 'Does P = NP?', { at: 9, event: 'ended', node: lemmas[1]!, seq: 2, text: '' })
        a.match(dead?.text ?? '', /Dead end, kept in the tree: Diagonalize against every machine\. Stopped by a known barrier: Relativizes/)
        a.equal(Share.announce('https://swarms.example', 'pnp', 'Does P = NP?', { at: 9, event: 'progress', node: lemmas[2]!, seq: 3, text: '' }), undefined)
        a.equal(Share.announce('https://swarms.example', 'pnp', 'Does P = NP?', { at: 9, event: 'proven', node: lemmas[3]!, seq: 4, text: '' }), undefined)
      },
    ],
    [
      'a statement nobody has reviewed says so on its card and frame',
      async (_t) => {
        const value = { ...lemmas[3]!, review: true }
        a.match(Film.svg(Cards.node(fonts, Cards.leaf('Does P = NP?', value), 1200, 630)), />Statement under review<\/text>/)
        a.doesNotMatch(Film.svg(Cards.node(fonts, Cards.leaf('Does P = NP?', lemmas[3]!), 1200, 630)), /under review/)
        a.notEqual(Share.version(Share.node('pnp', 'Does P = NP?', value)), Share.version(Share.node('pnp', 'Does P = NP?', lemmas[3]!)))
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { og }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'og.tree',
      'src/shared/Tree.ts',
      "const proven = new Set(nodes.filter((node) => node.status === 'proven').map((node) => node.id))",
      "const proven = new Set(nodes.filter((node) => node.status !== 'proven').map((node) => node.id))",
    ),
    invariant: 'a tree swarm shares its headline count, never a total, with a card and an X player',
    name: 'og.tree',
    scenario: 'og',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('og.share', 'src/worker/Share.ts', "return `${count} rider${count === 1 ? '' : 's'}`", "return `${count} rider${count !== 1 ? '' : 's'}`"),
    invariant: 'a swarm shares its own title, numbers, card, poster, video and X player',
    name: 'og.share',
    scenario: 'og',
    seeds: ['1', '2', '3'],
  },
]
