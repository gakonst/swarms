import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as Connect from '../src/shared/Connect.ts'

test('the runtime, lockfile and hand install command use one immutable SDK release', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.equal(manifest.dependencies['nanocode-ts'], Connect.release)
  assert.match(Connect.release, /\/build-([a-f0-9]{7})\/nanocode-ts-\1\.tgz$/)
  assert.equal(Connect.install, `npm install ${Connect.release}`)
  const old = manifest.devDependencies['nanocode-ts-old']
  const releases = (lock.match(/https:\/\/github\.com\/nanocodexyz\/nanocode-ts\/releases\/download\/[^\s(),}:]+/g) ?? []).filter((release) => release !== old)
  assert.ok(releases.length >= 5)
  assert.deepEqual([...new Set(releases)], [Connect.release])
})

test('the library snippet uses the SDK exports and the issued hand credentials', () => {
  const input = { name: 'my-machine-3c1f', token: 'hand_demo_4f2a', url: 'https://gateway.test/v1/hands/attach' }
  const source = Connect.library(input)
  assert.ok(source.includes("import { Hand } from 'nanocode-ts'"))
  assert.ok(source.includes("import { Bash, MemoryFileSystem } from 'nanocode-ts/bash'"))
  assert.ok(source.includes("resolve('nanocode-ts/nanocode_wasm.wasm')"))
  for (const [key, value] of Object.entries(input)) assert.ok(source.includes(`${key}: '${value}'`))
  assert.ok(source.includes('workspace: shell.workspace()'))
  assert.ok(source.includes('cwd: shell.cwd'))
})

test('the hand fixture returns the same install and library instructions as the real endpoint', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://swarms.test/swarms?fixture') })
  try {
    const api = await import('../src/web/api.ts')
    assert.equal(api.fixture, true)
    for (const label of ['', 'laptop']) {
      const issued = await api.hand('abc123abc123', label)
      assert.equal(issued.npm, Connect.install)
      assert.equal(issued.library, Connect.library(issued))
      assert.equal(issued.cli, Connect.cli(issued))
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})
