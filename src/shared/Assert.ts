export class Violation extends Error {
  override readonly name = 'Violation'
  readonly detail: unknown
  constructor(message: string, detail?: unknown) {
    super(message)
    this.detail = detail
  }
}

export function assert(ok: unknown, message: string, detail?: unknown): asserts ok {
  if (ok) return
  console.error('Invariant broken: ' + message, detail)
  throw new Violation(message, detail)
}

export function never(value: never, message: string): never {
  return fail(message, value)
}

export function fail(message: string, detail?: unknown): never {
  console.error('Invariant broken: ' + message, detail)
  throw new Violation(message, detail)
}

export function bounded(count: number, most: number, what: string) {
  assert(Number.isInteger(count) && count >= 0 && count <= most, what + ' is bounded by ' + most, count)
  return count
}
