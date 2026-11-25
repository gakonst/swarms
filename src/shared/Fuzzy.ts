export type Hit = { exact: boolean; marks: readonly number[]; score: number }

function fold(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function boundary(text: string, at: number) {
  if (at === 0) return true
  const before = text[at - 1]!
  return !/[\p{L}\p{N}]/u.test(before)
}

function token(text: string, folded: string, word: string): Hit | undefined {
  let best: Hit | undefined
  for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
    const score = 100 + word.length * 6 + (boundary(text, at) ? 40 : 0) + (at === 0 ? 20 : 0) - Math.min(at, 60) * 0.2
    if (!best || score > best.score) best = { exact: true, marks: Array.from({ length: word.length }, (_, index) => at + index), score }
  }
  if (best) return best
  if (word.length < 3) return undefined
  const marks: number[] = []
  let score = 0
  let from = 0
  for (const char of word) {
    let at = -1
    for (let index = from; index < folded.length; index++) {
      if (folded[index] !== char) continue
      if (at === -1) at = index
      if (boundary(text, index)) {
        at = index
        break
      }
      if (marks.length && index === marks.at(-1)! + 1) break
    }
    if (at === -1) return undefined
    const joined = marks.length > 0 && at === marks.at(-1)! + 1
    score += 8 + (joined ? 6 : 0) + (boundary(text, at) ? 10 : 0) - (marks.length ? Math.min(at - marks.at(-1)! - 1, 10) * 0.8 : Math.min(at, 20) * 0.3)
    marks.push(at)
    from = at + 1
  }
  if (marks.at(-1)! - marks[0]! + 1 > word.length * 4 + 6) return undefined
  return { exact: false, marks, score }
}

export function match(query: string, text: string): Hit | undefined {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return undefined
  const folded = fold(text)
  if (folded.length !== text.length) return undefined
  const marks = new Set<number>()
  let score = 0
  let exact = true
  for (const word of words) {
    const hit = token(text, folded, word)
    if (!hit) return undefined
    score += hit.score
    exact &&= hit.exact
    for (const mark of hit.marks) marks.add(mark)
  }
  return { exact, marks: [...marks].sort((a, b) => a - b), score }
}

export function spans(text: string, marks: readonly number[]): { lit: boolean; text: string }[] {
  const lit = new Set(marks)
  const out: { lit: boolean; text: string }[] = []
  for (let index = 0; index < text.length; index++) {
    const on = lit.has(index)
    const last = out.at(-1)
    if (last && last.lit === on) last.text += text[index]
    else out.push({ lit: on, text: text[index]! })
  }
  return out
}

export function same(a: string, b: string) {
  const bare = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, '')
  return bare(a) === bare(b)
}
