import { useState } from 'react'
import type { Config } from '../shared/Api.ts'
import { decimal } from '../shared/Memo.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import * as Setup from '../shared/Setup.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Card, Cover, fromProblem, Pill } from './Card.tsx'
import { Fuel, type Target } from './Contribute.tsx'
import { Models, price, ready } from './Models.tsx'
import { brief, open, problems } from './research.ts'
import { Link, navigate } from './router.tsx'
import * as Wire from './wire.ts'

const prefill = { amount: '5', note: '', token: undefined } as const

function starter() {
  const asked = here().searchParams.get('q')
  return asked === null ? undefined : problems.find((problem) => problem.id === asked)
}

function useLaunch(config: Config | undefined, title: string, goal: string, problem: string | undefined) {
  const [choice, setChoice] = useState<Setup.Choice>({ template: Setup.fallback })
  const [created, setCreated] = useState<Target>()
  const priced = price(config, choice)
  const target = async (step: (step: 'create') => void) => {
    if (created) return created
    step('create')
    const swarm = await Api.create({ ...choice, goal: goal.trim(), title: title.trim(), ...(problem ? { problem } : {}) })
    const next = { id: swarm.id, wallet: swarm.wallet }
    setCreated(next)
    return next
  }
  const fine = title.trim().length >= 3 && title.trim().length <= 80 && goal.trim().length >= 10 && goal.trim().length <= 2000
  return {
    choice,
    least: priced ? decimal(BigInt(priced.most)) : undefined,
    locked: !fine || !ready(choice),
    pick: (next: Setup.Choice) => {
      setChoice(next)
      setCreated(undefined)
    },
    reset: () => setCreated(undefined),
    target,
  }
}

export function New(props: { config: Config | undefined }) {
  const [picked] = useState(starter)
  return picked ? <Seed config={props.config} problem={picked} /> : <Own config={props.config} />
}

function Seed(props: { config: Config | undefined; problem: Problem }) {
  const problem = props.problem
  const [goal, setGoal] = useState(problem.goal)
  const [note, setNote] = useState('')
  const launch = useLaunch(props.config, problem.title, goal, problem.id)
  const id = `idea:${problem.id}`

  return (
    <div className="page idea-page">
      <div className="idea">
        <Link className="idea-back" to="/join">← All ideas</Link>
        <header className="idea-head">
          <Pill mood="new" word="Not started" />
          <h1>{problem.title}</h1>
          <p className="idea-pitch">{problem.hint}</p>
        </header>
        <div className="idea-grid">
          <aside className="box" id="back">
            <p className="box-raised"><b>$0</b> raised</p>
            <p className="box-people">Be the first backer</p>
            <p className="box-state">AI agents start the moment someone backs it.</p>
            <Fuel config={props.config} least={launch.least} locked={launch.locked} note={note} onDone={(swarm) => navigate(`/s/${swarm.id}`)} onNote={setNote} prefill={prefill} target={launch.target} />
          </aside>
          <div className="idea-main">
            <div className="idea-cover"><Cover id={id} mood="new" /></div>
            <section className="idea-section">
              <h2>The plan</h2>
              <p className="idea-plan-text">{goal}</p>
            </section>
            <details className="idea-section advanced">
              <summary><h2>Advanced</h2></summary>
              <label className="advanced-label" htmlFor="brief">Edit the plan</label>
              <textarea id="brief" maxLength={2000} onChange={(event) => { setGoal(event.target.value); launch.reset() }} rows={7} value={goal} />
              <Models config={props.config} onChange={launch.pick} value={launch.choice} />
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}

function Own(props: { config: Config | undefined }) {
  const list = Wire.useSwarms()
  const [question, setQuestion] = useState('')
  const [note, setNote] = useState('')
  const drafted = brief(question)
  const launch = useLaunch(props.config, drafted.title, drafted.goal, undefined)
  const enough = question.trim().length >= 10
  const free = (list.data ? open(list.data.swarms) : problems).slice(0, 3)

  return (
    <div className="page own-page">
      <h1>What should AI figure out or build?</h1>
      <label className="own-ask">
        <span className="sr-only">Your idea</span>
        <textarea autoFocus id="question" maxLength={1000} onChange={(event) => { setQuestion(event.target.value); launch.reset() }} placeholder="e.g. Find the cheapest way to make clean drinking water at home" rows={3} value={question} />
      </label>
      {enough ? (
        <div className="box own-box">
          <p className="box-state">Back it to get AI agents started.</p>
          <Fuel config={props.config} least={launch.least} locked={launch.locked} note={note} onDone={(swarm) => navigate(`/s/${swarm.id}`)} onNote={setNote} prefill={prefill} target={launch.target} />
          <details className="advanced">
            <summary>Advanced</summary>
            <Models config={props.config} onChange={launch.pick} value={launch.choice} />
          </details>
        </div>
      ) : (
        <p className="own-hint">{question.trim().length === 0 ? 'One or two sentences is enough.' : 'A little more…'}</p>
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
