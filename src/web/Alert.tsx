import type { ReactNode } from 'react'
import { Link } from './router.tsx'

type Action = { href: string; label: string } | { label: string; onClick: () => void } | { label: string; to: string }

const marks = { bad: '!', good: '✓', warn: '·' } as const

export function Alert(props: { action?: Action | undefined; children?: ReactNode; title: string; tone: keyof typeof marks }) {
  const action = props.action
  return (
    <div className="alert" data-tone={props.tone} role={props.tone === 'bad' ? 'alert' : 'status'}>
      <span aria-hidden="true" className="alert-mark">{marks[props.tone]}</span>
      <div className="alert-text">
        <b>{props.title}</b>
        {props.children && <span>{props.children}</span>}
      </div>
      {action &&
        ('to' in action ? (
          <Link className="alert-go" to={action.to}>{action.label} →</Link>
        ) : 'href' in action ? (
          <a className="alert-go" href={action.href} rel="noreferrer" target="_blank">{action.label} ↗</a>
        ) : (
          <button className="alert-go" onClick={action.onClick} type="button">{action.label} →</button>
        ))}
    </div>
  )
}

export function explain(error: string) {
  const text = error.split('\n')[0]?.trim() ?? error
  if (/^Sent, but not counted yet\./.test(text)) return { detail: text.replace(/^Sent, but not counted yet\. /, ''), title: 'Sent, but not counted yet.' }
  if (/no accounts connected|disconnected/i.test(text)) return { detail: 'Connect Tempo Wallet and try again.', title: 'Tempo Wallet is not connected.' }
  if (/declined|rejected|denied|cancel/i.test(text)) return { detail: 'Nothing was charged.', title: 'You declined in Tempo Wallet.' }
  if (/less than|insufficient|too little|balance/i.test(text)) return { detail: text, title: 'Not enough in your wallet.' }
  if (/fetch|network|unavailable|not answering|timeout/i.test(text)) return { detail: 'Check your connection and try again.', title: "Couldn't reach Swarms." }
  return { detail: text, title: 'That did not go through.' }
}
