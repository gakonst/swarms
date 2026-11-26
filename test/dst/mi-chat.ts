import { timingSafeEqual } from 'node:crypto'
import * as Mention from '../../src/shared/Mention.ts'
import * as Filled from '../../src/worker/Filled.ts'
import * as Relay from '../../src/worker/Relay.ts'
import * as Telegram from '../../src/worker/Telegram.ts'
import { recorder, rng, type Outcome, type Rng } from './mi.ts'

export const limits = { beatMs: 25_000, cases: 200, handles: 40, requests: 12, words: 8 }

const impl = {
  filled: Filled.filled,
  steers: Mention.steers,
  beat: Relay.beat,
  hooked: null as null | ((hook: typeof Telegram.hook) => typeof Telegram.hook),
}

const mutants: { [K in keyof typeof impl]: (typeof impl)[K] } = {
  filled: (env, vault, need) => {
    Filled.reset()
    return Filled.filled(env, vault, need)
  },
  steers: (text) => /@swarm/i.test(text),
  beat: (self) => {
    self.beating ??= setInterval(() => {
      for (const watcher of self.watchers) void watcher.writer.write(new TextEncoder().encode(': keepalive\n\n'))
    }, limits.beatMs)
  },
  hooked: (hook) => (env, request) =>
    hook(
      env,
      new Request(request, { headers: { 'x-telegram-bot-api-secret-token': (env as { TELEGRAM_WEBHOOK_SECRET?: string }).TELEGRAM_WEBHOOK_SECRET ?? '' } }),
    ),
}

function mutant<K extends keyof typeof impl>(key: K) {
  return () => {
    const was = impl[key]
    impl[key] = mutants[key]
    return () => void (impl[key] = was)
  }
}

async function vault(seed: string): Promise<Outcome> {
  const random = rng('vault', seed)
  const { holds, same, steps, violations } = recorder()
  for (let run = 0; run < limits.cases / 20; run++) {
    Filled.reset()
    let calls = 0
    let failing = random.int(0, 2)
    const own = random.chance(0.3)
    const env = (own ? Object.fromEntries(Filled.names.map((name) => [name, 'own'])) : { DB: 'db' }) as Record<string, unknown>
    const source = {
      secrets: () => {
        calls++
        if (failing > 0) {
          failing--
          throw new Error('down')
        }
        return { SWARMS_GATEWAY_KEY: 'k', TELEGRAM_BOT_TOKEN: 't' }
      },
    }
    let failed = 0
    for (let at = 0; at < limits.requests; at++) {
      const out = (await impl.filled(env, source, Filled.names).catch(() => undefined)) as Record<string, unknown> | undefined
      if (!out) {
        failed++
        continue
      }
      same('filled', [out['SWARMS_GATEWAY_KEY'], out['DB'] ?? null], own ? ['own', null] : ['k', 'db'], 'request ' + at)
    }
    same('once per isolate', calls, own ? 0 : failed + 1, (own ? 'own secrets' : failed + ' failed reads') + ' then ' + limits.requests + ' requests')
    holds('env untouched', own || env['SWARMS_GATEWAY_KEY'] === undefined, 'the shared env got the vault secret')
  }
  return { steps: steps(), violations }
}

