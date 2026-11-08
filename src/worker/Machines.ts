import { waitUntil } from 'cloudflare:workers'
import { z } from 'zod'
import * as Fleet from '../shared/Fleet.ts'
import { output, redact, result, tool } from '../shared/Trail.ts'
import * as Gateway from './Gateway.ts'
import * as Problem from './Problem.ts'
import * as Runs from './Runs.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'
import * as Timing from './Timing.ts'

const id = z.string().trim().min(1).max(64).describe('The swarm id, the last part of its page URL /s/<id>.')

const machine = z.string().trim().min(1).max(160).describe("A machine's name, as GET /v1/swarms/:id/machines lists it (a sandbox's name or id, a browser or a lent hand).")

const seq = z.coerce.number().int().min(1).describe("A command's seq, as the command listing gives it.")

export const schema = {
  command: z.object({ machine, seq, swarm: id }),
  commands: z.object({
    cursor: z.coerce.number().int().min(0).optional().describe("The previous page's next, to read the page after it."),
    limit: z.coerce.number().int().min(1).max(Runs.page.most).default(Runs.page.standard).describe(`At most this many commands, up to ${Runs.page.most}.`),
    machine,
    order: z.enum(['newest', 'oldest']).default('newest').describe('newest first (the default) or oldest first.'),
    swarm: id,
  }),
  export: z.object({ machine: machine.optional().describe('Only this machine; without it, every machine of the swarm.'), swarm: id }),
  job: z.object({ machine, seq: seq.describe("The seq of a compute_spawn command, whose job log to read."), swarm: id }),
  logs: z.object({
    before: z
      .string()
      .regex(/^\d{1,16}\.\d{1,16}$/)
      .optional()
      .describe("The previous page's next, to read the older lines."),
    limit: z.coerce.number().int().min(1).max(5_000).default(1_000).describe('At most this many lines, newest last.'),
    machine,
    sandbox: z.string().trim().max(64).optional().describe('One of the sandbox ids the answer lists, when the name was reused by more than one sandbox; the newest by default.'),
    stream: z.enum(['system', 'stdout', 'stderr']).optional().describe('Only lines of this stream.'),
    swarm: id,
  }),
}

type Input<name extends keyof typeof schema> = { [key in keyof z.input<(typeof schema)[name]>]?: unknown }

function parse<parser extends z.ZodType>(parser: parser, input: unknown): Problem.Result<z.output<parser>> {
  const parsed = parser.safeParse(input)
  return parsed.success ? Problem.ok(parsed.data) : Problem.invalid(parsed.error)
}

function stub(env: Cloudflare.Env, swarm: string): DurableObjectStub<Swarm> {
  return Timing.object(env.SWARMS.get(env.SWARMS.idFromName(swarm)))
}

function missing() {
  return Problem.fail(404, 'not_found', 'No swarm has this id.')
}

export type Full = { ms: number | null; output: string }

export type Command = Fleet.Shown

const keptSeconds = 30 * 86_400

function key(env: Cloudflare.Env, swarm: string, agent: string, event: number) {
  return new Request(new URL(`/__cache/full/${swarm}/${agent}/${event}`, env.SWARMS_URL))
}

function named(text: string) {
  return /^Called (\S+)/.exec(text)?.[1] ?? (text.startsWith('$ ') ? 'exec_command' : '')
}

function full(event: Gateway.Event | undefined, expected: string): Full | undefined {
  const outer = event?.event
  const inner = outer?.source === 'subagent' ? (outer.update as { event?: { payload?: Record<string, unknown>; type?: string } } | undefined)?.event : outer?.event
  if (inner?.type !== 'tool.result') return undefined
  const payload = inner.payload ?? {}
  const name = tool(payload)
  if (expected && name !== expected) return undefined
  const text = output(payload['result']).trim()
  const body = payload['status'] === 'completed' ? result(name, text).body : text
  return { ms: typeof payload['duration_ns'] === 'number' ? Math.round(payload['duration_ns'] / 1e6) : null, output: redact(body) }
}

