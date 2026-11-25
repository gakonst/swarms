import { Board } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/node'
import { module } from '../board.ts'

type Raw = { agent_id: number; budget_usd?: number; parent_agent_id: number | null; role: string; spent_usd?: number; status: { error?: string; output?: unknown; state: string } }

const read = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(name + ' is not set')
  return value
}

const worker = read('WORKER')
const leaseMs = Number(read('LEASE_MS'))
const gateway = read('GATEWAY_URL')
const key = read('GATEWAY_KEY')
const app = read('GATEWAY_APP')
const agent = read('AGENT')
const sql = Sql.open(read('BOARD_DB'))
const board = await Board.open({ actor: 'agent:' + worker, module, scope: read('BOARD_SCOPE'), sql })
const ended = new Set(['closed', 'completed', 'failed', 'interrupted'])
const lane = Number(worker.replace(/\D/g, '')) || 0

function emit(event: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ atMs: Date.now(), worker, ...event }) + '\n')
}

async function call<value>(path: string, body?: unknown): Promise<value> {
  const response = await fetch(gateway + path, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'gateway-app': app },
    method: body === undefined ? 'GET' : 'POST',
  })
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${await response.text()}`)
  return (await response.json()) as value
}

const listed = () => call<{ agents: Raw[] }>(`/v1/agents/${agent}/subagents`).then((found) => found.agents)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

emit({ event: 'started', pid: process.pid })

let turn = lane
for (;;) {
  await board.refresh()
  const root = await board.task('n:root')
  if (!root || ['cancelled', 'done', 'failed'].includes(root.phase)) break
  const ready = await board.ready({ label: ['kind', 'run'] })
  const task = ready[turn++ % Math.max(ready.length, 1)]
  if (!task) {
    await sleep(50)
    continue
  }
  const lease = await board.claim(task.id, { leaseMs })
  if (!lease.ok) continue
  emit({ event: 'claimed', task: task.id, tookOver: lease.tookOver })
  await perform(task, lease.claim).catch((error: unknown) => emit({ error: String(error), event: 'error', task: task.id }))
}

emit({ event: 'exited' })
await board.close()
sql.close()

async function perform(task: Board.Task, claim: string) {
  const [, nid, k] = task.id.split(':')
  const role = `n:${nid}${'#'}${k}`
  const spec = JSON.parse(task.spec) as { budget: number; task: string }
  let mine = (await listed()).find((each) => each.role === role && each.parent_agent_id === null)
  if (mine) emit({ event: 'adopted', role, subagent: mine.agent_id, task: task.id })
  else {
    await call(`/v1/agents/${agent}/turns`, { id: claim, prompt: 'Call spawn_agent once with exactly these arguments, then end the turn.\n' + JSON.stringify({ budget_usd: spec.budget, role, task: spec.task }), steer: false })
    for (let tries = 0; !mine && tries < 200; tries++) {
      await sleep(25)
      mine = (await listed()).find((each) => each.role === role && each.parent_agent_id === null)
    }
    if (!mine) throw new Error('the dispatcher did not spawn ' + role)
    emit({ event: 'spawned', role, subagent: mine.agent_id, task: task.id })
  }
  const id = mine.agent_id
  await call(`/v1/agents/${agent}/subagents/${id}/budget`, { budget_usd: spec.budget })
  for (const extra of (await listed()).filter((each) => each.parent_agent_id === null && !/^n:[^#]+#\d+$/.test(each.role) && !ended.has(each.status.state))) {
    await call(`/v1/agents/${agent}/subagents/${extra.agent_id}/close`, {})
    emit({ event: 'closed', role: extra.role, subagent: extra.agent_id })
  }

  let upto = 0
  let renewed = Date.now()
  const relay = async () => {
    const fresh = (await board.steers(task.id, claim)).filter((steer) => steer.seq > upto)
    for (const steer of fresh) await call(`/v1/agents/${agent}/subagents/${id}/messages`, { message: steer.body, priority: 'urgent' })
    const last = fresh.at(-1)
    if (!last) return
    const heeded = await board.heed(task.id, claim, last.seq)
    if (heeded.ok) upto = last.seq
    emit({ event: 'heeded', ok: heeded.ok, steers: fresh.map((steer) => steer.body), task: task.id })
  }

  const stop = new AbortController()
  const response = await fetch(`${gateway}/v1/agents/${agent}/events?after=0&live=1`, { headers: { accept: 'text/event-stream', authorization: 'Bearer ' + key, 'gateway-app': app }, signal: stop.signal })
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let status: Raw['status'] | undefined
  while (!status) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error('the event stream ended')
    buffer += chunk.value
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const lines = block.split('\n')
      const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data || lines.includes('event: live')) continue
      const update = (JSON.parse(data) as { event?: { update?: { id?: number; status?: Raw['status']; type?: string } } }).event?.update
      if (update?.id !== id) continue
      if (update.type === 'completion' || (update.type === 'status' && update.status && ended.has(update.status.state))) status = update.status
      else if (Date.now() - renewed >= leaseMs / 3) {
        await board.refresh()
        const kept = await board.renew(task.id, claim, leaseMs)
        if (!kept.ok) {
          stop.abort()
          emit({ event: 'lost', task: task.id })
          return
        }
        renewed = Date.now()
        emit({ event: 'renewed', task: task.id })
      }
      await relay()
    }
  }
  stop.abort()
  const outcome: Board.Outcome = status.state === 'completed' ? { done: JSON.stringify(status.output) } : { failed: status.error ?? status.state }
  for (let tries = 0; tries < 5; tries++) {
    await board.refresh()
    await relay()
    const finished = await board.finish(task.id, claim, outcome)
    if (finished.ok || finished.rejection.kind !== 'Steer') {
      emit({ event: 'finished', ok: finished.ok, outcome, task: task.id })
      return
    }
  }
}
