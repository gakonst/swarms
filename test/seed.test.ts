import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import * as Verify from '../src/worker/Verify.ts'

type Seed = {
  problem: string
  title: string
  toolchain: string
  mathlib: string
  header: string
  reviewed: boolean
  nodes: { id: string; parent: string | null; form: string; title: string; spec: string; statement: string | null; stmt: string; needs: string[] }[]
}

const dir = new URL('../problems/pnp/', import.meta.url)
const seed = JSON.parse(readFileSync(new URL('seed.json', dir), 'utf8')) as Seed
const byId = new Map(seed.nodes.map((node) => [node.id, node]))

const frozen = new Map<string, string>([
  ['root', 'none'],
  ['23a8aa7a3f', 'none'],
  ['d11c640642', 'none'],
  ['02f879c716', 'none'],
  ['315af74bc7', 'none'],
  ['ae3213ebe6', '32bc45c51130a6e5'],
  ['35f4b9585d', 'a822d83c3bc5fadf'],
  ['fa40748031', '59b4c5b0b1568fb3'],
  ['4b388ede84', '39085a851401dff8'],
  ['9eb0df13dc', '9a982abb925cebfe'],
  ['dbbb55ee8d', 'd7246ada4f3055ca'],
  ['ca0fc7256b', 'a36c6f525a6c3c8e'],
  ['9c37ac506c', '66a215faab8c0645'],
  ['8daffbfbe1', '22664f0f97cf803f'],
  ['93c4d31c35', 'cf929edeccd9f8d3'],
  ['c7bea4e90e', '303208b52040a135'],
  ['d658fca714', 'ce1fa8ec70402678'],
  ['8b0c6e4163', 'e8e42bc2989d8cf5'],
  ['4c4401c81d', 'a377ade69dcc196e'],
  ['c9e51a643d', 'a2e2e08fe976191b'],
  ['c0b9a05514', '428a93951cef07dd'],
  ['1364d81c47', '7024b8f80fbb09d7'],
  ['5ac0cf7cb5', '616e5260eb13ae6f'],
  ['81da17eb81', '57b9ef832eb55323'],
  ['dbb7e7488f', 'a9b872092ec94cbe'],
  ['143e0c5429', 'be97813153a3d852'],
  ['b629f6703c', '143e8706623875d6'],
  ['dc05d4ec1a', 'abb2921b3ff05bc7'],
  ['c1ad83e85e', '90ba7f028bf083db'],
  ['e83c2f5907', '2c048bb53218be15'],
  ['25ec4d810f', '818652534c167191'],
  ['f71cc669e4', 'd84b3eb2d9ba7dac'],
  ['2f7a140626', 'ad8c569d9b3bda66'],
  ['c9d5f7f35f', 'c0f58de882c54999'],
])

function nid(parent: string, title: string) {
  const normalized = (parent + '\n' + title).trim().toLowerCase().replace(/\s+/g, ' ')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 10)
}

test('the seed is one tree under the root, every id derived from its parent and title', () => {
  assert.equal(seed.problem, 'pnp')
  const roots = seed.nodes.filter((node) => node.parent === null)
  assert.deepEqual(
    roots.map((node) => [node.id, node.form, node.title]),
    [['root', 'goal', 'Does P = NP?']],
  )
  assert.equal(byId.size, seed.nodes.length)
  for (const node of seed.nodes) {
    if (node.parent === null) continue
    assert.ok(byId.has(node.parent), node.id)
    assert.equal(node.id, nid(node.parent, node.title), node.title)
    assert.match(node.id, /^[0-9a-f]{10}$/)
    assert.equal(node.spec.split('\n')[0], node.title)
  }
  const programs = seed.nodes.filter((node) => node.form === 'program')
  assert.deepEqual(
    programs.map((node) => node.title.split(':')[0]),
    ['Foundations', 'Lower bounds', 'Barriers', 'Upper bounds'],
  )
  for (const program of programs) assert.equal(program.parent, 'root')
  for (const node of seed.nodes.filter((each) => each.form === 'lemma')) assert.equal(byId.get(node.parent ?? '')?.form, 'program', node.title)
})

test('every lemma carries a frozen statement whose hash is its stmt label, and nothing else does', async () => {
  for (const node of seed.nodes) {
    if (node.form !== 'lemma') {
      assert.equal(node.statement, null)
      assert.equal(node.stmt, 'none')
      continue
    }
    assert.ok(node.statement)
    assert.equal(node.stmt, await Verify.hash(node.statement), node.title)
    assert.ok(node.spec.endsWith('\u0060\u0060\u0060lean\n' + node.statement + '\n\u0060\u0060\u0060'), node.title)
    assert.ok(!/\bsorry\b|native_decide|\baxiom\b/.test(node.statement), node.title)
  }
  assert.deepEqual(new Map(seed.nodes.map((node) => [node.id, node.stmt])), frozen)
})

test('needs point at lemmas in the seed and never form a cycle', () => {
  const lemmas = new Set(seed.nodes.filter((node) => node.form === 'lemma').map((node) => node.id))
  for (const node of seed.nodes) for (const need of node.needs) assert.ok(lemmas.has(need) && need !== node.id, node.title + ' needs ' + need)
  const done = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (done.has(id)) return
    assert.ok(!visiting.has(id), 'cycle through ' + id)
    visiting.add(id)
    for (const need of byId.get(id)?.needs ?? []) visit(need)
    visiting.delete(id)
    done.add(id)
  }
  for (const node of seed.nodes) visit(node.id)
  assert.ok(seed.nodes.filter((node) => node.needs.length).length >= 10)
})

test("the Lean project pins the seed's toolchain and Mathlib, and holds exactly the seed's statement files", () => {
  assert.equal(readFileSync(new URL('lean-toolchain', dir), 'utf8').trim(), seed.toolchain)
  const manifest = JSON.parse(readFileSync(new URL('lake-manifest.json', dir), 'utf8')) as { packages: { name: string; rev: string }[] }
  assert.equal(manifest.packages.find((pack) => pack.name === 'mathlib')?.rev, seed.mathlib)
  assert.match(seed.mathlib, /^[0-9a-f]{40}$/)
  assert.ok(readFileSync(new URL('lakefile.toml', dir), 'utf8').includes(`rev = "${seed.mathlib}"`))
  const statements = new URL('Pnp/Statements/', dir)
  const lemmas = seed.nodes.filter((node) => node.statement !== null)
  assert.deepEqual(readdirSync(statements).sort(), lemmas.map((node) => `N${node.id}.lean`).sort())
  for (const node of lemmas) assert.equal(readFileSync(new URL(`N${node.id}.lean`, statements), 'utf8'), Verify.statementFile(node.id, node.statement ?? ''))
})

test('seed statements stay under review until a person signs them off', () => {
  assert.equal(seed.reviewed, false)
})