async function fulls(env: Cloudflare.Env, swarm: string, agent: string, wanted: { event: number; tool: string }[]): Promise<Map<number, Full>> {
  const found = new Map<number, Full>()
  const left = [...new Map(wanted.map((item) => [item.event, item])).values()].sort((a, b) => a.event - b.event)
  const hits = await Promise.all(left.map((item) => caches.default.match(key(env, swarm, agent, item.event)).then((hit) => (hit ? (hit.json() as Promise<Full>) : undefined)).catch(() => undefined)))
  const missed = left.filter((item, index) => {
    const hit = hits[index]
    if (hit) found.set(item.event, hit)
    return !hit
  })
  const groups: (typeof missed)[] = []
  for (const item of missed) {
    const group = groups.at(-1)
    if (group?.[0] && item.event - group[0].event < 128) group.push(item)
    else groups.push([item])
  }
  await pooled(groups, async (group) => {
        const first = group[0]
        const last = group.at(-1)
        if (!first || !last) return
        const read = await Gateway.event(env, swarm, agent, first.event, Math.min(128, last.event - first.event + 1)).catch(() => undefined)
        if (!read?.ok) return
        for (const item of group) {
          const kept = full(
            read.value.events.find((event) => event.seq === item.event),
            item.tool,
          )
          if (!kept) continue
          found.set(item.event, kept)
          await caches.default.put(key(env, swarm, agent, item.event), Response.json(kept, { headers: { 'cache-control': `public, max-age=${keptSeconds}` } })).catch(() => undefined)
        }
  })
  return found
}

async function completed(env: Cloudflare.Env, swarm: string, opened: { agent: string | null; commands: Runs.Opened[] }, gateway: boolean): Promise<Command[]> {
  const needs = (run: Runs.Opened) => run.event !== null && (run.clipped || (gateway && run.ms === null))
  const asked = opened.agent ? opened.commands.filter(needs).map((run) => ({ event: run.event ?? 0, tool: named(run.tool) })) : []
  const found = opened.agent && asked.length ? await fulls(env, swarm, opened.agent, asked) : new Map<number, Full>()
  return opened.commands.map((run) => {
    const fuller = run.event === null ? undefined : found.get(run.event)
    const { call: _call, event: _event, tool: _tool, ...rest } = run
    return {
      ...rest,
      full: !!fuller || !run.clipped,
      ms: fuller?.ms ?? run.ms,
      output: fuller ? fuller.output : run.output,
      source: fuller ? 'gateway' : 'feed',
      truncated: !fuller && run.clipped,
    }
  })
}

