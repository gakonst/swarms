export type Span = { body: string; display: boolean; end: number }

const fence = /^ {0,3}(\x60{3,}|~{3,})/

const blank = /\n[ \t]*\n/

function between(text: string, at: number, open: number, shut: string, display: boolean): Span | undefined {
  const end = text.indexOf(shut, at + open)
  if (end < 0) return undefined
  const body = text.slice(at + open, end)
  if (!body.trim() || blank.test(body)) return undefined
  return { body: body.trim(), display, end: end + shut.length }
}

export function span(text: string, at: number): Span | undefined {
  const char = text[at]
  if (char === '\\') {
    if (text[at + 1] === '(') return between(text, at, 2, '\\)', false)
    if (text[at + 1] === '[') return between(text, at, 2, '\\]', true)
    return undefined
  }
  if (char !== '$') return undefined
  if (text[at + 1] === '$') return between(text, at, 2, '$$', true)
  if (!text[at + 1] || /\s/.test(text[at + 1]!)) return undefined
  for (let end = at + 1; end < text.length; end++) {
    if (text[end] === '\\') end++
    else if (text[end] === '$') {
      const before = text[end - 1]!
      const after = text[end + 1]
      if (/\s/.test(before) || (after !== undefined && /\d/.test(after))) return undefined
      const body = text.slice(at + 1, end)
      return blank.test(body) ? undefined : { body, display: false, end: end + 1 }
    }
  }
  return undefined
}

function shown(found: Span, inline: boolean) {
  const body = found.body.replace(/\s*\n\s*/g, ' ')
  if (inline || !found.display) return '$' + body + '$'
  return found.body.includes('\n') ? '\n\n$$\n' + found.body.replace(/\n[ \t]*/g, '\n') + '\n$$\n\n' : '$$' + body + '$$'
}

const greek: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  chi: 'χ',
  delta: 'δ',
  epsilon: 'ϵ',
  eta: 'η',
  gamma: 'γ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  omega: 'ω',
  phi: 'ϕ',
  pi: 'π',
  psi: 'ψ',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  theta: 'θ',
  upsilon: 'υ',
  varepsilon: 'ε',
  varphi: 'φ',
  varpi: 'ϖ',
  varrho: 'ϱ',
  varsigma: 'ς',
  vartheta: 'ϑ',
  xi: 'ξ',
  zeta: 'ζ',
}

function upright(math: string) {
  return math
    .replace(/[α-ωϑϕϖϱϵ]/g, (letter) => '\\mathrm{' + letter + '}')
    .replace(/\\([a-z]+)(?![a-zA-Z])/g, (found, name: string) => (greek[name] ? '\\mathrm{' + greek[name] + '}' : found))
}

export function normalize(text: string, inline: boolean, portable = false) {
  if (!/[$\\]/.test(text)) return text
  let out = ''
  let at = 0
  while (at < text.length) {
    if (at === 0 || text[at - 1] === '\n') {
      const eol = text.indexOf('\n', at)
      const fencing = fence.exec(text.slice(at, eol < 0 ? undefined : eol))
      if (fencing) {
        const close = new RegExp('\\n {0,3}' + fencing[1]!.charAt(0) + '{' + fencing[1]!.length + ',}[ \\t]*(?=\\n|$)').exec(text.slice(at))
        const end = close ? at + close.index + close[0].length : text.length
        out += text.slice(at, end)
        at = end
        continue
      }
    }
    const char = text[at]!
    if (char === '\x60') {
      const run = /^\x60+/.exec(text.slice(at))![0]
      const end = text.indexOf(run, at + run.length)
      const stop = end < 0 ? at + run.length : end + run.length
      out += text.slice(at, stop)
      at = stop
      continue
    }
    const found = char === '$' || (char === '\\' && (text[at + 1] === '(' || text[at + 1] === '[')) ? span(text, at) : undefined
    if (found) {
      const math = char === '$' && (inline ? !found.display : true) ? text.slice(at, found.end) : shown(found, inline)
      out += portable ? upright(math) : math
      at = found.end
      continue
    }
    if (char === '\\' && at + 1 < text.length) {
      out += text.slice(at, at + 2)
      at += 2
      continue
    }
    out += char
    at++
  }
  return out
}
