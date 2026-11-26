import type { Branch } from '../../src/shared/Api.ts'
import { applied, load, mutant, recorder, rng, type Canary, type Outcome, type Rng } from './mh-kit.ts'

type HelloModule = typeof import('../../src/shared/Hello.ts')
type DoorModule = typeof import('../../src/shared/Door.ts')
type CrewModule = typeof import('../../src/shared/Crew.ts')
type HandsModule = typeof import('../../src/worker/Hands.ts')
type FleetModule = typeof import('../../src/shared/Fleet.ts')
type ReplicaModule = typeof import('../../src/worker/Replica.ts')

export const limits = {
  chance: 0.5,
  crew: {
    branches: 8,
    cents: 2000,
    lists: 40,
    metrics: [
      [1.3376, '1.34'],
      [12.34, '12.3'],
      [150.2, '150'],
      [0.5, '0.50'],
    ] as [number, string][],
    numberMost: 99,
    parentChance: 0.25,
    sentencesMost: 3,
    variant: 9,
  },
  door: { calls: 64 },
  fleet: {
    failChance: 0.15,
    hexId: 21,
    leases: [
      [300, '5 min'],
      [30, '30 s'],
      [900, '15 min'],
    ] as [number, string][],
    memories: [
      [4096, '4 GB'],
      [512, '512 MB'],
      [16384, '16 GB'],
    ] as [number, string][],
    names: 3,
    namedChance: 0.6,
    removes: 30,
    runs: 12,
    sbId: 22,
    status: 402,
    steps: 40,
  },
  hands: { cents: 900, channels: 3, count: 4, listings: 60, payee: 40, requests: 9 },
  hello: { headers: 80, maxAgeSeconds: 365 * 24 * 3600, pairs: 4 },
  replica: { bookmarks: 40, cookieSeconds: 300, hexMost: 64, hexLeast: 8, marks: 20, paths: 60, statuses: [200, 201, 202, 404] },
}

function hex(random: Rng, length: number) {
  return Array.from({ length }, () => random.int(0, 15).toString(16)).join('')
}

const helloNames = ['swarms_hello', 'xswarms_hello', 'swarms_hellox', 'swarms_tz', 'swarms_rail', 'hello']

const helloValues = ['1', '0', '10', '01', 'UTC', 'expanded', '']

async function hello(seed: string): Promise<Outcome> {
  const random = rng(seed, 'hello')
  const { fail, same, violations } = recorder()
  const Hello = await load<HelloModule>('src/shared/Hello.ts')
  applied()
  const fixtures: [string | undefined, string][] = [
    [undefined, 'new'],
    ['', 'new'],
    ['swarms_hello=1', 'seen'],
    ['swarms_tz=UTC; swarms_hello=1; swarms_rail=expanded', 'seen'],
    ['swarms_hello=0', 'new'],
    ['xswarms_hello=1', 'new'],
  ]
  for (const [header, want] of fixtures) same('hello cookie', 'parse(' + String(header) + ')', Hello.parse(header), want)
  let steps = fixtures.length
  for (let i = 0; i < limits.hello.headers; i++, steps++) {
    const pairs = Array.from({ length: random.int(0, limits.hello.pairs) }, () => [random.pick(helloNames), random.pick(helloValues)] as const)
    const header = pairs.map(([name, value]) => name + '=' + value).join(random.pick(['; ', ';', ';  ']))
    const want = pairs.some(([name, value]) => name === 'swarms_hello' && value === '1') ? 'seen' : 'new'
    same('hello cookie', 'parse(' + header + ')', Hello.parse(header), want)
  }
  const written = Hello.written()
  same('hello lasts', 'parse(written())', Hello.parse(written), 'seen')
  same('hello lasts', 'max-age of ' + written, /max-age=(\d+)/.exec(written)?.[1], String(limits.hello.maxAgeSeconds))
  if (!written.startsWith(Hello.cookie + '=1;')) fail('hello lasts', written + ' does not set ' + Hello.cookie + '=1')
  return { steps, violations }
}

async function door(seed: string): Promise<Outcome> {
  const random = rng(seed, 'door')
  const { same, violations } = recorder()
  const Door = await load<DoorModule>('src/shared/Door.ts')
  applied()
  let steps = 0
  for (; steps < limits.door.calls; steps++) {
    const steering = random.pick(['open', 'team'] as const)
    const who = { rider: random.chance(limits.chance), seat: random.chance(limits.chance) }
    const want =
      steering === 'team' ? { posts: who.rider || who.seat, steers: who.seat ? 'team' : null } : { posts: who.rider, steers: who.rider ? 'backing' : null }
    same('door ' + steering, steering + ' ' + JSON.stringify(who), Door.of(steering, who), want)
  }
  return { steps, violations }
}

const crewStates = ['pending', 'running', 'completed', 'interrupted', 'failed', 'closing', 'closed'] as const

const crewPrefixes = ['autoresearch branch: ', 'research branch: ', 'Research Branch: ', 'branch: ', 'AutoResearch branch:']

const crewWords = ['moe', 'attention', 'routing', 'kernels', 'lattice', 'codes']

const crewKeys = ['summary', 'result', 'outcome', 'finding', 'findings', 'conclusion', 'answer', 'status', 'notes']

function crewBranch(fields: Partial<Branch>): Branch {
  return {
    budget: '7.000000',
    error: null,
    funded: '0',
    funders: [],
    id: 1,
    left: null,
    parent: null,
    result: null,
    role: 'autoresearch branch: moe',
    spent: '0.5',
    starved: false,
    state: 'completed',
    task: 'Tune it.',
    who: 'autoresearch branch: moe',
    ...fields,
  }
}

function crewState(branch: Branch) {
  if (branch.state === 'pending' || branch.state === 'running') return 'working'
  if (branch.starved) return 'starved'
  if (branch.state === 'completed') return 'done'
  if (branch.state === 'failed') return 'failed'
  return 'stopped'
}