async function room(seed: string): Promise<Outcome> {
  const random = rng('room', seed)
  const { holds, same, steps, violations } = recorder()
  const address = '0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A'
  const handle = Mention.handle(address)
  holds(
    'handle',
    /^[a-z]+-ff2a$/.test(handle) && Mention.handle(address.toLowerCase()) === handle && Mention.handle('0x1563915e194d8cfba1943570603f7606a3115508') !== handle,
    'handle ' + handle,
  )
  const steers: [string, boolean][] = [
    ['@swarm try simd-json next', true],
    ['agreed. @SWARM: measure cost per GiB', true],
    ['mail me at me@swarm.dev', false],
    ['@swarmy is not the swarm', false],
    ['no mention at all', false],
  ]
  for (const [text, want] of steers) same('standalone steers', impl.steers(text), want, text)
  same(
    'idea',
    [Mention.idea('@swarm   try simd-json\nnext'), Mention.idea('@quark-1a2b is right, @swarm drop Qwen')],
    ['try simd-json next', '@quark-1a2b is right, drop Qwen'],
    'idea',
  )
  same(
    'mentioned',
    [
      Mention.mentioned('@Quark-1A2B and @quark-1a2b, @mira_k and @swarm'),
      Mention.mentioned('write to me@georgios.dev or @ab'),
      Mention.mentioned('thanks, @tensorbox.'),
    ],
    [['quark-1a2b', 'mira_k'], [], ['tensorbox']],
    'mentioned',
  )
  same(
    'pieces',
    [Mention.pieces('hi @quark-1a2b, @swarm go @mira'), Mention.pieces('me@swarm.dev')],
    [['hi ', '@quark-1a2b', ', ', '@swarm', ' go ', '@mira'], ['me@swarm.dev']],
    'pieces',
  )
  same('invalid', [Mention.invalid('georgios'), Mention.invalid('Mira_K-2')], [undefined, undefined], 'valid names')
  const refusals: [string, RegExp][] = [
    ['ab', /3 to 24/],
    ['9lives', /starting with a letter/],
    ['trailing-', /ending with a letter or digit/],
    ['has space', /letters, digits/],
    ['swarm', /reserved/],
    ['quark-1a2b', /made from an address/],
    ['a'.repeat(25), /3 to 24/],
  ]
  for (const [name, why] of refusals) holds('invalid', why.test(Mention.invalid(name) ?? ''), name + ' refused with ' + Mention.invalid(name))
  for (let at = 0; at < limits.cases; at++) {
    const hex = '0x' + Array.from({ length: limits.handles }, () => random.int(0, 15).toString(16)).join('')
    const one = Mention.handle(random.chance(0.5) ? hex.toUpperCase().replace('0X', '0x') : hex)
    holds('handle', one === Mention.handle(hex) && one.endsWith('-' + hex.slice(-4)) && !!Mention.invalid(one), hex + ' gave ' + one)
    const text = Array.from({ length: random.int(1, limits.words) }, () => word(random)).join(' ')
    holds('pieces', Mention.pieces(text).join('') === text, JSON.stringify(text) + ' lost text in pieces')
    const standalone = /(^|[^\w@.])@swarm(?![\w-])/i.test(text)
    holds('standalone steers', impl.steers(text) === standalone, JSON.stringify(text) + ' steers ' + impl.steers(text))
    holds(
      'mentioned',
      Mention.mentioned(text).every((name, i, all) => name === name.toLowerCase() && name !== 'swarm' && all.indexOf(name) === i),
      JSON.stringify(text) + ' mentioned ' + JSON.stringify(Mention.mentioned(text)),
    )
  }
  return { steps: steps(), violations }
}

function word(random: Rng) {
  return random.pick(['@swarm', '@SWARM:', 'me@swarm.dev', '@swarmy', '@quark-1a2b', '@Mira_K', 'try', 'next.', 'hi', '@ab', 'x@swarm'])
}

type Timer = { fire: () => void; id: number }

async function relay(seed: string): Promise<Outcome> {
  const random = rng('relay', seed)
  const { holds, same, steps, violations } = recorder()
  const real = { clear: globalThis.clearInterval, set: globalThis.setInterval }
  const timers = new Map<number, Timer>()
  let ids = 0
  globalThis.setInterval = ((fire: () => void) => {
    const id = ++ids
    timers.set(id, { fire, id })
    return id
  }) as never
  globalThis.clearInterval = ((id: number) => void timers.delete(id)) as never
  const tick = () => {
    for (const timer of [...timers.values()]) timer.fire()
  }
  try {
    for (let run = 0; run < limits.cases / 10; run++) {
      const kind = random.pick(['current', 'replaced', 'reset'] as const)
      const writes: string[] = []
      let closed = 0
      const watchers = Array.from({ length: random.int(1, 3) }, () => {
        const writer = {
          close: () => (closed++, Promise.resolve()),
          desiredSize: 1,
          write: (bytes: Uint8Array) => (writes.push(new TextDecoder().decode(bytes)), Promise.resolve()),
        }
        return { follow: true, relaying: false, until: Date.now() + Relay.followForMs, writer } as never as Relay.Watcher
      })
      const instance = () => {
        if (kind === 'reset') throw new Error('Durable Object reset because its code was updated.')
        return kind === 'current' ? 'b1' : 'b2'
      }
      const self = { beating: undefined, boot: 'b1', ctx: { storage: { kv: { get: instance } } }, watchers: new Set(watchers) } as never as Parameters<
        typeof Relay.beat
      >[0]
      impl.beat(self)
      const beats = random.int(1, 3)
      for (let i = 0; i < beats; i++) tick()
      if (kind === 'current') {
        same('current kept', [writes.length, closed], [beats * watchers.length, 0], 'a current instance after ' + beats + ' beats')
        for (const watcher of watchers) Relay.unwatch(self, watcher)
      } else {
        same('superseded closed', [writes.length, closed, self.watchers.size], [0, watchers.length, 0], kind + ' instance')
        holds('superseded closed', self.beating === undefined, kind + ' instance still beats')
      }
      timers.clear()
    }
  } finally {
    globalThis.setInterval = real.set
    globalThis.clearInterval = real.clear
  }
  return { steps: steps(), violations }
}

