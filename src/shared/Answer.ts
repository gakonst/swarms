import type { Answer } from './Api.ts'

const status = /^[*_>\s]*STATUS:\s*(done|continue)\b[\s:\u2014\u2013-]*(.*?)[*_\s]*$/i

export function parse(message: string, at: number): Answer {
  const lines = message.trimEnd().split('\n')
  const found = status.exec(lines.at(-1) ?? '')
  return {
    at,
    done: found?.[1]?.toLowerCase() === 'done',
    text: (found ? lines.slice(0, -1) : lines).join('\n').trim(),
  }
}

const numbered = /^(\s*(?:#{1,6}\s+)?[*_]*)\s*(?:round|turn|update)\s+\d+\s*(?:update|report|results?|summary)?\s*(?:[\u2014\u2013:-]\s*)?/i

export function unround(text: string) {
  const [first = '', ...rest] = text.split('\n')
  const stripped = first.replace(numbered, '$1')
  if (stripped === first) return text
  return [/^[\s#*_]*$/.test(stripped) ? '' : stripped, ...rest].join('\n').replace(/^\n+/, '')
}

export function excerpt(text: string, length = 220) {
  const plain = unround(text)
    .split('\n')
    .filter((line) => !/^\s*(\||[-:| ]{3,}$|#{1,6}\s*$)/.test(line))
    .map((line) => line.replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .join(' ')
  return plain.length > length ? plain.slice(0, length - 1).trimEnd() + '…' : plain
}

function plain(line: string) {
  return line.replace(/[#*_`>|]/g, '').trim()
}

function telling(line: string) {
  return line.length > 20 && !/^[-: ]+$/.test(line)
}

export function gist(text: string) {
  return text.split('\n').map(plain).find(telling) ?? ''
}

export function lead(text: string) {
  const lines = text.split('\n')
  const found = lines.findIndex((line) => telling(plain(line)))
  return found < 0 ? '' : lines.slice(0, found + 1).join('\n')
}
