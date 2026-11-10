import assert from 'node:assert/strict'
import test from 'node:test'
import * as Shelf from '../src/shared/Artifact.ts'

test('a manifest becomes an artifact with its entry, form and url', () => {
  const artifact = Shelf.read('artifacts/leaderboard', { entry: 'index.html', kind: 'dashboard', summary: ' Solve rate by model. ', title: 'Leaderboard', updated: '2026-11-02T00:00:00Z' }, 3, '/a/abc')
  assert.deepEqual(artifact, {
    entry: 'index.html',
    form: 'page',
    kind: 'dashboard',
    slug: 'leaderboard',
    summary: 'Solve rate by model.',
    title: 'Leaderboard',
    updatedAt: Date.parse('2026-11-02T00:00:00Z'),
    url: '/a/abc/leaderboard/index.html',
    version: 3,
  })
})

test('a bare manifest falls back to index.html and the slug', () => {
  const artifact = Shelf.read('artifacts/notes', 'not an object', 1, '/a/abc')
  assert.equal(artifact?.entry, 'index.html')
  assert.equal(artifact?.title, 'notes')
  assert.equal(artifact?.form, 'page')
})

test('keys outside artifacts/ and bad slugs are not artifacts', () => {
  assert.equal(Shelf.read('git/x/issues/1', {}, 1, '/a/abc'), undefined)
  assert.equal(Shelf.read('artifacts/Bad Slug', {}, 1, '/a/abc'), undefined)
  assert.equal(Shelf.read('artifacts/a/b', {}, 1, '/a/abc'), undefined)
})

test('entries cannot climb out of their folder', () => {
  assert.equal(Shelf.path('../../secret.html'), undefined)
  assert.equal(Shelf.path('a/../b.html'), undefined)
  assert.equal(Shelf.path('/etc/passwd'), undefined)
  assert.equal(Shelf.path('a/b/c/d/e.html'), undefined)
  assert.equal(Shelf.path('./charts/cost.svg'), 'charts/cost.svg')
  assert.equal(Shelf.read('artifacts/evil', { entry: '../../x.html' }, 1, '/a/abc')?.entry, 'index.html')
})

test('the form follows the entry extension', () => {
  assert.equal(Shelf.form('README.md'), 'markdown')
  assert.equal(Shelf.form('results.CSV'), 'table')
  assert.equal(Shelf.form('chart.svg'), 'image')
  assert.equal(Shelf.form('data.json'), 'json')
  assert.equal(Shelf.form('log.txt'), 'text')
})

test('a file an agent wrote back wrapped in its own bucket_get answer is served as the file', () => {
  const key = 'artifacts/gf3-parity/index.html'
  const page = '<!doctype html><title>x</title>'
  const once = JSON.stringify({ contentType: 'text/html', etag: '"a"', key, public: true, size: 31, text: page })
  const twice = JSON.stringify({ contentType: 'text/html', etag: '"b"', key, public: true, size: 99, text: once })
  assert.equal(Shelf.unwrapped(page, key), page)
  assert.equal(Shelf.unwrapped(once, key), page)
  assert.equal(Shelf.unwrapped(twice, key), page)
  assert.equal(Shelf.unwrapped(once, 'artifacts/other/index.html'), once)
  const data = JSON.stringify({ key: 'value', text: 'a data file of its own' })
  assert.equal(Shelf.unwrapped(data, 'artifacts/x/data.json'), data)
  assert.equal(Shelf.unwrapped('{"key": broken', key), '{"key": broken')
})
