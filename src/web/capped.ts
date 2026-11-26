import { assert } from '../shared/Assert.ts'

export class Capped<K, V> extends Map<K, V> {
  readonly most: number

  constructor(most: number) {
    super()
    assert(Number.isInteger(most) && most > 0, 'a capped cache holds at least one entry', { most })
    this.most = most
  }

  override set(key: K, value: V) {
    this.delete(key)
    if (this.size >= this.most) this.delete(this.keys().next().value as K)
    return super.set(key, value)
  }
}
