import * as Answer from '../../src/shared/Answer.ts'
import * as Brief from '../../src/shared/Brief.ts'
import * as Chatter from '../../src/shared/Chatter.ts'
import * as Limits from '../../src/shared/Limits.ts'
import * as Surface from '../../src/shared/Surface.ts'
import type * as Tree from '../../src/shared/Tree.ts'
import * as Wishlist from '../../src/shared/Wishlist.ts'
import { recorder, rng, type Outcome, type Rng } from './mi.ts'

export const limits = { briefMost: 220, cases: 200, drafts: 12, nodes: 12, wishes: 80 }

const web = { channels: '../../src/web/channels.ts', launch: '../../src/web/launch.ts' }

type Draft = { goal?: string; steering?: string; template?: string; title: string }
type Launcher = (create: (input: Draft) => Promise<{ id: string }>) => (draft: Draft, step: (name: string) => void) => Promise<{ id: string }>

const impl = {
  idle: Chatter.idle,
  bullets: Brief.bullets,
  unround: Answer.unround,
  read: Wishlist.read,
  threads: null as null | ((ids: string[]) => string[]),
  launcher: null as null | ((launcher: Launcher) => Launcher),
}

const mutants: { [K in keyof typeof impl]: (typeof impl)[K] } = {
  idle: (text) => /this turn/i.test(text),
  bullets: (text) =>
    Brief.bullets(text)
      .map((line) => line + ' ' + line)
      .slice(0, 4),
  unround: (text) => text.replace(/^STATUS:.*$/gm, '').trim(),
  read: (value) => (Array.isArray(value) ? value : []).flatMap((one) => Wishlist.read([one])),
  threads: (ids) => [...ids].sort(),
  launcher: (launcher) => (create) => {
    const once = launcher(create)
    return (draft, step) => once({ title: draft.title }, step)
  },
}

function mutant<K extends keyof typeof impl>(key: K) {
  return () => {
    const was = impl[key]
    impl[key] = mutants[key]
    return () => void (impl[key] = was)
  }
}

function node(id: string, children: string[], pledged = '0', status: Tree.Status = 'proposed') {
  return { children, counts: { 'in flight': 0 }, id, money: { subtree: { pledged } }, run: null, status, title: id, updatedAt: 1 } as unknown as Tree.Node
}

async function channel(seed: string): Promise<Outcome> {
  const random = rng('channel', seed)
  const { holds, same, steps, violations } = recorder()
  const { fromTree } = (await import(web.channels)) as { fromTree: (nodes: Tree.Node[]) => { threads: { id: string }[] } }
  const threads = (nodes: Tree.Node[]) => {
    const ids = fromTree(nodes).threads.map((one) => one.id)
    return impl.threads ? impl.threads(ids) : ids
  }
  const shape = fromTree([node('root', ['a', 'b']), node('a', ['a1']), node('b', [], '5'), node('a1', [], '1', 'in flight')])
  same('one channel', Object.keys(shape), ['threads'], 'channel keys')
  same(
    'threads order',
    threads([node('root', ['a', 'b']), node('a', ['a1']), node('b', [], '5'), node('a1', [], '1', 'in flight')]),
    ['a1', 'b', 'a'],
    'threads',
  )
  for (let at = 0; at < limits.cases / 10; at++) {
    const count = random.int(1, limits.nodes)
    const ids = Array.from({ length: count }, (_, i) => (i ? 'n' + i : 'root'))
    const children = new Map<string, string[]>(ids.map((id) => [id, []]))
    for (let i = 1; i < count; i++) children.get(ids[random.int(0, i - 1)]!)!.push('n' + i)
    const nodes = ids.map((id) => node(id, children.get(id)!, String(random.int(0, 9)), random.pick(['proposed', 'in flight', 'proven'] as const)))
    const out = threads(nodes)
    holds(
      'one thread per item',
      new Set(out).size === out.length && out.every((id) => id !== 'root') && out.length === count - 1,
      JSON.stringify(out) + ' for ' + count + ' nodes',
    )
  }
  return { steps: steps(), violations }
}

