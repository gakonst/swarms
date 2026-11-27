import { assert } from './Assert.ts'

const high = /^[\uD800-\uDBFF]$/

export function head(text: string, most: number) {
  return text.slice(0, high.test(text.charAt(most - 1)) ? most - 1 : most)
}

function cut(text: string, most: number) {
  const line = text.lastIndexOf('\n', most - 1)
  if (line >= 0) return line + 1
  const space = text.lastIndexOf(' ', most - 1)
  if (space >= 0) return space + 1
  return head(text, most).length
}

export function split(text: string, most: number): string[] {
  assert(Number.isInteger(most) && most >= 2, 'a piece holds at least one whole character', most)
  const pieces: string[] = []
  let rest = text
  while (rest.length > most) {
    const at = cut(rest, most)
    pieces.push(rest.slice(0, at))
    rest = rest.slice(at)
  }
  pieces.push(rest)
  assert(pieces.join('') === text, 'pieces join back to the text', { most, pieces: pieces.length })
  return pieces
}
