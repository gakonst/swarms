import type * as M1 from '../dispatch.ts'
import type * as NodesModule from '../../src/worker/Nodes.ts'
import type * as RunnerModule from '../../src/worker/Runner.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

export const limits = { cap: 40, longChars: 20_000, rootChars: 11_000, rounds: 24 }

const pieces = ['a', 'word ', '中', '😀', '👩‍💻', '\n']

async function text(seed: string): Promise<Outcome> {
  const random = rng('board-text', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const { ana, gateway, id, planted } = await load<typeof M1>('test/dispatch.ts')
  const Nodes = await load<typeof NodesModule>('src/worker/Nodes.ts')
  const Runner = await load<typeof RunnerModule>('src/worker/Runner.ts')
  applied()
  const g = gateway()
  const words = (count: number) => Array.from({ length: count }, () => random.pick(pieces)).join('')
  const spec = (title: string, body: string) => Nodes.spec({ statement: null, title, words: body })
  const goal = 'y'.repeat(limits.rootChars)
  const tall = await planted(g.route, 0, null, null, goal)
  try {
    a.as('a tree swarm whose goal runs past the old fixed cap plants its root whole')
    a.equal((await tall.swarm.board.task(Nodes.nodeId('root')))?.spec, spec('Does P = NP?', goal))
  } catch (error) {
    fail('a tree swarm whose goal runs past the old fixed cap plants its root whole', String((error as Error)?.stack ?? error).slice(0, 400))
  } finally {
    await Runner.stop(tall.swarm)
    tall.restore()
  }
  const w = await planted(g.route)
  try {
    a.as('a board with no text limit takes a node text past the old fixed cap whole')
    const long = 'x'.repeat(limits.longChars)
    const posted = await Nodes.post(w.swarm, { by: ana, form: 'idea', needs: [], parent: 'root', statement: null, title: 'A long brief', words: long })
    a.equal((await w.swarm.board.task(Nodes.nodeId(posted.nid)))?.spec, spec('A long brief', long))
    const open = await w.swarm.treeRead(id, { depth: 1, root: 'root', status: undefined })
    a.ok(open.ok && open.value.maxText === undefined, 'no maxText while the board sets none')

    a.as('the tree read shows the board limit')
    a.ok((await w.swarm.board.setTextLimit(limits.cap)).ok, 'setting the limit')
    const read = await w.swarm.treeRead(id, { depth: 1, root: 'root', status: undefined })
    a.equal(read.ok ? read.value.maxText : null, limits.cap)

    for (let round = 0; round < limits.rounds; round++) {
      const title = 'Idea ' + round
      const body = words(random.int(1, limits.cap))
      const whole = spec(title, body)
      const length = [...whole].length
      const nid = await Nodes.nid('root', title)
      const answer = await w.swarm.treePropose(id, nid, { by: ana, form: 'idea', parent: 'root', said: null, statement: null, title, words: body })
      a.as('a node text counts code points as the board does')
      a.equal(answer.ok, length <= limits.cap, length + ' code points against ' + limits.cap)
      if (answer.ok) continue
      a.as('a refusal shows the length and the limit, and nothing is cut')
      a.match(answer.detail, new RegExp('is ' + length.toLocaleString('en-US') + ' characters'))
      a.match(answer.detail, new RegExp('at most ' + limits.cap + '\\b'))
      a.match(answer.detail, /Nothing was cut/)
      a.as('a refused proposal is never stored, so no ride can pay for it')
      a.equal(w.swarm.kv.get('proposal:' + nid), undefined)
    }

    a.as('a node the board refuses names both numbers')
    const refused = await Nodes.post(w.swarm, { by: ana, form: 'idea', needs: [], parent: 'root', statement: null, title: 'Too long now', words: long }).then(
      () => '',
      (error: unknown) => String((error as Error).message),
    )
    a.match(refused, new RegExp((limits.longChars + 2 + 'Too long now'.length).toLocaleString('en-US') + ' characters.*at most ' + limits.cap))

    a.as('lifting the limit takes the long text again')
    a.ok((await w.swarm.board.setTextLimit(null)).ok, 'lifting the limit')
    const again = await w.swarm.treePropose(id, await Nodes.nid('root', 'Long again'), {
      by: ana,
      form: 'idea',
      parent: 'root',
      said: null,
      statement: null,
      title: 'Long again',
      words: long,
    })
    a.ok(again.ok, 'a long proposal after the limit is lifted')
  } catch (error) {
    fail('board text', String((error as Error)?.stack ?? error).slice(0, 400))
  } finally {
    await Runner.stop(w.swarm)
    w.restore()
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { text }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('text.units', 'src/shared/Texts.ts', 'return [...text].length', 'return text.length'),
    invariant: 'a node text counts code points as the board does',
    name: 'text.units',
    scenario: 'text',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('text.max', 'src/shared/Texts.ts', "and this swarm's board takes at most ${counted.format(found.max)}", "and this swarm's board takes less"),
    invariant: 'a refusal shows the length and the limit, and nothing is cut',
    name: 'text.max',
    scenario: 'text',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('text.precheck', 'src/worker/Riding.ts', '  if (long) return fail(Limits.Http.invalid, long)\n', ''),
    invariant: 'a node text counts code points as the board does',
    name: 'text.precheck',
    scenario: 'text',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'text.root',
      'test/dispatch.ts',
      "root: { statement, title: 'Does P = NP?', words },",
      "root: { statement, title: 'Does P = NP?', words: words.slice(0, 9000) },",
    ),
    invariant: 'a tree swarm whose goal runs past the old fixed cap plants its root whole',
    name: 'text.root',
    scenario: 'text',
    seeds: ['1'],
  },
  {
    flip: mutant('text.open', 'src/worker/Riding.ts', '...(most === null ? {} : { maxText: most })', ''),
    invariant: 'the tree read shows the board limit',
    name: 'text.open',
    scenario: 'text',
    seeds: ['1', '2', '3'],
  },
]
