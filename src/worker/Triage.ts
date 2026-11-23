import * as Memo from '../shared/Memo.ts'
import { clip } from '../shared/Trail.ts'
import * as Flow from './Flow.ts'
import * as Nodes from './Nodes.ts'
import * as Persona from './Persona.ts'
import type { Swarm } from './Swarm.ts'
import * as Work from './Work.ts'

export const everyMs = 30 * 60_000

export const listed = 50

export type Action =
  | { kind: 'approve'; node: string; weight: number }
  | { idea: string; kind: 'adopt'; spec: string; statement: string | null; title: string }
  | { into: string; kind: 'merge'; node: string }
  | { kind: 'reject'; node: string; why: string }
  | { amount: string; kind: 'grant'; node: string }
  | { kind: 'restate'; node: string; statement: string }

export type Applied = { action: Action; ok: boolean; why: string }

export const output = {
  additionalProperties: false,
  properties: {
    actions: {
      items: {
        additionalProperties: false,
        properties: {
          amount: { type: ['string', 'null'] },
          idea: { type: ['string', 'null'] },
          into: { type: ['string', 'null'] },
          kind: { enum: ['approve', 'adopt', 'merge', 'reject', 'grant', 'restate'], type: 'string' },
          node: { type: ['string', 'null'] },
          spec: { type: ['string', 'null'] },
          statement: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
          weight: { type: ['integer', 'null'] },
          why: { type: ['string', 'null'] },
        },
        required: ['kind', 'node', 'weight', 'idea', 'title', 'spec', 'statement', 'into', 'why', 'amount'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['actions'],
  type: 'object',
}

function word(value: unknown, most = 4000) {
  return typeof value === 'string' && value.trim() ? clip(value.trim(), most) : null
}

export function action(value: unknown): Action | null {
  if (!value || typeof value !== 'object') return null
  const one = value as Record<string, unknown>
  const node = word(one['node'], 64)
  switch (one['kind']) {
    case 'approve':
      return node && typeof one['weight'] === 'number' ? { kind: 'approve', node, weight: Math.max(0, Math.min(10, Math.round(one['weight']))) } : null
    case 'adopt': {
      const idea = word(one['idea'], 64)
      const title = word(one['title'], 200)
      return idea && title ? { idea, kind: 'adopt', spec: word(one['spec']) ?? '', statement: word(one['statement']), title } : null
    }
    case 'merge': {
      const into = word(one['into'], 64)
      return node && into && into !== node ? { into, kind: 'merge', node } : null
    }
    case 'reject':
      return node ? { kind: 'reject', node, why: word(one['why'], 500) ?? 'Rejected by triage.' } : null
    case 'grant': {
      const amount = typeof one['amount'] === 'number' ? one['amount'].toFixed(6) : word(one['amount'], 32)
      return node && amount && /^\d+(\.\d{1,6})?$/.test(amount) ? { amount, kind: 'grant', node } : null
    }
    case 'restate': {
      const statement = word(one['statement'])
      return node && statement ? { kind: 'restate', node, statement } : null
    }
  }
  return null
}

export function parse(text: string | undefined): Action[] {
  if (!text) return []
  const tries = [text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  for (const candidate of tries) {
    try {
      const value = JSON.parse(candidate) as { actions?: unknown }
      if (Array.isArray(value.actions)) return value.actions.map(action).filter((one): one is Action => one !== null).slice(0, 50)
    } catch {}
  }
  return []
}

function bare(nid: string) {
  return nid.startsWith('n:') ? nid.slice(2) : nid
}

export async function apply(self: Swarm, actions: readonly Action[], by: string, key: string, halt: Nodes.Halt): Promise<Applied[]> {
  const applied: Applied[] = []
  let granted = 0n
  const rootLeft = (await Nodes.state(self)).ledger.left.get(Nodes.root) ?? 0n
  const most = by.startsWith('admin:') ? rootLeft : rootLeft / 4n
  for (const [index, one] of actions.entries()) {
    const found = await Nodes.state(self)
    const done = (ok: boolean, why: string) => applied.push({ action: one, ok, why })
    if (one.kind === 'adopt') {
      const idea = await self.env.DB.prepare('select id, parent, author, text, node from ideas where swarm = ? and id = ?').bind(Nodes.swarm(self), one.idea).first<{ author: string; id: string; node: string | null; parent: string; text: string }>()
      const parent = idea ? found.nodes.get(idea.parent) : undefined
      if (!idea || idea.node || !parent || Work.terminal(parent.phase)) {
        done(false, 'No open suggestion has this id.')
        continue
      }
      const posted = await Nodes.post(self, { by: idea.author, form: one.statement ? 'lemma' : 'idea', needs: [], parent: idea.parent, statement: one.statement, title: one.title, words: one.spec || idea.text })
      Nodes.weigh(self, posted.nid, 1)
      await self.env.DB.prepare('update ideas set node = ? where swarm = ? and id = ? and node is null').bind(posted.nid, Nodes.swarm(self), idea.id).run()
      done(true, 'Adopted as ' + posted.nid)
      continue
    }
    const nid = bare(one.node)
    const task = found.nodes.get(nid)
    if (!task || Work.terminal(task.phase) || nid === Nodes.root || nid === Nodes.triage) {
      done(false, 'No open node has this id.')
      continue
    }
    if (one.kind === 'approve') {
      Nodes.weigh(self, nid, one.weight)
      Nodes.emit(self, nid, 'funded', one.weight ? 'Approved by triage, weight ' + one.weight : 'Weighed to nothing by triage')
      done(true, 'Weight ' + one.weight)
    } else if (one.kind === 'merge') {
      const into = found.nodes.get(bare(one.into))
      if (!into || Work.terminal(into.phase)) {
        done(false, 'The node to merge into is not open.')
        continue
      }
      await self.board.reply(Nodes.nodeId(bare(one.into)), 'credit: ' + (task.labels['by'] ?? ''))
      await Nodes.end(self, nid, { at: Date.now(), check: null, into: bare(one.into), kind: 'merged', why: 'Merged into ' + bare(one.into) + '.' }, halt)
      done(true, 'Merged')
    } else if (one.kind === 'reject') {
      const author = task.labels['by'] ?? ''
      const riders = [...(found.ledger.funders.get(nid)?.keys() ?? [])]
      if (riders.some((rider) => rider !== author) && !by.startsWith('admin:')) {
        done(false, 'Someone besides its author rode it.')
        continue
      }
      await Nodes.end(self, nid, { at: Date.now(), check: null, into: null, kind: 'rejected', why: one.why }, halt)
      done(true, 'Rejected')
    } else if (one.kind === 'grant') {
      const amount = Memo.units(one.amount)
      if (amount <= 0n || granted + amount > most) {
        done(false, 'A grant is at most a quarter of the root money left in one triage run.')
        continue
      }
      const wrote = await Nodes.budgeting(self, async () => {
        const fresh = await Nodes.state(self)
        const parts = Flow.split(Flow.shares(fresh.rows, { node: Nodes.root, run: null }), amount)
        return Flow.write(self.env, { from: { node: Nodes.root, run: null }, id: 'triage:' + key + ':' + index, kind: 'grant', parts, swarm: Nodes.swarm(self), to: { node: nid, run: null } })
      })
      if (wrote) {
        granted += amount
        Nodes.changed(self)
        Nodes.emit(self, nid, 'funded', '$' + one.amount + ' granted by triage')
      }
      done(wrote, wrote ? 'Granted' : 'The root has too little left.')
    } else {
      const parsed = Nodes.parse(task.spec)
      const posted = await Nodes.post(self, { by: 'agent:n:' + Nodes.triage, form: 'lemma', needs: Nodes.needs(task), parent: nid, statement: one.statement, title: parsed.title + ' (restated)', words: parsed.words })
      Nodes.weigh(self, posted.nid, 1)
      done(true, 'Restated as ' + posted.nid)
    }
  }
  return applied
}

export function due(self: Swarm, now: number) {
  if (!self.kv.get<boolean>('triaging')) return Infinity
  return Math.max(now, (self.kv.get<number>('triagedAt') ?? 0) + everyMs)
}

async function fresh(self: Swarm, since: number) {
  const proposals = Number(
    self.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM tree_deltas WHERE event = 'posted' AND at > ? AND node NOT IN ('root', 'triage')", since).one().n,
  )
  const ideas = await self.env.DB.prepare('select count(*) as n from ideas where swarm = ? and created_at > ? and node is null').bind(Nodes.swarm(self), since).first<{ n: number }>()
  return proposals + Number(ideas?.n ?? 0)
}

export async function schedule(self: Swarm) {
  const now = Date.now()
  const since = self.kv.get<number>('triagedAt') ?? 0
  const found = await Nodes.state(self)
  const node = found.nodes.get(Nodes.triage)
  if (!node || Work.terminal(node.phase)) return false
  const open = (found.runs.get(Nodes.triage) ?? []).some((run) => !Work.terminal(run.phase))
  const rootLeft = found.ledger.left.get(Nodes.root) ?? 0n
  const set = Nodes.units(self)
  const grew = rootLeft >= (self.kv.get<string>('triageRoot') ? Memo.units(self.kv.get<string>('triageRoot') ?? '0') : 0n) + set.runStep
  const waiting = await fresh(self, since)
  self.kv.put('triaging', waiting > 0)
  if (open || (now - since < everyMs && !grew) || (waiting === 0 && !grew)) return false
  return Nodes.budgeting(self, async () => {
    const state = await Nodes.state(self)
    const pledged = state.ledger.pledged.get(Nodes.root) ?? 0n
    const share = (pledged * BigInt(Math.round(set.triageShare * 10_000))) / 10_000n
    const had = (state.ledger.inherited.get(Nodes.triage) ?? 0n) + (state.ledger.pledged.get(Nodes.triage) ?? 0n)
    const room = share - had
    const want = set.runStep < room ? set.runStep : room
    const have = state.ledger.left.get(Nodes.triage) ?? 0n
    if (have < set.runMin && want >= set.runMin) {
      const parts = Flow.split(Flow.shares(state.rows, { node: Nodes.root, run: null }), want)
      await Flow.write(self.env, { from: { node: Nodes.root, run: null }, id: 'triage-share:' + now, kind: 'grant', parts, swarm: Nodes.swarm(self), to: { node: Nodes.triage, run: null } })
    }
    const after = await Nodes.state(self)
    const left = after.ledger.left.get(Nodes.triage) ?? 0n
    const amount = left < set.runStep ? left : set.runStep
    self.kv.put('triagedAt', now)
    self.kv.put('triageRoot', Memo.decimal(rootLeft))
    if (amount < set.runMin) return false
    const k = Math.max(0, ...(after.runs.get(Nodes.triage) ?? []).map((run) => Nodes.kOf(run.id)), ...[...after.ledger.runs.keys()].filter((run) => Flow.runNode(run) === Nodes.triage).map(Nodes.kOf)) + 1
    const run = Nodes.runId(Nodes.triage, k)
    const parts = Flow.split(Flow.shares(after.rows, { node: Nodes.triage, run: null }), amount)
    if (!(await Flow.write(self.env, { from: { node: Nodes.triage, run: null }, id: 'commit:' + Nodes.triage + ':' + k, kind: 'commit', parts, swarm: Nodes.swarm(self), to: { node: Nodes.triage, run } }))) return false
    after.rows = await Flow.rows(self.env, Nodes.swarm(self))
    after.ledger = Flow.fold(after.rows)
    await Nodes.postRun(self, after, Nodes.triage, run)
    return true
  })
}

export async function task(self: Swarm, found: Nodes.State) {
  const since = self.kv.get<number>('triagedAt') ?? 0
  const weighed = new Set(self.ctx.storage.sql.exec<{ node: string }>('SELECT node FROM tree_weights').toArray().map((row) => row.node))
  const proposals = [...found.nodes.entries()]
    .filter(([nid, node]) => !Work.terminal(node.phase) && !weighed.has(nid) && nid !== Nodes.root && nid !== Nodes.triage && !(node.labels['by'] ?? '').startsWith('agent:') && node.labels['by'] !== 'seed')
    .slice(0, listed)
    .map(([nid, node]) => {
      const parsed = Nodes.parse(node.spec)
      const riders = found.ledger.funders.get(nid)?.size ?? 0
      return '- ' + nid + ' under ' + (Nodes.parentOf(node) ?? '-') + ': ' + parsed.title + ' (' + riders + ' riders, $' + Flow.usd(found.ledger.pledged.get(nid) ?? 0n) + ')' + (parsed.statement ? '\n  statement: ' + parsed.statement.replace(/\n/g, ' ') : '')
    })
  const { results } = await self.env.DB.prepare('select id, parent, text from ideas where swarm = ? and node is null order by created_at desc limit ?').bind(Nodes.swarm(self), listed).all<{ id: string; parent: string; text: string }>()
  const ideas = results.map((idea) => '- idea ' + idea.id + ' under ' + idea.parent + ': ' + clip(idea.text, 500))
  const root = found.ledger.left.get(Nodes.root) ?? 0n
  return [
    Persona.triage(self.kv.get('treeSetup') ?? null),
    '',
    'The root has $' + Flow.usd(root) + ' left; a grant is at most $' + Flow.usd(root / 4n) + ' in all this run.',
    'Since ' + new Date(since).toISOString() + ':',
    '',
    '# Proposals',
    ...(proposals.length ? proposals : ['(none)']),
    '',
    '# Suggestions',
    ...(ideas.length ? ideas : ['(none)']),
  ].join('\n')
}