function crewFixtures(Crew: CrewModule, same: ReturnType<typeof recorder>['same']) {
  const result = JSON.stringify(
    {
      best_commit_dir: '/w/moe5_best',
      best_speedup: 1.3376,
      blockers: 'No active blockers.',
      files_changed: ['moe.py'],
      summary:
        'Best commit cfae32e02012ad7a4e3f535c60530811cddf4557. Fused pre-expert RMSNorm with alignment in one Triton launch. Untouched control measured 1.3147x.',
    },
    null,
    2,
  )
  const one = Crew.member(
    crewBranch({ result, role: 'autoresearch branch: moe5 (routed experts + MoE glue)', who: 'autoresearch branch: moe5 (routed experts…' }),
  )
  same('crew title', 'fixture title', one.title, 'moe5 (routed experts + MoE glue)')
  same('crew summary', 'fixture summary', one.summary, 'Fused pre-expert RMSNorm with alignment in one Triton launch.')
  same('crew metric', 'fixture metric', one.metric, '1.34×')
  same('crew summary', 'fixture blockers', one.blockers, 'No active blockers.')
  same('crew state', 'fixture state', one.state, 'done')
  const summary = (text: string) => Crew.member(crewBranch({ result: JSON.stringify({ summary: text }) })).summary
  same(
    'crew summary',
    'ledger skipped',
    summary('Best remains commit e8c16f50c2ffbb32cc44f0ac88f6d27143eba7ec. Merge only /w/moe2_best/moe.py. Replacing Marlin lost 30%.'),
    'Replacing Marlin lost 30%.',
  )
  same(
    'crew summary',
    'ledger alone',
    summary('Best commit 655bf9f; exported logs to /w/attention6_best/.'),
    'Best commit 655bf9f; exported logs to /w/attention6_best/.',
  )
  same('crew summary', 'colon kept', summary('Unknown model: configure max_tokens explicitly.'), 'Unknown model: configure max_tokens explicitly.')
  same(
    'crew summary',
    'plain first line',
    Crew.member(crewBranch({ result: '**Seven** of nine allow commercial use.\nDetails in licenses.md.' })).summary,
    '**Seven** of nine allow commercial use.',
  )
  same(
    'crew summary',
    'error line',
    Crew.member(crewBranch({ error: 'subagent 4 could not resume after a runtime restart\n\nTool calls observed', result: '', state: 'failed' })).summary,
    'could not resume after a runtime restart',
  )
  same(
    'crew summary',
    'task line',
    Crew.member(crewBranch({ state: 'running', task: '\nCONTEXT. You are one branch of a swarm.' })).summary,
    'You are one branch of a swarm.',
  )
  same('crew summary', 'no summary', Crew.member(crewBranch({ result: '{"files_changed": []}' })).summary, null)
  const list = Crew.board([
    crewBranch({ id: 1, spent: '3.5' }),
    crewBranch({ id: 2, spent: '0.2', state: 'running' }),
    crewBranch({ id: 3, spent: '1.1', starved: true, state: 'failed' }),
    crewBranch({ id: 4, parent: 2, spent: '9', state: 'running' }),
  ])
  same(
    'crew board',
    'fixture board',
    list.map((member) => [member.id, member.state]),
    [
      [2, 'working'],
      [1, 'done'],
      [3, 'starved'],
    ],
  )
}

async function crew(seed: string): Promise<Outcome> {
  const random = rng(seed, 'crew')
  const { same, violations } = recorder()
  const Crew = await load<CrewModule>('src/shared/Crew.ts')
  applied()
  crewFixtures(Crew, same)
  let steps = 0
  for (let l = 0; l < limits.crew.lists; l++) {
    const branches: Branch[] = []
    const count = random.int(1, limits.crew.branches)
    for (let id = 1; id <= count; id++, steps++) {
      const word = random.pick(crewWords) + random.int(1, limits.crew.variant)
      const role = random.pick(crewPrefixes) + word
      const state = random.pick(crewStates)
      const fields: Partial<Branch> = {
        error: null,
        id,
        parent: id > 1 && random.chance(limits.crew.parentChance) ? random.int(1, id - 1) : null,
        result: null,
        role,
        spent: random.chance(limits.crew.parentChance) ? null : (random.int(0, limits.crew.cents) / 100).toFixed(2),
        starved: random.chance(limits.crew.parentChance),
        state,
        who: role,
      }
      let summary: string | null = null
      let metric: string | null = null
      const kind = random.pick(['json', 'plain', 'none'] as const)
      if (kind === 'json') {
        const sentences = Array.from({ length: random.int(1, limits.crew.sentencesMost) }, () =>
          random.chance(limits.chance)
            ? {
                ledger: true,
                text: random.chance(limits.chance)
                  ? 'Best commit ' + hex(random, limits.hands.payee) + '.'
                  : 'Merge only /w/' + word + '_best/' + word + '.py.',
              }
            : { ledger: false, text: 'Replacing ' + word.toUpperCase() + ' lost ' + random.int(1, limits.crew.numberMost) + '%.' },
        )
        summary = (sentences.find((one) => !one.ledger) ?? sentences[0])?.text ?? null
        const record: Record<string, unknown> = { files_changed: [word + '.py'] }
        record[random.pick(crewKeys)] = sentences.map((one) => one.text).join(' ')
        if (random.chance(limits.chance)) {
          const [value, shown] = random.pick(limits.crew.metrics)
          const key = random.pick(['best_speedup', 'speedup', 'speed_up', 'best_loss'])
          record[key] = value
          metric = key === 'best_loss' ? 'loss ' + shown : shown + '×'
        }
        fields.result = JSON.stringify(record, null, random.int(0, 2))
      } else if (kind === 'plain') {
        const first = 'Seven of nine ' + word + ' runs allow commercial use.'
        fields.result = '\n'.repeat(random.int(0, 2)) + first + '\nDetails in ' + word + '.md.'
        summary = first
      } else {
        fields.result = random.pick(['', null])
        if (state === 'failed' && fields.starved) {
          fields.error = 'subagent 1 could not resume ' + word
        } else if (state === 'failed') {
          fields.error = 'subagent ' + random.int(1, limits.crew.numberMost) + ' could not resume ' + word + '\n\nTool calls observed'
          summary = 'could not resume ' + word
        } else if (state === 'pending' || state === 'running') {
          fields.task = '\nCONTEXT. You are one branch of ' + word + '.'
          summary = 'You are one branch of ' + word + '.'
        }
      }
      const branch = crewBranch(fields)
      branches.push(branch)
      const member = Crew.member(branch)
      same('crew state', 'branch ' + JSON.stringify(branch).slice(0, 200), member.state, crewState(branch))
      same('crew title', 'role ' + role, member.title, word)
      same('crew summary', 'result ' + JSON.stringify(branch.result ?? branch.error ?? branch.task), member.summary, summary)
      same('crew metric', 'result ' + JSON.stringify(branch.result), member.metric, metric)
    }
    const want = branches
      .filter((branch) => branch.parent === null)
      .map((branch) => ({ id: branch.id, spent: Number(branch.spent ?? 0) || 0, working: crewState(branch) === 'working' }))
      .sort((a, b) => Number(b.working) - Number(a.working) || b.spent - a.spent || b.id - a.id)
      .map((one) => one.id)
    same(
      'crew board',
      'board of ' + JSON.stringify(branches.map((branch) => [branch.id, branch.parent, branch.state, branch.spent])),
      Crew.board(branches).map((member) => member.id),
      want,
    )
  }
  return { steps, violations }
}

type Listed = { connected: boolean; name: string } & Record<string, unknown>

type Terms = { channels: string | null; charged: string | null; earned: string | null; price: string | null; requests: number }

const termed: Record<keyof Terms, string> = {
  channels: 'terms channels',
  charged: 'terms charged',
  earned: 'terms earned',
  price: 'terms price',
  requests: 'terms charged',
}

