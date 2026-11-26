import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = join(import.meta.dirname, '..')
const baselineFile = join(root, 'tidy', 'size.txt')
const growthPercent = 2
const uploads = { swarms: 'dist/swarms', 'swarms-site': 'dist/swarms_site', client: 'dist/client' } as const
const ignored = /(\.map|wrangler\.json|\.vite)$/

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (ignored.test(entry.name)) return []
    return entry.isDirectory() ? files(path) : [path]
  })
}

function measure(dir: string) {
  const full = join(root, dir)
  if (!existsSync(full)) throw new Error(dir + ' is missing: run pnpm build first')
  const list = files(full)
  return {
    bytes: list.reduce((sum, file) => sum + statSync(file).size, 0),
    gzip: list.reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0),
    files: list.length,
    largest: list
      .map((file) => ({ file: relative(root, file), size: statSync(file).size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 3),
  }
}

function baseline(): Map<string, { bytes: number; gzip: number }> {
  const map = new Map<string, { bytes: number; gzip: number }>()
  if (!existsSync(baselineFile)) return map
  for (const line of readFileSync(baselineFile, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const [name, bytes, gzip] = line.split(' ')
    map.set(name!, { bytes: Number(bytes), gzip: Number(gzip) })
  }
  return map
}

const kb = (n: number) => (n / 1024).toFixed(1) + ' KiB'
const pct = (now: number, was: number) => (was ? (((now - was) / was) * 100).toFixed(2) : 'new') + '%'
const now = Object.entries(uploads).map(([name, dir]) => ({ name, ...measure(dir) }))
if (process.argv.includes('--update')) {
  const head = [
    '# Worker and client upload sizes after pnpm build: name bytes gzip. scripts/check fails when either grows more than ' +
      growthPercent +
      '% past this line; pnpm size --update rewrites it in the commit that grows them, with the measurement in the commit message.',
  ]
  writeFileSync(baselineFile, [...head, ...now.map((m) => m.name + ' ' + m.bytes + ' ' + m.gzip), ''].join('\n'))
}
const was = baseline()
let red = 0
for (const m of now) {
  const before = was.get(m.name)
  const grew = !before || m.bytes > before.bytes * (1 + growthPercent / 100) || m.gzip > before.gzip * (1 + growthPercent / 100)
  const line =
    m.name +
    ' ' +
    kb(m.bytes) +
    ' (' +
    pct(m.bytes, before?.bytes ?? 0) +
    '), gzip ' +
    kb(m.gzip) +
    ' (' +
    pct(m.gzip, before?.gzip ?? 0) +
    '), ' +
    m.files +
    ' files'
  if (grew) {
    red++
    console.log(
      'FAIL size/' + line + ': grew more than ' + growthPercent + '% past tidy/size.txt; largest ' + m.largest.map((l) => l.file + ' ' + kb(l.size)).join(', '),
    )
  } else console.log('ok   size/' + line)
}
process.exitCode = red ? 1 : 0
