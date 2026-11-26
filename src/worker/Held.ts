import { assert } from '../shared/Assert.ts'
import * as Limits from '../shared/Limits.ts'

export const limits: Record<keyof typeof Limits.Held, Limit> = Limits.Held

export type Limit = { entries: number; ms: number }

type Entry<V> = { at: number; value: V }

export class Held<V> {
  readonly #items = new Map<string, Entry<V>>()

  readonly limit: Limit

  constructor(limit: Limit) {
    assert(Number.isSafeInteger(limit.entries) && limit.entries > 0, 'a held cache has a positive whole number of entries')
    assert(Number.isSafeInteger(limit.ms) && limit.ms > 0, 'a held cache has a positive whole lifetime in ms')
    this.limit = limit
  }

  get size() {
    return this.#items.size
  }

  entry(key: string, now = Date.now()): Entry<V> | undefined {
    const item = this.#items.get(key)
    if (!item) return undefined
    if (now - item.at < this.limit.ms) return item
    this.#items.delete(key)
    return undefined
  }

  get(key: string, now = Date.now()): V | undefined {
    return this.entry(key, now)?.value
  }

  has(key: string, now = Date.now()) {
    return this.entry(key, now) !== undefined
  }

  set(key: string, value: V, at = Date.now()) {
    assert(!(value instanceof Promise) && typeof (value as { then?: unknown } | null)?.then !== 'function', 'a held cache keeps settled values, never a promise another request would await')
    assert(Number.isFinite(at), 'a held entry has a finite time')
    this.#items.delete(key)
    this.#items.set(key, { at, value })
    for (const oldest of this.#items.keys()) {
      if (this.#items.size <= this.limit.entries) break
      this.#items.delete(oldest)
    }
    assert(this.#items.size <= this.limit.entries, 'a held cache never grows past its limit')
    return value
  }

  delete(key: string) {
    return this.#items.delete(key)
  }

  drop(test: (value: V, key: string) => boolean) {
    for (const [key, item] of this.#items) if (test(item.value, key)) this.#items.delete(key)
  }

  clear() {
    this.#items.clear()
  }
}
