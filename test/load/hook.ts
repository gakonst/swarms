import { registerHooks } from 'node:module'

registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === 'cloudflare:workers')
      return { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }' }
    if (specifier === './Host.ts' && context.parentURL?.endsWith('/src/worker/Swarm.ts')) return { shortCircuit: true, url: new URL('./host.ts', import.meta.url).href }
    return next(specifier, context)
  },
})