async function chatter(seed: string): Promise<Outcome> {
  const random = rng('chatter', seed)
  const { holds, same, steps, violations } = recorder()
  const idle = [
    "I'm not starting anything this turn: $0.19 is left, and the room has no new messages or money.",
    'Update: I’m not starting anything this turn, and I made no tool calls, so this reply is the only cost.',
    'Nothing new this turn.',
    "I've started nothing this turn: about $0.30 is left of the $80 raised.",
    "I can't make progress on the kernel this turn.",
    "I can't take the next step: the H200 needs $5.",
    "I didn't check the budget this turn; checking costs money too.",
  ]
  const found = [
    'I put the new $5 into two experiments, and neither one improved the kernel.',
    "I can't reproduce the 1.4x on a cold cache.",
    'Attention4 reached 1.37x on verify; the best is now 1.400x faster than SGLang.',
    'No regression in the judge tests after the merge.',
  ]
  for (const text of idle) same('idle', impl.idle(text), true, text)
  for (const text of found) same('idle', impl.idle(text), false, text)
  same(
    'clause',
    Chatter.clause("Update: I'm not starting anything this turn and made no tool calls, so this reply is the only cost."),
    "I'm not starting anything this turn",
    'clause',
  )
  same('clause', Chatter.clause("I'm not starting anything this turn: $0.19 is left."), "I'm not starting anything this turn", 'clause')
  holds(
    'gist',
    Chatter.gist("I'm not starting anything this turn. $0.74 is left.") === Chatter.gist("I'm not starting anything this turn, and I made no tool calls."),
    'idle gists differ',
  )
  holds('gist', Chatter.gist('Spent $1.20 on run 4.') !== Chatter.gist('Started run 5.'), 'different lines share a gist')
  for (let at = 0; at < limits.cases; at++) {
    const amount = (random.int(1, 99999) / 100).toFixed(2)
    const run = random.int(1, 99)
    holds(
      'gist ignores numbers',
      Chatter.gist('Spent $' + amount + ' on run ' + run + '.') === Chatter.gist('Spent $1.20 on run 4.'),
      'Spent $' + amount + ' on run ' + run,
    )
    const text = random.pick(found).replace(/\d+/g, () => String(random.int(0, 999)))
    holds('idle', !impl.idle(text), JSON.stringify(text) + ' read as idle')
  }
  return { steps: steps(), violations }
}

