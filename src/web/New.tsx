import { useState } from 'react'
import type { Config, Steering } from '../shared/Api.ts'
import * as Drive from '../shared/Drive.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Setup from '../shared/Setup.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import * as Api from './api.ts'
import { here, site } from './boot.ts'
import { Box } from './Box.tsx'
import { Card, fromProblem, pill } from './Card.tsx'
import type { Target } from './Contribute.tsx'
import { remember } from './hooks.ts'
import { launcher } from './launch.ts'
import * as Names from './names.ts'
import * as Pay from './pay.ts'
import { brief, open, problems } from './research.ts'
import { Back, Link, navigate, useCanBack } from './router.tsx'
import { Steered } from './Steering.tsx'
import * as Wire from './wire.ts'
import * as Limits from '../shared/Limits.ts'

const prefill = { amount: '5', note: '', token: undefined } as const

function started(): Engine {
  return here().searchParams.get('runs') === 'antigravity' ? 'antigravity' : 'credit'
}

function starter() {
  const asked = here().searchParams.get('q')
  return asked === null ? undefined : problems.find((problem) => problem.id === asked)
}

async function named(input: Parameters<typeof Api.create>[0]) {
  if (input.nickname) return Api.create(input)
  const cut = Nickname.slug(input.title)
  const name = cut.length < Nickname.most || !cut.includes('-') ? cut : cut.slice(0, cut.lastIndexOf('-'))
  const free = Nickname.usable(name) && (await Names.warm(name).catch(() => undefined)) === null
  if (!free) return Api.create(input)
  return Api.create({ ...input, nickname: name }).catch((reason: unknown) => {
    if (reason instanceof Api.Failure && reason.code === 'conflict') return Api.create(input)
    throw reason
  })
}

type Engine = 'credit' | 'antigravity'

const engines: readonly (readonly [Engine, string, string])[] = [
  ['credit', "Riders' credit", 'Claude Fable 5.2, paid from what riders put in'],
  ['antigravity', 'My Antigravity', 'Gemini on your own Antigravity plan, never on credit'],
]

function Runs(props: { disabled?: boolean; engine: Engine; onPick: (engine: Engine) => void }) {
  return (
    <>
      <div aria-label="Runs on" className="runs" role="radiogroup">
        <p>Runs on</p>
        {engines.map(([name, label, hint]) => (
          <label data-on={props.engine === name} key={name}>
            <input checked={props.engine === name} disabled={props.disabled} name="engine" onChange={() => props.onPick(name)} type="radio" value={name} />
            <i aria-hidden="true" />
            <span><b>{label}</b> <span>{hint}</span></span>
          </label>
        ))}
      </div>
      {props.engine === 'antigravity' && (
        <p className="runs-note">
          {Setup.presets.antigravity.hint} Without the plan it waits. <Link to={Drive.ownAi}>{Drive.connect} →</Link>
        </p>
      )}
    </>
  )
}

function useLaunch(slot: string, title: string, goal: string, problem: string | undefined, steering: Steering, nickname: string | undefined, engine: Engine) {
  const [launch] = useState(() => launcher((input: Parameters<typeof Api.create>[0]) => named(input).then((swarm): Target => ({ id: swarm.id, ...(swarm.nickname ? { nickname: swarm.nickname } : {}) }))))
  const input = { steering, goal: goal.trim(), title: title.trim(), ...(problem ? { problem } : {}), ...(nickname ? { nickname } : {}), ...(engine === 'antigravity' ? { template: 'antigravity' as const } : {}) }
  return {
    busy: Pay.busy(Pay.useFlow(slot)),
    locked: !(input.title.length >= 1 && input.title.length <= Limits.Operations.titleChars && input.goal.length >= Limits.Operations.goalLeastChars && input.goal.length <= Limits.Operations.goalChars),
    target: () => launch(input, () => {}),
  }
}

function landing(name: string | undefined) {
  return (swarm: Target) => {
    if (!name && swarm.nickname) {
      Names.keep(swarm.nickname, { name: swarm.nickname, nickname: swarm.nickname, swarm: swarm.id })
      return navigate(`/${swarm.nickname}`, { replace: true })
    }
    if (!name) return navigate(`/s/${encodeURIComponent(swarm.id)}`, { replace: true })
    void Api.swarm(swarm.id, false)
      .then((detail) => remember(swarm.id, detail), () => {})
      .finally(() => Names.keep(name, { name, nickname: name, swarm: swarm.id }))
  }
}

