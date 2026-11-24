type Token =
  | { at: number; kind: 'text'; text: string }
  | { at: number; close: boolean; kind: 'mark'; open: boolean; text: string }
  | { at: number; body: string; kind: 'code'; tick: string }
  | { at: number; head: string; inner: string; kind: 'link'; tail: string }
  | { at: number; kind: 'atom'; size: number; text: string }

const space = /\s/

const punct = /[!-/:-@[-\x60{-~\p{P}\p{S}]/u

function flanks(before: string, after: string) {
  const left = !space.test(after) && (!punct.test(after) || space.test(before) || punct.test(before))
  const right = !space.test(before) && (!punct.test(before) || space.test(after) || punct.test(after))
  return { left, right }
}

function closing(text: string, from: number, run: string) {
  for (let at = text.indexOf(run, from); at >= 0; at = text.indexOf(run, at + 1)) {
    if (text[at - 1] !== '\x60' && text[at + run.length] !== '\x60') return at
  }
  return -1
}

function matched(text: string, from: number, open: string, shut: string) {
  let depth = 0
  for (let at = from; at < text.length; at++) {
    if (text[at] === '\\') at++
    else if (text[at] === open) depth++
    else if (text[at] === shut && --depth === 0) return at
  }
  return -1
}

function tokens(text: string) {
  const out: Token[] = []
  let at = 0
  let start = 0
  const flush = (end: number) => {
    if (end > start) out.push({ at: start, kind: 'text', text: text.slice(start, end) })
  }
  while (at < text.length) {
    const char = text[at]!
    if (char === '\\' && at + 1 < text.length && punct.test(text[at + 1]!)) {
      flush(at)
      out.push({ at, kind: 'atom', size: 1, text: text.slice(at, at + 2) })
      start = at += 2
      continue
    }
    if (char === '\x60') {
      const run = /^\x60+/.exec(text.slice(at))![0]
      const end = closing(text, at + run.length, run)
      if (end >= 0) {
        flush(at)
        out.push({ at, body: text.slice(at + run.length, end), kind: 'code', tick: run })
        start = at = end + run.length
      } else at += run.length
      continue
    }
    if (char === '[' || (char === '!' && text[at + 1] === '[')) {
      const from = char === '!' ? at + 1 : at
      const shut = matched(text, from, '[', ']')
      const end = shut >= 0 && text[shut + 1] === '(' ? matched(text, shut + 1, '(', ')') : -1
      if (end >= 0) {
        flush(at)
        out.push({ at, head: text.slice(at, from + 1), inner: text.slice(from + 1, shut), kind: 'link', tail: text.slice(shut, end + 1) })
        start = at = end + 1
      } else at++
      continue
    }
    if (char === '<') {
      const auto = /^<((?:https?|mailto):[^\s<>]+)>/i.exec(text.slice(at))
      if (auto) {
        flush(at)
        out.push({ at, kind: 'atom', size: auto[1]!.length, text: auto[0] })
        start = at += auto[0].length
      } else at++
      continue
    }
    if (char === '*' || char === '_' || char === '~') {
      const run = new RegExp('^\\' + char + '+').exec(text.slice(at))![0]
      const { left, right } = flanks(text[at - 1] ?? ' ', text[at + run.length] ?? ' ')
      const open = char === '_' ? left && (!right || punct.test(text[at - 1] ?? ' ')) : left
      const close = char === '_' ? right && (!left || punct.test(text[at + run.length] ?? ' ')) : right
      if ((open || close) && !(char === '~' && run.length > 2)) {
        flush(at)
        out.push({ at, close, kind: 'mark', open, text: run })
        start = at += run.length
      } else at += run.length
      continue
    }
    at++
  }
  flush(text.length)
  return out
}

function shown(token: Token): number {
  if (token.kind === 'text') return token.text.length
  if (token.kind === 'code') return token.body.length
  if (token.kind === 'link') return shown({ at: 0, kind: 'text', text: plain(token.inner) })
  if (token.kind === 'atom') return token.size
  return 0
}

function marks(open: readonly string[], token: Extract<Token, { kind: 'mark' }>) {
  if (token.close && open.at(-1) === token.text) return open.slice(0, -1)
  if (token.open) return [...open, token.text]
  return open
}

function shut(open: readonly string[]) {
  return [...open].reverse().join('')
}

function words(text: string, room: number) {
  const cut = text.slice(0, room)
  const gap = cut.search(/\s\S*$/)
  return (gap > room * 0.6 ? cut.slice(0, gap) : cut).trimEnd()
}

const fence = /^\s{0,3}(\x60{3,}|~{3,})/

const rule = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

const table = /^\s*\||^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

const marker = /^\s*(?:>\s*)*(?:#{1,6}(?=\s|$)|[-*+](?=\s)(?:\s+\[[ xX]\])?|\d+[.)](?=\s))?\s*/

export function line(text: string) {
  let fenced = ''
  let out = ''
  let gap = true
  for (const row of text.replace(/\r\n?/g, '\n').split('\n')) {
    const fencing = fence.exec(row)
    if (fencing) {
      if (!fenced) fenced = fencing[1]!.charAt(0)
      else if (fencing[1]!.charAt(0) === fenced) fenced = ''
      gap = true
      continue
    }
    if (fenced) continue
    if (!row.trim() || rule.test(row) || table.test(row) || /^\s*<!--/.test(row)) {
      gap = true
      continue
    }
    const head = marker.exec(row)![0]
    const body = row.slice(head.length).replace(/\s+#+\s*$/, '').trim()
    if (!body) continue
    const block = gap || /[#>*+\-\d]/.test(head)
    out += !out ? body : block && !/[.!?:;,…]$/.test(out) ? ' · ' + body : ' ' + body
    gap = false
  }
  return out.replace(/\s+/g, ' ').trim()
}

export function clip(text: string, length: number) {
  const list = tokens(text)
  if (list.reduce((sum, token) => sum + shown(token), 0) <= length) return text
  let room = length - 1
  let out = ''
  let open: readonly string[] = []
  for (const token of list) {
    if (token.kind === 'mark') {
      open = marks(open, token)
      out += token.text
      continue
    }
    const size = shown(token)
    if (size <= room) {
      out += token.kind === 'text' || token.kind === 'atom' ? token.text : token.kind === 'code' ? token.tick + token.body + token.tick : token.head + token.inner + token.tail
      room -= size
      continue
    }
    if (token.kind === 'text') out += words(token.text, room)
    else if (token.kind === 'code' && room > 3) out += token.tick + token.body.slice(0, room).trimEnd() + token.tick
    else if (token.kind === 'link' && room > 3) out += clip(token.inner, room).replace(/…$/, '')
    break
  }
  out = out.trimEnd()
  while (open.length && out.endsWith(open.at(-1)!)) {
    out = out.slice(0, -open.at(-1)!.length).trimEnd()
    open = open.slice(0, -1)
  }
  return out + '…' + shut(open)
}

export function sentences(text: string) {
  const parts: string[] = []
  let out = ''
  let open: readonly string[] = []
  const split = () => {
    const said = out.trim()
    if (said) parts.push(said + shut(open))
    out = open.join('')
  }
  for (const token of tokens(text)) {
    if (token.kind === 'mark') {
      open = marks(open, token)
      out += token.text
      continue
    }
    if (token.kind !== 'text') {
      out += token.kind === 'atom' ? token.text : token.kind === 'code' ? token.tick + token.body + token.tick : token.head + token.inner + token.tail
      continue
    }
    let rest = token.text
    if (/^\s+["'(\[]?[A-Z0-9]/.test(rest) && /[.!?]["')\]]?[*_~]*$/.test(out)) split()
    for (let stop = rest.search(/[.!?]["')\]]?\s+["'(\[]?[A-Z0-9]/); stop >= 0; stop = rest.search(/[.!?]["')\]]?\s+["'(\[]?[A-Z0-9]/)) {
      const end = stop + /^[.!?]["')\]]?/.exec(rest.slice(stop))![0].length
      out += rest.slice(0, end)
      rest = rest.slice(end).trimStart()
      split()
    }
    out += rest
  }
  split()
  return parts
}

export function plain(text: string): string {
  return tokens(text)
    .map((token) => (token.kind === 'mark' ? '' : token.kind === 'text' ? token.text : token.kind === 'code' ? token.body : token.kind === 'link' ? plain(token.inner) : token.text.replace(/^\\|^<|>$/g, '')))
    .join('')
}
