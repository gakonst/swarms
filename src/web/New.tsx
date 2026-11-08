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

const choice: Setup.Choice = { template: Setup.fallback }

function least(config: Config | undefined) {
  const resolved = Setup.resolve(choice)
  if (typeof resolved === 'string' || !config?.models.length) return undefined
  const priced = Setup.priced(resolved, new Map(config.models.map((model) => [model.id, model])))
  return typeof priced === 'string' ? undefined : decimal(BigInt(priced.most))
}

function starter() {
  const asked = here().searchParams.get('q')
  return asked === null ? undefined : problems.find((problem) => problem.id === asked)
}

function useLaunch(title: string, goal: string, problem: string | undefined) {
  const created = useRef<Target | undefined>(undefined)
  const target = async (step: (step: 'create') => void) => {
    if (created.current) return created.current
    step('create')
    const swarm = await Api.create({ ...choice, goal: goal.trim(), title: title.trim(), ...(problem ? { problem } : {}) })
    created.current = { id: swarm.id, wallet: swarm.wallet }
    return created.current
  }
  return { locked: !(title.trim().length >= 3 && title.trim().length <= 80 && goal.trim().length >= 10 && goal.trim().length <= 2000), reset: () => (created.current = undefined), target }
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
  const launch = useLaunch(problem.title, problem.goal, problem.id)
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
            least={least(props.config)}
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
  const launch = useLaunch(drafted.title, drafted.goal, undefined)
  const enough = question.trim().length >= 10
  const free = (list.data ? open(list.data.swarms) : problems).slice(0, 3)

  return (
    <div className="page own-page">
      <h1>What should AI figure out or build?</h1>
      <label className="own-ask">
        <span className="sr-only">Your idea</span>
        <textarea autoFocus id="question" maxLength={1000} onChange={(event) => { setQuestion(event.target.value); launch.reset() }} placeholder="e.g. Find the cheapest way to make clean drinking water at home" rows={3} value={question} />
      </label>
      {enough && (
        <div className="own-box">
          <Box
            config={props.config}
            focus={0}
            least={least(props.config)}
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
