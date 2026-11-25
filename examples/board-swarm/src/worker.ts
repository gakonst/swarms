import { Sql } from 'nanocode-ts/node'
import { Board } from 'nanocode-ts'
import * as Agent from './Agent.ts'
import * as Swarm from './Swarm.ts'
import * as Work from './Work.ts'

const worker = Swarm.env('WORKER')
const dir = Swarm.env('BOARD_DIR')
const leaseMs = Number(Swarm.env('LEASE_MS'))
const tickMs = Number(process.env['TICK_MS'] ?? 100)
const sql = Sql.open(Swarm.env('BOARD_DB'))
const board = await Board.open({ sql, scope: Swarm.scope, actor: Swarm.actor(worker), module: await Swarm.board() })
const lane = Number(worker.replace(/\D/g, '')) || 0

type Lease = { claim: string; untilMs: number; tookOver: boolean }

Swarm.emit({ worker, event: 'started', pid: process.pid })

let turn = lane
for (;;) {
  await board.refresh()
  const goal = await board.task(Swarm.root)
  if (!goal || Swarm.terminal(goal.phase)) break

  const ready = await board.ready({ label: ['role', 'work'] })
  const task = ready[turn++ % Math.max(ready.length, 1)]
  if (!task) {
    await Swarm.sleep(tickMs)
    continue
  }

  const lease = await board.claim(task.id, { leaseMs })
  if (!lease.ok) {
    Swarm.emit({ worker, event: 'missed', task: task.id, rejection: lease.rejection.kind })
    continue
  }

  Swarm.emit({ worker, event: 'claimed', task: task.id, tookOver: lease.tookOver, untilMs: lease.untilMs, attempts: task.attempts })
  await perform(task, lease)
}

Swarm.emit({ worker, event: 'exited' })
await board.close()
sql.close()

async function perform(task: Board.Task, lease: Lease) {
  let spec = Work.decode(task.spec)
  const heard: string[] = []
  let upto = 0
  let renewedAt = Date.now()

  // Applies steers the worker has not heeded yet and heeds them, so finish is not refused.
  const listen = async () => {
    const fresh = (await board.steers(task.id, lease.claim)).filter((steer) => steer.seq > upto)
    const last = fresh.at(-1)
    if (!last) return true
    for (const steer of fresh) {
      spec = Work.heed(spec, steer.body)
      heard.push(steer.body)
    }
    const heeded = await board.heed(task.id, lease.claim, last.seq)
    if (heeded.ok) upto = last.seq
    Swarm.emit({ worker, event: 'heeded', task: task.id, steers: fresh.map((steer) => steer.body), upto: last.seq, ok: heeded.ok })
    return heeded.ok
  }

  const until = Date.now() + spec.ms
  while (Date.now() < until) {
    await Swarm.sleep(tickMs)
    await board.refresh()

    if (Date.now() - renewedAt >= leaseMs / 3) {
      const renewed = await board.renew(task.id, lease.claim, leaseMs)
      if (!renewed.ok) {
        Swarm.emit({ worker, event: 'lost', task: task.id, rejection: renewed.rejection.kind })
        return
      }
      renewedAt = Date.now()
      Swarm.emit({ worker, event: 'renewed', task: task.id })
    }

    if (!(await listen())) return
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await board.refresh()
    if (!(await listen())) return
    const outcome = await execute(task, spec, heard)
    const finished = await board.finish(task.id, lease.claim, outcome)
    if (finished.ok || finished.rejection.kind !== 'Steer') {
      Swarm.emit({ worker, event: 'finished', task: task.id, outcome, ok: finished.ok, ...(finished.ok ? {} : { rejection: finished.rejection.kind }) })
      return
    }
  }
}

async function execute(task: Board.Task, spec: Work.Spec, heard: string[]): Promise<Board.Outcome> {
  try {
    const done = Work.run(spec, { dir, steers: heard })
    const note = await Agent.note({ task: task.id, spec: task.spec, done })
    return { done: note === undefined ? done : `${done}; agent: ${note}` }
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) }
  }
}
