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

const rounds: [RegExp, string][] = [
  [/\b(this|that|each|every|last|previous|the next|next) round\b/gi, '$1 update'],
  [/\b(this|that|each|every|last|previous|the next|next) rounds\b/gi, '$1 updates'],
  [/\b(in|during|from|since|after|before) round \d+\b/gi, '$1 an earlier update'],
]

export function unround(text: string) {
  const lines = text.split('\n').filter((line) => !/^[*_>\s]*STATUS:\s*\w+/i.test(line))
  const [first = '', ...rest] = lines
  const stripped = first.replace(numbered, '$1')
  const head = stripped === first ? lines : [/^[\s#*_]*$/.test(stripped) ? '' : stripped, ...rest]
  return rounds.reduce((body, [pattern, replace]) => body.replace(pattern, (found: string, ...groups: string[]) => matchCase(found, replace.replace('$1', groups[0] ?? ''))), head.join('\n').replace(/^\n+/, '').trimEnd())
}

function matchCase(found: string, next: string) {
  return /^[A-Z]/.test(found) ? next.charAt(0).toUpperCase() + next.slice(1) : next
}

export function cash(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  if (value >= 0.1) return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
  return '$' + String(Number(value.toPrecision(2)))
}

export function amounts(text: string) {
  return text.replace(/\$(\d[\d,]*\.\d+)/g, (_, value: string) => cash(Number(value.replace(/,/g, ''))))
}

const broke = (left: string) => `Out of money: ${left} left, and one step can cost up to $0.05. Fund it to keep going.`

const costly = (needed: string) => `Paused: its next step needs about ${needed} at once, more than any one backer has left in it. Fund it to keep going.`

export function settled(text: string) {
  const said = spoken(text)
  return said === null || /^(Out of money|Paused:|Stopped after|Resting|Not started|Open again)/.test(said)
}

export function spoken(text: string): string | null {
  const said = text.trim()
  if (/^Round \d+ (started|completed|failed|cancelled)\b/i.test(said) || /room for \d+ explorers?/i.test(said) || /^Told the agent to keep going\b/.test(said)) return null
  if (/code repository|\$1\.(19|04)\b|repository first/i.test(said) && /^Waiting/i.test(said)) return null
  const held = /^(?:Waiting for money: the agent's next model call holds|Out of money for its next step: it needs about) \$([\d.]+)/.exec(said)
  if (held) return costly(cash(Number(held[1])))
  const short = /^(?:Waiting for money: (?:the next request needed more than the )?|Out of money: )\$([\d.]+)(?: left, less than its next step needs\.|\b)/.exec(said)
  if (short && !/one step can cost/.test(said)) return broke(cash(Number(short[1])))
  if (/^Waiting for money\b/.test(said) || /^Out of money\. Adding money wakes it\.$/.test(said)) return 'Out of money. Fund it to keep going.'
  const stopped = /^Stopped after \d+ errors in a row\. New money or a note restarts it\./.exec(said)
  if (stopped) return stopped[0]
  if (/^Waiting for its first (funds|contribution)/.test(said) || /^Created\. The first pledge/.test(said)) return 'Not started: nobody has funded it yet.'
  const errors = /^The agent hit (\d+) errors in a row/.exec(said)
  if (errors) return `Stopped after ${errors[1]} errors in a row. New money or a note restarts it.`
  const resting = /^Resting: .*?(\$[\d.]+) is kept for later/.exec(said)
  if (resting) return `Resting: the agent found nothing more worth doing. ${amounts(resting[1] ?? '')} is kept for later; a note or new money wakes it.`
  const back = /^(Back at work|Started working) with \$[\d.]+ to spend\./.exec(said)
  if (back) return `${back[1]}.`
  return amounts(unround(said))
}

export function local(text: string, at: number, format: (at: number) => string) {
  return text.replace(/\b(\d{2}):(\d{2}) UTC\b/g, (found, hours: string, minutes: string) => {
    const day = new Date(at)
    let next = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(hours), Number(minutes))
    if (next < at - 60_000) next += 86_400_000
    return Number.isFinite(next) ? format(next) : found
  })
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