async function brief(seed: string): Promise<Outcome> {
  const random = rng('brief', seed)
  const { holds, same, steps, violations } = recorder()
  same(
    'bullets',
    impl.bullets(
      '## Round 4 update\n\nSome intro.\n\n- **Proved** statement 3 on \x60main\x60\n- Wired [#9](https://x.test) to Kummer\n- Helper 2 is out of budget\n- A fourth point\n\nSTATUS: continue',
    ),
    ['**Proved** statement 3 on \x60main\x60', 'Wired [#9](https://x.test) to Kummer', 'Helper 2 is out of budget'],
    'a list',
  )
  same(
    'bullets',
    impl.bullets(
      '# Status\n\nThe baseline runs at 1.00x. Fusing the dense layers gave 1.07x, e.g. on v1.2 inputs. Attention is next.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nA fourth sentence.',
    ),
    ['The baseline runs at 1.00x.', 'Fusing the dense layers gave 1.07x, e.g. on v1.2 inputs.', 'Attention is next.'],
    'prose',
  )
  const status = Surface.status(
    Surface.read({
      nodes: [
        { items: ['Six of 60 proved.', { text: 'Helper 3 is on the PID statements.' }, 'Next: Kummer.', 'A fourth'], kind: 'status' },
        { items: [{ label: 'a', value: '1' }], kind: 'stats' },
      ],
    }),
  )
  same('status wins', status, ['Six of 60 proved.', 'Helper 3 is on the PID statements.', 'Next: Kummer.'], 'status items')
  same(
    'status wins',
    Brief.brief({ status, surfaced: { summary: 'old summary', updatedAt: 50 }, update: { at: 90, text: '- a later update\n- with bullets' } }),
    { at: 50, lines: status },
    'status over update',
  )
  const update = { at: 100, text: 'Proved the first lemma. Started the second.' }
  const surfaced = { summary: '5 of 60 statements proved on main; 14 more wired to lower statements', updatedAt: 200 }
  same(
    'newer told',
    Brief.brief({ status: [], surfaced, update }),
    { at: 200, lines: ['5 of 60 statements proved on main', '14 more wired to lower statements'] },
    'newer surface',
  )
  same(
    'newer told',
    Brief.brief({ status: [], surfaced: { ...surfaced, updatedAt: 50 }, update }),
    { at: 100, lines: ['Proved the first lemma.', 'Started the second.'] },
    'newer update',
  )
  same(
    'newer told',
    [
      Brief.brief({ status: [], surfaced, update: undefined })?.lines.length,
      Brief.brief({ status: [], surfaced: { summary: null, updatedAt: 1 }, update: { at: 2, text: '  ' } }),
      Brief.brief({ status: [] }),
    ],
    [2, null, null],
    'nothing to tell',
  )
  for (let at = 0; at < limits.cases / 4; at++) {
    const words = 'word '.repeat(random.int(1, 120)).trim()
    const text = random.chance(0.5)
      ? Array.from({ length: random.int(1, 6) }, (_, i) => '- ' + words + ' ' + i).join('\n')
      : Array.from({ length: random.int(1, 6) }, (_, i) => words + ' ' + i + '.').join(' ')
    const lines = impl.bullets(text)
    holds(
      'bullets bounded',
      lines.length <= 3 && lines.every((line) => line.length <= limits.briefMost),
      lines.length + ' lines, longest ' + Math.max(0, ...lines.map((line) => line.length)),
    )
    holds(
      'bullets bounded',
      lines.every((line) => line.length < limits.briefMost - 1 || line.endsWith('…')),
      'a long line was not cut',
    )
  }
  return { steps: steps(), violations }
}

