import { createRoot, hydrateRoot } from 'react-dom/client'
import * as Site from '../shared/Site.ts'
import { App } from './App.tsx'
import { preload } from './pages.ts'
import './style.css'
import './research.css'
import './room.css'
import './ideas.css'
import './reins.css'

function fit() {
  document.documentElement.style.setProperty('--screen', `${Math.round(visualViewport?.height ?? innerHeight)}px`)
  if (scrollY) scrollTo(0, 0)
}

fit()
visualViewport?.addEventListener('resize', fit)
visualViewport?.addEventListener('scroll', fit)
addEventListener('resize', fit)

document.cookie = `swarms_tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}; path=/; max-age=31536000; samesite=lax`

const path = Site.strip(location.pathname)
const route = /^\/s\/[^/]+(\/chat|\/code|\/results)?\/?$/.test(path)
  ? import('./Swarm.tsx').then((module) => preload('swarm', module.Swarm))
  : path === '/new'
      ? import('./New.tsx').then((module) => preload('new', module.New))
      : path === '/about'
        ? import('./About.tsx').then((module) => preload('about', module.About))
        : path === '/docs'
          ? import('./Docs.tsx').then((module) => preload('docs', module.Docs))
          : undefined
const root = document.getElementById('root')!

if (root.firstChild && globalThis.__SWARMS_BOOT__) void Promise.resolve(route).catch(() => {}).then(() => hydrateRoot(root, <App />, { onRecoverableError: (error) => console.warn('Hydration', error) }))
else createRoot(root).render(<App />)
