import { useState } from 'react'
import type { Issued, Summary } from '../shared/Api.ts'
import { Alert, explain } from './Alert.tsx'
import * as Api from './api.ts'
import { message } from './hooks.ts'

type Step = { kind: 'closed' } | { kind: 'naming'; label: string } | { kind: 'issuing'; label: string } | { error: string; kind: 'failed'; label: string } | { hand: Issued; kind: 'issued' }

function Shell(props: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="shell">
      <div className="shell-bar">
        <span>{props.label}</span>
        <button onClick={() => void navigator.clipboard?.writeText(props.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })} type="button">{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre>{props.text}</pre>
    </div>
  )
}

export function Connect(props: { swarm: Summary }) {
  const [step, setStep] = useState<Step>({ kind: 'closed' })
  const [form, setForm] = useState<'cli' | 'library'>('cli')

  const issue = async (label: string) => {
    setStep({ kind: 'issuing', label })
    try {
      setStep({ hand: await Api.hand(props.swarm.id, label.trim()), kind: 'issued' })
    } catch (error) {
      setStep({ error: message(error), kind: 'failed', label })
    }
  }

  return (
    <ol className="tiles-swarm lend">
      <li data-open={step.kind !== 'closed'}>
        <button aria-expanded={step.kind !== 'closed'} className="tile-swarm machine-row" onClick={() => setStep(step.kind === 'closed' ? { kind: 'naming', label: '' } : { kind: 'closed' })} type="button">
          <i aria-hidden="true" className="machine-glyph" data-kind="lend">+</i>
          <span className="tile-title">Lend your machine</span>
          <span className="tile-raised">{step.kind === 'closed' ? '' : '−'}</span>
          <span className="machine-sub">The agent runs commands on it. You can charge for it.</span>
        </button>
        {step.kind !== 'closed' && (
          <div className="machine-open">
            {step.kind === 'issued' ? (
              <>
                <div className="fuel-seg" role="radiogroup">
                  {(['cli', 'library'] as const).map((value) => (
                    <button aria-checked={form === value} key={value} onClick={() => setForm(value)} role="radio" type="button">{value === 'cli' ? 'nanocode' : 'nanocode-ts'}</button>
                  ))}
                </div>
                {form === 'cli' ? (
                  <>
                    <Shell label={`run in the folder you share · ${step.hand.name}`} text={step.hand.cli} />
                    <details className="lend-more"><summary>No nanocode yet</summary><Shell label="installs it, then runs the hand" text={step.hand.command} /></details>
                    <details className="lend-more"><summary>Charge for it</summary><Shell label="add --pricing prices.json" text={'{"payee":"0x…","describe":"Q3 data, $0.01 a file","rules":[{"paths":["data/**"],"ops":["read"],"usd":0.01}]}'} /></details>
                  </>
                ) : (
                  <>
                    <Shell label="install" text={step.hand.npm} />
                    <Shell label="hand.mjs" text={step.hand.library} />
                  </>
                )}
                <p className="machine-none">The token is shown only once. It appears above as soon as it connects.</p>
              </>
            ) : (
              <form className="say-box lend-name" onSubmit={(event) => { event.preventDefault(); if (step.kind !== 'issuing') void issue(step.label) }}>
                <input aria-label="Name it" autoFocus disabled={step.kind === 'issuing'} maxLength={32} onChange={(event) => setStep({ kind: 'naming', label: event.target.value })} placeholder="Name it, like my-laptop" value={step.label} />
                <button className="btn btn-high lend-go" disabled={step.kind === 'issuing'} type="submit">{step.kind === 'issuing' ? 'Issuing…' : 'Get the command'}</button>
              </form>
            )}
            {step.kind === 'failed' && <Alert action={{ label: 'Try again', onClick: () => void issue(step.label) }} title={explain(step.error).title} tone="bad">{explain(step.error).detail}</Alert>}
          </div>
        )}
      </li>
    </ol>
  )
}