function termsSame(same: ReturnType<typeof recorder>['same'], what: string, got: Terms, want: Terms) {
  for (const key of Object.keys(termed) as (keyof Terms)[]) same(termed[key], what + ' ' + key, got[key], want[key])
}

function dollars(cents: number) {
  return '$' + String(cents / 100)
}

async function hands(seed: string): Promise<Outcome> {
  const random = rng(seed, 'hands')
  const { same, violations } = recorder()
  await load('test/run.ts')
  const Hands = await load<HandsModule>('src/worker/Hands.ts')
  applied()
  termsSame(
    same,
    'priced fixture',
    Hands.terms({
      cap: { operation: null, since: 0, spent: 0.01, usd: 0.015 },
      charges: { count: 2, usd: 0.02 },
      connected: true,
      earned: 0.02,
      name: 'data-room-553b00',
      paid: 0,
      pricing: { describe: 'Q3 data, $0.01 a file', payee: '0x975937feafc6869a260c176854dda8764a78e122' },
      requests: 5,
    }),
    { channels: null, charged: '$0.02 for 2 operations', earned: '$0.02, $0 paid out', price: 'Q3 data, $0.01 a file (paid to 0x9759…e122)', requests: 5 },
  )
  const channel = { currency: '0x20c0000000000000000000006a37da5c996874be', deposit: 0.05, payee: '0x4011ff5961d8573c5d8fcba00253c6229e2ac826' }
  termsSame(
    same,
    'channels fixture',
    Hands.terms({
      channels: [
        { ...channel, accepted: 0.03, id: '0x01', open: true, settled: 0.02 },
        { ...channel, accepted: 0.01, id: '0x02', open: false, settled: 0.01 },
      ],
      charges: { count: 5, usd: 0.05 },
      connected: true,
      earned: 0.05,
      name: 'data-room-553b00',
      paid: 0.04,
      pricing: { currency: 'ousd', payee: '0x4011ff5961d8573c5d8fcba00253c6229e2ac826' },
      requests: 7,
    }),
    {
      channels: '$0.04 paid straight to its owner over 2 channels, $0.03 settled on Tempo',
      charged: '$0.05 for 5 operations',
      earned: '$0.05, $0.04 paid out',
      price: 'priced by its owner (paid to 0x4011…c826 in OUSD)',
      requests: 7,
    },
  )
  const free = { channels: null, charged: null, earned: null, price: null, requests: 0 }
  termsSame(same, 'free fixture', Hands.terms({ connected: true, name: 'laptop-1a2b3c', requests: 3 }), { ...free, requests: 3 })
  termsSame(same, 'no listing', Hands.terms(undefined), free)
  let steps = 0
  for (; steps < limits.hands.listings; steps++) {
    const listed: Listed = { connected: random.chance(limits.chance), name: 'hand-' + steps }
    const want: Terms = { ...free }
    if (random.chance(limits.chance)) {
      want.requests = random.int(0, limits.hands.requests)
      listed['requests'] = want.requests
    }
    if (random.chance(limits.chance)) {
      const count = random.int(0, limits.hands.count)
      const cents = random.int(0, limits.hands.cents)
      listed['charges'] = { count, usd: cents / 100 }
      want.charged = count ? dollars(cents) + ' for ' + count + ' operation' + (count === 1 ? '' : 's') : null
    }
    if (random.chance(limits.chance)) {
      const list = Array.from({ length: random.int(0, limits.hands.channels) }, (_, n) => ({
        ...channel,
        accepted: random.int(0, limits.hands.cents),
        id: '0x0' + n,
        open: random.chance(limits.chance),
        settled: random.int(0, limits.hands.cents),
      }))
      listed['channels'] = list.map((one) => ({ ...one, accepted: one.accepted / 100, settled: one.settled / 100 }))
      const accepted = list.reduce((total, one) => total + one.accepted, 0)
      const settled = list.reduce((total, one) => total + one.settled, 0)
      want.channels = list.length
        ? dollars(accepted) +
          ' paid straight to its owner over ' +
          list.length +
          ' channel' +
          (list.length === 1 ? '' : 's') +
          ', ' +
          dollars(settled) +
          ' settled on Tempo'
        : null
    }
    if (random.chance(limits.chance)) {
      const earned = random.chance(limits.crew.parentChance) ? 0 : random.int(1, limits.hands.cents)
      listed['earned'] = earned / 100
      const paid = random.chance(limits.chance) ? random.int(0, limits.hands.cents) : undefined
      if (paid !== undefined) listed['paid'] = paid / 100
      want.earned = earned > 0 ? dollars(earned) + (paid === undefined ? '' : ', ' + dollars(paid) + ' paid out') : null
    }
    if (random.chance(limits.chance)) {
      const pricing: Record<string, unknown> = {}
      const describe = random.chance(limits.chance) ? random.pick(['Q3 data, $0.01 a file', '', 'GPU minutes']) : undefined
      const payee = random.chance(limits.chance) ? '0x' + hex(random, limits.hands.payee) : undefined
      const currency = random.chance(limits.chance) ? random.pick(['ousd', 'usdce', 'eth']) : undefined
      if (describe !== undefined) pricing['describe'] = describe
      if (payee !== undefined) pricing['payee'] = payee
      if (currency !== undefined) pricing['currency'] = currency
      listed['pricing'] = pricing
      const symbol = currency === 'ousd' ? 'OUSD' : currency === 'usdce' ? 'USDC.e' : undefined
      want.price =
        (describe || 'priced by its owner') + (payee ? ' (paid to ' + payee.slice(0, 6) + '…' + payee.slice(-4) + (symbol ? ' in ' + symbol : '') + ')' : '')
    }
    termsSame(same, JSON.stringify(listed).slice(0, 240), Hands.terms(listed), want)
  }
  return { steps, violations }
}

type Entry = { at: number; detail: string | null; event: number; kind: string; seq: number; text: string; who: string | null }

const entry = (seq: number, kind: string, text: string, detail: string | null = null, who: string | null = null): Entry => ({
  at: seq * 1000,
  detail,
  event: seq,
  kind,
  seq,
  text,
  who,
})

