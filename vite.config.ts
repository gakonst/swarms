import { cloudflare, type WorkerConfig } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { reserved } from './src/shared/Nickname.ts'
import { base } from './src/shared/Site.ts'

type Bundle = Parameters<NonNullable<Extract<Plugin['generateBundle'], Function>>>[1]

function graph(bundle: Bundle) {
  const chunks = Object.values(bundle).filter((item) => item.type === 'chunk')
  const by = (test: (id: string) => boolean) => chunks.filter((chunk) => chunk.facadeModuleId && test(chunk.facadeModuleId))
  const closure = (roots: typeof chunks) => {
    const files = new Set<string>()
    const walk = (file: string) => {
      if (files.has(file)) return
      files.add(file)
      for (const next of chunks.find((chunk) => chunk.fileName === file)?.imports ?? []) walk(next)
    }
    for (const root of roots) walk(root.fileName)
    return [...files]
  }
  const page = (name: string) => closure(by((id) => id.endsWith(`/src/web/${name}.tsx`)))
  const entry = closure(chunks.filter((chunk) => chunk.isEntry))
  return { entry, page }
}

function preloads(): Plugin {
  return {
    name: 'swarms-preloads',
    transformIndexHtml: {
      handler(html, context) {
        if (!context.bundle) return html
        const { entry, page } = graph(context.bundle)
        const routes: [string, string[]][] = [
          [`^(?:${base})?/s/[^/]+(/chat|/code|/results|/n/[^/]+)?/?$`, [...page('Swarm'), ...page('TreePage')]],
          [`^(?:${base})?/new/?$`, page('New')],
          [`^(?:${base})?/about/?$`, page('About')],
          [`^(?:${base})?/docs/?$`, page('Docs')],
          [`^(?:${base})?/(?!(?:${[...reserved].join('|')})(?:/|$))[a-z0-9][a-z0-9-]{1,38}[a-z0-9](/chat|/code|/results|/n/[^/]+)?/?$`, [...page('Swarm'), ...page('TreePage')]],
        ]
        const table = routes.map(([path, files]) => [path, files.filter((file) => !entry.includes(file))])
        return html.replace('<script type="module"', `<script>(()=>{for(const[p,f]of${JSON.stringify(table)})if(new RegExp(p).test(location.pathname)){for(const h of f){const l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href='${base}/'+h;document.head.append(l)}break}})()</script>\n    <script type="module"`)
      },
      order: 'post',
    },
  }
}

function unhighlighted(): Plugin {
  const stub = fileURLToPath(new URL('./src/worker/Languages.ts', import.meta.url))
  const absent = fileURLToPath(new URL('./src/worker/Absent.ts', import.meta.url))
  const unused = (id: string, importer = '') =>
    ['shiki/wasm', 'shiki/engine/oniguruma', 'shiki/engine/javascript', '@pierre/theming/themes'].includes(id) || id.startsWith('@shikijs/themes/') || (id === './fixtures.ts' && importer.includes('/src/web/'))
  return {
    applyToEnvironment: (environment) => environment.name === 'swarms' || environment.name === 'swarms_site',
    enforce: 'pre',
    name: 'swarms-unhighlighted',
    resolveId: (id, importer) => (id === 'shiki/langs' ? stub : unused(id, importer) ? absent : undefined),
  }
}

export default defineConfig(({ command }) => {
  const gateway = command === 'serve' ? process.env['SWARMS_GATEWAY'] : undefined
  const passed = ['GITHUB_API', 'SWARMS_GITHUB_TOKEN', 'SWARMS_GITHUB_WEBHOOK_SECRET', 'SWARMS_PROOFS_REPO', 'SWARMS_SPAWN', 'SWARMS_LEASE_MS', 'SWARMS_TRIAGE_MS'].flatMap((name) => (process.env[name] ? [[name, process.env[name]] as const] : []))

  const local = (config: WorkerConfig) => {
    config.services = config.services?.filter((service) => service.binding !== 'GATEWAY')
    if (passed.length) config.vars = { ...config.vars, ...Object.fromEntries(passed) }
    if (!gateway) return
    config.vars = { ...config.vars, GATEWAY_URL: gateway }
    config.compatibility_flags = (config.compatibility_flags ?? []).filter(
      (flag) => flag !== 'global_fetch_strictly_public',
    )
  }

  return {
    experimental: { renderBuiltUrl: (file: string) => `${base}/${file}` },
    resolve: { alias: { '#ssr': fileURLToPath(new URL('./src/web/server.tsx', import.meta.url)) } },
    environments: {
      client: { build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'hash', test: /\/viem\/_esm\/utils\/(hash\/keccak256|encoding\/toHex)\.js$/ }] } } } } },
      swarms: { build: { minify: true } },
      swarms_site: { build: { minify: true } },
    },
    server: { allowedHosts: ['terminal.local', 'swarms.new', 'www.swarms.new'], cors: { origin: '*' } },
    plugins: [
      react(),
      preloads(),
      unhighlighted(),
      cloudflare({
        auxiliaryWorkers: [{ configPath: './wrangler.jsonc', ...(command === 'serve' ? { config: local } : {}) }],
        configPath: './wrangler.site.jsonc',
        ...(process.env['SWARMS_STATE'] ? { persistState: { path: process.env['SWARMS_STATE'] } } : {}),
        ...(command === 'serve'
          ? {
              config: local,
            }
          : {}),
      }),
    ],
  }
})
