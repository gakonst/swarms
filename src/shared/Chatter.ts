const idlers = [
  /^(i['’]?m|i am|i['’]?ll|i will) not (starting|doing|running|launching|spending|taking|trying) (anything|any|a new|new)\b/i,
  /^(nothing|no) (new|change|changes|progress|tool calls?) (this|since|to)\b/i,
  /^(still )?(waiting|resting|idle|paused)\b/i,
  /^no new (messages|money|notes)\b/i,
]

export function opening(text: string) {
  return text.replace(/^update:\s*/i, '').trim().split(/(?<=[.!?:])\s|\n/)[0]?.trim() ?? ''
}

export function clause(text: string) {
  return opening(text).split(/[,:;.](?:\s|$)| and /)[0]?.trim() ?? ''
}

export function idle(text: string) {
  const first = opening(text)
  return idlers.some((pattern) => pattern.test(first)) || /\bmade no tool calls\b/i.test(first)
}

export function gist(text: string) {
  if (idle(text)) return 'idle'
  return text.toLowerCase().replace(/\$?\d[\d,.]*/g, '#').replace(/[^a-z#]+/g, ' ').trim()
}
