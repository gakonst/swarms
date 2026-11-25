import assert from 'node:assert/strict'
import test from 'node:test'
import * as Status from '../src/shared/Status.ts'

const swarm = { balance: '2.000000', remaining: '0.500000', status: 'paused', why: null } as const

test('a running swarm with money is working, and one out of money needs money even while a turn ends', () => {
  assert.deepEqual(Status.standing({ ...swarm, status: 'running' }), { action: null, mood: 'live', word: 'Working' })
  assert.deepEqual(Status.standing({ ...swarm, remaining: '0.000000', status: 'running' }), { action: 'Ride it to keep it going', mood: 'money', word: 'Needs money' })
  assert.equal(Status.pill('Working'), 'Working now')
})

test('a running swarm whose turns keep failing with money left is stuck, not working and not short of money', () => {
  const stuck = { balance: '56.710051', remaining: '27.983248', status: 'running', why: 'stuck' } as const
  assert.deepEqual(Status.standing(stuck), { action: null, mood: 'stuck', word: 'Stuck' })
  assert.equal(Status.pill('Stuck'), 'Retrying')
  assert.ok(!Status.live(stuck))
  assert.equal(Status.word({ ...stuck, remaining: '0.010000' }), 'Needs money')
})

test('a swarm paused for money while it still holds enough is stuck on refused payments', () => {
  assert.equal(Status.word({ ...swarm, why: 'money' }), 'Stuck')
  assert.equal(Status.word({ ...swarm, status: 'funding', why: 'money' }), 'Stuck')
  assert.equal(Status.word({ ...swarm, remaining: '0.010000', why: 'money' }), 'Needs money')
})

test('a swarm nobody backed is new, and one with money but no first step is starting', () => {
  assert.deepEqual(Status.standing({ ...swarm, balance: '0.000000', status: 'funding', why: 'unfunded' }), { action: 'Ride it to start it', mood: 'new', word: 'Not started' })
  assert.deepEqual(Status.standing({ ...swarm, status: 'funding', why: null }), { action: null, mood: 'live', word: 'Starting' })
  assert.equal(Status.word({ ...swarm, why: 'idle' }), 'Starting')
  assert.equal(Status.word({ ...swarm, why: 'rest' }), 'Starting')
  assert.equal(Status.word(swarm), 'Starting')
  assert.deepEqual(Status.standing({ ...swarm, remaining: '0.010000' }), { action: 'Ride it to keep it going', mood: 'money', word: 'Needs money' })
})

test('an archived swarm is stopped whatever else it says, and a tree with nodes in flight is working', () => {
  assert.equal(Status.word({ ...swarm, archivedAt: 1, status: 'running' }), 'Stopped')
  assert.equal(Status.word({ ...swarm, archivedAt: 1, remaining: '0.000000' }), 'Stopped')
  assert.equal(Status.word({ ...swarm, inFlight: 2, remaining: '0.000000', status: 'funding' }), 'Working')
  assert.equal(Status.word({ ...swarm, archivedAt: 1, inFlight: 2 }), 'Stopped')
})

test('every word has one pill, one line and a rail tag only when riders need to know', () => {
  const words: Status.Word[] = ['Working', 'Stuck', 'Starting', 'Needs money', 'Not started', 'Stopped']
  for (const word of words) {
    assert.ok(Status.pill(word))
    assert.ok(Status.line(word))
  }
  assert.equal(Status.tag('Working'), 'working now')
  assert.equal(Status.tag('Stuck'), 'retrying')
  assert.equal(Status.tag('Needs money'), 'needs money')
  assert.equal(Status.tag('Starting'), null)
  assert.deepEqual([Status.pill('Stopped'), Status.tag('Stopped')], ['Archived', 'archived'])
  assert.match(Status.line('Needs money'), /Out of money/)
  assert.doesNotMatch(Status.line('Stuck'), /model call|tool call|session|minutes/)
})

test('a money pause the server calls out of money needs money even with money left on paper, and the page says the server reason', () => {
  const megakernel = { balance: '100.519583', reason: Status.reasons.broke, remaining: '5.033962', setup: { most: '220480' }, status: 'paused', why: 'money' } as const
  assert.equal(Status.word(megakernel), 'Needs money')
  assert.equal(Status.told(megakernel), 'Out of money. Ride it to keep it going.')
  assert.equal(Status.word({ ...megakernel, reason: undefined }), 'Stuck')
  const sponsored = { ...megakernel, reason: Status.reasons.sponsor }
  assert.equal(Status.word(sponsored), 'Stuck')
  assert.match(Status.told(sponsored), /^Waiting on Tempo, not on money/)
  assert.doesNotMatch(Status.told(sponsored), /fee sponsor|gateway/)
  assert.equal(Status.badge(sponsored), 'Waiting on Tempo')
  assert.equal(Status.badge(megakernel), 'Needs money')
  assert.equal(Status.badge({ ...megakernel, reason: undefined }), 'Retrying')
  const live = { balance: '56.710051', failure: { status: 503 }, reason: Status.reasons.sponsor, remaining: '27.973444', status: 'paused', why: 'money' } as const
  assert.deepEqual([Status.badge(live), Status.told(live)], ['Waiting on Tempo', Status.reasons.sponsor], 'the P = NP detail: pill, Board line and ride box all say the sponsor reason')
  assert.equal(Status.told({ ...live, reason: "Waiting on the gateway's fee sponsor: the gateway cannot pay the network fee for its AI calls right now, though the swarm has money. It tries again by itself." }).startsWith('Waiting on the gateway'), true, 'a reason from a Worker one version behind is still shown as sent')
  assert.equal(Status.told({ ...megakernel, reason: Status.failing(503), status: 'running', why: 'stuck' }), 'Its AI calls keep failing (error 503). It tries again by itself.')
  assert.equal(Status.told({ ...megakernel, reason: null, status: 'running', why: 'stuck' }), Status.line('Stuck'))
  assert.equal(Status.told({ ...megakernel, reason: 'stale', status: 'running', why: null }), Status.line('Working'))
})

test('counts and rank count only swarms that are really working', () => {
  const now = 10_000_000
  const working = { ...swarm, createdAt: 1, status: 'running', updatedAt: now } as const
  const stuck = { ...working, why: 'stuck' } as const
  assert.equal(Status.count([working, stuck]).running, 1)
  assert.ok(Status.lively(working, now) > Status.lively(stuck, now))
})

test('a swarm paused for money while it holds a step of it is one whose payments are refused', () => {
  assert.ok(Status.refused({ ...swarm, status: 'paused', why: 'money' }))
  assert.ok(!Status.refused({ ...swarm, remaining: '0.010000', status: 'paused', why: 'money' }))
  assert.ok(!Status.refused({ ...swarm, status: 'running', why: null }))
  assert.ok(!Status.refused({ ...swarm, balance: '0.000000', remaining: '0.000000', status: 'funding', why: 'unfunded' }))
})