function fleetFixtures(Fleet: FleetModule, same: ReturnType<typeof recorder>['same']) {
  const fleet = (entries: Entry[], hands: { connected: boolean; name: string }[], lent: unknown[]) => Fleet.fleet(entries as never, hands, lent as never)
  const first = fleet(
    [
      entry(1, 'machine', 'Starting machine sb-1 (python:3.12-slim)', '{"attach":"sb-1","image":"python:3.12-slim","cpu":2,"memory":4096,"lease":300}'),
      entry(2, 'tool', '$ ls on sb-1', '{"cmd":"ls","hand":"sb-1"}'),
      entry(3, 'output', 'Command output', 'a\nb'),
      entry(4, 'machine', "A contributor's machine joined the swarm as hand room-1 (data room)."),
      entry(5, 'tool', '$ cat q3.txt on room-1', '{"cmd":"cat q3.txt","hand":"room-1"}'),
      entry(6, 'error', 'exec_command failed', 'denied'),
      entry(7, 'machine', 'Shutting down a machine', '{"sandboxId":"sb-1"}'),
    ],
    [{ connected: true, name: 'room-1' }],
    [{ at: 0, channels: null, charged: '0.010000', connected: true, earned: null, label: 'data room', name: 'room-1', price: '$0.01 a read', requests: 2 }],
  )
  const box = first.find((item) => item.name === 'sb-1')
  const room = first.find((item) => item.name === 'room-1')
  same('fleet named', 'fixture kinds', [box?.kind, room?.kind, first[0]?.name], ['sandbox', 'hand', 'room-1'])
  same('fleet config', 'fixture config', box?.config, [
    ['Image', 'python:3.12-slim'],
    ['CPU', '2'],
    ['Memory', '4 GB'],
    ['Lease', '5 min'],
  ])
  same('fleet commands', 'fixture output', [box?.commands[0]?.output, room?.commands[0]?.failed], ['a\nb', true])
  same('fleet ended', 'fixture ended', box?.ended, 7000)
  same('fleet hands', 'fixture lent', [room?.label, room?.charged], ['data room', '0.010000'])
  const created = JSON.stringify([
    { text: JSON.stringify({ hand: null, handError: 'A hand named h200 is already connected', sandboxId: 'sb-abc' }), type: 'text' },
  ])
  const second = fleet(
    [
      entry(
        1,
        'machine',
        'Starting machine h200 (pytorch/pytorch:2.9.0, H200)',
        '{"attach":"h200","cpuMax":4,"gpu":"H200","gpuCount":1,"image":"pytorch/pytorch:2.9.0","memoryMax":16384,"timeout":150,"volumes":[{"name":"muse","path":"/work"}],"env":{"TOKEN":"secret"}}',
      ),
      entry(2, 'output', 'compute_create output', created),
      entry(3, 'tool', 'Called compute_write', '{"path":"/work/smoke.py","sandboxId":"sb-abc","text":"print(1)"}'),
      entry(4, 'output', 'compute_write output', '{"size":8}'),
      entry(5, 'tool', 'Called compute_exec', '{"command":["sh","-c","cd /work && python smoke.py"],"sandboxId":"sb-abc","timeout":110}'),
      entry(6, 'output', 'compute_exec output', '{"exitCode":0,"stdout":"1"}'),
      entry(7, 'machine', 'Shutting down a machine', '{"sandboxId":"sb-abc"}'),
    ],
    [],
    [],
  )
  same('fleet named', 'compute machine', [second.length, second[0]?.name], [1, 'h200'])
  same('fleet config', 'compute config', second[0]?.config, [
    ['CPU', '4'],
    ['GPU', 'H200'],
    ['Image', 'pytorch/pytorch:2.9.0'],
    ['Memory', '16 GB'],
    ['Timeout', '3 min'],
    ['Volumes', 'muse at /work'],
    ['Environment', 'TOKEN'],
  ])
  same(
    'fleet commands',
    'compute commands',
    [second[0]?.commands.map((run) => run.text), second[0]?.commands[1]?.output],
    [['write /work/smoke.py', '$ cd /work && python smoke.py'], '{"exitCode":0,"stdout":"1"}'],
  )
  same('fleet ended', 'compute ended', second[0]?.ended, 7000)
  const third = fleet(
    [
      entry(1, 'machine', 'Starting machine  (python:3.12-slim)', '{"image":"python:3.12-slim","cpu":2}'),
      entry(2, 'output', 'compute_create output', JSON.stringify([{ text: JSON.stringify({ hand: null, sandboxId: 'sb-xyz' }), type: 'text' }])),
      entry(3, 'tool', 'Called compute_exec', '{"command":["python","-V"],"sandboxId":"sb-xyz"}'),
      entry(4, 'output', 'compute_exec output', '{"exitCode":0}'),
      entry(5, 'tool', 'Called compute_write', '{"path":"/work/big.py","sandboxId":"sb-xyz","text":"print(1)'),
    ],
    [],
    [],
  )
  same('fleet named', 'unattached', [third.length, third[0]?.name], [1, 'sb-xyz'])
  same('fleet config', 'unattached config', third[0]?.config, [
    ['Image', 'python:3.12-slim'],
    ['CPU', '2'],
  ])
  same(
    'fleet commands',
    'unattached commands',
    third[0]?.commands.map((run) => run.text),
    ['$ python -V', 'write /work/big.py'],
  )
  const e2b = 'iajm8koswc342dpzhhv41'
  const fourth = fleet(
    [
      entry(1, 'machine', 'Starting machine  (default image)', '{"lease":900,"timeout":900}'),
      entry(
        2,
        'output',
        'compute_create output',
        JSON.stringify({
          text: JSON.stringify([
            { text: JSON.stringify({ createdAt: 1, gpu: null, hand: null, image: 'base', provider: 'e2b', sandboxId: e2b, tunnels: {} }), type: 'text' },
          ]),
        }),
      ),
      entry(3, 'tool', 'Called compute_exec', '{"command":["sh","-c","uname -a"],"sandboxId":"' + e2b + '","timeout":10}'),
      entry(4, 'output', 'compute_exec output', '{"exitCode":0,"stdout":"Linux e2b.local"}'),
      entry(5, 'machine', 'Shutting down a machine', '{"sandboxId":"' + e2b + '"}'),
    ],
    [],
    [],
  )
  same('fleet named', 'e2b', [fourth.length, fourth[0]?.name, fourth[0]?.kind], [1, e2b, 'sandbox'])
  same(
    'fleet commands',
    'e2b commands',
    fourth[0]?.commands.map((run) => run.text),
    ['$ uname -a'],
  )
  same('fleet ended', 'e2b ended', fourth[0]?.ended, 5000)
  const failed = JSON.stringify([
    { text: JSON.stringify({ code: 'payment_failed', detail: 'Every contribution to this swarm is spent.', status: limits.fleet.status }), type: 'text' },
  ])
  const fifth = fleet(
    [
      entry(1, 'machine', 'Starting machine judge (lmsysorg/sglang, H200)', '{"gpu":"H200","image":"lmsysorg/sglang"}'),
      entry(2, 'error', 'compute_create failed', failed),
    ],
    [],
    [],
  )
  same('fleet failed', 'failed create', [fifth[0]?.failed, fifth[0]?.ended], ['Every contribution to this swarm is spent.', 2000])
  const deep = 'sb-E4MAfaPmjuC8gDgCptT4Md'
  const sixth = fleet(
    [
      entry(1, 'machine', 'Starting machine  (lmsysorg/sglang)', '{"cpu":8,"gpu":"H200","image":"lmsysorg/sglang","lease":600}'),
      entry(
        2,
        'output',
        'compute_create output',
        JSON.stringify({ text: JSON.stringify([{ text: JSON.stringify({ gpu: 'H200', hand: null, sandboxId: deep }), type: 'text' }]) }),
      ),
      entry(3, 'tool', 'Called compute_exec', '{"command":["nvidia-smi"],"sandboxId":"' + deep + '"}', 'autoresearch branch: moe3'),
    ],
    [],
    [],
  )
  same('fleet named', 'deep id', [sixth.length, sixth[0]?.name, sixth[0]?.by, sixth[0]?.started], [1, deep, null, 1000])
  same('fleet config', 'deep config', sixth[0]?.config, [
    ['CPU', '8'],
    ['GPU', 'H200'],
    ['Image', 'lmsysorg/sglang'],
    ['Lease', '10 min'],
  ])
  same(
    'fleet commands',
    'deep who',
    sixth[0]?.commands.map((run) => run.who),
    ['autoresearch branch: moe3'],
  )
  const seventh = Fleet.folded(
    [
      entry(1, 'machine', 'Starting machine sandbox (python:3.12-slim)', '{"attach":"sandbox","image":"python:3.12-slim"}'),
      entry(2, 'output', 'compute_create output', '{"sandboxId":"sb-AAA111"}'),
      entry(3, 'machine', 'Starting machine gpu (pytorch)', '{"attach":"gpu","image":"pytorch"}'),
      entry(4, 'output', 'compute_create output', '{"sandboxId":"sb-BBB222"}'),
      entry(5, 'machine', 'Starting machine d (pytorch)', '{"attach":"d","image":"pytorch"}'),
      entry(6, 'output', 'compute_create output', '{"sandboxId":"sb-CCC333"}'),
      entry(7, 'machine', 'Shutting down a machine', '{"sandboxId":"sb-BBB222"}'),
      entry(8, 'machine', 'Starting machine sandbox (python:3.12-slim)', '{"attach":"sandbox","image":"python:3.12-slim"}'),
      entry(9, 'output', 'compute_create output', '{"sandboxId":"sb-DDD444"}'),
      entry(10, 'machine', 'Shutting down a machine', '{"sandboxId":"sb-AAA111"}'),
    ] as never,
    [],
  )
  same('fleet ended', 'latest sandbox', Object.fromEntries(seventh.map((machine) => [machine.name, machine.ended]).toSorted()), {
    d: null,
    gpu: 7000,
    sandbox: null,
  })
  const eighth = Fleet.folded(
    [
      entry(1, 'machine', "A contributor's machine joined the swarm as hand mbp-abc123 (laptop)."),
      entry(2, 'machine', 'Machine box-1 joined the swarm.'),
      entry(3, 'machine', 'Machine mbp-abc123 left.'),
      entry(4, 'machine', 'Machine box-1 left.'),
      entry(5, 'machine', 'Machine gone-1 joined the swarm.'),
      entry(6, 'machine', "A contributor's machine joined the swarm as hand mbp-abc123 (laptop)."),
      entry(7, 'machine', 'Machine box-1 joined the swarm.'),
      entry(8, 'machine', 'Machine gone-1 left.'),
    ] as never,
    [
      { connected: true, name: 'mbp-abc123' },
      { connected: true, name: 'box-1' },
    ],
  )
  same(
    'fleet hands',
    'rejoined',
    eighth.map((machine) => [machine.name, machine.kind, machine.label, machine.connected, machine.started, machine.ended]),
    [
      ['box-1', 'hand', null, true, 7000, null],
      ['mbp-abc123', 'hand', 'laptop', true, 6000, null],
      ['gone-1', 'hand', null, false, 5000, 8000],
    ],
  )
}

