import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  const gateway = command === 'serve' ? process.env['SWARMS_GATEWAY'] : undefined

  return {
    server: { allowedHosts: ['terminal.local'] },
    plugins: [
      react(),
      cloudflare({
        ...(process.env['SWARMS_STATE'] ? { persistState: { path: process.env['SWARMS_STATE'] } } : {}),
        ...(gateway
          ? {
              config: (config) => {
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
