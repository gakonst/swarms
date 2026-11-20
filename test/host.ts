import { registerHooks } from 'node:module'

// The Worker's Host.ts bundles the board's wasm and opens it over the Durable
// Object's storage; under node, Swarm.ts opens its boards through board.ts.
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === './Host.ts' && context.parentURL?.endsWith('/src/worker/Swarm.ts') ? { shortCircuit: true, url: new URL('./board.ts', import.meta.url).href } : next(specifier, context),
})
