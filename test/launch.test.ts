import assert from 'node:assert/strict'
import test from 'node:test'
import { launcher } from '../src/web/launch.ts'

test('a swarm created from one draft is reused only for that draft', async () => {
  const created: string[] = []
  const steps: string[] = []
  const launch = launcher(async (input: { goal: string; steering: string; template: string; title: string }) => {
    created.push(input.title)
    return { id: `swarm-${created.length}` }
  })
  const step = (name: string) => void steps.push(name)
  const first = { goal: 'Find the cheapest way to make clean water', steering: 'team', template: 'frontier-mix', title: 'Clean water' }

  assert.deepEqual(await launch(first, step), { id: 'swarm-1' })
  assert.deepEqual(await launch({ ...first }, step), { id: 'swarm-1' })
  assert.deepEqual(steps, ['create'])

  assert.deepEqual(await launch({ ...first, title: 'Desalination' }, step), { id: 'swarm-2' })
  assert.deepEqual(await launch({ ...first, template: 'frontier-openai' }, step), { id: 'swarm-3' })
  assert.deepEqual(await launch({ ...first, steering: 'open' }, step), { id: 'swarm-4' })
  assert.deepEqual(await launch(first, step), { id: 'swarm-1' })
  assert.deepEqual(created, ['Clean water', 'Desalination', 'Clean water', 'Clean water'])
})

test('a draft changed while its swarm is being created does not inherit that swarm', async () => {
  let made = (_: { id: string }) => {}
  const launch = launcher((_: { title: string }) => new Promise<{ id: string }>((resolve) => (made = resolve)))
  const creating = launch({ title: 'Clean water' }, () => {})
  made({ id: 'swarm-1' })
  assert.deepEqual(await creating, { id: 'swarm-1' })
  const next = launch({ title: 'Desalination' }, () => {})
  made({ id: 'swarm-2' })
  assert.deepEqual(await next, { id: 'swarm-2' })
})

test('a swarm that could not be created is asked for again', async () => {
  let fail = true
  const launch = launcher(async (_: { title: string }) => {
    if (fail) throw new Error('Sign in with Tempo Wallet to steer the swarm you start.')
    return { id: 'swarm-1' }
  })
  await assert.rejects(launch({ title: 'Clean water' }, () => {}), /Sign in/)
  fail = false
  assert.deepEqual(await launch({ title: 'Clean water' }, () => {}), { id: 'swarm-1' })
})
