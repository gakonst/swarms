import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
import type { Summary } from '../src/shared/Api.ts'
import * as Cards from '../src/worker/Cards.ts'
import * as Film from '../src/worker/Film.ts'
import * as Glyphs from '../src/worker/Glyphs.ts'
import * as Mp4 from '../src/worker/Mp4.ts'
import * as Paint from '../src/worker/Paint.ts'
import * as Share from '../src/worker/Share.ts'

const buffer = (path: string) => {
  const data = readFileSync(new URL(path, import.meta.url))
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}

const fonts = { mono: Glyphs.face(buffer('../src/worker/fonts/mono.bin'), 'Paradigm Semi Mono Beta'), serif: Glyphs.face(buffer('../src/worker/fonts/serif.bin'), 'Paradigm Serif') }

const swarm: Summary = {
  answer: null,
  contributors: 2,
  createdAt: 1,
  goal: 'Beat "SGLang" on <muse_decode_layer>.\n\nWork in the open.',
  id: 'abc123',
  machines: 0,
  pool: '0',
  problem: null,
  raised: '80.000000',
  remaining: '2.310000',
  setup: null,
  spent: '77.690000',
  status: 'paused',
  steering: 'open',
  title: 'Megakernel for "Muse" <Spark> & co',
  updatedAt: 2,
  wallet: null,
  why: 'money',
}

function boxes(data: Uint8Array, start = 0, end = data.length) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const found: { at: number; size: number; type: string }[] = []
  for (let at = start; at < end; ) {
    const size = view.getUint32(at)
    found.push({ at, size, type: String.fromCharCode(...data.subarray(at + 4, at + 8)) })
    assert.ok(size >= 8, 'every box has a size')
    at += size
  }
  return found
}

const headers: Record<string, number> = { avc1: 86, stsd: 16 }

function find(data: Uint8Array, path: string[]) {
  let range = { at: 0, size: data.length, type: '' }
  for (const type of path) {
    const next = boxes(data, range.at + (range.type ? (headers[range.type] ?? 8) : 0), range.at + range.size).find((item) => item.type === type)
    assert.ok(next, `found ${type}`)
    range = next
  }
  return range
}

