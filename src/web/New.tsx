import { useState } from 'react'
import type { Config, Currency, Summary } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { mach, symbols } from './format.ts'
import { message } from './hooks.ts'
import { Amount, code, disclosure, NoteField, pledge, type Step, Tokens, valid, WalletLine } from './Pledge.tsx'
import { Link, navigate } from './router.tsx'
import * as Wallet from './wallet.ts'
import { questions } from './research.ts'

const stages = [
  ['create', 'Create the swarm'],
  ['request', 'Prepare the pledge'],
  ['approve', 'Approve the key in Tempo Wallet'],
  ['confirm', 'Record the pledge'],
] as const satisfies readonly (readonly [Step | 'create', string])[]

export function New(props: { config: Config | undefined }) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [amount, setAmount] = useState('0.25')
  const [note, setNote] = useState('')
  const [token, setToken] = useState<Currency>('mach')
  const [state, setState] = useState<{ created?: Summary; error?: string; short?: boolean; step?: Step | 'create' }>({})
  const busy = state.step !== undefined
  const ready = title.trim().length >= 3 && title.trim().length <= 80 && goal.trim().length >= 10 && goal.trim().length <= 2000 && valid(amount, props.config) && note.length <= maxNote && !!props.config && !busy
  const reached = state.step ? stages.findIndex(([key]) => key === state.step) : state.created ? 1 : -1

  const submit = async () => {
    const config = props.config
    if (!config) return
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
    <div className="page new">
      <section className="grid">
        <div className="new-intro">
          <p className="label">
            <span className="index">[N]</span> A new research frontier
          </p>
          <h1 className="display">What should we discover?</h1>
          <p className="lead">Turn an open question into a research swarm. Define the evidence you want to see, fund the first round, and invite others to help it go further.</p>
        </div>
      </section>
      <section className="grid">
        <form
          className="new-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) void submit()
          }}
        >
          <div className="research-starters">
            <p className="label">Start from a research brief</p>
            <div className="actions">{questions.map((question) => <button className="btn btn-low" disabled={!!state.created || busy} key={question.title} onClick={() => { setTitle(question.title); setGoal(question.goal) }} type="button">{question.title} <span aria-hidden="true">↗</span></button>)}</div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="title">
              Title
            </label>
            <div className="field-input">
              <input disabled={!!state.created} id="title" maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Find a better post-quantum signature scheme" value={title} />
            </div>
            <p className="field-hint">
              <span>A short name for your research swarm.</span>
              <span>{title.length}/80</span>
            </p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="goal">
              Research question & evidence
            </label>
            <div className="field-input">
              <textarea disabled={!!state.created} id="goal" maxLength={2000} onChange={(event) => setGoal(event.target.value)} placeholder="What question should the swarm investigate? Specify the baselines, experiments, sources and reproducible artifacts that would make the result useful. Include what would disprove the idea." rows={7} value={goal} />
            </div>
            <p className="field-hint">
              <span>Ask for testable claims, reproducible work and negative results.</span>
              <span>{goal.length}/2000</span>
            </p>
          </div>
          <Tokens config={props.config} onChange={setToken} value={token} />
          <Amount config={props.config} onChange={setAmount} suffix={symbols[token]} value={amount} />
          <NoteField hint="Optional. The first note the swarm reads, weighted by your pledge." onChange={setNote} value={note} />
          <WalletLine amount={amount} config={props.config} token={token} />
          <button className="btn btn-high btn-wide" disabled={!ready} type="submit">
            {busy ? (stages.find(([key]) => key === state.step)?.[1] ?? 'Working') + '…' : state.created ? 'Try the pledge again' : `Start the swarm with ${valid(amount, props.config) ? mach(decimal(units(amount))) : ''} ${symbols[token]}`}
          </button>
          {state.error && (
            <p className="error">
              {state.error}
              {state.short && token === 'mach' && (
                <>
                  {' '}
                  <button className="btn btn-minimal" onClick={() => void Wallet.fund(units(amount) - (Wallet.snapshot().balances.mach ?? 0n))} type="button">
                    Add MACH
                  </button>
                </>
              )}
            </p>
          )}
          {state.created && !busy && (
            <p className="notice">
              The swarm exists and waits for its first pledge. <Link to={`/s/${state.created.id}`}>Open it</Link>
            </p>
          )}
        </form>
        <aside className="new-aside">
          <ol className="stages">
            {stages.map(([key, label], index) => (
              <li data-state={index < reached ? 'done' : index === reached && busy ? 'active' : 'pending'} key={key}>
                <span className="index">[{index + 1}]</span>
                {label}
              </li>
            ))}
          </ol>
          <p className="fine">{disclosure(token)}</p>
          {props.config && (
            <p className="fine">
              The minimum pledge is {mach(props.config.minPledge)} {symbols[token]}. Each explorer beyond the first needs ${mach(props.config.perWorker)} left to spend, and the swarm pauses below ${mach(props.config.reserve)}. Once it exists, anyone can also send it money once or give it a daily budget.
            </p>
          )}
        </aside>
      </section>
    </div>
  )
}