type Want = {
  commands: string[]
  config: [string, string][]
  connected: boolean
  ended: number | null
  failed: string | null
  kind: string
  label: string | null
  started: number | null
}

function sandboxText(random: Rng, id: string) {
  const base = JSON.stringify({ hand: null, sandboxId: id })
  const layers = random.int(0, 2)
  if (layers === 0) return base
  const once = JSON.stringify([{ text: base, type: 'text' }])
  return layers === 1 ? once : JSON.stringify({ text: once })
}

async function fleet(seed: string): Promise<Outcome> {
  const random = rng(seed, 'fleet')
  const { fail, same, violations } = recorder()
  const Fleet = await load<FleetModule>('src/shared/Fleet.ts')
  applied()
  fleetFixtures(Fleet, same)
  let steps = 0
  for (let r = 0; r < limits.fleet.runs; r++) {
    const entries: Entry[] = []
    const push = (kind: string, text: string, detail: string | null = null) => {
      const seq = entries.length + 1
      entries.push(entry(seq, kind, text, detail))
      return seq * 1000
    }
    const want = new Map<string, Want>()
    const named = new Map<string, string>()
    const ids: string[] = []
    const boxes = Array.from({ length: limits.fleet.names }, (_, n) => 'box-' + n)
    const hands = Array.from({ length: limits.fleet.names }, (_, n) => 'mbp-' + n)
    const fresh = (kind: string, at: number): Want => ({
      commands: [],
      config: [],
      connected: false,
      ended: null,
      failed: null,
      kind,
      label: null,
      started: at,
    })
    for (let s = 0; s < limits.fleet.steps; s++, steps++) {
      const op = random.pick(['start', 'start', 'exec', 'exec', 'write', 'shutdown', 'join', 'leave'] as const)
      if (op === 'start') {
        const name = random.chance(limits.fleet.namedChance) ? random.pick(boxes) : ''
        const image = random.pick(['python:3.12-slim', 'pytorch', 'lmsysorg/sglang'])
        const cpu = random.int(1, limits.fleet.names)
        const [memory, memoryShown] = random.pick(limits.fleet.memories)
        const [lease, leaseShown] = random.pick(limits.fleet.leases)
        const config: [string, string][] = [
          ['Image', image],
          ['CPU', String(cpu)],
          ['Memory', memoryShown],
          ['Lease', leaseShown],
        ]
        const at = push(
          'machine',
          'Starting machine ' + name + ' (' + image + ')',
          JSON.stringify({ ...(name ? { attach: name } : {}), image, cpu, memory, lease }),
        )
        const machine = name ? (want.get(name) ?? fresh('sandbox', at)) : undefined
        if (name && machine) {
          want.set(name, machine)
          Object.assign(machine, { config, ended: null, failed: null, started: at })
        }
        if (random.chance(limits.fleet.failChance)) {
          const reason = random.pick(['Every contribution to this swarm is spent.', 'No GPU is free right now.'])
          const ended = push(
            'error',
            'compute_create failed',
            JSON.stringify([{ text: JSON.stringify({ code: 'payment_failed', detail: reason, status: limits.fleet.status }), type: 'text' }]),
          )
          if (machine) Object.assign(machine, { ended, failed: reason })
          continue
        }
        const id = random.chance(limits.chance)
          ? 'sb-' + hex(random, limits.fleet.sbId).replace(/[0-4]/g, (digit) => 'ABCDE'.charAt(Number(digit)))
          : hex(random, limits.fleet.hexId).replace(/[0-4]/g, (digit) => 'vwxyz'.charAt(Number(digit)))
        push('output', 'compute_create output', sandboxText(random, id))
        ids.push(id)
        if (name) named.set(id, name)
        else want.set(id, { ...fresh('sandbox', at), config })
      } else if ((op === 'exec' || op === 'write') && ids.length) {
        const id = random.pick(ids)
        const owner = want.get(named.get(id) ?? id)
        if (op === 'exec') {
          const command = random.pick(['ls', 'uname -a', 'python -V'])
          push(
            'tool',
            'Called compute_exec',
            JSON.stringify({ command: random.chance(limits.chance) ? ['sh', '-c', command] : command.split(' '), sandboxId: id }),
          )
          push('output', 'compute_exec output', JSON.stringify({ exitCode: 0, stdout: 'x' }))
          owner?.commands.push('$ ' + command)
        } else {
          const path = '/work/' + random.pick(['a.py', 'b.txt'])
          push('tool', 'Called compute_write', JSON.stringify({ path, sandboxId: id, text: 'print(1)' }))
          push('output', 'compute_write output', '{"size":8}')
          owner?.commands.push('write ' + path)
        }
      } else if (op === 'shutdown' && ids.length) {
        const id = random.pick(ids)
        const at = push('machine', 'Shutting down a machine', JSON.stringify({ sandboxId: id }))
        const name = named.get(id) ?? id
        const latest = [...named].findLast(([, one]) => one === name)?.[0] ?? id
        const machine = want.get(name)
        if (machine && latest === id) machine.ended = at
      } else if (op === 'join') {
        const name = random.pick(hands)
        const label = random.chance(limits.chance) ? random.pick(['laptop', 'data room']) : null
        const at = push(
          'machine',
          label ? "A contributor's machine joined the swarm as hand " + name + ' (' + label + ').' : 'Machine ' + name + ' joined the swarm.',
        )
        const machine = want.get(name) ?? fresh('hand', at)
        want.set(name, machine)
        if (label) machine.label = label
        if (machine.ended !== null) Object.assign(machine, { ended: null, started: at })
      } else if (op === 'leave') {
        const name = random.pick(hands)
        const at = push('machine', 'Machine ' + name + ' left.')
        const machine = want.get(name)
        if (machine) machine.ended = at
      }
    }
    const listed = hands.filter(() => random.chance(limits.chance)).map((name) => ({ connected: random.chance(limits.chance), name }))
    for (const hand of listed) {
      const machine = want.get(hand.name) ?? fresh('hand', 0)
      want.set(hand.name, machine)
      machine.connected = hand.connected
    }
    const got = Fleet.folded(entries as never, listed)
    const trail = entries.map((one) => one.text + (one.detail ? ' ' + one.detail : '')).join(' | ')
    same(
      'fleet named',
      'machines of ' + trail.slice(0, 200),
      got.map((one) => one.name + ':' + one.kind).toSorted(),
      [...want].map(([name, one]) => name + ':' + one.kind).toSorted(),
    )
    for (const machine of got) {
      const expected = want.get(machine.name)
      if (!expected) continue
      const where = machine.name + ' after ' + trail.slice(-300)
      same(machine.kind === 'hand' ? 'fleet hands' : 'fleet ended', where, [machine.started, machine.ended], [expected.started, expected.ended])
      same('fleet failed', where, machine.failed, expected.failed)
      same(
        'fleet commands',
        where,
        machine.commands.map((one) => one.text),
        expected.commands,
      )
      if (machine.kind === 'sandbox') same('fleet config', where, machine.config, expected.config)
      else same('fleet hands', where, [machine.label, machine.connected], [expected.label, expected.connected])
    }
    for (let i = 1; i < got.length; i++) {
      const a = got[i - 1]
      const b = got[i]
      if (a && b && (Number(b.connected) > Number(a.connected) || (a.connected === b.connected && (b.started ?? 0) > (a.started ?? 0))))
        fail('fleet order', b.name + ' comes after ' + a.name + ' though connected or started later')
    }
  }
  const people = Array.from({ length: limits.fleet.names }, () => '0x' + hex(random, limits.hands.payee))
  const cased = (address: string) => (random.chance(limits.chance) ? address.toUpperCase().replace('0X', '0x') : address)
  for (let i = 0; i < limits.fleet.removes; i++, steps++) {
    const admins = people.filter(() => random.chance(limits.chance)).map(cased)
    const operator = random.chance(limits.chance) ? cased(random.pick(people)) : undefined
    const me = random.chance(limits.fleet.failChance) ? undefined : cased(random.pick(people))
    const who = me?.toLowerCase()
    const want = !!who && (admins.some((admin) => admin.toLowerCase() === who) || operator?.toLowerCase() === who)
    same('fleet removes', 'removes(' + me + ', ' + admins.join(',') + ', ' + operator + ')', Fleet.removes(me, admins, operator), want)
  }
  return { steps, violations }
}

