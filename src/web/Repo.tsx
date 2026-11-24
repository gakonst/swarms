import { Suspense, useEffect } from 'react'
import type { Code as Repo } from '../shared/Api.ts'
import { page, preload } from './pages.ts'

const Lazy = page('code', () => import('./Code.tsx').then((module) => module.Code))

export function useWarmCode() {
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
    idle(() => void import('./Code.tsx').then((module) => preload('code', module.Code), () => {}))
  }, [])
}

export function Code(props: { repo: Repo | null; swarm: string }) {
  return (
    <Suspense fallback={null}>
      <Lazy {...props} />
    </Suspense>
  )
}
