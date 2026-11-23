import * as assert from 'node:assert/strict'
import * as child from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import { Board } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/node'
import * as Chain from '../mock/chain.ts'
import * as Mock from '../mock/gateway.ts'

type Line = Record<string, unknown> & { event: string; task?: string; worker: string }

const leaseMs = 1500

test('runner processes on one Board: a killed runner\'s lease lapses, another takes over and adopts its subagent by role, a steer is heeded, every bound holds', { timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarms-e2e-board-'))
  const gateway = await Mock.start({ dispatcherBudget: 99, unsolicited: false })
  const children: child.ChildProcess[] = []
  try {
    const swarm = 'e2etakeover'
    const name = 'swarm-' + swarm
    gateway.credit(name, gateway.transfer({ amount: '30', app: name, from: Chain.address('ana') }).hash)
    const made = await fetch(gateway.url + '/v1/agents', { body: JSON.stringify({ instructions: 'Call spawn_agent once with exactly the arguments given, then end the turn.', name: 'dispatcher' }), headers: { authorization: 'Bearer ' + gateway.key, 'content-type': 'application/json', 'gateway-app': name }, method: 'POST' })
    const agent = ((await made.json()) as { id: string }).id
    const think = (text: string) => ({ think: text })
    gateway.script('n:slow#1', [think('one'), { spend: 0.2 }, ...Array.from({ length: 16 }, (_, index) => [{ wait: 250 }, think('step ' + index)]).flat(), { result: { outcome: 'progress', summary: 'Slow work done.' } }])
    gateway.script('n:steer#1', [think('start'), ...Array.from({ length: 10 }, () => [{ wait: 200 }, think('working')]).flat(), { spend: 0.1 }, { result: { outcome: 'progress', summary: 'Steered work done.' } }])
    gateway.script('n:over#1', [think('start'), { overspend: 0.3 }])

    const db = path.join(dir, 'board.db')
    const sql = Sql.open(db)
    const board = await Board.open({ actor: 'agent:lead', scope: 'swarm:' + swarm, sql })
    assert.ok((await board.grant({ can: { '*': ['manage'] }, who: [{ id: 'agent', kind: 'kind' }] }, { key: 'swarm' })).ok)
    assert.ok((await board.post({ id: 'n:root', labels: { form: 'goal', kind: 'node' }, spec: 'Does P = NP?' }, { key: 'n:root' })).ok)
    const runs = { fast: 1, over: 1.2, slow: 2, steer: 1 } as Record<string, number>
    for (const [nid, budget] of Object.entries(runs)) {
      assert.ok((await board.post({ id: 'n:' + nid, labels: { form: 'lemma', kind: 'node' }, parent: 'n:root', spec: 'Lemma ' + nid }, { key: 'n:' + nid })).ok)
      assert.ok((await board.post({ id: `r:${nid}:1`, labels: { kind: 'run', node: nid }, parent: 'n:' + nid, spec: JSON.stringify({ budget, task: 'Work on ' + nid + (nid === 'fast' ? ' mock:prove' : '') }) }, { key: `commit:${nid}:1` })).ok)
    }
    const held = await board.claim('n:root', { leaseMs: 120_000 })
    assert.ok(held.ok)

    const lines: Line[] = []
    const exits = new Map<string, string>()
    const runner = path.join(import.meta.dirname, 'runner.ts')
    const spawn = (worker: string) => {
      const proc = child.spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', runner], {
        env: { ...process.env, AGENT: agent, BOARD_DB: db, BOARD_SCOPE: 'swarm:' + swarm, GATEWAY_APP: name, GATEWAY_KEY: gateway.key, GATEWAY_URL: gateway.url, LEASE_MS: String(leaseMs), WORKER: worker },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let buffer = ''
      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) if (part.trim()) lines.push(JSON.parse(part) as Line)
      })
      proc.stderr.on('data', (chunk: Buffer) => lines.push({ event: 'stderr', text: chunk.toString(), worker }))
      proc.on('exit', (code, signal) => exits.set(worker, signal ?? 'code ' + code))
      children.push(proc)
      return proc
    }
    const procs = new Map([['w1', spawn('w1')], ['w2', spawn('w2')], ['w3', spawn('w3')]])
    const wait = async (found: () => Line | undefined, ms = 30_000) => {
      const until = Date.now() + ms
      for (;;) {
        const line = found()
        if (line) return line
        if (Date.now() > until) throw new Error('timed out; lines: ' + JSON.stringify(lines.slice(-40)))
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }

    const first = await wait(() => lines.find((line) => line.event === 'renewed' && line.task === 'r:slow:1'))
    procs.get(first.worker)!.kill('SIGKILL')
    const killedAt = Date.now()
    const steered = await wait(() => lines.find((line) => line.event === 'spawned' && line.task === 'r:steer:1'))
    await board.refresh()
    assert.ok((await board.steer('r:steer:1', '[$4 behind this, from @ana] Try the switching lemma first.', { key: 'steer-1' })).ok)
    const takeover = await wait(() => lines.find((line) => line.event === 'claimed' && line.task === 'r:slow:1' && line.tookOver === true))
    assert.notEqual(takeover.worker, first.worker)
    const adopted = await wait(() => lines.find((line) => line.event === 'adopted' && line.task === 'r:slow:1'))
    assert.equal(adopted.worker, takeover.worker)
    for (const nid of Object.keys(runs)) await wait(() => lines.find((line) => line.event === 'finished' && line.task === `r:${nid}:1`))
    assert.ok(Number(takeover['atMs']) - killedAt >= 0)

    await board.refresh()
    const tasks = new Map((await board.tasks()).map((task) => [task.id, task]))
    assert.equal(tasks.get('r:slow:1')?.phase, 'done')
    assert.equal(tasks.get('r:slow:1')?.attempts, 2)
    assert.equal(tasks.get('r:fast:1')?.phase, 'done')
    assert.equal(tasks.get('r:steer:1')?.phase, 'done')
    assert.equal(tasks.get('r:over:1')?.phase, 'failed')
    assert.ok(lines.some((line) => line.event === 'heeded' && line.task === 'r:steer:1' && line.ok === true && line.worker === steered.worker))

    const listing = gateway.agents(name)[0]!
    for (const nid of Object.keys(runs)) assert.equal(listing.subagents.filter((each) => each.role === `n:${nid}#1`).length, 1, nid)
    assert.equal(listing.turns.length, Object.keys(runs).length)
    const byRole = new Map(listing.subagents.map((each) => [each.role, each]))
    for (const [nid, budget] of Object.entries(runs)) {
      const found = byRole.get(`n:${nid}#1`)!
      assert.equal(found.budget_usd, budget)
      assert.ok(found.spent_usd <= budget, nid)
    }
    assert.equal(byRole.get('n:over#1')!.spent_usd, runs['over'])
    assert.match(String(byRole.get('n:over#1')!.status.error), /over_limit/)
    assert.equal(JSON.parse(String(tasks.get('r:fast:1')?.outcome && (tasks.get('r:fast:1')!.outcome as { done: string }).done)).outcome, 'proved')
    assert.match(JSON.stringify(byRole.get('n:steer#1')!.status.output), /Heeded: \[\$4 behind this, from @ana\] Try the switching lemma first\./)
    assert.deepEqual(byRole.get('n:steer#1')!.messages.map((each) => each.read), [true])
    const ledger = gateway.ledger(name)
    assert.equal(ledger.left, ledger.received - ledger.spent)
    assert.equal(ledger.spent, Chain.units(listing.subagents.reduce((sum, each) => sum + each.spent_usd, 0)) + Chain.units(Mock.models.length ? 0.0005 * listing.turns.length : 0))

    assert.ok((await board.finish('n:root', held.claim, { done: 'all runs ended' })).ok)
    await wait(() => (exits.size === 3 ? { event: 'exits', worker: 'lead' } : undefined))
    assert.equal(exits.get(first.worker), 'SIGKILL')
    for (const [worker, exit] of exits) if (worker !== first.worker) assert.equal(exit, 'code 0', worker)
    await board.close()
    sql.close()
  } finally {
    for (const proc of children) if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    await gateway.close()
    fs.rmSync(dir, { force: true, recursive: true })
  }
})
