import type { Summary } from '../shared/Api.ts'

export const areas = [
  { id: 'cryptography', label: 'Cryptography', match: /\b(cryptograph\w*|post.quantum|signature\w*|lattice\w*|encryption|zero.knowledge|zkp)\b/i },
  { id: 'mathematics', label: 'Mathematics', match: /\b(mathemat\w*|theorem\w*|conjecture\w*|p\s*[=≠]\s*np|p\s+vs\.?\s+np|proof\w*|polynomial\w*)\b/i },
  { id: 'life', label: 'Life sciences', match: /\b(biolog\w*|protein\w*|genom\w*|molecul\w*|drug\w*|cell\w*|disease\w*)\b/i },
  { id: 'energy', label: 'Matter & energy', match: /\b(energy|material\w*|batter\w*|catalys\w*|climate|ocean\w*|fusion|physics|geothermal)\b/i },
  { id: 'computing', label: 'Computing', match: /\b(model\w*|coding|code\w*|algorithm\w*|compress\w*|codec\w*|parser\w*|machine\w*|memory|inference|benchmark\w*|python|http\w*)\b/i },
  { id: 'open', label: 'Open exploration', match: /./ },
] as const

export type Area = (typeof areas)[number]['id']

export function area(swarm: Pick<Summary, 'title' | 'goal'>) {
  return areas.find((item) => item.id !== 'open' && item.match.test(swarm.title)) ?? areas.find((item) => item.id !== 'open' && item.match.test(swarm.goal)) ?? areas[5]
}

export const questions = [
  {
    label: 'Quantum-safe signatures',
    hint: 'Protect the next generation of cryptography.',
    title: 'Better post-quantum signatures',
    goal: 'Find a defensible size or speed improvement in post-quantum signatures at matched security. Establish the frontier from primary papers and specifications. Propose falsifiable hypotheses, reproduce the strongest relevant baselines on identical hardware, and test the most promising idea. Publish sources, parameters, code, measurements, failed approaches and proof gaps. Distinguish measured improvements from security and novelty claims. A rigorous negative result is a useful outcome.',
  },
  {
    label: 'Faster science',
    hint: 'Make a scientific workload run better.',
    title: 'More efficient scientific computing',
    goal: 'Find a reproducible performance improvement for an open-source scientific computing workload. Choose and justify one workload, establish correctness and strong baselines, then test competing optimization hypotheses under identical conditions. Report runtime distributions, memory use, hardware, dependencies and full reproduction commands. Publish code and negative results. Do not trade away numerical accuracy to win a benchmark.',
  },
  {
    label: 'Put a result to the test',
    hint: 'Find out what holds up.',
    title: 'Reproduce a research result',
    goal: 'Independently reproduce a published computational research result. First identify a specific paper with public code and data and state its central testable claim. Record the original conditions, reproduce the baseline, test sensitivity to key assumptions and publish exact commands, dependencies, outputs and discrepancies. Separate successful reproduction, failed reproduction and inconclusive evidence. Do not claim independent validation from the authors’ reported numbers alone.',
  },
] as const

export function brief(question: string) {
  const text = question.trim()
  return { title: text.slice(0, 80), goal: `${text}\n\nEstablish sourced baselines, propose testable hypotheses, and run reproducible computational experiments where feasible. Publish methods, code, measurements, negative results and next steps. Distinguish observations from unverified claims.` }
}