async function launch(seed: string): Promise<Outcome> {
  const random = rng('launch', seed)
  const { holds, same, steps, violations } = recorder()
  const loaded = ((await import(web.launch)) as { launcher: Launcher }).launcher
  const launcher = impl.launcher ? impl.launcher(loaded) : loaded
  const created: string[] = []
  const stepped: string[] = []
  const go = launcher(async (input) => {
    created.push(input.title)
    return { id: 'swarm-' + created.length }
  })
  const step = (name: string) => void stepped.push(name)
  const first = { goal: 'Find the cheapest way to make clean water', steering: 'team', template: 'frontier-mix', title: 'Clean water' }
  same(
    'one per draft',
    [await go(first, step), await go({ ...first }, step), stepped],
    [{ id: 'swarm-1' }, { id: 'swarm-1' }, ['create']],
    'the same draft twice',
  )
  same(
    'one per draft',
    [
      await go({ ...first, title: 'Desalination' }, step),
      await go({ ...first, template: 'frontier-openai' }, step),
      await go({ ...first, steering: 'open' }, step),
      await go(first, step),
    ],
    [{ id: 'swarm-2' }, { id: 'swarm-3' }, { id: 'swarm-4' }, { id: 'swarm-1' }],
    'changed drafts',
  )
  same('one per draft', created, ['Clean water', 'Desalination', 'Clean water', 'Clean water'], 'created')
  let made = (_: { id: string }) => {}
  const slow = launcher(() => new Promise<{ id: string }>((resolve) => (made = resolve)))
  const creating = slow({ title: 'Clean water' }, () => {})
  made({ id: 'swarm-1' })
  same('changed mid-create', await creating, { id: 'swarm-1' }, 'first create')
  const next = slow({ title: 'Desalination' }, () => {})
  made({ id: 'swarm-2' })
  same('changed mid-create', await next, { id: 'swarm-2' }, 'a changed draft')
  let fail = true
  const flaky = launcher(async () => {
    if (fail) throw new Error('Sign in with Tempo Wallet to steer the swarm you start.')
    return { id: 'swarm-1' }
  })
  same(
    'failed asked again',
    await flaky({ title: 'Clean water' }, () => {}).then(
      () => 'created',
      (error: Error) => error.message,
    ),
    'Sign in with Tempo Wallet to steer the swarm you start.',
    'first try',
  )
  fail = false
  same('failed asked again', await flaky({ title: 'Clean water' }, () => {}), { id: 'swarm-1' }, 'second try')
  const made2 = new Map<string, number>()
  let count = 0
  const many = launcher(async (input) => {
    count++
    made2.set(JSON.stringify(input), (made2.get(JSON.stringify(input)) ?? 0) + 1)
    return { id: 'swarm-' + count }
  })
  const answers = new Map<string, string>()
  for (let at = 0; at < limits.drafts * 4; at++) {
    const draft = { goal: 'g', steering: random.pick(['team', 'open']), template: random.pick(['a', 'b']), title: random.pick(['One', 'Two', 'Three']) }
    const key = JSON.stringify(draft)
    const { id } = await many(draft, () => {})
    if (answers.has(key)) holds('one per draft', answers.get(key) === id, key + ' got ' + id + ' after ' + answers.get(key))
    answers.set(key, id)
  }
  return { steps: steps(), violations }
}

