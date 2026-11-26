import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Named } from '../shared/Api.ts'
import * as Api from './api.ts'
import { boot, server } from './boot.ts'
import * as Limits from '../shared/Limits.ts'
import { Capped } from './capped.ts'

const names = new Capped<string, Named | null>(Limits.WebCache.namesMost)

const listeners = new Set<() => void>()

function watch(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function keep(name: string, found: Named | null) {
  names.set(name, found)
  for (const listener of listeners) listener()
}

export function known(name: string): Named | null | undefined {
  if (!server && names.has(name)) return names.get(name)
  const data = boot()?.data
  return data && `name:${name}` in data ? (data[`name:${name}`] as Named | null) : undefined
}

export async function warm(name: string) {
  const held = known(name)
  if (held !== undefined) return held
  const found = await Api.named(name)
  keep(name, found)
  return found
}

export function useNamed(name: string | undefined): Named | null | undefined | 'failed' {
  const found = useSyncExternalStore(watch, () => (name === undefined ? undefined : known(name)), () => (name === undefined ? undefined : known(name)))
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    if (name === undefined || known(name) !== undefined) return
    let alive = true
    warm(name).catch(() => alive && setFailed(name))
    return () => {
      alive = false
    }
  }, [name])
  return name !== undefined && failed === name && found === undefined ? 'failed' : found
}
