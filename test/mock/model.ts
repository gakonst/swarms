import { keccak256, stringToHex } from 'viem'

export type Child = { needs: string[]; spec: string; statement: string | null; title: string }

export type Outcome = 'progress' | 'proved' | 'refuted' | 'split' | 'stuck'

export type Result = { children: Child[]; commit: string | null; outcome: Outcome; summary: string; theorem: string | null; why: string | null }

export type Spawn = { budget_usd?: number; role: string; steps?: Step[]; task: string }

export type Step =
  | { think: string }
  | { calls?: number; ms?: number; spend: number }
  | { wait: number }
  | { stall: number }
  | { crash: string }
  | { result: Partial<Result> & { outcome: Outcome } }
  | { answer: Record<string, unknown> }
  | { overspend: number }
  | { join?: boolean; spawn: Spawn }

export const call = 0.02

export type Refusal = { error: string; ok: false; status: 402 | 429 }

export type Context = {
  closed(): boolean
  emit(type: string, payload: Record<string, unknown>, live?: boolean): void
  inbox(): string[]
  join(id: number): Promise<string>
  meter(usd: number, ms: number): Promise<{ ok: true } | Refusal>
  role: string
  sleep(ms: number): Promise<void>
  spawn(input: Spawn): Promise<number>
  task: string
}

export type Ended = { output: Record<string, unknown>; state: 'completed' } | { error: string; state: 'failed' } | { state: 'closed' }

export const presets = ['prove', 'split', 'refute', 'progress', 'stuck', 'overspend', 'stall', 'crash', 'helpers', 'slow', 'triage'] as const

export type Preset = (typeof presets)[number]

