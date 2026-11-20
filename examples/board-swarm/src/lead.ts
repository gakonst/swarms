import * as child from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import * as util from 'node:util'
import { Sql } from 'nanocode-ts/node'
import { Board } from 'nanocode-ts'
import * as Swarm from './Swarm.ts'
import * as Work from './Work.ts'

const args = util.parseArgs({
  options: {
    dir: { type: 'string', default: path.join(import.meta.dirname, '..', 'output', 'run') },
    workers: { type: 'string', default: '3' },
    'lease-ms': { type: 'string', default: '1500' },
    'kill-after-ms': { type: 'string', default: '500' },
    'timeout-ms': { type: 'string', default: '60000' },
  },
}).values
const dir = path.resolve(args.dir)
const workers = Number(args.workers)
const leaseMs = Number(args['lease-ms'])
const killAfterMs = Number(args['kill-after-ms'])
const timeoutMs = Number(args['timeout-ms'])
const steerText = 'List only the top 5 words'

fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
const db = path.join(dir, 'board.db')
const sql = Sql.open(db)
const board = await Board.open({ sql, scope: Swarm.scope, actor: Swarm.actor('lead') })
// Opening a new board charters it for the lead; let every agent in the swarm work on it.
const granted = await board.grant({ who: [{ kind: 'kind', id: 'agent' }], can: { '*': ['manage'] } }, { key: 'swarm' })
if (!granted.ok) throw new Error(`the board refused the grant: ${JSON.stringify(granted.rejection)}`)
const startedAt = Date.now()
const events: Swarm.Event[] = []
const record = (event: Swarm.Fields) => events.push({ atMs: Date.now(), ...event })

const posted: Board.Verdict[] = [await board.post({ id: Swarm.root, spec: Work.goal, labels: { role: 'lead' } }, { key: Swarm.root })]
for (const step of Work.plan())
  posted.push(
    await board.post(
      { id: step.id, parent: Swarm.root, spec: Work.encode(step), labels: { role: 'work' }, needs: step.needs },
      { key: step.id },
    ),
  )
const refused = posted.filter((verdict) => !verdict.ok)
if (refused.length > 0) throw new Error(`the board refused the plan: ${JSON.stringify(refused)}`)
record({ worker: 'lead', event: 'posted', task: Swarm.root, tasks: Work.plan().length })

const held = await board.claim(Swarm.root, { leaseMs })
if (!held.ok) throw new Error(`the lead could not claim the goal: ${JSON.stringify(held.rejection)}`)
record({ worker: 'lead', event: 'claimed', task: Swarm.root })

type Process = { name: string; process: child.ChildProcess; exited: Promise<string> }
const processes: Process[] = Array.from({ length: workers }, (_, index) => spawn(`w${index + 1}`))
const holders = new Map<string, { worker: string; atMs: number }>()
let killed: { worker: string; task: string; atMs: number } | undefined
let steered: { task: string; text: string; seq: number; atMs: number } | undefined
const seen = new Map<string, string>()
let renewedAt = Date.now()

const ending = await (async (): Promise<Board.Outcome> => {
  for (;;) {
    await board.refresh()
    const tasks = await board.tasks()
    observe(tasks)

    if (Date.now() - renewedAt >= leaseMs / 3) {
      const renewed = await board.renew(Swarm.root, held.claim, leaseMs)
      if (!renewed.ok) throw new Error(`the lead lost the goal: ${JSON.stringify(renewed.rejection)}`)
      renewedAt = Date.now()
    }

    const slow = holders.get(Work.slow)
    if (!killed && slow && Date.now() - slow.atMs >= killAfterMs) {
      const target = processes.find((entry) => entry.name === slow.worker)
      target?.process.kill('SIGKILL')
      killed = { worker: slow.worker, task: Work.slow, atMs: Date.now() }
      record({ worker: 'lead', event: 'killed', task: Work.slow, target: slow.worker, signal: 'SIGKILL' })
    }

    if (!steered && holders.has(Work.steered)) {
      const verdict = await board.steer(Work.steered, steerText, { key: `steer-${Work.steered}` })
      if (!verdict.ok) throw new Error(`the board refused the steer: ${JSON.stringify(verdict)}`)
      steered = { task: Work.steered, text: steerText, seq: verdict.seq, atMs: Date.now() }
      record({ worker: 'lead', event: 'steered', task: Work.steered, text: steerText, seq: verdict.seq })
    }

    const children = tasks.filter((task) => task.parent === Swarm.root)
    if (children.length > 0 && children.every((task) => task.phase === 'done')) return { done: summarize(children) }
    const broken = children.find((task) => task.phase === 'failed' || task.phase === 'cancelled')
    if (broken) return { failed: `${broken.id} ${broken.phase}: ${Swarm.text(broken.outcome)}` }
    if (Date.now() - startedAt > timeoutMs) return { failed: `timed out after ${timeoutMs} ms` }
    await Swarm.sleep(100)
  }
})()

const finished = await board.finish(Swarm.root, held.claim, ending)
if (!finished.ok) throw new Error(`the lead could not finish the goal: ${JSON.stringify(finished)}`)
record({ worker: 'lead', event: 'finished', task: Swarm.root, outcome: ending })