export async function commands(env: Cloudflare.Env, input: Input<'commands'>) {
  const parsed = parse(schema.commands, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()
  const page = await stub(env, query.swarm).commands(query.machine, { cursor: query.cursor, limit: query.limit, order: query.order })
  return Problem.ok({ ...page, commands: page.commands.map(({ event: _event, ...run }) => run), machine: query.machine, order: query.order })
}

export async function command(env: Cloudflare.Env, input: Input<'command'>): Promise<Problem.Result<Command>> {
  const parsed = parse(schema.command, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()
  const object = stub(env, query.swarm)
  const opened = await object.opened(query.machine, [query.seq])
  const [found] = await completed(env, query.swarm, opened as unknown as { agent: string | null; commands: Runs.Opened[] }, true)
  if (!found) return Problem.fail(404, 'not_found', 'This machine has no command with this seq.')
  const before = opened.commands[0]?.ms ?? null
  if (found.ms !== null && found.ms !== before) await object.timed(found.seq, found.ms)
  return Problem.ok(found)
}

export async function logs(env: Cloudflare.Env, input: Input<'logs'>) {
  const parsed = parse(schema.logs, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()
  const logged = await stub(env, query.swarm).machineLogs(query.swarm, query.machine, { before: query.before, limit: query.limit, sandbox: query.sandbox, stream: query.stream })
  if (!logged.sandbox) return Problem.fail(404, 'not_found', 'This machine is not a sandbox, so the gateway keeps no log of it; its commands are in its command listing.')
  return Problem.ok({ ...logged, machine: query.machine })
}

export async function job(env: Cloudflare.Env, input: Input<'job'>) {
  const parsed = parse(schema.job, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()
  const found = await stub(env, query.swarm).job(query.swarm, query.machine, query.seq)
  if (!found) return Problem.fail(404, 'not_found', 'This machine has no compute_spawn command with this seq and a log path.')
  return Problem.ok({ ...found, machine: query.machine })
}

const exportPage = 200

const pool = 6

async function pooled<item, value>(items: readonly item[], run: (item: item) => Promise<value>): Promise<value[]> {
  const results: value[] = []
  for (let start = 0; start < items.length; start += pool) results.push(...(await Promise.all(items.slice(start, start + pool).map(run))))
  return results
}

export async function exported(env: Cloudflare.Env, input: Input<'export'>): Promise<Problem.Result<Response>> {
  const parsed = parse(schema.export, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()
  const object = stub(env, query.swarm)
  const listed = (await object.fleet()) as unknown as Fleet.Machine[]
  const machines = query.machine ? listed.filter((item) => item.name === query.machine) : listed
  if (query.machine && !machines.length) return Problem.fail(404, 'not_found', 'This swarm has no machine with this name.')
  const encoder = new TextEncoder()
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const send = (line: unknown) => writer.write(encoder.encode(JSON.stringify(line) + '\n'))
  const work = async () => {
    await send({ at: Date.now(), machine: query.machine ?? null, swarm: query.swarm, type: 'export' })
    for (const item of machines) {
      const { commands: _commands, ...shown } = item
      await send({ ...shown, type: 'machine' })
      let cursor: number | undefined
      for (;;) {
        const page = await object.commands(item.name, { cursor, limit: exportPage, order: 'oldest' })
        const opened = await object.opened(
          item.name,
          page.commands.map((run) => run.seq),
        )
        for (const run of await completed(env, query.swarm, opened as unknown as { agent: string | null; commands: Runs.Opened[] }, false)) await send({ ...run, type: 'command' })
        if (page.next === null) break
        cursor = page.next
      }
      const logged = await pooled(item.sandboxes, async (sandbox) => {
        const chunks: Fleet.Logged[] = []
        let before: string | undefined
        for (;;) {
          const found = await object.machineLogs(query.swarm, item.name, { before, limit: 5_000, sandbox })
          chunks.push(found)
          if (!found.next) return chunks
          before = found.next
        }
      })
      for (const [index, chunks] of logged.entries()) {
        const sandbox = item.sandboxes[index] ?? ''
        const head = chunks[0]
        await send({ complete: head?.complete ?? false, error: head?.error ?? null, fetchedAt: head?.fetchedAt ?? null, machine: item.name, sandbox, type: 'logs' })
        for (const chunk of [...chunks].reverse()) for (const line of chunk.lines) await send({ at: line.at, machine: item.name, sandbox, stream: line.stream, text: line.text, type: 'log' })
      }
      let jobs: number | undefined
      for (;;) {
        const page = await object.commands(item.name, { cursor: jobs, limit: Runs.page.most, order: 'oldest' })
        const found = await pooled(
          page.commands.filter((run) => run.log),
          (run) => object.job(query.swarm, item.name, run.seq),
        )
        for (const job of found) if (job) await send({ ...job, machine: item.name, type: 'job' })
        if (page.next === null) break
        jobs = page.next
      }
    }
    await send({ type: 'end' })
  }
  const done = work()
    .catch((error: unknown) => send({ detail: error instanceof Error ? error.message : String(error), type: 'error' }))
    .finally(() => writer.close().catch(() => undefined))
  waitUntil(done)
  const name = `swarm-${query.swarm}${query.machine ? `-${query.machine.replace(/[^A-Za-z0-9._-]/g, '_')}` : ''}-machines.ndjson`
  return Problem.ok(
    new Response(stream.readable, {
      headers: { 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${name}"`, 'content-type': 'application/x-ndjson; charset=utf-8' },
    }),
  )
}
