import { useState } from 'react'
import type { Artifact, Branch, Detail, Update } from '../shared/Api.ts'
import * as Brief from '../shared/Brief.ts'
import * as Chatter from '../shared/Chatter.ts'
import * as Status from '../shared/Status.ts'
import * as Kinds from '../shared/Surface.ts'
import { Board } from './Crew.tsx'
import { ago } from './format.ts'
import { useNow } from './hooks.ts'
import { Inline } from './Markdown.tsx'
import { Surface } from './Surface.tsx'
import { state, Traces } from './Traces.tsx'
import * as Limits from '../shared/Limits.ts'

export function Now(props: {
  artifacts: readonly Artifact[] | undefined
  branches: readonly Branch[] | undefined
  onChat: () => void
  onSteer: (note: string) => void
  stir: number
  surface: readonly Kinds.Node[] | undefined
  swarm: Detail
  updates: readonly Update[] | undefined
  visible: boolean
}) {
  const swarm = props.swarm
  const now = useNow(Limits.Clock.minuteMs)
  const [traced, setTraced] = useState(false)
  const told = props.updates?.filter((update) => update.text.trim() && !Chatter.idle(update.text)).at(-1) ?? (swarm.answer?.text.trim() && !Chatter.idle(swarm.answer.text) ? swarm.answer : undefined)
  const brief = props.surface && Brief.brief({ status: Kinds.status(props.surface), surfaced: props.artifacts?.find(Kinds.is), update: told })
  const nodes = props.surface ? Kinds.shown(props.surface) : []
  const stood = Status.standing(swarm)
  const running = stood.word === 'Working' || stood.word === 'Stuck'
  const settled = props.artifacts !== undefined && props.updates !== undefined && props.surface !== undefined

  return (
    <div className="now">
      <section aria-labelledby="now-title" className="now-status">
        <h2 id="now-title">Latest from the lead{brief?.at ? <small>{ago(brief.at, now)}</small> : null}</h2>
        {brief ? (
          <ul>{brief.lines.map((line, index) => <li key={index}><Inline text={line} /></li>)}</ul>
        ) : (
          <p className="result-quiet">{settled ? (running ? 'No status yet. The lead posts one as it works.' : 'No status yet.') : ' '}</p>
        )}
        {(stood.word === 'Stuck' || stood.word === 'Needs money') && <p className="now-stalled">{Status.told(swarm)}</p>}
      </section>
      {nodes.length > 0 && (
        <section aria-labelledby="now-swarm" className="now-swarm">
          <h2 className="sr-only" id="now-swarm">Swarm</h2>
          <Surface nodes={nodes} onChat={props.onChat} onSteer={props.onSteer} />
        </section>
      )}
      {settled && props.branches && <Board branches={props.branches} />}
      {settled && props.branches && <section className="now-traces">
        <button aria-expanded={traced} className="now-traces-toggle" onClick={() => setTraced(!traced)} type="button">
          <i aria-hidden="true" />{traced ? 'Hide traces' : 'Traces'}<span data-mood={state(stood.word)}>{Status.badge(swarm)}</span>
        </button>
        {traced && <Traces branches={props.branches} id={swarm.id} running={running} stir={props.stir} label={Status.badge(swarm)} visible={props.visible} word={stood.word} />}
      </section>}
    </div>
  )
}
