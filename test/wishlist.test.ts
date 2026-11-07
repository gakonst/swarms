import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Wishlist from '../src/shared/Wishlist.ts'

test('a wishlist reads its items and their states', () => {
  const wishes = Wishlist.read([
    { want: 'An H100 for 2 hours', why: 'The 7B fine-tune does not fit on an A10G', use: 'Would pay $6 from the budget', status: 'open' },
    { want: 'The SWE-bench Verified split', why: 'The harness needs it', status: 'found', found: 'https://huggingface.co/datasets/x, from @ana' },
    { want: 'A Solidity auditor', status: 'no longer needed' },
    { why: 'no want' },
    'A Bloomberg terminal account',
    42,
  ])
  assert.deepEqual(
    wishes.map((wish) => [wish.want, wish.state]),
    [
      ['An H100 for 2 hours', 'open'],
      ['The SWE-bench Verified split', 'found'],
      ['A Solidity auditor', 'dropped'],
      ['A Bloomberg terminal account', 'open'],
    ],
  )
  assert.equal(wishes[0]?.use, 'Would pay $6 from the budget')
  assert.equal(wishes[1]?.found, 'https://huggingface.co/datasets/x, from @ana')
  assert.equal(Wishlist.open(wishes).length, 2)
})

test('a wishlist takes an object with items and ignores anything else', () => {
  assert.equal(Wishlist.parse('{"items":[{"want":"A GPU","status":"Open"}]}').length, 1)
  assert.deepEqual(Wishlist.parse('{"want":"A GPU"}'), [])
  assert.deepEqual(Wishlist.parse('not json'), [])
  assert.equal(Wishlist.read(Array.from({ length: 80 }, (_, index) => ({ want: String(index) }))).length, 50)
})

test('the wishlist artifact is the JSON one named wishlist', () => {
  assert.equal(Wishlist.is({ form: 'json', slug: 'wishlist', title: 'Wishlist' }), true)
  assert.equal(Wishlist.is({ form: 'json', slug: 'wants', title: 'Wishlist' }), true)
  assert.equal(Wishlist.is({ form: 'page', slug: 'wishlist', title: 'Wishlist' }), false)
  assert.equal(Wishlist.is({ form: 'json', slug: 'results', title: 'Results' }), false)
})
