export type Limit = { by: 'board'; chars: number } | { by: 'host'; bytes: number } | { by: 'none' }

export type Over = { chars: number; max: number }

export type Refusal = { kind: string; reason?: 'Text' | undefined; chars?: number | undefined; max?: number | undefined; bytes?: number | undefined }

const counted = new Intl.NumberFormat('en-US')

const encoder = new TextEncoder()

export const unbounded: Limit = { by: 'none' }

export function bytes(text: string) {
  return encoder.encode(text).length
}

export function chars(text: string) {
  return [...text].length
}

export function over(text: string, limit: Limit): Over | null {
  if (limit.by !== 'board') return null
  const length = chars(text)
  return length > limit.chars ? { chars: length, max: limit.chars } : null
}

export function most(limit: Limit) {
  return limit.by === 'board' ? limit.chars : null
}

export function detail(what: string, found: Over) {
  return `${what} is ${counted.format(found.chars)} characters, and this swarm's board takes at most ${counted.format(found.max)}. Nothing was cut: shorten it and send it again.`
}

export function beyond(what: string, text: string, limit: Limit, hostBytes: number) {
  const found = over(text, limit)
  if (found) return detail(what, found)
  const max = limit.by === 'host' ? limit.bytes : hostBytes
  const size = bytes(text)
  return size > max ? stored(what, size, max) : null
}

function stored(what: string, size: number, max: number) {
  return `${what} is ${counted.format(size)} bytes, and storage holds at most ${counted.format(max)} in one entry. Nothing was cut: shorten it and send it again.`
}

export function refused(what: string, rejection: Refusal) {
  if (rejection.reason === 'Text' && rejection.chars !== undefined && rejection.max !== undefined)
    return detail(what, { chars: rejection.chars, max: rejection.max })
  if (rejection.kind === 'Row' && rejection.bytes !== undefined && rejection.max !== undefined) return stored(what, rejection.bytes, rejection.max)
  return null
}
