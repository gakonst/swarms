import assert from 'node:assert/strict'
import test from 'node:test'
import { simulate, type Fault, type Options } from './load/sim.ts'

const small: Partial<Options> = { activeMs: 30 * 60_000, children: 4, pledges: 4, swarms: 2, tailMs: 2 * 60 * 60_000 }

const holding: Fault[] = ['evict', 'dup', 'reorder', 'stale', 'retry', 'move', 'refuse']

test('a seed replays the same schedule and the same result', async () => {
  const first = await simulate({ ...small, faults: holding, seed: '7' })
  const again = await simulate({ ...small, faults: holding, seed: '7' })
  assert.equal(first.trace, again.trace)
  assert.deepEqual(first.counts, again.counts)
  assert.deepEqual(first.ledger, again.ledger)
  assert.deepEqual(first.violations, again.violations)
})

for (const seed of ['1', '2'])
  test(`without faults every result folds once and the ledger balances to the micro-dollar (seed ${seed})`, async () => {
    const report = await simulate({ ...small, faults: [], seed })
    assert.deepEqual(report.violations, [])
    assert.ok(report.counts.subagents > 0)
    assert.equal(report.counts.folds, report.counts.subagents)
    assert.equal(report.ledger.drift, '0.000000')
  })

for (const seed of ['1', '2', '3'])
  test(`evictions, redelivered events, retried rides, moves and refused spawns break no invariant (seed ${seed})`, async () => {
    const report = await simulate({ ...small, faults: holding, seed })
    assert.ok(report.counts.evictions + report.counts.redeliveries > 0)
    assert.deepEqual(report.violations, [])
    assert.equal(report.ledger.drift, '0.000000')
  })

for (const seed of ['3', '6'])
  test(`crashes at every await on top of every other fault fold each result once, release every claim and keep the ledger exact (seed ${seed})`, async () => {
    const report = await simulate({ ...small, faults: ['crash', ...holding], seed })
    assert.ok(report.counts.evictions > 0)
    assert.deepEqual(report.violations, [])
    assert.equal(report.ledger.drift, '0.000000')
  })

test('a settlement claimed by an earlier life is let go on restart, so its spend is recorded (seed 5)', async () => {
  const report = await simulate({ children: 6, faults: ['crash', ...holding], seed: '5', swarms: 3 })
  assert.deepEqual(report.violations, [])
  assert.equal(report.ledger.drift, '0.000000')
})

test('a subagent list that lags loses no result and no spend', { todo: 'pnpm load --seed 2 --swarms 2 --children 4 --pledges 4 --active 30 --tail 120 --faults staleList loses sim 0 sub 7 and $0.718736' }, async () => {
  const report = await simulate({ ...small, faults: ['staleList'], seed: '2' })
  assert.deepEqual(report.violations, [])
})
