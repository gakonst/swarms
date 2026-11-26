import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

type Hit = { file: string; line: number; text: string }
type Allowed = Map<string, { count: number; why: string }>
type Rule = { name: string; about: string; why: string; scan: (file: string, source: ts.SourceFile) => Hit[] }

const root = join(import.meta.dirname, '..')
const update = process.argv.includes('--update')
const seed = process.argv.includes('--seed')
const only = process.argv.find((arg) => arg.startsWith('--rule='))?.slice('--rule='.length)
const codeRoots = ['src', 'cli/src']
const commentRoots = ['scripts', 'test/dst']
const skipped = new Set(['node_modules', 'dist', '.git', '.wrangler', 'output'])
const limitsFile = 'src/shared/Limits.ts'
const timers = new Set(['setTimeout', 'setInterval', 'sleep', 'wait', 'delay', 'pause'])
const delayAt: Record<string, number> = { setTimeout: 1, setInterval: 1 }
const serials = new Set(['serial', 'blockConcurrencyWhile'])
const growing = new Set(['Map', 'Set', 'Array'])
const plain = new Set([0, 1, 2, 24, 60, 1000, 1024, 3600])

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const full = join(root, dir)
  if (!existsSync(full)) return []
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (skipped.has(entry.name)) return []
    const path = dir === '.' ? entry.name : join(dir, entry.name)
    if (entry.isDirectory()) return walk(path, keep)
    return keep(path) ? [path] : []
  })
}

function hit(file: string, source: ts.SourceFile, pos: number, node?: ts.Node): Hit {
  const line = source.getLineAndCharacterOfPosition(pos).line + 1
  const end = source.text.indexOf('\n', pos)
  const text = (node ? node.getText(source) : source.text.slice(pos, end < 0 ? undefined : end)).split('\n')[0]!.trim().slice(0, 100)
  return { file, line, text }
}

function each(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node)
  node.forEachChild((child) => each(child, visit))
}

function owner(node: ts.Node): ts.Node | undefined {
  let at = node.parent
  while (at && !ts.isFunctionLike(at) && !ts.isSourceFile(at)) at = at.parent
  return at
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return undefined
}

function awaits(fn: ts.Node): ts.Node[] {
  const found: ts.Node[] = []
  each(fn, (node) => {
    if ((ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) && owner(node) === fn) found.push(node)
  })
  return found
}

function comments(file: string, source: ts.SourceFile): Hit[] {
  const seen = new Set<number>()
  const found: Hit[] = []
  const take = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      found.push(hit(file, source, range.pos))
    }
  }
  each(source, (node) => {
    take(ts.getLeadingCommentRanges(source.text, node.pos))
    take(ts.getTrailingCommentRanges(source.text, node.end))
  })
  return found.sort((a, b) => a.line - b.line)
}

function loopAwaits(file: string, source: ts.SourceFile): Hit[] {
  const found: Hit[] = []
  each(source, (node) => {
    if (!ts.isAwaitExpression(node)) return
    const fn = owner(node)
    let child: ts.Node = node
    let at = node.parent
    while (at && at !== fn) {
      const loop = ts.isForOfStatement(at) || ts.isForInStatement(at) || ts.isForStatement(at) || ts.isWhileStatement(at) || ts.isDoStatement(at)
      if (loop && child === at.statement) {
        found.push(hit(file, source, node.getStart(source), node))
        return
      }
      child = at
      at = at.parent
    }
  })
  return found
}

function boundNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  each(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && /\bLimits\./.test(node.initializer.getText(source)))
      names.add(node.name.text)
  })
  return names
}

function waits(file: string, source: ts.SourceFile): Hit[] {
  const found: Hit[] = []
  const bound = boundNames(source)
  each(source, (node) => {
    if (ts.isWhileStatement(node) && node.expression.kind === ts.SyntaxKind.TrueKeyword) found.push(hit(file, source, node.getStart(source), node))
    if (ts.isForStatement(node) && !node.condition) found.push(hit(file, source, node.getStart(source), node))
    if (!ts.isCallExpression(node)) return
    const name = calleeName(node)
    if (!name || !timers.has(name)) return
    const delay = node.arguments[delayAt[name] ?? 0]
    const text = delay?.getText(source) ?? ''
    const named = [...text.matchAll(/[A-Za-z_$][\w$]*/g)].some(([word]) => bound.has(word))
    if (!/\bLimits\./.test(text) && !named) found.push(hit(file, source, node.getStart(source), node))
  })
  return found
}