async function answer(seed: string): Promise<Outcome> {
  const random = rng('answer', seed)
  const { holds, same, steps, violations } = recorder()
  const unround: [string, string][] = [
    ['## Round 49 update — P vs NP\n\nNothing spent.', '## P vs NP\n\nNothing spent.'],
    ['**Round 1 report — P vs NP**  I spent little.', '**P vs NP**  I spent little.'],
    ['Round 51 update\nTwo corrections.', 'Two corrections.'],
    ['Rounding errors dominate.', 'Rounding errors dominate.'],
    ['Built the parser.\nSTATUS: continue — more to do', 'Built the parser.'],
    ['**STATUS: done**\nThis round I wrote tests; the next round adds docs.', 'This update I wrote tests; the next update adds docs.'],
    ['As found in round 12, it holds.', 'As found in an earlier update, it holds.'],
  ]
  for (const [text, want] of unround) same('unround', impl.unround(text), want, text)
  same('excerpt', Answer.excerpt('## Round 45 update — P vs NP\nI made no tool calls.'), 'P vs NP I made no tool calls.', 'excerpt')
  same('cash', [9.215238, 0.046235, 0.0038, 0.5].map(Answer.cash), ['$9.22', '$0.046', '$0.0038', '$0.50'], 'cash')
  const spoken: [string, string | null][] = [
    ['Out of money. Back it to keep it going.', 'Out of money. Ride it to keep it going.'],
    [
      'Waiting for money: $0.0038 is payable now, less than one model call holds. New money keeps it going.',
      'Out of money: $0.0038 left, and one step can cost up to $0.05. Fund it to keep going.',
    ],
    [
      'Waiting for money: $1.10 is payable now, less than one model call holds. The next budget pull or resting contribution is at 16:37 UTC.',
      'Out of money: $1.10 left, and one step can cost up to $0.05. Fund it to keep going.',
    ],
    [
      "Waiting for money: the agent's next model call holds $0.2147, more than the $0.2083 any one contribution can pay at once.",
      'Paused: its next step needs about $0.21 at once, more than any one backer has left in it. Fund it to keep going.',
    ],
    [
      'The agent hit 3 errors in a row, so the swarm stopped to rest. New money restarts it, and so does the next budget pull at 16:37 UTC.',
      'Stopped after 3 errors in a row. New money or a note restarts it.',
    ],
    [
      'Out of money: $0.021 left, less than its next step needs. Adding money wakes it. More comes in at 21:32 UTC.',
      'Out of money: $0.021 left, and one step can cost up to $0.05. Fund it to keep going.',
    ],
    [
      'Resting: the agent found nothing worth spending on, so the swarm stopped asking it and spends nothing. $9.215238 is kept for later; a note or new money wakes it.',
      'Resting: the agent found nothing more worth doing. $9.22 is kept for later; a note or new money wakes it.',
    ],
    ['Back at work with $2.680000 to spend.', 'Back at work.'],
    [
      'Waiting for $1.17 payable, with $1.02 of it from one funder, so the swarm can open its $1 code repository and still work; $0.493744 is payable now.',
      null,
    ],
    ["Round 2 started on 0x3ca3…4184's pledge, with $4.481149 left on it, room for 3 explorers beside the lead.", null],
    ['Told the agent to keep going, with $3.952974 left.', null],
  ]
  for (const [text, want] of spoken) same('spoken', Answer.spoken(text), want, text)
  const iso = (at: number) => new Date(at).toISOString()
  same(
    'local',
    [Answer.local('More comes in at 16:37 UTC.', Date.UTC(2026, 10, 3, 12), iso), Answer.local('More comes in at 01:00 UTC.', Date.UTC(2026, 10, 3, 12), iso)],
    ['More comes in at 2026-11-03T16:37:00.000Z.', 'More comes in at 2026-11-04T01:00:00.000Z.'],
    'local',
  )
  const text = '# Round 3\n\n| a | b |\n|---|---|\n**The fastest parser was simdjson at 4.1 GiB/s.**\n\nMore detail follows here.\n'.repeat(3)
  same(
    'lead',
    [Answer.lead(text), Answer.gist(Answer.lead(text)) === Answer.gist(text), Answer.gist(text), Answer.lead('short\n---')],
    ['# Round 3\n\n| a | b |\n|---|---|\n**The fastest parser was simdjson at 4.1 GiB/s.**', true, '**The fastest parser was simdjson at 4.1 GiB/s.**', ''],
    'lead',
  )
  same(
    'gist',
    Answer.gist(
      '{"code":"over_limit","message":"The key is over its limit"}\n\x60\x60\x60\nconst bound = solve(instance, 1000)\n\x60\x60\x60\nThe bound is $n \\le \\frac{k}{2}$ for every instance, for $5 of $10.',
    ),
    'The bound is n ≤ k/2 for every instance, for $5 of $10.',
    'gist skips JSON and code',
  )
  same('symbols', Answer.symbols('\\sqrt{n} \\cdot 2 \\ne \\infty'), '√(n) · 2 ≠ ∞', 'symbols')
  for (let at = 0; at < limits.cases; at++) {
    const n = random.int(1, 999)
    const body = random.pick(['Nothing spent.', 'Two corrections.', 'I wrote tests.'])
    const out = impl.unround(
      random.pick(['## Round ' + n + ' update\n\n', 'Round ' + n + ' update\n', '**Round ' + n + ' report**\n']) +
        body +
        (random.chance(0.5) ? '\nSTATUS: continue' : ''),
    )
    holds('unround', !/\bround \d+/i.test(out) && !/STATUS:/.test(out) && out.includes(body), JSON.stringify(out))
    const cash = random.int(1, 99_999_999) / 1_000_000
    const said = Answer.cash(cash)
    holds('cash', Math.abs(Number(said.slice(1)) - cash) <= Math.max(0.005, cash * 0.05), cash + ' said ' + said)
  }
  return { steps: steps(), violations }
}

