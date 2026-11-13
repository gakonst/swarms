import assert from 'node:assert/strict'
import test from 'node:test'
import * as Answer from '../src/shared/Answer.ts'

test('updates lose the round numbers the agent used to give them', () => {
  assert.equal(Answer.unround('## Round 49 update — P vs NP\n\nNothing spent.'), '## P vs NP\n\nNothing spent.')
  assert.equal(Answer.unround('**Round 1 report — P vs NP**  I spent little.'), '**P vs NP**  I spent little.')
  assert.equal(Answer.unround('Round 51 update\nTwo corrections.'), 'Two corrections.')
  assert.equal(Answer.unround('Rounding errors dominate.'), 'Rounding errors dominate.')
  assert.equal(Answer.excerpt('## Round 45 update — P vs NP\nI made no tool calls.'), 'P vs NP I made no tool calls.')
})

test('old updates lose their STATUS lines and their talk of rounds', () => {
  assert.equal(Answer.unround('Built the parser.\nSTATUS: continue — more to do'), 'Built the parser.')
  assert.equal(Answer.unround('**STATUS: done**\nThis round I wrote tests; the next round adds docs.'), 'This update I wrote tests; the next update adds docs.')
  assert.equal(Answer.unround('As found in round 12, it holds.'), 'As found in an earlier update, it holds.')
})

test('system lines read as plain words with short amounts', () => {
  assert.equal(Answer.cash(9.215238), '$9.22')
  assert.equal(Answer.cash(0.046235), '$0.046')
  assert.equal(Answer.cash(0.0038), '$0.0038')
  assert.equal(Answer.cash(0.5), '$0.50')
  assert.equal(Answer.spoken('Out of money. Back it to keep it going.'), 'Out of money. Ride it to keep it going.')
  assert.equal(Answer.spoken('Waiting for money: $0.0038 is payable now, less than one model call holds. New money keeps it going.'), 'Out of money: $0.0038 left, and one step can cost up to $0.05. Fund it to keep going.')
  assert.equal(Answer.spoken('Waiting for money: $1.10 is payable now, less than one model call holds. The next budget pull or resting contribution is at 16:37 UTC.'), 'Out of money: $1.10 left, and one step can cost up to $0.05. Fund it to keep going.')
  assert.equal(Answer.spoken("Waiting for money: the agent's next model call holds $0.2147, more than the $0.2083 any one contribution can pay at once."), 'Paused: its next step needs about $0.21 at once, more than any one backer has left in it. Fund it to keep going.')
  assert.equal(Answer.spoken('The agent hit 3 errors in a row, so the swarm stopped to rest. New money restarts it, and so does the next budget pull at 16:37 UTC.'), 'Stopped after 3 errors in a row. New money or a note restarts it.')
  assert.equal(Answer.spoken('Out of money: $0.021 left, less than its next step needs. Adding money wakes it. More comes in at 21:32 UTC.'), 'Out of money: $0.021 left, and one step can cost up to $0.05. Fund it to keep going.')
  assert.equal(Answer.spoken('Resting: the agent found nothing worth spending on, so the swarm stopped asking it and spends nothing. $9.215238 is kept for later; a note or new money wakes it.'), 'Resting: the agent found nothing more worth doing. $9.22 is kept for later; a note or new money wakes it.')
  assert.equal(Answer.spoken('Back at work with $2.680000 to spend.'), 'Back at work.')
  assert.equal(Answer.spoken('Waiting for $1.17 payable, with $1.02 of it from one funder, so the swarm can open its $1 code repository and still work; $0.493744 is payable now.'), null)
  assert.equal(Answer.spoken('Round 2 started on 0x3ca3…4184\'s pledge, with $4.481149 left on it, room for 3 explorers beside the lead.'), null)
  assert.equal(Answer.spoken('Told the agent to keep going, with $3.952974 left.'), null)
  assert.equal(Answer.local('More comes in at 16:37 UTC.', Date.UTC(2026, 10, 3, 12), (at) => new Date(at).toISOString()), 'More comes in at 2026-11-03T16:37:00.000Z.')
  assert.equal(Answer.local('More comes in at 01:00 UTC.', Date.UTC(2026, 10, 3, 12), (at) => new Date(at).toISOString()), 'More comes in at 2026-11-04T01:00:00.000Z.')
})

test('a list keeps only the lines up to an answer gist, and the gist stays the same', () => {
  const text = '# Round 3\n\n| a | b |\n|---|---|\n**The fastest parser was simdjson at 4.1 GiB/s.**\n\nMore detail follows here.\n'.repeat(3)
  assert.equal(Answer.lead(text), '# Round 3\n\n| a | b |\n|---|---|\n**The fastest parser was simdjson at 4.1 GiB/s.**')
  assert.equal(Answer.gist(Answer.lead(text)), Answer.gist(text))
  assert.equal(Answer.gist(text), 'The fastest parser was simdjson at 4.1 GiB/s.')
  assert.equal(Answer.lead('short\n---'), '')
})

test('an update row skips raw JSON and code, and shows inline LaTeX as symbols', () => {
  const text = '{"code":"over_limit","message":"The key is over its limit"}\n```\nconst bound = solve(instance, 1000)\n```\nThe bound is $n \\le \\frac{k}{2}$ for every instance, for $5 of $10.'
  assert.equal(Answer.gist(text), 'The bound is n ≤ k/2 for every instance, for $5 of $10.')
  assert.equal(Answer.symbols('\\sqrt{n} \\cdot 2 \\ne \\infty'), '√(n) · 2 ≠ ∞')
})