function moduleCollections(file: string, source: ts.SourceFile): Hit[] {
  const found: Hit[] = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer
      if (!init) continue
      const collection =
        (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && growing.has(init.expression.text) && !init.arguments?.length) ||
        (ts.isArrayLiteralExpression(init) && init.elements.length === 0)
      if (collection) found.push(hit(file, source, declaration.getStart(source), declaration))
    }
  }
  return found
}

function magic(file: string, source: ts.SourceFile): Hit[] {
  if (file === limitsFile) return []
  const found: Hit[] = []
  each(source, (node) => {
    if (ts.isNumericLiteral(node) && !plain.has(Number(node.text.replaceAll('_', '')))) found.push(hit(file, source, node.getStart(source), node.parent))
    if (ts.isBigIntLiteral(node) && !plain.has(Number(node.text.slice(0, -1).replaceAll('_', ''))))
      found.push(hit(file, source, node.getStart(source), node.parent))
  })
  return found
}

function heldAcrossAwait(file: string, source: ts.SourceFile): Hit[] {
  const found: Hit[] = []
  each(source, (node) => {
    if (!ts.isCallExpression(node)) return
    const name = calleeName(node)
    if (name && serials.has(name)) {
      for (const arg of node.arguments) if (ts.isFunctionLike(arg) && awaits(arg).length > 0) found.push(hit(file, source, node.getStart(source), node))
    }
    const held =
      name === 'lock' || (name === 'claim' && ts.isPropertyAccessExpression(node.expression) && /board$/i.test(node.expression.expression.getText(source)))
    if (held && ts.isAwaitExpression(node.parent)) {
      const fn = owner(node.parent)
      if (fn && awaits(fn).some((other) => other.getStart(source) > node.end)) found.push(hit(file, source, node.getStart(source), node))
    }
  })
  return found
}

function unitTests(): Hit[] {
  return walk('.', (path) => /\.test\.tsx?$/.test(path) && !path.startsWith('test/dst/')).map((file) => ({ file, line: 1, text: 'test file' }))
}

const rules: Rule[] = [
  { name: 'comments', about: 'No comments in code.', why: 'pre-existing; delete it or say it in a name', scan: comments },
  {
    name: 'await-in-loop',
    about: 'No await per iteration over independent items: start them together with Promise.all.',
    why: 'pre-existing; run with Promise.all or make the order a named dependency',
    scan: loopAwaits,
  },
  {
    name: 'unbounded-waits',
    about: 'Every timer, sleep and poll waits a deadline from src/shared/Limits.ts; no while (true) or for (;;).',
    why: 'pre-existing; bound it with a Limits deadline',
    scan: waits,
  },
  {
    name: 'module-collections',
    about: 'No empty Map, Set or array at module scope: it grows per request for the life of the isolate.',
    why: 'pre-existing; bound it in Limits or move it into the request or Durable Object',
    scan: moduleCollections,
  },
  {
    name: 'magic-limits',
    about: 'No numeric literal outside src/shared/Limits.ts but 0, 1, 2 and the unit conversions 24, 60, 1000, 1024 and 3600.',
    why: 'pre-existing; move it into src/shared/Limits.ts',
    scan: magic,
  },
  {
    name: 'held-across-await',
    about: 'No claim, lock or Work.serial held across another await.',
    why: 'pre-existing; commit the state change, release, then do the I/O',
    scan: heldAcrossAwait,
  },
  {
    name: 'unit-tests',
    about: 'No test files outside test/dst: the DST sim is the only test.',
    why: 'pre-existing unit test; port what it checks to a test/dst invariant with a canary and delete it',
    scan: () => [],
  },
]

function allowances(rule: string): Allowed {
  const path = join(root, 'tidy', rule + '.txt')
  const map: Allowed = new Map()
  if (!existsSync(path)) return map
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const [file, count, ...why] = line.split(' ')
    map.set(file!, { count: Number(count), why: why.join(' ') })
  }
  return map
}

