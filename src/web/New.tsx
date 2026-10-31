import { useEffect, useRef, useState } from 'react'
import type { Config, Currency, Summary } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { mach, symbols } from './format.ts'
import { message } from './hooks.ts'
import { Amount, code, disclosure, NoteField, pledge, type Step, Tokens, valid } from './Pledge.tsx'
import { brief, questions } from './research.ts'
import { Link, navigate } from './router.tsx'
import * as Wallet from './wallet.ts'

const stages = ['Choose', 'Equip', 'Launch'] as const
const working = { create: 'Preparing your swarm…', request: 'Preparing your budget…', approve: 'Approve in Tempo Wallet…', confirm: 'Launching…' } as const
const titles = ['Pick your first quest.', 'Fuel your swarm.', 'Ready for discovery?'] as const

export function New(props: { config: Config | undefined }) {
  const [stage, setStage] = useState(0)
  const [question, setQuestion] = useState('')
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [amount, setAmount] = useState('0.25')
  const [note, setNote] = useState('')
  const [token, setToken] = useState<Currency>('mach')
  const [state, setState] = useState<{ created?: Summary; error?: string; short?: boolean; step?: Step | 'create' }>({})
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = state.step !== undefined
  const questionReady = question.trim().length >= 10
  const budgetReady = valid(amount, props.config) && !!props.config && note.length <= maxNote
  const ready = title.trim().length >= 3 && title.trim().length <= 80 && goal.trim().length >= 10 && goal.trim().length <= 2000 && budgetReady && !busy

  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [stage])

  const submit = async () => {
    const config = props.config
    if (!config || !ready) return
    let created = state.created
    try {
      if (!created) {
        setState({ step: 'create' })
        created = await Api.create({ goal: goal.trim(), title: title.trim() })
      }
      const swarm = created
      await pledge(config, swarm.id, amount, note, token, (step) => setState({ created: swarm, step }))
      navigate(`/s/${swarm.id}`)
    } catch (error) {
      setState({ ...(created ? { created } : {}), error: message(error), short: code(error) === 'insufficient_balance' })
    }
  }

  return (
    <div className="page quest-onboarding">
      <nav aria-label="Quest setup" className="quest-steps">
        {stages.map((label, index) => <button aria-current={stage === index ? 'step' : undefined} className="quest-step" data-reached={index <= stage} disabled={busy || index > stage || (index === 0 && !!state.created)} key={label} onClick={() => setStage(index)} type="button"><span>{index < stage ? '✓' : `0${index + 1}`}</span>{label}</button>)}
      </nav>
      <div className="quest-heading"><p className="label">New expedition</p><h1 ref={heading} tabIndex={-1}>{titles[stage]}</h1><p>{stage === 0 ? 'Choose a challenge. Your team takes it from here.' : stage === 1 ? 'A fixed budget. You stay in control.' : 'Your question. Your team. One shared adventure.'}</p></div>
      <form onSubmit={(event) => { event.preventDefault(); if (stage === 0 && questionReady) { if (!goal) { const next = brief(question); setTitle(next.title); setGoal(next.goal) } setStage(1) } else if (stage === 1 && budgetReady) setStage(2); else if (stage === 2) void submit() }}>
        {stage === 0 && <div className="quest-choose">
          <div className="quest-options">{questions.map((item, index) => <button className="quest-option" key={item.title} onClick={() => { setQuestion(item.title); setTitle(item.title); setGoal(item.goal); setStage(1) }} type="button"><span aria-hidden="true" className={`quest-emblem quest-emblem-${index}`}><i /><i /><i /></span><span className="quest-option-title">{item.label}</span><span className="quest-option-hint">{item.hint}</span><span aria-hidden="true" className="quest-option-arrow">↗</span></button>)}</div>
          <label className="quest-custom" htmlFor="question">Or ask your own<textarea id="question" maxLength={1000} onChange={(event) => { setQuestion(event.target.value); setTitle(''); setGoal('') }} placeholder="What would you love to figure out?" rows={2} value={question} /></label>
          <button className="btn btn-high quest-next" disabled={!questionReady} type="submit">Continue <span aria-hidden="true">→</span></button>
        </div>}
        {stage === 1 && <div className="quest-budget">
          <p className="quest-chosen"><span aria-hidden="true">✧</span>{title}</p>
          <Amount config={props.config} label="Starting budget" onChange={setAmount} suffix={symbols[token]} value={amount} />
          <details className="game-details"><summary>More options</summary><Tokens config={props.config} onChange={setToken} value={token} /><NoteField hint="Tell the team what to prioritize." onChange={setNote} value={note} /></details>
          <p className="quest-budget-hint">Unused funds return when the quest ends.</p>
          {!props.config && <p className="quest-wallet-hint" role="status">Connecting to Tempo…</p>}
          <button className="btn btn-high quest-next" disabled={!budgetReady} type="submit">Review & launch <span aria-hidden="true">→</span></button>
        </div>}
        {stage === 2 && <div className="quest-review">
          <div className="quest-launch-emblem" aria-hidden="true"><span className="quest-emblem"><i /><i /><i /></span></div>
          <h2>{title}</h2><p className="quest-budget-value">{valid(amount, props.config) ? mach(decimal(units(amount))) : amount} <span>{symbols[token]}</span></p>
          <p className="quest-budget-hint">Your spending limit. No automatic top-ups.</p>
          <details className="game-details"><summary>Research brief</summary><label className="quest-custom" htmlFor="title">Quest name<input disabled={!!state.created || busy} id="title" maxLength={80} onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="quest-custom" htmlFor="goal">What the team will investigate<textarea disabled={!!state.created || busy} id="goal" maxLength={2000} onChange={(event) => setGoal(event.target.value)} rows={6} value={goal} /></label></details>
          <details className="game-details"><summary>Wallet permissions</summary><p>{disclosure(token)}</p></details>
          <button className="btn btn-high quest-next" disabled={!ready} type="submit">{state.step ? working[state.step] : state.created ? 'Retry launch' : 'Launch swarm'} <span aria-hidden="true">↗</span></button>
          <p className="quest-wallet-hint">You'll approve in Tempo Wallet.</p>
        </div>}
        {state.error && <p className="error" role="alert">{state.error}{state.short && token === 'mach' && <> <button className="btn btn-minimal" onClick={() => void Wallet.fund(units(amount) - (Wallet.snapshot().balances.mach ?? 0n))} type="button">Add MACH</button></>}</p>}
        {state.created && !busy && <p className="notice">Your quest is saved. <Link to={`/s/${state.created.id}`}>Open it</Link></p>}
      </form>
    </div>
  )
}
