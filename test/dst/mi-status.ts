import type * as StatusModule from '../../src/shared/Status.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

export const limits = { cases: 300 }

const swarm = { balance: '2.000000', remaining: '0.500000', status: 'paused', why: null } as const

async function status(seed: string): Promise<Outcome> {
  const random = rng('status', seed)
  const { fail, holds, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const Status = await load<typeof StatusModule>('src/shared/Status.ts')
  applied()
  a.as('a running swarm with money is working, and one out of money needs money even while a turn ends')
  {
    a.deepEqual(Status.standing({ ...swarm, status: 'running' }), { action: null, mood: 'live', word: 'Working' })
    a.deepEqual(Status.standing({ ...swarm, remaining: '0.000000', status: 'running' }), {
      action: 'Ride it to keep it going',
      mood: 'money',
      word: 'Needs money',
    })
    a.equal(Status.pill('Working'), 'Working now')
  }
  a.as('a running swarm whose turns keep failing with money left is stuck, not working and not short of money')
  {
    const stuck = { balance: '56.710051', remaining: '27.983248', status: 'running', why: 'stuck' } as const
    a.deepEqual(Status.standing(stuck), { action: null, mood: 'stuck', word: 'Stuck' })
    a.equal(Status.pill('Stuck'), 'Retrying')
    a.ok(!Status.live(stuck))
    a.equal(Status.word({ ...stuck, remaining: '0.010000' }), 'Needs money')
  }
  a.as('a swarm paused for money while it still holds enough is stuck on refused payments')
  {
    a.equal(Status.word({ ...swarm, why: 'money' }), 'Stuck')
    a.equal(Status.word({ ...swarm, status: 'funding', why: 'money' }), 'Stuck')
    a.equal(Status.word({ ...swarm, remaining: '0.010000', why: 'money' }), 'Needs money')
  }
  a.as('a swarm nobody backed is new, and one with money but no first step is starting')
  {
    a.deepEqual(Status.standing({ ...swarm, balance: '0.000000', status: 'funding', why: 'unfunded' }), {
      action: 'Ride it to start it',
      mood: 'new',
      word: 'Not started',
    })
    a.deepEqual(Status.standing({ ...swarm, status: 'funding', why: null }), { action: null, mood: 'live', word: 'Starting' })
    a.equal(Status.word({ ...swarm, why: 'idle' }), 'Starting')
    a.equal(Status.word({ ...swarm, why: 'rest' }), 'Starting')
    a.equal(Status.word(swarm), 'Starting')
    a.deepEqual(Status.standing({ ...swarm, remaining: '0.010000' }), { action: 'Ride it to keep it going', mood: 'money', word: 'Needs money' })
  }
  a.as('an archived swarm is stopped whatever else it says, and a tree with nodes in flight is working')
  {
    a.equal(Status.word({ ...swarm, archivedAt: 1, status: 'running' }), 'Stopped')
    a.equal(Status.word({ ...swarm, archivedAt: 1, remaining: '0.000000' }), 'Stopped')
    a.equal(Status.word({ ...swarm, inFlight: 2, remaining: '0.000000', status: 'funding' }), 'Working')
    a.equal(Status.word({ ...swarm, archivedAt: 1, inFlight: 2 }), 'Stopped')
  }
  a.as('every word has one pill, one line and a rail tag only when riders need to know')
  {
    const words: StatusModule.Word[] = ['Working', 'Stuck', 'Starting', 'Needs money', 'Not started', 'Stopped']
    for (const word of words) {
      a.ok(Status.pill(word))
      a.ok(Status.line(word))
    }
    a.equal(Status.tag('Working'), 'working now')
    a.equal(Status.tag('Stuck'), 'retrying')
    a.equal(Status.tag('Needs money'), 'needs money')
    a.equal(Status.tag('Starting'), null)
    a.deepEqual([Status.pill('Stopped'), Status.tag('Stopped')], ['Archived', 'archived'])
    a.match(Status.line('Needs money'), /Needs more money/)
    a.doesNotMatch(Status.line('Stuck'), /model call|tool call|session|minutes/)
  }
  a.as('a money pause the server calls out of money needs money even with money left on paper, and the page says the server reason')
  {
    const megakernel = {
      balance: '100.519583',
      reason: Status.reasons.broke,
      remaining: '5.033962',
      setup: { most: '220480' } as never,
      status: 'paused',
      why: 'money',
    } as const
    a.equal(Status.word(megakernel), 'Needs money')
    a.equal(Status.told(megakernel), 'Out of money. Ride it to keep it going.')
    a.equal(Status.word({ ...megakernel, reason: undefined }), 'Stuck')
    const sponsored = { ...megakernel, reason: Status.reasons.sponsor }
    a.equal(Status.word(sponsored), 'Stuck')
    a.match(Status.told(sponsored), /^Waiting on Tempo, not on money/)
    a.doesNotMatch(Status.told(sponsored), /fee sponsor|gateway/)
    a.equal(Status.badge(sponsored), 'Waiting on Tempo')
    a.equal(Status.badge(megakernel), 'Needs money')
    a.equal(Status.badge({ ...megakernel, reason: undefined }), 'Retrying')
    const live = {
      balance: '56.710051',
      failure: { status: 503 },
      reason: Status.reasons.sponsor,
      remaining: '27.973444',
      status: 'paused',
      why: 'money',
    } as const
    a.deepEqual(
      [Status.badge(live), Status.told(live)],
      ['Waiting on Tempo', Status.reasons.sponsor],
      'the P = NP detail: pill, Board line and ride box all say the sponsor reason',
    )
    a.equal(
      Status.told({
        ...live,
        reason:
          "Waiting on the gateway's fee sponsor: the gateway cannot pay the network fee for its AI calls right now, though the swarm has money. It tries again by itself.",
      }),
      Status.reasons.sponsor,
      'a sponsor wait from an object one version behind reads in the current words',
    )
    a.equal(
      Status.told({ ...megakernel, reason: Status.failing(503), status: 'running', why: 'stuck' }),
      'Its AI calls keep failing (error 503). It tries again by itself.',
    )
    a.equal(Status.told({ ...megakernel, reason: null, status: 'running', why: 'stuck' }), Status.line('Stuck'))
    a.equal(Status.told({ ...megakernel, reason: 'stale', status: 'running', why: null }), Status.line('Working'))
  }
  a.as('counts and rank count only swarms that are really working')
  {
    const now = 10_000_000
    const working = { ...swarm, createdAt: 1, status: 'running', updatedAt: now } as const
    const stuck = { ...working, why: 'stuck' } as const
    a.equal(Status.count([working, stuck]).running, 1)
    a.ok(Status.lively(working, now) > Status.lively(stuck, now))
  }
  a.as('a swarm paused for money while it holds a step of it is one whose payments are refused')
  {
    a.ok(Status.refused({ ...swarm, status: 'paused', why: 'money' }))
    a.ok(!Status.refused({ ...swarm, remaining: '0.010000', status: 'paused', why: 'money' }))
    a.ok(!Status.refused({ ...swarm, status: 'running', why: null }))
    a.ok(!Status.refused({ ...swarm, balance: '0.000000', remaining: '0.000000', status: 'funding', why: 'unfunded' }))
  }
  a.as('a fee-sponsor wait comes from structured fields, so the pill, rail and Board line agree with objects one version apart')
  {
    const pnp = { balance: '56.710051', remaining: '27.973444', status: 'paused', why: 'money' } as const
    const failure = {
      at: 1795594180114,
      code: 'api_error',
      message: "Tempo Agents cannot pay the network fee to open your key's channel right now: its fee sponsor is out of funds. The team has been alerted.",
      route: 'Messages',
      status: 503,
    }
    const older =
      "Waiting on the gateway's fee sponsor: the gateway cannot pay the network fee for its AI calls right now, though the swarm has money. It tries again by itself."
    const details = {
      'old sentence': { ...pnp, failure: null, reason: older },
      'old sentence with its failure, as production serves P = NP': { ...pnp, failure, reason: older, waiting: null },
      'new sentence': { ...pnp, failure: null, reason: Status.reasons.sponsor },
      'failure only': { ...pnp, failure, reason: null },
      'structured field only': { ...pnp, reason: 'any words at all', waiting: 'tempo' },
      'stuck while running on the sponsor': { ...pnp, failure, reason: null, status: 'running', why: 'stuck' },
    } as const
    for (const [name, detail] of Object.entries(details)) {
      a.equal(Status.waiting(detail), 'tempo', name)
      a.equal(Status.badge(detail), 'Waiting on Tempo', name)
      a.equal(Status.tagged(detail), 'waiting on Tempo', name)
      a.equal(Status.told(detail), Status.reasons.sponsor, name)
    }
    const refused = { ...pnp, failure: { ...failure, message: 'boom', status: 500 }, reason: Status.reasons.refused }
    a.deepEqual([Status.waiting(refused), Status.badge(refused), Status.tagged(refused)], [null, 'Retrying', 'retrying'])
    const broke = { ...pnp, remaining: '0.010000', waiting: 'tempo' } as const
    a.deepEqual([Status.badge(broke), Status.tagged(broke)], ['Needs money', 'needs money'], 'out of money wins over a stale wait')
    const working = { ...pnp, failure, status: 'running', why: null, waiting: 'tempo' } as const
    a.deepEqual([Status.waiting(working), Status.badge(working), Status.tagged(working)], [null, 'Working now', 'working now'])
  }
  a.as('a summary, the rail and lists read, says Waiting on Tempo from its waiting field alone')
  {
    const summary = { balance: '56.710051', remaining: '27.973444', status: 'paused', waiting: 'tempo', why: 'money' } as const
    a.equal(Status.word(summary), 'Stuck')
    a.equal(Status.tagged(summary, Status.word(summary)), 'waiting on Tempo')
    a.equal(Status.badge(summary, Status.word(summary)), 'Waiting on Tempo')
    const previous = { ...summary, waiting: undefined }
    a.deepEqual(
      [Status.tagged(previous), Status.badge(previous)],
      ['retrying', 'Retrying'],
      'a row an older object projected, without the field, still reads as before',
    )
  }
  const words: StatusModule.Word[] = ['Working', 'Stuck', 'Starting', 'Needs money', 'Not started', 'Stopped']
  for (let at = 0; at < limits.cases; at++) {
    const one = {
      archivedAt: random.chance(0.15) ? 1 : null,
      balance: random.pick(['0.000000', '0.010000', '2.000000', '56.710051']),
      inFlight: random.chance(0.2) ? random.int(1, 3) : 0,
      reason: random.pick([undefined, null, Status.reasons.broke, Status.reasons.sponsor, 'stale']),
      remaining: random.pick(['0.000000', '0.010000', '0.500000', '27.973444']),
      status: random.pick(['funding', 'running', 'paused'] as const),
      waiting: random.pick([undefined, null, 'tempo'] as const),
      why: random.pick([null, 'money', 'stuck', 'unfunded', 'idle', 'rest'] as const),
    }
    const word = Status.word(one)
    holds('one word', words.includes(word) && !!Status.pill(word) && !!Status.line(word), JSON.stringify(one) + ' read ' + word)
    if (one.archivedAt) holds('archived is stopped', word === 'Stopped', JSON.stringify(one) + ' read ' + word)
    else if (one.inFlight) holds('in flight is working', word === 'Working', JSON.stringify(one) + ' read ' + word)
    if (!one.archivedAt && !one.inFlight && one.status === 'running' && one.why === 'stuck' && word !== 'Needs money')
      holds('stuck is not working', word === 'Stuck', JSON.stringify(one) + ' read ' + word)
    holds('live is working', Status.live(one) === (word === 'Working'), JSON.stringify(one) + ' live ' + Status.live(one))
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { status }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'status.archived',
      'src/shared/Status.ts',
      "if (swarm.archivedAt || swarm.status === 'archived') return",
      "if (swarm.status === 'archived') return",
    ),
    invariant: 'archived is stopped',
    name: 'status.archived',
    scenario: 'status',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('status.stuck', 'src/shared/Status.ts', "(swarm.status === 'running' && swarm.why === 'stuck')", '(false)'),
    invariant: 'stuck is not working',
    name: 'status.stuck',
    scenario: 'status',
    seeds: ['1', '2', '3'],
  },
]
