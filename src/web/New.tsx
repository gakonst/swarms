import { useRef, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import * as Setup from '../shared/Setup.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Box } from './Box.tsx'
import { Card, Cover, fromProblem, Pill } from './Card.tsx'
import type { Target } from './Contribute.tsx'
import { useMedia } from './hooks.ts'
import { brief, open, problems } from './research.ts'
import { Back, navigate, useCanBack } from './router.tsx'
import * as Wire from './wire.ts'

const prefill = { amount: '5', note: '', token: undefined } as const

const offered = ['cheap', 'frontier-mix', 'fable'] as const

type Offered = (typeof offered)[number]

function asked(): Offered {
  const template = here().searchParams.get('template')
  return offered.find((name) => name === template) ?? 'cheap'
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

function Runs(props: { onPick: (template: Offered) => void; template: Offered }) {
  return (
    <label className="runs-on">
      <span>Runs on</span>
      <select onChange={(event) => props.onPick(event.target.value as Offered)} value={props.template}>
        {offered.map((name) => (
          <option key={name} value={name}>{Setup.labels[name]}</option>
        ))}
      </select>
    </label>
  )
}

function useLaunch(title: string, goal: string, problem: string | undefined, template: Offered) {
  const created = useRef<Target | undefined>(undefined)
  const target = async (step: (step: 'create') => void) => {
    if (created.current) return created.current
    step('create')
    const swarm = await Api.create({ template, goal: goal.trim(), title: title.trim(), ...(problem ? { problem } : {}) })
    created.current = { id: swarm.id }
    return created.current
  }
  return { locked: !(title.trim().length >= 3 && title.trim().length <= 80 && goal.trim().length >= 10 && goal.trim().length <= 12_000), reset: () => (created.current = undefined), target }
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
  const phone = useMedia('(max-width: 899px)')
  const [open, setOpen] = useState(false)
  const [template, setTemplate] = useState(asked)
  const launch = useLaunch(problem.title, problem.goal, problem.id, template)
  const pick = (next: Offered) => {
    setTemplate(next)
    launch.reset()
  }
  const id = `idea:${problem.id}`
  const backed = useCanBack()

  return (
    <article className="page idea-page">
      <div className="idea">
        <Back className="idea-back" to="/ideas">{backed ? '← Back' : '← All ideas'}</Back>
        <header className="idea-head">
          <Pill mood="new" word="Not started" />
          <h1>{problem.title}</h1>
          <p className="idea-pitch">{problem.hint}</p>
        </header>
        <div className="idea-grid">
          <Box
            config={props.config}
            focus={0}
            least={least(props.config, template)}
            locked={launch.locked}
            members={[]}
            note={note}
            onDone={landed}
            onNote={setNote}
            onOpen={() => setOpen(true)}
            open={open || !phone}
            prefill={prefill}
            shared={false}
            swarm={{ contributors: 0, id, raised: '0', remaining: '0', status: 'funding', title: problem.title, why: null }}
            target={launch.target}
          />
          <div className="idea-main">
            <div className="idea-cover"><Cover id={id} mood="new" /></div>
            <Runs onPick={pick} template={template} />
          </div>
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
  const launch = useLaunch(drafted.title, drafted.goal, undefined, template)
  const pick = (next: Offered) => {
    setTemplate(next)
    launch.reset()
  }
  const enough = question.trim().length >= 10
  const free = (list.data ? open(list.data.swarms) : problems).slice(0, 3)

  return (
    <div className="page own-page">
      <h1>What should AI figure out or build?</h1>
      <label className="own-ask">
        <span className="sr-only">Your idea</span>
        <textarea autoFocus id="question" maxLength={10_000} onChange={(event) => { setQuestion(event.target.value); launch.reset() }} placeholder="e.g. Find the cheapest way to make clean drinking water at home" rows={3} value={question} />
      </label>
      {enough && (
        <div className="own-box">
          <Box
            config={props.config}
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
            swarm={{ contributors: 0, id: 'own', raised: '0', remaining: '0', status: 'funding', title: drafted.title, why: null }}
            target={launch.target}
          />
          <Runs onPick={pick} template={template} />
        </div>
      )}
      {free.length > 0 && (
        <section className="own-ideas">
          <h2>Or back one of these</h2>
          <ul className="cards cards-small">{free.map((problem) => <Card idea={fromProblem(problem)} key={problem.id} />)}</ul>
        </section>
      )}
    </div>
  )
}