export function nid(role: string) {
  return /^n:([^#\s]+)/.exec(role)?.[1] ?? role.replace(/[^a-z0-9]/gi, '').slice(0, 10)
}

export function commit(role: string, salt = '') {
  return keccak256(stringToHex(`commit:${nid(role)}:${salt}`)).slice(2, 42)
}

export function theorem(role: string) {
  return `Pnp.N${nid(role)}`
}

export function directive(text: string): Preset | undefined {
  const found = /\bmock:([a-z]+)/.exec(text)?.[1]
  return presets.find((preset) => preset === found)
}

export function preset(name: Preset, role: string, task: string): Step[] {
  const title = /^#*\s*(.+)$/m.exec(task)?.[1]?.trim().slice(0, 80) ?? role
  const base = { children: [], commit: null, theorem: null, why: null }
  if (name === 'prove')
    return [{ think: 'Writing the proof on paper first.' }, { spend: 0.4 }, { think: 'The Lean proof builds locally.' }, { spend: 0.3 }, { result: { ...base, commit: commit(role), outcome: 'proved', summary: 'Proved it; the commit is ready to check.', theorem: theorem(role) } }]
  if (name === 'refute')
    return [{ think: 'Looking for a counterexample.' }, { spend: 0.5 }, { result: { ...base, commit: commit(role, 'not'), outcome: 'refuted', summary: 'The statement is false: a counterexample is on the branch.', theorem: theorem(role), why: 'A checked counterexample.' } }]
  if (name === 'split')
    return [
      { think: 'This is two steps; splitting.' },
      { spend: 0.2 },
      {
        result: {
          ...base,
          children: [
            { needs: [], spec: `First half of ${title}.\n\nmock:prove`, statement: 'True', title: `First half of ${title}` },
            { needs: [`First half of ${title}`], spec: `Second half of ${title}, using the first.\n\nmock:prove`, statement: 'True', title: `Second half of ${title}` },
          ],
          outcome: 'split',
          summary: 'Split into two lemmas; the second needs the first.',
        },
      },
    ]
  if (name === 'progress') return [{ think: 'Narrowed the search.' }, { spend: 0.5 }, { result: { ...base, outcome: 'progress', summary: 'Ruled out two approaches; one is left.' } }]
  if (name === 'stuck') return [{ think: 'No way in.' }, { spend: 0.3 }, { result: { ...base, outcome: 'stuck', summary: 'Stuck: every route needs a lemma we do not have.', why: 'Needs a stronger switching lemma.' } }]
  if (name === 'slow') return [{ think: 'A long run.' }, { spend: 0.2 }, ...Array.from({ length: 40 }, (_, index): Step[] => [{ wait: 250 }, { think: 'Still working, step ' + index }]).flat(), { spend: 0.2 }, { result: { ...base, outcome: 'progress', summary: 'A long run ended.' } }]
  if (name === 'triage') return [{ think: 'Reading proposals.' }, { spend: 0.05 }, { answer: { actions: [] } }]
  if (name === 'overspend') return [{ think: 'Trying everything at once.' }, { overspend: 1 }]
  if (name === 'stall') return [{ think: 'Starting.' }, { spend: 0.1 }, { stall: 86_400_000 }]
  if (name === 'crash') return [{ think: 'Starting.' }, { spend: 0.2 }, { crash: 'The session crashed mid-run.' }]
  return [
    { think: 'Two helpers will try both directions.' },
    { join: true, spawn: { budget_usd: 0.5, role: role + '/a', steps: [{ spend: 0.2 }, { result: { ...base, outcome: 'progress', summary: 'Direction A is closed.' } }], task: 'Try direction A.' } },
    { join: true, spawn: { budget_usd: 0.5, role: role + '/b', steps: [{ spend: 0.2 }, { result: { ...base, outcome: 'progress', summary: 'Direction B is open.' } }], task: 'Try direction B.' } },
    { spend: 0.1 },
    { result: { ...base, outcome: 'progress', summary: 'Helpers closed direction A; B is open.' } },
  ]
}

export function script(role: string, task: string, scripted?: Step[]): Step[] {
  if (scripted) return scripted
  const named = directive(task) ?? directive(role) ?? (/^n:triage#/.test(role) ? 'triage' : undefined)
  return preset(named ?? 'progress', role, task)
}

export async function play(steps: readonly Step[], context: Context): Promise<Ended> {
  const heard: string[] = []
  const listen = () => {
    for (const message of context.inbox()) {
      heard.push(message)
      context.emit('assistant.message', { text: 'Heeding: ' + message })
    }
  }
  for (const step of steps) {
    if (context.closed()) return { state: 'closed' }
    listen()
    if ('think' in step) {
      context.emit('reasoning.summary.delta', { item_id: 'rs', offset: 0, text: step.think }, true)
      context.emit('assistant.message', { text: step.think })
      continue
    }
    if ('spend' in step) {
      const calls = step.calls ?? Math.max(1, Math.ceil(step.spend / call - 1e-9))
      const each = Math.round((step.spend / calls) * 1_000_000) / 1_000_000
      for (let made = 0; made < calls; made++) {
        if (context.closed()) return { state: 'closed' }
        const paid = await pay(context, made === calls - 1 ? Math.round((step.spend - each * (calls - 1)) * 1_000_000) / 1_000_000 : each, Math.max(1, Math.round((step.ms ?? 50) / calls)))
        if (!paid.ok) return { error: paid.error, state: 'failed' }
      }
      continue
    }
    if ('overspend' in step) {
      for (;;) {
        if (context.closed()) return { state: 'closed' }
        const paid = await pay(context, Math.min(step.overspend, call), 10)
        if (!paid.ok) return { error: paid.error, state: 'failed' }
      }
    }
    if ('wait' in step) {
      await context.sleep(step.wait)
      continue
    }
    if ('stall' in step) {
      const until = Date.now() + step.stall
      while (Date.now() < until && !context.closed()) await context.sleep(50)
      continue
    }
    if ('crash' in step) return { error: step.crash, state: 'failed' }
    if ('answer' in step) return { output: step.answer, state: 'completed' }
    if ('spawn' in step) {
      context.emit('tool.call', { arguments: JSON.stringify({ budget_usd: step.spawn.budget_usd, role: step.spawn.role, task: step.spawn.task }), call_id: 'spawn:' + step.spawn.role, name: 'spawn_agent' })
      const id = await context.spawn(step.spawn)
      context.emit('tool.result', { call_id: 'spawn:' + step.spawn.role, name: 'spawn_agent', output: JSON.stringify({ agent_id: id }) })
      if (step.join) await context.join(id)
      continue
    }
    listen()
    const result: Result = { children: [], commit: null, summary: '', theorem: null, why: null, ...step.result }
    return { output: heard.length ? { ...result, summary: `${result.summary} Heeded: ${heard.join('; ')}` } : result, state: 'completed' }
  }
  listen()
  return { output: { children: [], commit: null, outcome: 'progress', summary: heard.length ? 'Heeded: ' + heard.join('; ') : 'Done.', theorem: null, why: null }, state: 'completed' }
}

async function pay(context: Context, usd: number, ms: number) {
  for (let tries = 0; ; tries++) {
    const paid = await context.meter(usd, ms)
    if (paid.ok) {
      context.emit('model.call.completed', { cost_usd: usd })
      return paid
    }
    context.emit('model.call.failed', { error: paid.error })
    if (paid.status === 402 || tries >= 100) return paid
    await context.sleep(Math.max(ms, 25))
  }
}

export function pick(question: string): string | undefined {
  if (!question.startsWith('Pick the model for')) return undefined
  const listed = [...question.slice(question.indexOf('Models you may pick')).matchAll(/^- (\S+)/gm)].map((found) => found[1] ?? '')
  const asked = /mock:model=(\S+)/.exec(question)?.[1]
  const model = asked && listed.includes(asked) ? asked : listed[0]
  if (!model) return 'No model is listed.'
  return JSON.stringify({ harness: model.includes('/anthropic/') ? 'claude' : 'codex', model, why: asked ? 'A rider asked for it.' : 'The first one listed.' })
}

export function spawned(prompt: string): Spawn | undefined {
  for (let start = prompt.indexOf('{'); start !== -1; start = prompt.indexOf('{', start + 1)) {
    let depth = 0
    let quoted = false
    for (let at = start; at < prompt.length; at++) {
      const char = prompt[at]
      if (quoted) {
        if (char === '\\') at++
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') quoted = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        const found = parse(prompt.slice(start, at + 1))
        if (found) return found
        break
      }
    }
  }
  return undefined
}

function parse(text: string): Spawn | undefined {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    const args = (typeof value['arguments'] === 'object' && value['arguments'] !== null ? value['arguments'] : value) as Record<string, unknown>
    if (typeof args['role'] !== 'string' || typeof args['task'] !== 'string') return undefined
    return { role: args['role'], task: args['task'], ...(typeof args['budget_usd'] === 'number' ? { budget_usd: args['budget_usd'] } : {}) }
  } catch {
    return undefined
  }
}
