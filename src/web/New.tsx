import { useEffect, useRef, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Fund, type Target } from './Contribute.tsx'
import * as Setup from '../shared/Setup.ts'
import { Models, price, ready } from './Models.tsx'
import { decimal } from '../shared/Memo.ts'
import { brief, open, problems } from './research.ts'
import { Link, navigate } from './router.tsx'
import * as Wire from './wire.ts'

const stages = ['Start', 'Fund'] as const
const titles = ['Start a breakthrough.', 'Fund it.'] as const
const prefill = { amount: '2', mode: 'send', note: '', token: undefined } as const

function starter() {
  const asked = here().searchParams.get('q')
  return asked === null ? undefined : problems.find((problem) => problem.id === asked)
}

export function New(props: { config: Config | undefined }) {
  const [picked] = useState(starter)
  const list = Wire.useSwarms()
  const [page, setPage] = useState(0)
  const [peek, setPeek] = useState<string | undefined>(() => (picked ? picked.id : undefined))
  const free = list.data ? open(list.data.swarms) : list.error ? [...problems] : []
  const shown = free.length > 6 ? Array.from({ length: 6 }, (_, index) => free[(page * 6 + index) % free.length]!).filter((item, index, all) => all.indexOf(item) === index) : free
  const [stage, setStage] = useState(picked ? 1 : 0)
  const [question, setQuestion] = useState<string>(picked?.title ?? '')
  const [title, setTitle] = useState<string>(picked?.title ?? '')
  const [goal, setGoal] = useState<string>(picked?.goal ?? '')
  const [problem, setProblem] = useState<string | undefined>(picked?.id)
  const [note, setNote] = useState('')
  const [choice, setChoice] = useState<Setup.Choice>({ template: Setup.fallback })
  const priced = price(props.config, choice)
  const [created, setCreated] = useState<Target>()
  const heading = useRef<HTMLHeadingElement>(null)
  const questionReady = question.trim().length >= 10
  const briefReady = title.trim().length >= 3 && title.trim().length <= 80 && goal.trim().length >= 10 && goal.trim().length <= 2000

  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [stage])

  const target = async (step: (step: 'create') => void) => {
    if (created) return created
    step('create')
    const swarm = await Api.create({ ...choice, goal: goal.trim(), title: title.trim(), ...(problem ? { problem } : {}) })
    const next = { id: swarm.id, wallet: swarm.wallet }
    setCreated(next)
    return next
  }

  return (
    <div className="page quest-onboarding">
      <nav aria-label="Quest setup" className="quest-steps">
        {stages.map((label, index) => <button aria-current={stage === index ? 'step' : undefined} className="quest-step" data-reached={index <= stage} disabled={index > stage} key={label} onClick={() => { if (index === 0) setCreated(undefined); setStage(index) }} type="button"><span>{index < stage ? '✓' : `0${index + 1}`}</span>{label}</button>)}
      </nav>
      <div className="quest-heading"><h1 ref={heading} tabIndex={-1}>{titles[stage]}</h1></div>
      <form onSubmit={(event) => { event.preventDefault(); if (stage === 0 && questionReady) { if (!goal) { const next = brief(question); setTitle(next.title); setGoal(next.goal) } setStage(1) } }}>
        {stage === 0 && <div className="quest-choose">
          <ol className="tiles-swarm ideas" data-loading={!list.data && !list.error}>
            {!list.data && !list.error && Array.from({ length: 4 }, (_, index) => <li className="tile-ghost" key={index} />)}
            {list.data && !free.length && <li><Link className="tile-swarm" to="/join"><i className="tile-mark" /><span className="tile-title">Every idea has a swarm. Join one</span><span className="tile-raised">→</span></Link></li>}
            {shown.map((item) => {
              const opened = peek === item.id
              const choose = () => { setPeek(item.id); setQuestion(item.title); setTitle(item.title); setGoal(item.goal); setProblem(item.id) }
              return (
                <li data-open={opened} key={item.id}>
                  <button aria-expanded={opened} className="tile-swarm" onClick={() => (opened ? goal.trim().length >= 10 && setStage(1) : choose())} type="button">
                    <i className="tile-mark" data-tone={problems.indexOf(item) % 3} />
                    <span className="tile-title">{item.label}</span>
                  </button>
                  {opened && (
                    <div className="tile-swarm tile-own tile-edit">
                      <span className="tile-more">
                        <span className="tile-lead">{item.hint}</span>
                        <label className="tile-edit-label" htmlFor={`brief-${item.id}`}>The brief, yours to edit</label>
                        <textarea id={`brief-${item.id}`} maxLength={2000} onChange={(event) => setGoal(event.target.value)} rows={6} value={goal} />
                        <button className="btn btn-high quest-next" disabled={goal.trim().length < 10} onClick={() => setStage(1)} type="button">Next <span aria-hidden="true">→</span></button>
                        {goal.trim().length < 10 && <span className="tile-why">The brief needs at least 10 characters.</span>}
                      </span>
                    </div>
                  )}
                </li>
              )
            })}
            {free.length > 6 && <li><button className="tile-swarm tile-more-ideas" onClick={() => { setPage(page + 1); setPeek(undefined) }} type="button"><i className="tile-mark" data-tone="more" /><span className="tile-title">More ideas</span><span className="tile-raised">↻</span></button></li>}
            <li data-open={peek === 'own'}>
              {peek === 'own' ? (
                <div className="tile-swarm tile-own">
                  <i className="tile-mark" data-tone="own" />
                  <label className="tile-title" htmlFor="question">Your own idea</label>
                  <span className="tile-more">
                    <textarea autoFocus id="question" maxLength={1000} onChange={(event) => { setQuestion(event.target.value); setTitle(''); setGoal(''); setProblem(undefined) }} placeholder="What should it find out or build?" rows={3} value={question} />
                    <button aria-describedby={questionReady ? undefined : 'question-why'} className="btn btn-high quest-next" disabled={!questionReady} type="submit">Next <span aria-hidden="true">→</span></button>
                    {!questionReady && <span className="tile-why" id="question-why">{question.trim().length === 0 ? 'Say what you want done in at least 10 characters.' : `${10 - question.trim().length} more character${10 - question.trim().length === 1 ? '' : 's'} to go.`}</span>}
                  </span>
                </div>
              ) : (
                <button className="tile-swarm tile-quiet" onClick={() => setPeek('own')} type="button"><i className="tile-mark" data-tone="own" /><span className="tile-title">Your own idea</span><span className="tile-raised">+</span></button>
              )}
            </li>
          </ol>
        </div>}
        {stage === 1 && <div className="quest-budget">
          <Models config={props.config} onChange={(next) => { setChoice(next); setCreated(undefined) }} value={choice} />
          <Fund
            action={(label) => (label === 'Chip in' ? 'Launch' : `Launch · ${label.replace('Chip in ', '')}`)}
            config={props.config}
            least={priced ? decimal(BigInt(priced.most)) : undefined}
            locked={!briefReady || !ready(choice)}
            note={note}
            onChange={() => { setCreated(undefined); setStage(0) }}
            onDone={(swarm) => navigate(`/s/${swarm.id}`)}
            onNote={setNote}
            prefill={prefill}
            target={target}
            title={title}
          />
        </div>}
      </form>
    </div>
  )
}
