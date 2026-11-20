import * as child from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type Spec =
  | { kind: 'corpus'; shards: number; words: number; ms: number }
  | { kind: 'count'; shard: number; ms: number }
  | { kind: 'digest'; ms: number }
  | { kind: 'merge'; shards: number; ms: number }
  | { kind: 'report'; top: number; ms: number }

export type Step = { id: string; title: string; needs: string[]; spec: Spec }

const shards = 3

const vocabulary =
  'ledger stablecoin payment wallet settle route transfer issuer validator block fee rate payout collect account zone balance invoice merchant bank rail swap quote reserve mint burn escrow refund batch chain'.split(
    ' ',
  )

export const goal = 'Write a word-frequency report over a generated payments corpus'

export const slow = 'count-2'

export const steered = 'report'

export function plan(): Step[] {
  const counts = Array.from({ length: shards }, (_, index) => `count-${index + 1}`)
  return [
    { id: 'corpus', title: 'Generate the corpus', needs: [], spec: { kind: 'corpus', shards, words: 4000, ms: 600 } },
    ...counts.map((id, index): Step => ({
      id,
      title: `Count words in shard ${index + 1}`,
      needs: ['corpus'],
      spec: { kind: 'count', shard: index + 1, ms: id === slow ? 2400 : 900 },
    })),
    { id: 'digest', title: 'Checksum the corpus with sha256sum', needs: ['corpus'], spec: { kind: 'digest', ms: 500 } },
    { id: 'merge', title: 'Merge the shard counts', needs: counts, spec: { kind: 'merge', shards, ms: 600 } },
    { id: 'report', title: 'Write the report', needs: ['merge', 'digest'], spec: { kind: 'report', top: 10, ms: 2000 } },
  ]
}

export function encode(step: Step) {
  return JSON.stringify({ title: step.title, ...step.spec })
}

export function decode(spec: string): Spec {
  return JSON.parse(spec) as Spec
}

export function heed(spec: Spec, text: string): Spec {
  const top = /top (\d+)/i.exec(text)?.[1]
  if (spec.kind !== 'report' || top === undefined) return spec
  return { ...spec, top: Number(top) }
}

export function run(spec: Spec, options: run.Options): string {
  const dir = options.dir
  const file = (...parts: string[]) => path.join(dir, ...parts)

  switch (spec.kind) {
    case 'corpus': {
      fs.mkdirSync(file('corpus'), { recursive: true })
      let seed = 0x9e3779b9
      const next = () => {
        seed = (seed + 0x6d2b79f5) >>> 0
        let t = seed
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      for (let shard = 1; shard <= spec.shards; shard++) {
        const words = Array.from({ length: spec.words }, () => vocabulary[Math.floor(next() ** 2 * vocabulary.length)])
        fs.writeFileSync(file('corpus', `shard-${shard}.txt`), words.join(' ') + '\n')
      }
      return `${spec.shards} shards of ${spec.words} words`
    }
    case 'count': {
      const counts: Record<string, number> = {}
      for (const word of fs.readFileSync(file('corpus', `shard-${spec.shard}.txt`), 'utf8').split(/\s+/))
        if (word) counts[word] = (counts[word] ?? 0) + 1
      fs.mkdirSync(file('counts'), { recursive: true })
      fs.writeFileSync(file('counts', `shard-${spec.shard}.json`), JSON.stringify(counts))
      return `shard ${spec.shard}: ${Object.keys(counts).length} distinct words`
    }
    case 'digest': {
      const sums = child.execFileSync('sh', ['-c', 'sha256sum corpus/*.txt'], { cwd: dir, encoding: 'utf8' })
      fs.writeFileSync(file('digest.txt'), sums)
      return `${sums.trim().split('\n').length} files checksummed`
    }
    case 'merge': {
      const total: Record<string, number> = {}
      for (let shard = 1; shard <= spec.shards; shard++) {
        const counts = JSON.parse(fs.readFileSync(file('counts', `shard-${shard}.json`), 'utf8')) as Record<string, number>
        for (const [word, count] of Object.entries(counts)) total[word] = (total[word] ?? 0) + count
      }
      const ranked = Object.entries(total).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      fs.writeFileSync(file('merged.json'), JSON.stringify(ranked))
      return `${ranked.length} words ranked`
    }
    case 'report': {
      const ranked = JSON.parse(fs.readFileSync(file('merged.json'), 'utf8')) as [string, number][]
      const digest = fs.readFileSync(file('digest.txt'), 'utf8').trim()
      const rows = ranked.slice(0, spec.top).map((entry, index) => `| ${index + 1} | ${entry[0]} | ${entry[1]} |`)
      const lines = [
        `# Top ${spec.top} words`,
        '',
        '| rank | word | count |',
        '| --- | --- | --- |',
        ...rows,
        '',
        ...options.steers.map((steer) => `Steered: ${steer}`),
        '',
        '```',
        digest,
        '```',
        '',
      ]
      fs.writeFileSync(file('report.md'), lines.join('\n'))
      return `report.md lists the top ${spec.top} words`
    }
  }
}

export declare namespace run {
  type Options = { dir: string; steers: string[] }
}
