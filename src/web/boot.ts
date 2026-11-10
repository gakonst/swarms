import type { Boot } from '../shared/Boot.ts'
import * as Site from '../shared/Site.ts'

export type { Boot, Face } from '../shared/Boot.ts'

export const server = typeof window === 'undefined'

export function boot(): Boot | undefined {
  return server ? globalThis.__swarmsServer?.boot() : globalThis.__SWARMS_BOOT__
}

export function here(): URL {
  if (server) return new URL(boot()?.url ?? 'http://localhost/')
  const url = new URL(location.href)
  url.pathname = Site.strip(url.pathname)
  return url
}

export function site() {
  return boot()?.site ?? (server ? Site.base : location.origin + Site.base)
}

export function seeded<T>(key: string): T | undefined {
  return boot()?.data[key] as T | undefined
}

export const faceCookie = 'swarms_face'
