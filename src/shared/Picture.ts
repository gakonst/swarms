import * as Limits from './Limits.ts'
export const colors = ['green', 'teal', 'blue', 'violet', 'pink', 'red', 'orange', 'yellow', 'gray'] as const

export type Color = (typeof colors)[number]

export type Picture = { color: Color; emoji: string } | { url: string }

export type Type = 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp'

export const most = Limits.SharedPicture.most

export const side = Limits.SharedPicture.side

const pictograph = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

export function emoji(value: string) {
  const text = value.trim()
  if (!text || text.length > Limits.SharedPicture.emojiChars) return false
  const parts = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)]
  return parts.length === 1 && pictograph.test(text)
}

function starts(bytes: Uint8Array, at: number, ...expected: number[]) {
  return expected.every((byte, index) => bytes[at + index] === byte)
}

export function sniff(bytes: Uint8Array): Type | undefined {
  if (starts(bytes, 0, ...Limits.SharedPicture.png)) return 'image/png'
  if (starts(bytes, 0, ...Limits.SharedPicture.jpeg)) return 'image/jpeg'
  if (starts(bytes, 0, ...Limits.SharedPicture.gif)) return 'image/gif'
  if (starts(bytes, 0, ...Limits.SharedPicture.riff) && starts(bytes, Limits.SharedPicture.webpAt, ...Limits.SharedPicture.webp)) return 'image/webp'
  return undefined
}

export function path(swarm: string, at: number) {
  return `/v1/swarms/${encodeURIComponent(swarm)}/picture?v=${at.toString(Limits.SharedPicture.versionRadix)}`
}
