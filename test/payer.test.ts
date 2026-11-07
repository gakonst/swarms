import assert from 'node:assert/strict'
import test from 'node:test'
import * as Payer from '../src/worker/Payer.ts'

const opened: Payer.Channel = { at: 0, confirmed: true, deposit: '100000', descriptor: {}, id: '0x01', signed: '90000' }

test('a top-up never lowers the money a channel counts', () => {
  const spent = 90_000n
  const before = Payer.inside(opened, spent)
  const topped = Payer.topped(opened, 100_000n, 100_000n, 120_000n, 1_000)
  assert.equal(Payer.inside(topped, spent), before)
  assert.equal(topped.confirmed, true)
  assert.equal(Payer.held(topped), 200_000n)
  assert.ok(Payer.unsure(topped))
  const again = Payer.topped(topped, Payer.held(topped), 50_000n, 190_000n, 2_000)
  assert.equal(Payer.held(again), 250_000n)
  assert.equal(Payer.inside(again, spent), before)
})

test('the chain confirms a pending top-up and an opening channel, and a read showing nothing keeps them', () => {
  const topped = Payer.topped(opened, 100_000n, 100_000n, 120_000n, 1_000)
  assert.equal(Payer.confirm(topped, 0n, 60_000), topped)
  assert.equal(Payer.confirm(topped, 100_000n, 2_000), topped)
  const landed = Payer.confirm(topped, 200_000n, 2_000)
  assert.equal(Payer.inside(landed, 90_000n), 110_000n)
  assert.ok(!Payer.unsure(landed))
  const lost = Payer.confirm(topped, 100_000n, 60_000)
  assert.equal(Payer.inside(lost, 90_000n), 10_000n)
  assert.ok(!Payer.unsure(lost))
  const opening: Payer.Channel = { ...opened, confirmed: false, signed: '1000' }
  assert.equal(Payer.inside(opening, 0n), 0n)
  assert.equal(Payer.inside(Payer.confirm(opening, 100_000n, 1_000), 1_000n), 99_000n)
  const legacy: Payer.Channel = { ...opened, at: 1_000, confirmed: false, deposit: '200000' }
  assert.equal(Payer.inside(Payer.confirm(legacy, 200_000n, 2_000), 90_000n), 110_000n)
})