test('a swarm shares its own title, numbers, card, poster, video and X player', () => {
  const shared = Share.share('https://swarms.example', Share.swarm(swarm))
  const html = Share.tags(shared)
  assert.equal(shared.url, 'https://swarms.example/s/abc123')
  assert.equal(shared.title, 'Megakernel for "Muse" <Spark> & co · Swarms')
  assert.match(shared.description, /^Needs funding · \$80\.00 raised from 2 backers\. Beat "SGLang" on <muse_decode_layer>\.$/)
  assert.match(html, /<meta property="og:title" content="Megakernel for &quot;Muse&quot; &lt;Spark&gt; &amp; co · Swarms">/)
  assert.doesNotMatch(html, /<Spark>/)
  assert.match(html, /<meta property="og:image" content="https:\/\/swarms\.example\/og\/s\/abc123\/card\.png\?v=[a-z0-9]+">/)
  assert.match(html, /<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">/)
  assert.match(html, /<meta property="og:video:type" content="video\/mp4">/)
  assert.match(html, /<meta name="twitter:card" content="player">/)
  assert.match(html, /<meta name="twitter:image" content="https:\/\/swarms\.example\/og\/s\/abc123\/poster\.png\?v=/)
  assert.match(html, /<meta name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123">/)
  assert.match(html, /<meta name="twitter:label2" content="Raised"><meta name="twitter:data2" content="\$80\.00 from 2 backers">/)
  assert.match(html, /<link rel="alternate" type="application\/json\+oembed" href="https:\/\/swarms\.example\/oembed\?url=https%3A%2F%2Fswarms\.example%2Fs%2Fabc123"/)
})

test('pages without a moving picture share a large image and no player', () => {
  const html = Share.tags(Share.share('https://swarms.example', Share.plain('docs')))
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/)
  assert.match(html, /<meta name="twitter:image" content="https:\/\/swarms\.example\/og\/docs\/card\.png/)
  assert.doesNotMatch(html, /og:video|twitter:player/)
})

test('a preview keeps its version while only cents move, and changes with money, backers or state', () => {
  const version = Share.version(Share.swarm(swarm))
  assert.equal(Share.version(Share.swarm({ ...swarm, remaining: '2.300000', spent: '77.700000', updatedAt: 9 })), version)
  assert.notEqual(Share.version(Share.swarm({ ...swarm, raised: '82.000000' })), version)
  assert.notEqual(Share.version(Share.swarm({ ...swarm, contributors: 3 })), version)
  assert.notEqual(Share.version(Share.swarm({ ...swarm, status: 'running', why: null })), version)
})

test('page urls map to preview keys, and only known ideas get one', () => {
  const at = (path: string) => Share.page(new URL(path, 'https://swarms.example'))
  assert.equal(at('/'), 'home')
  assert.equal(at('/ideas/'), 'ideas')
  assert.equal(at('/s/abc123/chat'), 's/abc123')
  assert.equal(at('/new?q=port-to-rust'), 'new/port-to-rust')
  assert.equal(at('/new?q=nope'), undefined)
  assert.equal(at('/s/a b'), undefined)
  assert.equal(at('/board'), undefined)
})

test('link preview crawlers are told apart from people', () => {
  const asks = (agent: string) => Share.bot(new Request('https://swarms.example/', { headers: { 'user-agent': agent } }))
  for (const agent of ['Twitterbot/1.0', 'facebookexternalhit/1.1 Facebot Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'TelegramBot (like TwitterBot)', 'WhatsApp/2.23', 'LinkedInBot/1.0', 'Mastodon/4.3']) assert.ok(asks(agent), agent)
  assert.ok(!asks('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'))
})

test('text wraps inside its width and ends with an ellipsis when it runs out of lines', () => {
  const lines = Glyphs.wrap(fonts.serif, swarm.title.repeat(4), 48, 500, 2)
  assert.equal(lines.length, 2)
  for (const line of lines) assert.ok(Glyphs.width(fonts.serif, line, 48) <= 500, line)
  assert.match(lines.at(-1) ?? '', /…$/)
  assert.deepEqual(Glyphs.wrap(fonts.serif, 'Short title', 48, 500, 2), ['Short title'])
})

test('cards escape what people wrote', () => {
  const scene = Cards.swarm(fonts, Cards.item(swarm), 1200, 630)
  const svg = Film.svg(scene, true)
  assert.doesNotMatch(svg, /<Spark>|<muse_decode_layer>/)
  assert.match(svg, /&lt;Spark&gt;/)
  assert.ok(scene.lines.length > 0)
  assert.ok(scene.gauge && scene.gauge.fill > 0 && scene.gauge.fill < 0.05)
})

test('a picture is a valid PNG of its canvas', async () => {
  const canvas = { data: new Uint8Array(4 * 3 * 2).fill(255), height: 2, width: 3 }
  Paint.disc(canvas, 1.5, 1, 1, [0, 0, 0])
  const png = await Paint.png(canvas)
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(png.buffer, png.byteOffset)
  assert.equal(view.getUint32(16), 3)
  assert.equal(view.getUint32(20), 2)
  const length = view.getUint32(33)
  assert.equal(String.fromCharCode(...png.subarray(37, 41)), 'IDAT')
  assert.equal(inflateSync(png.subarray(41, 41 + length)).length, (3 * 3 + 1) * 2)
})

test('a film is a fast-start MP4 whose samples and key frames match its H.264 stream', () => {
  const encoder = Film.encoder(new WebAssembly.Module(readFileSync(new URL('../src/worker/h264/encoder.wasm', import.meta.url))))(64, 48, 4)
  const frames: Uint8Array[] = []
  for (let index = 0; index < 6; index++) {
    encoder.pixels().fill(index * 40)
    frames.push(encoder.encode(25, index % 4 === 0))
  }
  const mp4 = Mp4.mux(frames, { fps: 24, height: 48, width: 64 })
  assert.deepEqual(boxes(mp4).map((item) => item.type), ['ftyp', 'moov', 'mdat'])
  const stsz = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz'])
  const view = new DataView(mp4.buffer, mp4.byteOffset)
  assert.equal(view.getUint32(stsz.at + 16), 6)
  const sizes = Array.from({ length: 6 }, (_, index) => view.getUint32(stsz.at + 20 + index * 4))
  const mdat = boxes(mp4).find((item) => item.type === 'mdat')!
  assert.equal(mdat.size - 8, sizes.reduce((sum, size) => sum + size, 0))
  const stco = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])
  assert.equal(view.getUint32(stco.at + 16), mdat.at + 8)
  const stss = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stss'])
  assert.deepEqual([view.getUint32(stss.at + 12), view.getUint32(stss.at + 16), view.getUint32(stss.at + 20)], [2, 1, 5])
  const avcc = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC'])
  assert.equal(mp4[avcc.at + 8], 1)
  assert.equal(mp4[avcc.at + 9], 66)
})