const exits = await Promise.all(
  processes.map(async (entry) => ({
    name: entry.name,
    pid: entry.process.pid,
    exit: await Promise.race([entry.exited, Swarm.sleep(10_000).then(() => 'timeout')]),
  })),
)
for (const entry of processes) if (entry.process.exitCode === null && entry.process.signalCode === null) entry.process.kill('SIGKILL')

await board.refresh()
const tasks = await board.tasks()
observe(tasks)
const takeover = events.find(
  (event) => event.event === 'claimed' && event.task === Work.slow && event['tookOver'] === true,
)
const heeded = events.find(
  (event) =>
    event.event === 'heeded' &&
    event.task === Work.steered &&
    event['ok'] === true &&
    Number(event['upto']) >= (steered?.seq ?? Infinity),
)
const report = fs.existsSync(path.join(dir, 'report.md')) ? fs.readFileSync(path.join(dir, 'report.md'), 'utf8') : ''
const summary = {
  ok: false,
  goal: Work.goal,
  elapsedMs: Date.now() - startedAt,
  leaseMs,
  db,
  root: describe(tasks.find((task) => task.id === Swarm.root)),
  tasks: tasks.filter((task) => task.id !== Swarm.root).map(describe),
  allDone: tasks.length > 1 && tasks.every((task) => task.phase === 'done'),
  killed: killed ?? null,
  takeover: takeover
    ? { task: Work.slow, by: takeover.worker, tookOver: true, afterKillMs: killed ? takeover.atMs - killed.atMs : null }
    : null,
  steer: {
    task: Work.steered,
    text: steered?.text ?? null,
    seq: steered?.seq ?? null,
    heededBy: heeded?.worker ?? null,
    heededUpto: heeded ? Number(heeded['upto']) : null,
    finishedBy: Swarm.named(tasks.find((task) => task.id === Work.steered)?.worker),
    reportTop: Number(/# Top (\d+) words/.exec(report)?.[1] ?? 0),
  },
  workers: exits,
}
summary.ok =
  summary.allDone &&
  summary.takeover !== null &&
  summary.takeover.by !== killed?.worker &&
  summary.steer.heededBy !== null &&
  summary.steer.finishedBy === summary.steer.heededBy &&
  summary.steer.reportTop === 5
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
fs.writeFileSync(path.join(dir, 'timeline.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n')

console.log('timeline')
for (const event of events.toSorted((a, b) => a.atMs - b.atMs)) console.log(line(event))
console.log('')
console.log('summary')
console.log(JSON.stringify(summary, null, 2))
await board.close()
sql.close()
process.exitCode = summary.ok ? 0 : 1

function spawn(name: string): Process {
  const process = child.spawn(globalThis.process.execPath, [...globalThis.process.execArgv, path.join(import.meta.dirname, 'worker.ts')], {
    env: { ...globalThis.process.env, WORKER: name, BOARD_DB: db, BOARD_DIR: dir, LEASE_MS: String(leaseMs) },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  readline.createInterface({ input: process.stdout! }).on('line', (text) => {
    const event = (() => {
      try {
        return JSON.parse(text) as Swarm.Event
      } catch {
        return undefined
      }
    })()
    if (!event) return void console.log(`[${name}] ${text}`)
    events.push(event)
    if (event.event === 'claimed' && event.task) holders.set(event.task, { worker: event.worker, atMs: event.atMs })
  })
  const exited = new Promise<string>((resolve) =>
    process.on('exit', (code, signal) => resolve(signal ?? `code ${code}`)),
  )
  return { name, process, exited }
}

function observe(tasks: Board.Task[]) {
  for (const task of tasks) {
    const state = `${task.phase}|${task.stage}|${task.worker ?? ''}|${task.attempts}`
    if (seen.get(task.id) === state) continue
    seen.set(task.id, state)
    record({ worker: 'board', event: task.phase, task: task.id, stage: task.stage, holder: task.worker ?? null, attempts: task.attempts })
  }
}

function describe(task: Board.Task | undefined) {
  if (!task) return null
  return { id: task.id, phase: task.phase, by: Swarm.named(task.worker), attempts: task.attempts, outcome: Swarm.text(task.outcome) }
}

function summarize(children: Board.Task[]) {
  return `${children.length} tasks done: ${children.map((task) => `${task.id} (${Swarm.text(task.outcome)})`).join('; ')}`
}

function line(event: Swarm.Event) {
  const { atMs, worker, event: kind, task, ...rest } = event
  const at = `+${((atMs - startedAt) / 1000).toFixed(3)}s`.padStart(9)
  const extra = Object.entries(rest)
    .filter((entry) => entry[1] !== null && entry[1] !== undefined && entry[0] !== 'pid')
    .map((entry) => `${entry[0]}=${typeof entry[1] === 'string' ? entry[1] : JSON.stringify(entry[1])}`)
    .join(' ')
  return `${at}  ${worker.padEnd(5)}  ${kind.padEnd(9)}  ${(task ?? '').padEnd(8)}  ${extra}`
}
