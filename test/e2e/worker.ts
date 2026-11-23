import { registerHooks } from 'node:module'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }' } : next(specifier, context),
})

export const Gateway = await import('../../src/worker/Gateway.ts')

export const Credit = await import('../../src/shared/Credit.ts')

export function env(gateway: { key: string; url: string }) {
  return { GATEWAY_URL: gateway.url, SWARMS_GATEWAY_KEY: gateway.key } as unknown as Cloudflare.Env
}

export type Frame = { data: Record<string, unknown>; live: boolean }

export async function frames(response: Response, until: (frame: Frame, all: Frame[]) => boolean, ms = 10_000) {
  const all: Frame[] = []
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  const timer = setTimeout(() => void reader.cancel(), ms)
  let buffer = ''
  try {
    for (;;) {
      const read = await reader.read()
      if (read.done) return all
      buffer += read.value
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const lines = block.split('\n')
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        const frame = { data: JSON.parse(data) as Record<string, unknown>, live: lines.includes('event: live') }
        all.push(frame)
        if (until(frame, all)) {
          void reader.cancel().catch(() => undefined)
          return all
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function eventually<value>(read: () => Promise<value | undefined> | value | undefined, ms = 10_000, every = 50): Promise<value> {
  const until = Date.now() + ms
  for (;;) {
    const value = await read()
    if (value !== undefined && value !== false) return value
    if (Date.now() > until) throw new Error('timed out after ' + ms + ' ms')
    await new Promise((resolve) => setTimeout(resolve, every))
  }
}
