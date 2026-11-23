import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Chatter from '../src/shared/Chatter.ts'

test('idle lead messages are told apart from findings', () => {
  assert.equal(Chatter.idle("I'm not starting anything this turn: $0.19 is left, and the room has no new messages or money."), true)
  assert.equal(Chatter.idle("Update: I’m not starting anything this turn, and I made no tool calls, so this reply is the only cost."), true)
  assert.equal(Chatter.idle('Nothing new this turn.'), true)
  assert.equal(Chatter.idle('Attention4 reached 1.37x on verify; the best is now 1.400x faster than SGLang.'), false)
  assert.equal(Chatter.idle('No regression in the judge tests after the merge.'), false)
})

test('an idle message folds to its first clause', () => {
  assert.equal(Chatter.clause("Update: I'm not starting anything this turn and made no tool calls, so this reply is the only cost."), "I'm not starting anything this turn")
  assert.equal(Chatter.clause("I'm not starting anything this turn: $0.19 is left."), "I'm not starting anything this turn")
})

test('repeated messages share a gist whatever their numbers', () => {
  assert.equal(Chatter.gist("I'm not starting anything this turn. $0.74 is left."), Chatter.gist("I'm not starting anything this turn, and I made no tool calls."))
  assert.equal(Chatter.gist('Spent $1.20 on run 4.'), Chatter.gist('Spent $3.05 on run 5.'))
  assert.notEqual(Chatter.gist('Spent $1.20 on run 4.'), Chatter.gist('Started run 5.'))
})
