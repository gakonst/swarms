import { useRef, useState } from 'react'
import type { Config, Steering } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import * as Setup from '../shared/Setup.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Box } from './Box.tsx'
import { Card, fromProblem, pill } from './Card.tsx'
import type { Target } from './Contribute.tsx'
import { usd } from './format.ts'
import { brief, open, problems } from './research.ts'
import { Back, navigate, useCanBack } from './router.tsx'
import { Steered } from './Steering.tsx'
import * as Wire from './wire.ts'

const prefill = { amount: '5', note: '', token: undefined } as const

const offered = ['frontier-anthropic', 'frontier-openai', 'frontier-mix'] as const

type Offered = (typeof offered)[number]

function asked(): Offered {
  const template = here().searchParams.get('template')
  return offered.find((name) => name === template) ?? Setup.fallback
}

function least(config: Config | undefined, template: Offered) {
  const resolved = Setup.resolve({ template })
  if (typeof resolved === 'string' || !config?.models.length) return undefined
  const priced = Setup.priced(resolved, new Map(config.models.map((model) => [model.id, model])))
  return typeof priced === 'string' ? undefined : decimal(BigInt(priced.most))
}

function starter() {
  const asked = here().searchParams.get('q')
  return asked === null ? undefined : problems.find((problem) => problem.id === asked)
}

function Runs(props: { config: Config | undefined; onPick: (template: Offered) => void; template: Offered }) {
  const prices = new Map((props.config?.models ?? []).map((model) => [model.id, model]))
  return (
    <div aria-label="Runs on" className="runs" role="radiogroup">
      <p>Runs on</p>
      {offered.map((name) => {
        const preset = Setup.presets[name]
        const resolved = Setup.resolve({ template: name })
        const priced = typeof resolved === 'string' || !prices.size ? undefined : Setup.priced(resolved, prices)
        return (
          <label data-on={props.template === name} key={name}>
            <input checked={props.template === name} name="runs" onChange={() => props.onPick(name)} type="radio" value={name} />
            <i aria-hidden="true" />
            <span><b>{preset.label}</b> <span>{Setup.name(preset.model)}</span></span>
            <small>{priced && typeof priced !== 'string' ? `${usd(decimal(BigInt(priced.step)))} a step` : ''}</small>
          </label>
        )
      })}
      <label aria-disabled="true" data-soon="true">
        <input disabled name="runs" type="radio" value="abliterated" />
        <i aria-hidden="true" />
        <span><b>Abliterated</b></span>
        <small>Soon</small>
      </label>
    </div>
  )
}

function useLaunch(title: string, goal: string, problem: string | undefined, template: Offered, steering: Steering) {
  const created = useRef<Target | undefined>(undefined)
  const target = async (step: (step: 'create') => void) => {
    if (created.current) return created.current
    step('create')
    const swarm = await Api.create({ steering, template, goal: goal.trim(), title: title.trim(), ...(problem ? { problem } : {}) })
    created.current = { id: swarm.id }
    return created.current
  }
  return { locked: !(title.trim().length >= 1 && title.trim().length <= 80 && goal.trim().length >= 10 && goal.trim().length <= 12_000), reset: () => (created.current = undefined), target }
}

function landed(swarm: Target) {
  navigate(`/s/${encodeURIComponent(swarm.id)}`, { replace: true })
}

export function New(props: { config: Config | undefined }) {
  const [picked] = useState(starter)
  return picked ? <Seed config={props.config} problem={picked} /> : <Own config={props.config} />
}

function Seed(props: { config: Config | undefined; problem: Problem }) {
  const problem = props.problem
  const [note, setNote] = useState('')
  const [template, setTemplate] = useState(asked)
  const [steering, setSteering] = useState<Steering>('team')
  const launch = useLaunch(problem.title, problem.goal, problem.id, template, steering)
  const pick = (next: Offered) => {
    setTemplate(next)
    launch.reset()
  }
  const steer = (next: Steering) => {
    setSteering(next)
    launch.reset()
  }
  const id = `idea:${problem.id}`
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
          </header>
          <Box
            config={props.config}
            extra={<><Runs config={props.config} onPick={pick} template={template} /><Steered onPick={steer} steering={steering} /></>}
            first
            focus={0}
            least={least(props.config, template)}
            locked={launch.locked}
            members={[]}
            note={note}
            onDone={landed}
            onNote={setNote}
            onOpen={() => undefined}
            open
            prefill={prefill}
            shared={false}
            sign={steering === 'team'}
            swarm={{ balance: '0', contributors: 0, id, remaining: '0', status: 'funding', title: problem.title, why: null }}
            target={launch.target}
          />
        </div>
      </div>
    </article>
  )
}

function Own(props: { config: Config | undefined }) {
  const list = Wire.useSwarms()
  const [question, setQuestion] = useState('')
  const [note, setNote] = useState('')
  const drafted = brief(question)
  const [template, setTemplate] = useState(asked)
  const [steering, setSteering] = useState<Steering>('team')
  const launch = useLaunch(drafted.title, drafted.goal, undefined, template, steering)
  const pick = (next: Offered) => {
    setTemplate(next)
    launch.reset()
  }
  const steer = (next: Steering) => {
    setSteering(next)
    launch.reset()
  }
  const free = (list.data ? open(list.data.swarms) : problems).slice(0, 3)

  return (
    <div className="page own-page">
      <h1>What breakthrough are you after?</h1>
      <label className="own-ask">
        <span className="sr-only">Your problem</span>
        <textarea autoFocus id="question" maxLength={10_000} onChange={(event) => { setQuestion(event.target.value); launch.reset() }} placeholder="e.g. Find the cheapest way to make clean drinking water at home" rows={3} value={question} />
      </label>
      <div className="own-box">
        <Box
            config={props.config}
            extra={<><Runs config={props.config} onPick={pick} template={template} /><Steered onPick={steer} steering={steering} /></>}
            first
            focus={0}
            least={least(props.config, template)}
            locked={launch.locked}
            members={[]}
            note={note}
            onDone={landed}
            onNote={setNote}
            bare
            onOpen={() => undefined}
            open
            prefill={prefill}
            shared={false}
            sign={steering === 'team'}
            swarm={{ balance: '0', contributors: 0, id: 'own', remaining: '0', status: 'funding', title: drafted.title, why: null }}
            target={launch.target}
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
