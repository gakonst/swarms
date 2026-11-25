import type { IncomingMessage } from 'node:http'
import { type Context, Failure, hint, line, page, sleep, swarm, text as body } from '../context.ts'
import { entry } from './swarms.ts'

type Frame = { data: unknown; event: string; id: string | null }

function shown(frame: Frame): string | undefined {
  const data = frame.data as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return undefined
  if (data['type'] === 'entry' && data['entry']) return entry(data['entry'] as Parameters<typeof entry>[0])
  if (data['type'] === 'start') return '— the agent started working'
  if (data['type'] === 'idle' || data['type'] === 'end') return '— the agent is idle'
  const node = data['node'] as { status?: string; title?: string } | undefined
  if (node && typeof data['event'] === 'string') return `${data['event'].padEnd(9)} [${node.status ?? ''}] ${line(node.title ?? '', 100)}`
  return undefined
}

export async function watch(ctx: Context) {
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const limit = Number(ctx.flag('limit') ?? 0)
  const timeout = Number(ctx.flag('timeout') ?? 0)
  const stop = new AbortController()
  if (timeout > 0) setTimeout(() => stop.abort(), timeout * 1000)
  process.once('SIGINT', () => stop.abort())
  if (!ctx.json) ctx.say(`Watching ${page(ctx.host, { id })} live. Ctrl-C stops.`)
  let count = 0
  let after: string | undefined
  while (!stop.signal.aborted) {
    let response: IncomingMessage
    try {
      response = await ctx.request(`/v1/swarms/${encodeURIComponent(id)}/live${after ? `?after=${after}` : ''}`, { headers: { accept: 'text/event-stream' }, signal: stop.signal })
    } catch {
      if (stop.signal.aborted) break
      await sleep(1000)
      continue
    }
    const status = response.statusCode ?? 0
    if (status < 200 || status >= 300) {
      let problem: { code?: string; detail?: string } = {}
      try {
        problem = JSON.parse(await body(response)) as typeof problem
      } catch {}
      const code = problem.code ?? `http_${status}`
      throw new Failure(problem.detail ?? `The live stream answered ${status}.`, { code, next: hint(status, code), status })
    }
    response.setEncoding('utf8')
    let buffer = ''
    try {
      for await (const chunk of response) {
        buffer += chunk as string
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const lines = block.split(/\r?\n/)
          const text = lines.filter((each) => each.startsWith('data:')).map((each) => each.slice(5).trimStart()).join('\n')
          if (!text) continue
          const frame: Frame = { data: text, event: 'message', id: null }
          for (const each of lines) {
            if (each.startsWith('event:')) frame.event = each.slice(6).trim()
            if (each.startsWith('id:')) frame.id = each.slice(3).trim()
          }
          try {
            frame.data = JSON.parse(text)
          } catch {}
          if (frame.id && /^\d+$/.test(frame.id)) after = frame.id
          if (ctx.json) process.stdout.write(JSON.stringify(frame) + '\n')
          else {
            const said = shown(frame)
            if (said) process.stdout.write(said + '\n')
          }
          count += 1
          if (limit > 0 && count >= limit) stop.abort()
          if (stop.signal.aborted) break
        }
        if (stop.signal.aborted) break
      }
    } catch {}
    response.destroy()
    if (!stop.signal.aborted) await sleep(1000)
  }
  return 0
}
