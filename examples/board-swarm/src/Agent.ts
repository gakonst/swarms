import { AgentRuntime, Contracts } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/node'
import * as Swarm from './Swarm.ts'

const scope = 'board-swarm-agent'

export async function note(options: note.Options): Promise<string | undefined> {
  const key = process.env['ANTHROPIC_API_KEY']
  if (!key || options.task !== 'report') return undefined

  const module = await Swarm.module()
  const sql = Sql.open(':memory:')
  const runtime = await AgentRuntime.instantiate(module, sql, { published: () => {} })
  const model = process.env['ANTHROPIC_MODEL']
  await runtime.open(
    {
      scope,
      session_id: Contracts.sessionUuid(),
      provider: 'claude',
      ...(model ? { model } : {}),
      subscription: false,
      endpoint: 'https://api.anthropic.com/v1/messages',
      event_coalesce_ms: 0,
      tools: [],
    },
    {
      dispatch: (request) =>
        fetch(request.endpoint, {
          method: 'POST',
          headers: [...request.headers, ['x-api-key', key], ['anthropic-version', '2023-06-01']],
          body: request.body as Uint8Array<ArrayBuffer>,
        }),
    },
  )

  const requestId = `note-${options.task}`
  const prompt = `A worker on a task board finished the task "${options.task}" (${options.spec}) with: ${options.done}. Reply with one sentence a reader of the report should know. Do not run any tools.`
  await runtime.submit(scope, { request_id: requestId, prompt, metadata: {} })
  for (;;) {
    const next = (await runtime.pending(scope))[0]
    if (!next) break
    const driven = await runtime.drive(next.report.request_id)
    if (driven.retry) throw new Error('the agent turn needs recovery')
    if (driven.waiting) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  while (!(await runtime.settle())) await new Promise((resolve) => setTimeout(resolve, 10))

  const report = (await runtime.turn(scope, requestId))?.report
  await runtime.dispose()
  sql.close()
  if (report?.status !== 'completed') throw new Error(`the agent turn ended ${report?.status ?? 'without a report'}`)
  return said(report) ?? 'completed'
}

function said(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  for (const field of ['text', 'final', 'answer', 'message']) {
    const found = record[field]
    if (typeof found === 'string' && found.trim()) return found.trim()
  }
  for (const nested of Object.values(record)) {
    const found = said(nested)
    if (found) return found
  }
  return undefined
}

export declare namespace note {
  type Options = { task: string; spec: string; done: string }
}