function sum(allowed: Allowed): number {
  return [...allowed.values()].reduce((total, a) => total + a.count, 0)
}

function write(rule: Rule, allowed: Allowed) {
  const lines = [...allowed]
    .filter(([, a]) => a.count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, a]) => file + ' ' + a.count + ' ' + a.why)
  const head = [
    '# ' + rule.about,
    '# path count why; ' + sum(allowed) + ' allowed. Counts only fall: pnpm tidy --update lowers them; raising one is a reviewed edit with its why.',
  ]
  mkdirSync(join(root, 'tidy'), { recursive: true })
  writeFileSync(join(root, 'tidy', rule.name + '.txt'), [...head, ...lines, ''].join('\n'))
}

function byFile(hits: Hit[]): Map<string, Hit[]> {
  const map = new Map<string, Hit[]>()
  for (const h of hits) map.set(h.file, [...(map.get(h.file) ?? []), h])
  return map
}

const files = codeRoots.flatMap((dir) => walk(dir, (path) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts')))
const sources = files.map((file) => ({
  file,
  source: ts.createSourceFile(
    file,
    readFileSync(join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  ),
}))
const parsed = (file: string) => ({
  file,
  source: ts.createSourceFile(
    file,
    readFileSync(join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  ),
})
const commented = commentRoots.flatMap((dir) => walk(dir, (path) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts'))).map(parsed)
const shells = walk('scripts', (path) => !/\.tsx?$/.test(path))
function shellComments(): Hit[] {
  return shells.flatMap((file) =>
    readFileSync(join(root, file), 'utf8')
      .split('\n')
      .flatMap((text, at) => (at > 0 && /^\s*#/.test(text) ? [{ file, line: at + 1, text: text.trim().slice(0, 100) }] : [])),
  )
}
function scan(rule: Rule): Hit[] {
  if (rule.name === 'unit-tests') return unitTests()
  const own = sources.flatMap(({ file, source }) => rule.scan(file, source))
  if (rule.name !== 'comments') return own
  return [...own, ...commented.flatMap(({ file, source }) => comments(file, source)), ...shellComments()]
}
let red = 0
for (const rule of rules) {
  if (only && rule.name !== only) continue
  const start = performance.now()
  const hits = scan(rule)
  const found = byFile(hits)
  const allowed = allowances(rule.name)
  if (update) {
    for (const [file, a] of allowed) allowed.set(file, { ...a, count: Math.min(a.count, found.get(file)?.length ?? 0) })
    if (seed) for (const [file, list] of found) if (!allowed.has(file)) allowed.set(file, { count: list.length, why: rule.why })
    write(rule, allowed)
  }
  const over: string[] = []
  const under: string[] = []
  for (const [file, list] of found) {
    const cap = allowed.get(file)?.count ?? 0
    if (list.length > cap)
      over.push(
        '  ' +
          file +
          ': ' +
          list.length +
          ' found, ' +
          cap +
          ' allowed\n' +
          list
            .slice(0, 8)
            .map((h) => '    ' + h.file + ':' + h.line + ' ' + h.text)
            .join('\n'),
      )
  }
  for (const [file, a] of allowed) {
    const n = found.get(file)?.length ?? 0
    if (n < a.count) under.push('  ' + file + ': ' + n + ' found, ' + a.count + ' allowed')
  }
  const ms = Math.round(performance.now() - start)
  if (over.length || under.length) {
    red++
    console.log('FAIL tidy/' + rule.name + ' ' + hits.length + ' found, ' + sum(allowed) + ' allowed (' + ms + 'ms): ' + rule.about)
    for (const line of over) console.log(line)
    if (under.length) console.log('  below the allowance: run pnpm tidy --update and commit tidy/' + rule.name + '.txt\n' + under.join('\n'))
  } else console.log('ok   tidy/' + rule.name + ' ' + hits.length + ' allowed in ' + found.size + ' files (' + ms + 'ms)')
}
const allowedTotal = rules.reduce((total, rule) => total + sum(allowances(rule.name)), 0)
console.log((red ? red + ' of ' : '') + rules.length + ' rules ' + (red ? 'red' : 'hold') + ', ' + allowedTotal + ' allowances left')
process.exitCode = red ? 1 : 0
