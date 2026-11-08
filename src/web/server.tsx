import { renderToReadableStream } from 'react-dom/server'
import { About } from './About.tsx'
import { App } from './App.tsx'
import { Docs } from './Docs.tsx'
import { New } from './New.tsx'
import { preload } from './pages.tsx'
import { Swarm } from './Swarm.tsx'

preload('about', About)
preload('docs', Docs)
preload('new', New)
preload('swarm', Swarm)

export async function render(signal: AbortSignal) {
  return renderToReadableStream(<App />, {
    onError(error) {
      console.error('Server render failed', error)
    },
    progressiveChunkSize: Number.POSITIVE_INFINITY,
    signal,
  })
}
