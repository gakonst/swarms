import { type ComponentType, lazy } from 'react'

const loaded = new Map<string, unknown>()

export function page<P extends object>(name: string, load: () => Promise<ComponentType<P>>) {
  const lazied = lazy(async () => {
    const component = await load().catch((error: unknown) => {
      const key = `reloaded:${location.pathname}`
      if (sessionStorage.getItem(key)) throw error
      sessionStorage.setItem(key, '1')
      location.reload()
      return new Promise<never>(() => {})
    })
    loaded.set(name, component)
    return { default: component }
  })
  return function Page(props: P) {
    const Shown = (loaded.get(name) as ComponentType<P> | undefined) ?? lazied
    return <Shown {...props} />
  }
}

export function preload(name: string, component: unknown) {
  loaded.set(name, component)
}
