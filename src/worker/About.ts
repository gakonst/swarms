import * as Memo from '../shared/Memo.ts'
import { clip, redact } from '../shared/Trail.ts'
import * as Flow from './Flow.ts'
import * as Gateway from './Gateway.ts'
import * as Nodes from './Nodes.ts'
import * as Persona from './Persona.ts'
import type { Dispatcher } from './Runner.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'
import * as Limits from '../shared/Limits.ts'

export const retryMs = Limits.About.retryMs

export const least = Memo.units('0.25')

export const most = Limits.About.most

export function read(self: Swarm) {
  return self.kv.get<string>('about') ?? null
}

export function clean(text: string) {
  const plain = redact(text).replace(/\s+/g, ' ').trim()
  if (!plain || plain.startsWith('{') || plain.startsWith('[')) return null
  return clip(plain, most)
}

export async function ensure(self: Swarm) {
  const owed = self.kv.get<string>('aboutOwed')
  if (owed) return settle(self, owed)
  if (self.kv.get<string>('about') !== undefined) return
  const id = self.kv.get<string>('id')
  const agent = self.kv.get<Dispatcher>('dispatcher')?.id
  if (!id || !agent || self.kv.get<string>('form') !== 'tree' || self.kv.get<number>('archivedAt')) return
  const now = Date.now()
  if (now - (self.kv.get<number>('aboutTried') ?? 0) < retryMs) return
  self.kv.put('aboutTried', now)
  const row = await Store.find(self.env, id)
  if (!row?.goal.trim()) return
  const found = await Nodes.state(self)
  const left = [...found.ledger.left.values()].reduce((sum, value) => (value > 0n ? sum + value : sum), 0n)
  if (left < least) return
  const asked = await Gateway.side(self.env, id, agent, Persona.about(row.goal))
  if (!asked.ok) return
  const spent = Flow.micro(asked.value.usage?.estimated_cost?.total_usd)
  const text = clean(asked.value.text)
  if (text) self.kv.put('about', text)
  if (spent > 0n) {
    self.kv.put('aboutOwed', Memo.decimal(spent))
    await settle(self, Memo.decimal(spent))
  }
}

async function settle(self: Swarm, owed: string) {
  if (await Nodes.charge(self, Nodes.root, 'about', Memo.units(owed))) self.kv.delete('aboutOwed')
}