async function wishlist(seed: string): Promise<Outcome> {
  const random = rng('wishlist', seed)
  const { holds, same, steps, violations } = recorder()
  const wishes = impl.read([
    { status: 'open', use: 'Would pay $6 from the budget', want: 'An H100 for 2 hours', why: 'The 7B fine-tune does not fit on an A10G' },
    { found: 'https://huggingface.co/datasets/x, from @ana', status: 'found', want: 'The SWE-bench Verified split', why: 'The harness needs it' },
    { status: 'no longer needed', want: 'A Solidity auditor' },
    { why: 'no want' },
    'A Bloomberg terminal account',
    42,
  ])
  same(
    'states',
    wishes.map((wish) => [wish.want, wish.state]),
    [
      ['An H100 for 2 hours', 'open'],
      ['The SWE-bench Verified split', 'found'],
      ['A Solidity auditor', 'dropped'],
      ['A Bloomberg terminal account', 'open'],
    ],
    'wishes',
  )
  same(
    'states',
    [wishes[0]?.use, wishes[1]?.found, Wishlist.open(wishes).length],
    ['Would pay $6 from the budget', 'https://huggingface.co/datasets/x, from @ana', 2],
    'fields',
  )
  same(
    'parse',
    [Wishlist.parse('{"items":[{"want":"A GPU","status":"Open"}]}').length, Wishlist.parse('{"want":"A GPU"}'), Wishlist.parse('not json')],
    [1, [], []],
    'parse',
  )
  same('capped', impl.read(Array.from({ length: limits.wishes }, (_, i) => ({ want: String(i) }))).length, Limits.SharedWishlist.most, 'eighty wishes')
  same(
    'is',
    [
      Wishlist.is({ form: 'json', slug: 'wishlist', title: 'Wishlist' }),
      Wishlist.is({ form: 'json', slug: 'wants', title: 'Wishlist' }),
      Wishlist.is({ form: 'page', slug: 'wishlist', title: 'Wishlist' }),
      Wishlist.is({ form: 'json', slug: 'results', title: 'Results' }),
    ],
    [true, true, false, false],
    'is',
  )
  for (let at = 0; at < limits.cases / 4; at++) {
    const items = Array.from({ length: random.int(0, limits.wishes) }, (_, i) => wish(random, i))
    const read = impl.read(items)
    holds('capped', read.length <= Limits.SharedWishlist.most, read.length + ' wishes read')
    holds(
      'states',
      read.every((one) => ['open', 'found', 'dropped'].includes(one.state) && !!one.want),
      'a wish without a want or state',
    )
    holds(
      'states',
      Wishlist.open(read).every((one) => one.state === 'open'),
      'open listed a closed wish',
    )
  }
  return { steps: steps(), violations }
}

function wish(random: Rng, at: number): unknown {
  if (random.chance(0.1)) return random.pick([42, null, 'A plain wish ' + at])
  return { status: random.pick(['open', 'Open', 'found', 'no longer needed', 'dropped', 'weird']), want: random.chance(0.9) ? 'want ' + at : undefined }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { answer, brief, channel, chatter, launch, wishlist }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('threads'), invariant: 'threads order', name: 'channel.order', scenario: 'channel', seeds: ['1', '2', '3'] },
  { flip: mutant('idle'), invariant: 'idle', name: 'chatter.idle', scenario: 'chatter', seeds: ['1', '2', '3'] },
  { flip: mutant('bullets'), invariant: 'bullets', name: 'brief.bullets', scenario: 'brief', seeds: ['1', '2', '3'] },
  { flip: mutant('launcher'), invariant: 'one per draft', name: 'launch.draft', scenario: 'launch', seeds: ['1', '2', '3'] },
  { flip: mutant('unround'), invariant: 'unround', name: 'answer.unround', scenario: 'answer', seeds: ['1', '2', '3'] },
  { flip: mutant('read'), invariant: 'capped', name: 'wishlist.capped', scenario: 'wishlist', seeds: ['1', '2', '3'] },
]