const node = (status: 'proven' | 'in flight') => ({
  by: { address: null, agent: null, handle: 'ana' },
  children: [],
  counts: { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 1 },
  createdAt: 1,
  end: null,
  form: 'lemma' as const,
  funders: [],
  id: '3fa91c2b0d',
  money: {
    committed: '0.000000',
    granted: '0.000000',
    inherited: '0.000000',
    left: '0.000000',
    pledged: '0.000000',
    spent: '1.000000',
    subtree: { left: '0.000000', pledged: '0.000000', spent: '1.000000' },
  },
  needs: [],
  parent: 'root',
  proof: {
    at: 5,
    axioms: [],
    checker: 'lean4checker',
    command: 'lake build',
    commit: 'abc1234def',
    contentHash: 'x',
    durationMs: 1,
    exitCode: 0,
    mathlib: 'm',
    repo: 'r',
    run: '1',
    statement: 's',
    theorem: 't',
    toolchain: 'l',
    url: 'https://github.com/example/proofs/actions/runs/1',
  },
  riders: 0,
  run: null,
  spec: '',
  statement: null,
  status,
  title: 'Parity is not in AC0',
  updatedAt: 1,
})

async function telegram(seed: string): Promise<Outcome> {
  const random = rng('telegram', seed)
  const { holds, same, steps, violations } = recorder()
  const subtle = crypto.subtle as unknown as Record<string, unknown>
  const had = subtle['timingSafeEqual']
  subtle['timingSafeEqual'] = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b)
  try {
    const at = (param: string) => new URL('https://swarms.example/tg' + (param ? '?tgWebAppStartParam=' + param : ''))
    same(
      'started',
      ['abc123', 'join', 'a/b', '', 'pnp__3fa91c2b0d'].map((one) => Telegram.started(at(one))),
      ['abc123', undefined, undefined, undefined, 'pnp'],
      'start parameters',
    )
    same('node', [Telegram.node(at('pnp__3fa91c2b0d')), Telegram.node(at('pnp'))], ['3fa91c2b0d', undefined], 'node parameters')
    const chat = { id: 7, type: 'private' }
    const plain = Telegram.answer({ message: { chat, text: '/start' } }, 'https://swarms.example')
    same(
      'answer',
      [plain?.method, plain?.chat_id, plain?.reply_markup.inline_keyboard[0]?.[0]?.web_app],
      ['sendMessage', 7, { url: 'https://swarms.example/tg' }],
      '/start',
    )
    same(
      'answer',
      Telegram.answer({ message: { chat, text: '/start abc123' } }, 'https://swarms.example')?.reply_markup.inline_keyboard[0]?.[0],
      { text: 'Open this swarm', web_app: { url: 'https://swarms.example/tg/s/abc123' } },
      '/start a swarm',
    )
    same(
      'answer',
      Telegram.answer({ message: { chat, text: '/start join' } }, 'https://swarms.example')?.reply_markup.inline_keyboard[0]?.[0]?.web_app.url,
      'https://swarms.example/tg?view=join',
      '/start join',
    )
    const leaf = Telegram.answer({ message: { chat, text: '/start pnp__root' } }, 'https://swarms.example')
    same(
      'answer',
      leaf?.reply_markup.inline_keyboard[0]?.[0],
      { text: 'Open this node', web_app: { url: 'https://swarms.example/tg/s/pnp/n/root' } },
      '/start a node',
    )
    holds('answer', !/fund/i.test(leaf?.text ?? ''), 'a node answer asks for funds')
    same(
      'answer',
      [
        Telegram.answer({ message: { chat: { id: 8, type: 'group' }, text: '/start' } }, 'https://swarms.example'),
        Telegram.answer({ edited_message: {} }, 'https://swarms.example'),
      ],
      [undefined, undefined],
      'groups and edits',
    )
    const message = Telegram.notice('https://swarms.example', 'TempoSwarmsBot', 'pnp', 'Does P = NP?', {
      at: 1,
      event: 'proven',
      node: node('proven'),
      seq: 1,
      text: '',
    } as never)
    same(
      'notice',
      [message?.text, message?.reply_markup.inline_keyboard[0]?.[0]],
      [
        'Does P = NP?\nProven, checked by Lean at abc1234: Parity is not in AC0\nhttps://swarms.example/s/pnp/t/3fa91c2b0d',
        { text: 'See the proof', url: 'https://t.me/TempoSwarmsBot?startapp=pnp__3fa91c2b0d' },
      ],
      'a proof notice',
    )
    same(
      'notice',
      Telegram.notice('https://swarms.example', undefined, 'pnp', 'Does P = NP?', {
        at: 1,
        event: 'progress',
        node: node('in flight'),
        seq: 2,
        text: '',
      } as never),
      undefined,
      'progress is not announced',
    )
    const quiet = { SWARMS_URL: 'https://swarms.example' } as unknown as Cloudflare.Env
    same(
      'notice',
      await Telegram.announce(quiet, 'pnp', 'Does P = NP?', { at: 1, event: 'proven', node: node('proven'), seq: 1, text: '' } as never),
      false,
      'no channel configured',
    )
    const env = { SWARMS_URL: 'https://swarms.example', TELEGRAM_WEBHOOK_SECRET: 'shh' } as unknown as Cloudflare.Env
    const hook = impl.hooked ? impl.hooked(Telegram.hook) : Telegram.hook
    const body = JSON.stringify({ message: { chat, text: '/start' } })
    for (let i = 0; i < limits.cases / 20; i++) {
      const secret = random.pick([null, 'nope', 'shh', 'sh', 'shhh', ''])
      const headers: Record<string, string> = secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }
      const answer = await hook(env, new Request('https://swarms.example/telegram', { body, headers, method: 'POST' }))
      same('secret required', answer.status, secret === 'shh' ? 200 : 403, 'secret ' + JSON.stringify(secret))
      if (answer.status === 200) same('secret required', ((await answer.json()) as { method: string }).method, 'sendMessage', 'answered method')
    }
    for (let i = 0; i < limits.cases; i++) {
      const id = Array.from({ length: random.int(1, 12) }, () => random.pick(['a', 'b', '1', '_', '/', '-', '.'])).join('')
      const got = Telegram.started(at(id))
      holds('started', got === undefined || (/^[\w-]+$/.test(got) && id.startsWith(got)), JSON.stringify(id) + ' started ' + JSON.stringify(got))
    }
  } finally {
    subtle['timingSafeEqual'] = had
  }
  return { steps: steps(), violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { relay, room, telegram, vault }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('filled'), invariant: 'once per isolate', name: 'vault.once', scenario: 'vault', seeds: ['1', '2', '3'] },
  { flip: mutant('steers'), invariant: 'standalone steers', name: 'room.steers', scenario: 'room', seeds: ['1', '2', '3'] },
  { flip: mutant('beat'), invariant: 'superseded closed', name: 'relay.superseded', scenario: 'relay', seeds: ['1', '2', '3'] },
  { flip: mutant('hooked'), invariant: 'secret required', name: 'telegram.secret', scenario: 'telegram', seeds: ['1', '2', '3'] },
]
