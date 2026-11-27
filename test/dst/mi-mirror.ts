import type * as PiecesModule from '../../src/shared/Pieces.ts'
import type * as TelegramModule from '../../src/worker/Telegram.ts'
import * as Limits from '../../src/shared/Limits.ts'
import * as Site from '../../src/shared/Site.ts'
import { node } from './mi-chat.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { recorder, rng, type Outcome, type Rng } from './mi.ts'

export const limits = { cases: 300, runMost: 40, tinyMost: 9, textMost: 3 * Limits.Telegram.sendMessageChars, notices: 12 }

const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

const atoms = ['a', 'word', ' ', '\n', '\n\n', 'é', '中', '😀', '👩‍💻', '\t', '—']

function text(random: Rng, most: number) {
  const parts: string[] = []
  let length = 0
  const wanted = random.int(0, most)
  while (length < wanted) {
    const atom = random.pick(atoms)
    const run = random.chance(0.2) ? atom.repeat(random.int(1, limits.runMost)) : atom
    parts.push(run)
    length += run.length
  }
  return parts.join('')
}

async function mirror(seed: string): Promise<Outcome> {
  const random = rng('mirror', seed)
  const { fail, holds, same, steps, violations } = recorder()
  const Pieces = await load<typeof PiecesModule>('src/shared/Pieces.ts')
  const Telegram = await load<typeof TelegramModule>('src/worker/Telegram.ts')
  applied()
  for (let at = 0; at < limits.cases; at++) {
    const most = random.chance(0.5) ? random.int(2, limits.tinyMost) : Limits.Telegram.sendMessageChars
    const whole = text(random, most === Limits.Telegram.sendMessageChars ? limits.textMost : most * limits.tinyMost)
    let pieces: string[]
    try {
      pieces = Pieces.split(whole, most)
    } catch (error) {
      fail('mirror round trip', 'splitting ' + whole.length + ' chars at ' + most + ' threw ' + String(error))
      continue
    }
    holds('mirror round trip', pieces.join('') === whole, whole.length + ' chars split at ' + most + ' did not join back')
    holds(
      'mirror pieces fit',
      pieces.every((piece) => piece.length <= most),
      'a piece over ' + most + ': ' + JSON.stringify(pieces.map((piece) => piece.length)),
    )
    holds('mirror pieces fit', pieces.length === 1 || pieces.every((piece) => piece.length > 0), 'an empty piece among ' + pieces.length)
    holds(
      'mirror whole characters',
      pieces.every((piece) => !lone.test(piece)),
      'a piece splits a character at ' + most,
    )
  }
  const sent: { chat_id: string; reply_markup?: unknown; text: string }[] = []
  const real = globalThis.fetch
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as never)
    return new Response('{"ok":true}')
  }
  try {
    const env = { SWARMS_URL: 'https://swarms.example', TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHANNEL: '@swarms' } as unknown as Cloudflare.Env
    for (let at = 0; at < limits.notices; at++) {
      const title = text(random, limits.textMost) || 'a lemma'
      try {
        await notice(title)
      } catch (error) {
        fail('mirror whole notice', 'a notice of ' + title.length + ' chars of title threw ' + String(error))
      }
    }
    async function notice(title: string) {
      const delta = { at: 1, event: 'proven', node: { ...node('proven'), title }, seq: 1, text: '' } as never
      const home = Site.home(env)
      const messages = Telegram.notice(home, 'SwarmsBot', 'pnp', 'Does P = NP?', delta) ?? []
      const wanted = 'Does P = NP?\nProven, checked by Lean at abc1234: ' + title + '\n' + home + '/s/pnp/t/3fa91c2b0d'
      holds(
        'mirror whole notice',
        messages.map((one) => one.text).join('') === wanted,
        'a notice of ' + title.length + ' chars of title did not mirror whole across ' + messages.length + ' messages',
      )
      holds(
        'mirror pieces fit',
        messages.every((one) => one.text.length <= Limits.Telegram.sendMessageChars),
        'a message over the limit',
      )
      holds(
        'mirror button last',
        messages.every((one, index) => (index === messages.length - 1) === !!one.reply_markup),
        'buttons on ' + JSON.stringify(messages.map((one) => !!one.reply_markup)),
      )
      sent.length = 0
      same('mirror whole notice', await Telegram.announce(env, 'pnp', 'Does P = NP?', delta), true, 'announcing a notice')
      holds(
        'mirror whole notice',
        sent.map((one) => one.text).join('') === wanted,
        'the channel got ' + sent.length + ' messages that do not join to the notice',
      )
    }
  } finally {
    globalThis.fetch = real
  }
  return { steps: steps(), violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { mirror }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('mirror.trim', 'src/shared/Pieces.ts', 'rest = rest.slice(at)', 'rest = rest.slice(at).trimStart()'),
    invariant: 'mirror round trip',
    name: 'mirror.trim',
    scenario: 'mirror',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('mirror.fit', 'src/shared/Pieces.ts', "text.lastIndexOf('\\n', most - 1)", "text.lastIndexOf('\\n', most)"),
    invariant: 'mirror pieces fit',
    name: 'mirror.fit',
    scenario: 'mirror',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'mirror.whole',
      'src/shared/Pieces.ts',
      'return text.slice(0, high.test(text.charAt(most - 1)) ? most - 1 : most)',
      'return text.slice(0, most)',
    ),
    invariant: 'mirror whole characters',
    name: 'mirror.whole',
    scenario: 'mirror',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('mirror.clipped', 'src/worker/Telegram.ts', '`${found.whole}\\n${found.url}`', '`${found.text}\\n${found.url}`'),
    invariant: 'mirror whole notice',
    name: 'mirror.clipped',
    scenario: 'mirror',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('mirror.clip', 'src/worker/Share.ts', 'Pieces.head(text, most - 1)', 'text.slice(0, most - 1)'),
    invariant: 'mirror whole notice',
    name: 'mirror.clip',
    scenario: 'mirror',
    seeds: ['2', '3', '4'],
  },
  {
    flip: mutant('mirror.button', 'src/worker/Telegram.ts', 'const last = pieces.length - 1', 'const last = 0'),
    invariant: 'mirror button last',
    name: 'mirror.button',
    scenario: 'mirror',
    seeds: ['1', '2', '3'],
  },
]