function Address(props: { name: string | undefined }) {
  if (!props.name) return null
  return <p className="new-name">{site().replace(/^https?:\/\//, '')}/<b>{props.name}</b></p>
}

export function New(props: { config: Config | undefined; name?: string }) {
  const [picked] = useState(() => (props.name ? problems.find((problem) => problem.id === props.name) : starter()))
  return picked ? <Seed config={props.config} name={props.name} problem={picked} /> : <Own config={props.config} name={props.name} />
}

function Seed(props: { config: Config | undefined; name: string | undefined; problem: Problem }) {
  const problem = props.problem
  const [note, setNote] = useState('')
  const [steering, setSteering] = useState<Steering>('team')
  const [engine, setEngine] = useState<Engine>(started)
  const id = `idea:${problem.id}`
  const launch = useLaunch(id, problem.title, problem.goal, problem.id, steering, props.name, engine)
  const backed = useCanBack()

  return (
    <article className="page idea-page">
      <div className="idea">
        <Back className="idea-back" to="/ideas">{backed ? '← Back' : '← All swarms'}</Back>
        <div className="idea-head idea-seed">
          <header className="idea-info">
            <h1>{problem.title}</h1>
            <p className="idea-kind" data-mood="new"><i />{pill('Not started')}</p>
            <p className="idea-pitch">{problem.hint}</p>
            <p className="idea-brief">{problem.goal}</p>
            <Address name={props.name} />
          </header>
          <Box
            config={props.config}
            creates
            extra={
              <>
                <Steered disabled={launch.busy} onPick={setSteering} steering={steering} />
                <Runs disabled={launch.busy} engine={engine} onPick={setEngine} />
              </>
            }
            first
            focus={0}
            least="1"
            locked={launch.locked}
            members={[]}
            note={note}
            onDone={() => undefined}
            onNote={setNote}
            onOpen={() => undefined}
            onSent={landing(props.name)}
            open
            prefill={prefill}
            shared={false}
            swarm={{ balance: '0', contributors: 0, id, remaining: '0', status: 'funding', title: problem.title, why: null }}
            target={launch.target}
          />
        </div>
      </div>
    </article>
  )
}

function Own(props: { config: Config | undefined; name: string | undefined }) {
  const list = Wire.useSwarms()
  const [question, setQuestion] = useState(() => (props.name ? Nickname.topic(props.name) : (here().searchParams.get('q') ?? '')))
  const [note, setNote] = useState('')
  const drafted = brief(question)
  const [steering, setSteering] = useState<Steering>('team')
  const [engine, setEngine] = useState<Engine>(started)
  const launch = useLaunch('own', drafted.title, drafted.goal, undefined, steering, props.name, engine)
  const free = (list.data ? open(list.data.swarms) : problems).slice(0, Limits.WebNew.free)

  return (
    <div className="page own-page">
      <h1>What breakthrough are you after?</h1>
      <Address name={props.name} />
      <label className="own-ask">
        <span className="sr-only">Your problem</span>
        <textarea autoFocus disabled={launch.busy} id="question" maxLength={Limits.WebNew.questionChars} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. Find the cheapest way to make clean drinking water at home" rows={Limits.WebNew.rows} value={question} />
      </label>
      <div className="own-box">
        <Box
            config={props.config}
            creates
            extra={
              <>
                <Steered disabled={launch.busy} onPick={setSteering} steering={steering} />
                <Runs disabled={launch.busy} engine={engine} onPick={setEngine} />
              </>
            }
            first
            focus={0}
            least="1"
            locked={launch.locked}
            members={[]}
            note={note}
            onDone={() => undefined}
            onNote={setNote}
            bare
            onOpen={() => undefined}
            onSent={landing(props.name)}
            open
            prefill={prefill}
            shared={false}
            swarm={{ balance: '0', contributors: 0, id: 'own', remaining: '0', status: 'funding', title: drafted.title, why: null }}
            target={launch.target}
            wants={question.trim() ? 'Say a little more first' : "Say what you're after first"}
          />
      </div>
      {free.length > 0 && (
        <section className="own-ideas">
          <h2>Or ride one of these</h2>
          <ul className="cards cards-small">{free.map((problem) => <Card idea={fromProblem(problem)} key={problem.id} />)}</ul>
        </section>
      )}
    </div>
  )
}