const replicaTails = [
  '',
  '/feed',
  '/code',
  '/git/log',
  '/live',
  '/artifacts',
  '/chat',
  '/chat/live',
  '/chat/42',
  '/hands',
  '/answer',
  '/updates',
  '/search',
  '/wait',
  '/machines',
  '/machines/export',
  '/machines/sb-1/commands',
  '/machines/sb-1/commands/12',
  '/machines/sb-1/commands/12/log',
  '/machines/sb-1/logs',
  '/machines/sb-1/export',
  '/backers',
  '/team',
  '/branches',
  '/progress',
  '/ledger',
  '/deltas',
  '/tree',
  '/proofs',
  '/nodes/root',
  '/nodes/root/updates',
]

const replicaPages = [
  '/',
  '/join',
  '/s/abc',
  '/s/abc/code',
  '/x',
  '/x/s/abc',
  '/api/swarms',
  '/v1/search',
  '/v1/me',
  '/ideas',
  '/u/gakonst',
  '/oembed',
  '/og/s/abc/card.png',
  '/s/abc/n/1583a1546a',
  '/v1/riders/0xabc',
  '/api/riders/gakonst',
  '/v1/names/every-route',
  '/v1/general/chat',
  '/api/general/chat',
  '/v1/me/swarms/abc',
]

const replicaPrimary = ['/v1/auth/challenge', '/api/config', '/mcp']

