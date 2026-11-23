import { renderToReadableStream } from 'react-dom/server'
import { About } from './About.tsx'
import { App } from './App.tsx'
import { Docs } from './Docs.tsx'
import { Faq } from './Faq.tsx'
import { New } from './New.tsx'
import { preload } from './pages.ts'
import { Swarm } from './Swarm.tsx'
import { TreePage } from './TreePage.tsx'

preload('about', About)
preload('docs', Docs)
preload('faq', Faq)
preload('new', New)
preload('swarm', Swarm)
preload('tree', TreePage)

export async function render(signal: AbortSignal) {
  return renderToReadableStream(<App />, {
    onError(error) {
      console.error('Server render failed', error)
    },
    progressiveChunkSize: Number.POSITIVE_INFINITY,
    signal,
  })
}
