import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

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
  const highlighter = by((id) => /highlighter\/backends\/shiki\.js$|shiki\/dist\/(core|engine-javascript|langs)\.mjs$|@shikijs\/langs\/dist\/markdown\.mjs$|@pierre\/theme\/dist\/pierre-light\.mjs$|@pierre\/theming\/dist\/themes\.js$/.test(id))
  const code = closure([...by((id) => id.endsWith('/src/web/Code.tsx')), ...highlighter])
  const repo = [...new Set([...page('Repo'), ...code])]
  const entry = closure(chunks.filter((chunk) => chunk.isEntry))
  return { code, entry, page, repo }
}

function preloads(): Plugin {
  return {
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return
      const { code, repo } = graph(bundle)
      this.emitFile({ fileName: 'preload.json', source: JSON.stringify({ code, repo }), type: 'asset' })
    },
    name: 'swarms-preloads',
    transformIndexHtml: {
      handler(html, context) {
        if (!context.bundle) return html
        const { entry, page, repo } = graph(context.bundle)
        const routes: [string, string[]][] = [
          ['^/s/[^/]+/?$', page('Swarm')],
          ['^/s/[^/]+/code/?$', repo],
          ['^/new/?$', page('New')],
          ['^/about/?$', page('About')],
          ['^/docs/?$', page('Docs')],
        ]
        const table = routes.map(([path, files]) => [path, files.filter((file) => !entry.includes(file))])
        return html.replace('<script type="module"', `<script>(()=>{for(const[p,f]of${JSON.stringify(table)})if(new RegExp(p).test(location.pathname)){for(const h of f){const l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href='/'+h;document.head.append(l)}break}})()</script>\n    <script type="module"`)
      },
      order: 'post',
    },
  }
}

export default defineConfig(({ command }) => {
  const gateway = command === 'serve' ? process.env['SWARMS_GATEWAY'] : undefined

  return {
    resolve: { alias: { '#ssr': fileURLToPath(new URL('./src/web/server.tsx', import.meta.url)) } },
    environments: {
      client: { build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'hash', test: /\/viem\/_esm\/utils\/(hash\/keccak256|encoding\/toHex)\.js$/ }] } } } } },
      swarms: { build: { minify: true } },
    },
    server: { allowedHosts: ['terminal.local'] },
    plugins: [
      react(),
      preloads(),
      cloudflare({
        ...(process.env['SWARMS_STATE'] ? { persistState: { path: process.env['SWARMS_STATE'] } } : {}),
        ...(command === 'serve'
          ? {
              config: (config) => {
                config.services = []
                if (!gateway) return
                config.vars = { ...config.vars, GATEWAY_URL: gateway }
                config.compatibility_flags = (config.compatibility_flags ?? []).filter(
                  (flag) => flag !== 'global_fetch_strictly_public',
                )
              },
            }
          : {}),
      }),
    ],
  }
})
