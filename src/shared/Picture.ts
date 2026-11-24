export const colors = ['green', 'teal', 'blue', 'violet', 'pink', 'red', 'orange', 'yellow', 'gray'] as const

export type Color = (typeof colors)[number]

export type Picture = { color: Color; emoji: string } | { url: string }

export type Type = 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp'

export const most = 65_536

export const side = 128

const pictograph = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

export function emoji(value: string) {
  const text = value.trim()
  if (!text || text.length > 32) return false
  const parts = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)]
  return parts.length === 1 && pictograph.test(text)
}

function starts(bytes: Uint8Array, at: number, ...expected: number[]) {
  return expected.every((byte, index) => bytes[at + index] === byte)
}

export function sniff(bytes: Uint8Array): Type | undefined {
  if (starts(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(bytes, 0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(bytes, 0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(bytes, 0, 0x52, 0x49, 0x46, 0x46) && starts(bytes, 8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return undefined
}

export function path(swarm: string, at: number) {
  return `/v1/swarms/${encodeURIComponent(swarm)}/picture?v=${at.toString(36)}`
}
