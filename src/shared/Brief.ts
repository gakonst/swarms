import * as Answer from './Answer.ts'

export type Brief = { at: number | null; lines: string[] }

const most = 3

function clean(line: string) {
  const plain = line
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 220 ? plain.slice(0, 219).trimEnd() + '…' : plain
}

function sentences(text: string) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(#])/).map(clean).filter(Boolean)
}

export function bullets(text: string) {
  const lines = Answer.unround(text)
    .split('\n')
    .filter((line) => !/^\s*(\||[-:| ]{3,}$|```)/.test(line))
  const listed = lines.filter((line) => /^ ?([-*+]|\d+[.)])\s+\S/.test(line)).map(clean).filter(Boolean)
  if (listed.length >= 2) return listed.slice(0, most)
  return sentences(lines.filter((line) => !/^\s*#{1,6}\s/.test(line)).join(' ')).slice(0, most)
}

export function brief(input: {
  status: readonly string[]
  surfaced?: { summary: string | null; updatedAt: number | null } | undefined
  update?: { at: number; text: string } | undefined
}): Brief | null {
  if (input.status.length) return { at: input.surfaced?.updatedAt ?? null, lines: input.status.slice(0, most) }
  const told = input.update ? bullets(input.update.text) : []
  const summed = (input.surfaced?.summary ?? '').split(/;\s+/).flatMap(sentences).slice(0, most)
  if (summed.length && (!told.length || (input.surfaced?.updatedAt ?? 0) > (input.update?.at ?? 0))) return { at: input.surfaced?.updatedAt ?? null, lines: summed }
  return told.length ? { at: input.update?.at ?? null, lines: told } : null
}
