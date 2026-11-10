import { type ComponentType, createElement, lazy } from 'react'

const loaded = new Map<string, unknown>()

function reloaded(name: string) {
  return `reloaded:${name}`
}

export function fresh<T>(name: string, load: () => Promise<T>) {
  return load().catch((error: unknown) => {
    if (sessionStorage.getItem(reloaded(name))) throw error
    sessionStorage.setItem(reloaded(name), '1')
    location.reload()
    return new Promise<never>(() => {})
  })
}

export function page<P extends object>(name: string, load: () => Promise<ComponentType<P>>) {
  const lazied = lazy(async () => {
    const component = await fresh(name, load)
    preload(name, component)
    return { default: component }
  })
  return function Page(props: P) {
    return createElement((loaded.get(name) as ComponentType<P> | undefined) ?? lazied, props)
  }
}

export function preload(name: string, component: unknown) {
  loaded.set(name, component)
  try {
    sessionStorage.removeItem(reloaded(name))
  } catch {}
}
