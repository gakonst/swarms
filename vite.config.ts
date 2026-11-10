import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
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
          [`^${base}/s/[^/]+(/chat|/code|/results)?/?$`, page('Swarm')],
          [`^${base}/new/?$`, page('New')],
          [`^${base}/about/?$`, page('About')],
          [`^${base}/docs/?$`, page('Docs')],
        ]
        const table = routes.map(([path, files]) => [path, files.filter((file) => !entry.includes(file))])
        return html.replace('<script type="module"', `<script>(()=>{for(const[p,f]of${JSON.stringify(table)})if(new RegExp(p).test(location.pathname)){for(const h of f){const l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href='${base}/'+h;document.head.append(l)}break}})()</script>\n    <script type="module"`)
      },
      order: 'post',
    },
  }
}

export default defineConfig(({ command }) => {
  const gateway = command === 'serve' ? process.env['SWARMS_GATEWAY'] : undefined

  return {
    experimental: { renderBuiltUrl: (file: string) => `${base}/${file}` },
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
