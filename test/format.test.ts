import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mach, money, usd } from '../src/web/format.ts'

test('amounts at a dollar and above keep two decimals', () => {
  assert.equal(usd('1'), '$1.00')
  assert.equal(usd('2.5'), '$2.50')
  assert.equal(usd('1.028919'), '$1.03')
  assert.equal(usd('1234.567891'), '$1,234.57')
  assert.equal(usd('0.996'), '$1.00')
  assert.equal(usd('0'), '$0.00')
})

test('amounts under a dollar keep two significant figures', () => {
  assert.equal(usd('0.5'), '$0.50')
  assert.equal(usd('0.05'), '$0.05')
  assert.equal(usd('0.123456'), '$0.12')
  assert.equal(usd('0.028264'), '$0.028')
  assert.equal(usd('0.000183'), '$0.00018')
  assert.equal(usd('0.000001'), '$0.000001')
  assert.equal(usd('0.0995'), '$0.10')
})

test('no amount shows six decimals unless it is a millionth', () => {
  for (const value of ['0.150844', '0.215709', '3.950000', '0.004144', '0.017463']) assert.ok(!/\.\d{6}/.test(mach(value)), value)
  assert.equal(money('1.3', 'mach'), '1.30 MACH')
  assert.equal(money('0.086055', 'pathusd'), '0.086 pathUSD')
})
