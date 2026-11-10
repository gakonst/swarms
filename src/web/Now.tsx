import type { Artifact, Branch, Detail, Update } from '../shared/Api.ts'
import * as Brief from '../shared/Brief.ts'
import * as Kinds from '../shared/Surface.ts'
import { ago } from './format.ts'
import { useNow } from './hooks.ts'
import { Surface } from './Surface.tsx'
import { Traces } from './Traces.tsx'

export function Now(props: {
  artifacts: readonly Artifact[] | undefined
  branches: readonly Branch[] | undefined
  onChat: () => void
  onSteer: (note: string) => void
  stir: number
  surface: readonly Kinds.Node[]
  swarm: Detail
  updates: readonly Update[] | undefined
  visible: boolean
}) {
  const swarm = props.swarm
  const now = useNow(60_000)
  const told = props.updates?.filter((update) => update.text.trim()).at(-1) ?? (swarm.answer?.text.trim() ? swarm.answer : undefined)
  const brief = Brief.brief({ status: Kinds.status(props.surface), surfaced: props.artifacts?.find(Kinds.is), update: told })
  const laid = Kinds.shown(props.surface)
  const nodes = laid.length ? laid : Kinds.crew(props.branches ?? [])
  const running = swarm.status === 'running'
  const stalled = running && !!swarm.working?.stalled
  const settled = props.artifacts !== undefined && props.updates !== undefined

  return (
    <div className="now">
      <section aria-labelledby="now-title" className="now-status">
        <h2 id="now-title">Latest from the lead{brief?.at ? <small>{ago(brief.at, now)}</small> : null}</h2>
        {brief ? (
          <ul>{brief.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        ) : (
          <p className="result-quiet">{settled ? (running ? 'No status yet. The lead posts one as it works.' : 'No status yet.') : ' '}</p>
        )}
        {stalled && swarm.working?.progressed && <p className="now-stalled">Stalled: its last progress was {ago(swarm.working.progressed, now)}.</p>}
      </section>
      {nodes.length > 0 && (
        <section aria-labelledby="now-swarm" className="now-swarm">
          <h2 className="sr-only" id="now-swarm">Swarm</h2>
          <Surface nodes={nodes} onChat={props.onChat} onSteer={props.onSteer} />
        </section>
      )}
      <Traces branches={props.branches} id={swarm.id} running={running} stalled={stalled} stir={props.stir} visible={props.visible} />
    </div>
  )
}