function replicaDb(log: string[], name: string): D1Database {
  const session = (constraint?: string) => {
    let asked = false
    return {
      batch: async () => [],
      getBookmark: () => (asked ? name + '-bookmark' : null),
      prepare: (query: string) => {
        asked = true
        log.push(name + ':' + constraint + ':' + query)
        return { first: async () => null } as unknown as D1PreparedStatement
      },
    }
  }
  return {
    batch: async () => [],
    dump: async () => new ArrayBuffer(0),
    exec: async () => ({ count: 0, duration: 0 }),
    prepare: (query: string) => {
      log.push(name + ':primary:' + query)
      return { first: async () => null } as unknown as D1PreparedStatement
    },
    withSession: (constraint?: string) => session(constraint) as unknown as D1DatabaseSession,
  } as unknown as D1Database
}

async function replica(seed: string): Promise<Outcome> {
  const random = rng(seed, 'replica')
  const { fail, same, violations } = recorder()
  const Replica = await load<ReplicaModule>('src/worker/Replica.ts')
  applied()
  let steps = 0
  const id = () => hex(random, limits.replica.hexLeast)
  for (; steps < limits.replica.paths; steps++) {
    const kind = random.pick(['swarm', 'page', 'primary'] as const)
    const path =
      kind === 'swarm'
        ? '/' + random.pick(['api', 'v1']) + '/swarms/' + id() + random.pick(replicaTails)
        : kind === 'page'
          ? random.pick(replicaPages)
          : random.chance(limits.chance)
            ? random.pick(replicaPrimary)
            : '/a/' + id() + '/slug/index.html'
    const method = random.pick(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'])
    same('replica reads', method + ' ' + path, Replica.readable(method, path), kind !== 'primary' && (method === 'GET' || method === 'HEAD'))
    const written = random.pick([
      '/api/swarms/' + id() + '/contributions',
      '/api/swarms/' + id() + '/pay',
      '/v1/auth',
      '/v1/auth/challenge',
      '/v1/swarms/' + id() + '/steer',
      '/s/' + id(),
      '/api/swarms',
    ])
    const verb = random.pick(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'])
    const writes =
      !['GET', 'HEAD', 'OPTIONS'].includes(verb) &&
      /^\/(api|v1)\//.test(written) &&
      !/^\/api\/swarms\/[^/]+\/pay$/.test(written) &&
      !written.startsWith('/v1/auth')
    same('replica writes', verb + ' ' + written, Replica.writes(verb, written), writes)
  }
  for (let i = 0; i < limits.replica.bookmarks; i++, steps++) {
    const log: string[] = []
    const env = { DB: replicaDb(log, 'db') } as unknown as Cloudflare.Env
    const valid = () =>
      hex(random, limits.replica.hexLeast) +
      Array.from({ length: 3 }, () => '-' + hex(random, random.int(limits.replica.hexLeast, limits.replica.hexMost))).join('')
    const mark = () =>
      random.pick([
        valid,
        valid,
        () => 'zzzz-not-a-bookmark',
        () => 'x;y',
        () => valid().replace(/-[0-9a-f]+$/, ''),
        () => valid() + 'g',
        () => hex(random, limits.replica.hexLeast - 1) + valid().slice(limits.replica.hexLeast),
      ])()
    const cookie = random.chance(limits.chance) ? mark() : undefined
    const header = random.chance(limits.chance) ? mark() : undefined
    const decoy = random.chance(limits.chance) ? valid() : undefined
    const cookies = [
      'swarms_tz=UTC',
      ...(decoy ? ['xswarms_d1=' + decoy] : []),
      ...(cookie ? ['swarms_d1=' + cookie] : []),
      ...(random.chance(limits.chance) ? ['swarms_rail=open'] : []),
    ]
    const headers: Record<string, string> = { cookie: cookies.join('; ') }
    if (header) headers[Replica.header] = header
    const request = new Request('https://swarms.test/api/swarms', { headers })
    const given = header ?? cookie
    const want = given && /^[0-9a-f]{8}(-[0-9a-f]{8,64}){3}$/i.test(given) ? given : undefined
    same('replica bookmark', JSON.stringify(headers), Replica.bookmark(request), want)
    const read = Replica.read(env, request)
    read.DB.prepare('select ' + i)
    same('replica bookmark', 'session for ' + JSON.stringify(headers), log, ['db:' + (want ?? 'first-unconstrained') + ':select ' + i])
    same(
      'replica primary',
      'read env',
      [Replica.replicated(read), Replica.primary(read) === env, Replica.primary(env) === env, Replica.replicated(env)],
      [true, true, true, false],
    )
  }
  for (let i = 0; i < limits.replica.marks; i++, steps++) {
    const log: string[] = []
    const env = { DB: replicaDb(log, 'db') } as unknown as Cloudflare.Env
    const written = Replica.write(env)
    same('replica primary', 'written env', [Replica.replicated(written), Replica.primary(written) === env], [true, true])
    const queried = random.chance(limits.chance)
    const query = "insert into names (address, name, updated_at) values ('0x" + i + "', 'ada', 1)"
    if (queried) written.DB.prepare(query)
    const status = random.pick(limits.replica.statuses)
    const response = Response.json({ n: i, ok: true }, { status })
    const plain = Replica.mark(env, response)
    if (plain !== response) fail('replica mark', 'a response from an env that never wrote was replaced')
    const marked = Replica.mark(written, response)
    if (!queried) {
      if (marked !== response) fail('replica mark', 'a write with no query of its own changed its response')
      same('replica mark', 'unqueried log', log, [])
      continue
    }
    same('replica mark', 'write log', log, ['db:first-primary:' + query])
    same('replica mark', 'status', marked.status, status)
    same('replica mark', 'header', marked.headers.get(Replica.header), 'db-bookmark')
    const set = marked.headers.get('set-cookie') ?? ''
    if (!set.startsWith(Replica.cookie + '=db-bookmark; Path=/; Max-Age=' + limits.replica.cookieSeconds + ';'))
      fail('replica mark', 'set-cookie ' + set + ' does not hand back the bookmark for ' + limits.replica.cookieSeconds + 's')
    same('replica mark', 'body', await marked.json(), { n: i, ok: true })
  }
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { crew, door, fleet, hands, hello, replica }

const all = ['1', '2', '3']

export const canaries: Canary[] = [
  {
    flip: mutant('hello.exact', 'src/shared/Hello.ts', 'swarms_hello=1(?:;|$)', 'swarms_hello=1'),
    invariant: 'hello cookie',
    name: 'hello.exact',
    scenario: 'hello',
    seeds: all,
  },
  {
    flip: mutant('hello.named', 'src/shared/Hello.ts', '(?:^|;\\s*)swarms_hello', 'swarms_hello'),
    invariant: 'hello cookie',
    name: 'hello.named',
    scenario: 'hello',
    seeds: all,
  },
  {
    flip: mutant('hello.year', 'src/shared/Hello.ts', 'max-age=31536000', 'max-age=86400'),
    invariant: 'hello lasts',
    name: 'hello.year',
    scenario: 'hello',
    seeds: all,
  },
  {
    flip: mutant('door.seat', 'src/shared/Door.ts', 'return { posts: who.rider, steers', 'return { posts: who.rider || who.seat, steers'),
    invariant: 'door open',
    name: 'door.seat',
    scenario: 'door',
    seeds: all,
  },
  {
    flip: mutant('door.team', 'src/shared/Door.ts', "steers: who.seat ? 'team' : null", "steers: who.seat || who.rider ? 'team' : null"),
    invariant: 'door team',
    name: 'door.team',
    scenario: 'door',
    seeds: all,
  },
  {
    flip: mutant('crew.working', 'src/shared/Crew.ts', "Number(b.state === 'working') - Number(a.state === 'working') || ", ''),
    invariant: 'crew board',
    name: 'crew.working',
    scenario: 'crew',
    seeds: all,
  },
  {
    flip: mutant('crew.parent', 'src/shared/Crew.ts', '.filter((branch) => branch.parent === null)', '.filter((branch) => branch.id > 0)'),
    invariant: 'crew board',
    name: 'crew.parent',
    scenario: 'crew',
    seeds: all,
  },
  {
    flip: mutant('crew.ledger', 'src/shared/Crew.ts', 'parts.find((part) => !ledger(part)) ?? parts[0]', 'parts[0]'),
    invariant: 'crew summary',
    name: 'crew.ledger',
    scenario: 'crew',
    seeds: all,
  },
  {
    flip: mutant('crew.told', 'src/shared/Crew.ts', ".replace(/^subagent \\d+ /i, '')", ''),
    invariant: 'crew summary',
    name: 'crew.told',
    scenario: 'crew',
    seeds: all,
  },
  {
    flip: mutant(
      'crew.starved',
      'src/shared/Crew.ts',
      "if (branch.starved) return 'starved'",
      "if (branch.starved && branch.state !== 'failed') return 'starved'",
    ),
    invariant: 'crew state',
    name: 'crew.starved',
    scenario: 'crew',
    seeds: all,
  },
  {
    flip: mutant('crew.title', 'src/shared/Crew.ts', '(auto)?research', 'autoresearch'),
    invariant: 'crew title',
    name: 'crew.title',
    scenario: 'crew',
    seeds: all,
  },
  { flip: mutant('crew.metric', 'src/shared/Crew.ts', 'speed_?up', 'speedup'), invariant: 'crew metric', name: 'crew.metric', scenario: 'crew', seeds: all },
  {
    flip: mutant('terms.plural', 'src/worker/Hands.ts', "operation${count === 1 ? '' : 's'}", 'operations'),
    invariant: 'terms charged',
    name: 'terms.plural',
    scenario: 'hands',
    seeds: all,
  },
  {
    flip: mutant('terms.settled', 'src/worker/Hands.ts', "${usd(sum('settled'))} settled", "${usd(sum('accepted'))} settled"),
    invariant: 'terms channels',
    name: 'terms.settled',
    scenario: 'hands',
    seeds: all,
  },
  {
    flip: mutant('terms.payee', 'src/worker/Hands.ts', 'pricing.payee.slice(-4)', 'pricing.payee.slice(-6)'),
    invariant: 'terms price',
    name: 'terms.payee',
    scenario: 'hands',
    seeds: all,
  },
  {
    flip: mutant('terms.currency', 'src/worker/Hands.ts', 'symbols[pricing.currency]', 'pricing.currency'),
    invariant: 'terms price',
    name: 'terms.currency',
    scenario: 'hands',
    seeds: all,
  },
  {
    flip: mutant('terms.earned', 'src/worker/Hands.ts', 'earned > 0', 'earned >= 0'),
    invariant: 'terms earned',
    name: 'terms.earned',
    scenario: 'hands',
    seeds: all,
  },
  {
    flip: mutant('fleet.latest', 'src/shared/Fleet.ts', 'if (machine && latest === id)', 'if (machine)'),
    invariant: 'fleet ended',
    name: 'fleet.latest',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('fleet.rejoin', 'src/shared/Fleet.ts', 'if (machine.ended !== null) {', 'if (machine.ended === null) {'),
    invariant: 'fleet hands',
    name: 'fleet.rejoin',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('fleet.wrapped', 'src/shared/Fleet.ts', '/sandboxId\\\\*"', '/sandboxId"'),
    invariant: 'fleet named',
    name: 'fleet.wrapped',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('fleet.reason', 'src/shared/Fleet.ts', 'machine.failed = reason(entry.detail) ?? entry.text', 'machine.failed = entry.text'),
    invariant: 'fleet failed',
    name: 'fleet.reason',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('fleet.output', 'src/shared/Fleet.ts', 'sorted.slice(index + 1, index + 6)', 'sorted.slice(index + 2, index + 6)'),
    invariant: 'fleet commands',
    name: 'fleet.output',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant(
      'fleet.write',
      'src/shared/Fleet.ts',
      "text.replace('Called compute_', '')} ${String(path",
      "text.replace('Called compute_', '')} ${String(args",
    ),
    invariant: 'fleet commands',
    name: 'fleet.write',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('fleet.memory', 'src/shared/Fleet.ts', 'raw >= 1024 ?', 'raw > 4096 ?'),
    invariant: 'fleet config',
    name: 'fleet.memory',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('fleet.connected', 'src/shared/Fleet.ts', 'Number(b.connected) - Number(a.connected) || ', ''),
    invariant: 'fleet order',
    name: 'fleet.connected',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('fleet.removes', 'src/shared/Fleet.ts', 'admin.toLowerCase() === who', 'admin === who'),
    invariant: 'fleet removes',
    name: 'fleet.removes',
    scenario: 'fleet',
    seeds: all,
  },
  {
    flip: mutant('replica.post', 'src/worker/Replica.ts', "if (method !== 'GET' && method !== 'HEAD') return false", "if (method === 'OPTIONS') return false"),
    invariant: 'replica reads',
    name: 'replica.post',
    scenario: 'replica',
    seeds: all,
  },
  {
    flip: mutant('replica.pay', 'src/worker/Replica.ts', ' && !/^\\/api\\/swarms\\/[^/]+\\/pay$/.test(path)', ''),
    invariant: 'replica writes',
    name: 'replica.pay',
    scenario: 'replica',
    seeds: all,
  },
  {
    flip: mutant('replica.bookmark', 'src/worker/Replica.ts', '? given : undefined', '? given : given'),
    invariant: 'replica bookmark',
    name: 'replica.bookmark',
    scenario: 'replica',
    seeds: all,
  },
  {
    flip: mutant('replica.mark', 'src/worker/Replica.ts', 'sessions.set(written, session)', 'void session'),
    invariant: 'replica mark',
    name: 'replica.mark',
    scenario: 'replica',
    seeds: all,
  },
  {
    flip: mutant('replica.primary', 'src/worker/Replica.ts', 'primaries.set(replica, env)', 'void replica'),
    invariant: 'replica primary',
    name: 'replica.primary',
    scenario: 'replica',
    seeds: all,
  },
]
