import { useEffect, useRef, useState } from 'react'
import type { Config, Detail, Said } from '../shared/Api.ts'
import * as Btw from '../shared/Btw.ts'
import { decimal, units } from '../shared/Memo.ts'
import { Alert, explain } from './Alert.tsx'
import * as Api from './api.ts'
import { usd } from './format.ts'
import { message, usePoll, useWallet } from './hooks.ts'
import { Markdown } from './Markdown.tsx'
import { useCredit } from './money.ts'
import { seated, useRoster } from './Steering.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'

const stakes = ['0.5', '1', '5'] as const

function slot(swarm: string, branch: number | null) {
  return `swarms.btw:${swarm}:${branch ?? 'lead'}`
}

function recall(swarm: string, branch: number | null): Btw.Exchange[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const stored = JSON.parse(localStorage.getItem(slot(swarm, branch)) ?? 'null') as { thread?: Btw.Exchange[] } | null
    return stored?.thread ?? []
  } catch {
    return []
  }
}

function keep(swarm: string, branch: number | null, thread: readonly Btw.Exchange[]) {
  if (typeof localStorage === 'undefined') return
  if (thread.length) localStorage.setItem(slot(swarm, branch), JSON.stringify({ thread }))
  else localStorage.removeItem(slot(swarm, branch))
}

function valid(stake: string) {
  return /^\d*\.?\d{0,6}$/.test(stake) && stake !== '' && stake !== '.' && units(stake) >= 10_000n
}

export function Side(props: {
  branch: number | null
  config: Config | undefined
  onBranch: (branch: number | null) => void
  onClose: () => void
  onSaid: (said: Said) => void
  question: { at: number; text: string }
  swarm: Detail
}) {
  const wallet = useWallet()
  const roster = useRoster(props.swarm.id, props.swarm.steering)
  const team = props.swarm.steering === 'team'
  const seat = seated(roster, wallet.session?.address)
  const [listed] = usePoll(() => Api.branches(props.swarm.id), 30_000, `branches:${props.swarm.id}`)
  const branches = (listed.data?.branches ?? []).filter((branch) => branch.parent === null)
  const target = branches.find((branch) => branch.id === props.branch)
  const name = target ? target.who : 'the agent'
  const [thread, setThread] = useState<Btw.Exchange[]>(() => recall(props.swarm.id, props.branch))
  const [pending, setPending] = useState<string>()
  const [text, setText] = useState('')
  const [stake, setStake] = useState<string>('1')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const area = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const credit = useCredit()

  useEffect(() => {
    setThread(recall(props.swarm.id, props.branch))
    setError(undefined)
    setDone(undefined)
  }, [props.swarm.id, props.branch])

  useEffect(() => {
    if (!props.question.at) return
    setText(props.question.text)
    requestAnimationFrame(() => area.current?.focus())
  }, [props.question])

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [thread.length, pending])

  const remember = (next: Btw.Exchange[]) => {
    setThread(next)
    keep(props.swarm.id, props.branch, next)
  }

  const ask = async () => {
    const question = text.trim()
    if (!question || pending) return
    setError(undefined)
    setDone(undefined)
    setPending(question)
    setText('')
    try {
      const answered = await Api.btw(props.swarm.id, { ...(props.branch === null ? {} : { branch: props.branch }), question, thread: Btw.fit(thread) })
      remember([...thread, answered].slice(-Btw.maxThread))
    } catch (reason) {
      setText(question)
      setError(message(reason))
    } finally {
      setPending(undefined)
    }
  }

  const steer = async (artifact: boolean) => {
    const config = props.config
    if (!config || busy || !thread.length || !valid(stake)) return
    setError(undefined)
    setDone(undefined)
    const kept = Btw.fit(thread)
    try {
      const need = units(stake)
      if (team) {
        if (!seat) throw new Error("Only this swarm's team steers it. Ask one of its admins in the room to add you.")
      } else await credit.cover(config, props.swarm, need, setBusy)
      setBusy('Sending…')
      if (props.branch === null) {
        const posted = await Api.say(props.swarm.id, { artifact, btw: kept, steer: decimal(need), text: `@swarm ${Btw.note(kept, artifact)}` })
        props.onSaid(posted.message)
      } else await Api.fund(props.swarm.id, props.branch, { amount: decimal(need), message: Btw.collapse(kept, artifact) })
      credit.spend(need)
      setDone(artifact ? `Asked ${name} for an artifact, with ${usd(decimal(need))} behind it.` : `Steered ${name} with this thread and ${usd(decimal(need))}.`)
      remember([])
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const share = async () => {
    const last = thread.at(-1)
    if (!last || busy) return
    setError(undefined)
    setBusy('Sharing…')
    try {
      const posted = await Api.say(props.swarm.id, { text: `Asked ${name} on the side: "${last.question.slice(0, 300)}"\n\n${last.answer.slice(0, 1200)}` })
      props.onSaid(posted.message)
      setDone('Shared to the room.')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const gate = (() => {
    if (!wallet.session)
      return (
        <button
          className="side-go"
          disabled={!!busy || !props.config}
          onClick={() => {
            if (!props.config) return
            setBusy('Approve in Tempo Wallet…')
            void Wallet.signIn(props.config).catch((reason: unknown) => setError(message(reason))).finally(() => setBusy(undefined))
          }}
          type="button"
        >
          {busy ?? 'Sign in to ask on the side'}
        </button>
      )
    if (wallet.account && !wallet.account.name) return <Username why="Pick a username to ask the swarm on the side and steer it." />
    if (team && roster && !seat) return <p className="side-note"><b>Only its team asks this swarm on the side.</b> Its admins add who may.</p>
    return undefined
  })()

  return (
    <aside aria-label="Ask on the side" className="side">
      <header className="side-head">
        <div className="side-title">
          <b>On the side</b>
          <select aria-label="Who to ask" onChange={(event) => props.onBranch(event.target.value === 'lead' ? null : Number(event.target.value))} value={props.branch ?? 'lead'}>
            <option value="lead">The agent</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.who}</option>
            ))}
          </select>
        </div>
        <button aria-label="Close" className="side-close" onClick={props.onClose} type="button">×</button>
      </header>
      <p className="side-how">Answered from {name}'s own context without interrupting it. Steer with the thread, or ask for an artifact, by putting money behind it.</p>
      <ol className="side-list" ref={list}>
        {thread.map((exchange, index) => (
          <li key={index}>
            <p className="side-q">{exchange.question}</p>
            <div className="side-a"><Markdown text={exchange.answer} /></div>
          </li>
        ))}
        {pending && (
          <li>
            <p className="side-q">{pending}</p>
            <p aria-busy="true" className="side-a side-wait">Thinking…</p>
          </li>
        )}
        {!thread.length && !pending && <li className="side-empty">Ask {name} anything: where it stands, why it chose something, what a result means.</li>}
      </ol>
      {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
      {done && <p className="side-done">{done}</p>}
      {gate ?? (
        <>
          {thread.length > 0 && props.swarm.status !== 'done' && (
            <div className="side-act">
              <div className="say-stake" role="radiogroup" aria-label="How much behind it">
                {stakes.map((value) => (
                  <button aria-checked={stake === value} disabled={!!busy} key={value} onClick={() => setStake(value)} role="radio" type="button">${value === '0.5' ? '0.50' : value}</button>
                ))}
                <label className="say-own">$<input aria-label="Your amount" disabled={!!busy} inputMode="decimal" onChange={(event) => setStake(event.target.value.replace(',', '.').replace('$', ''))} onFocus={(event) => event.target.select()} placeholder="…" value={(stakes as readonly string[]).includes(stake) ? '' : stake} /></label>
              </div>
              <div className="side-buttons">
                <button disabled={!!busy || !valid(stake)} onClick={() => void steer(false)} type="button">Steer with this</button>
                <button disabled={!!busy || !valid(stake)} onClick={() => void steer(true)} type="button">Ask for an artifact</button>
                <button className="side-quiet" disabled={!!busy} onClick={() => void share()} type="button">Share to room</button>
                <button className="side-quiet" disabled={!!busy} onClick={() => remember([])} type="button">Clear</button>
              </div>
              <p className="side-note">{busy ?? (team ? `From the swarm's money${seat?.left === null || seat?.left === undefined ? '' : ` · ${usd(seat.left)} of your team budget left`}.` : 'New money from your wallet goes behind it.')}</p>
            </div>
          )}
          <form className="side-box" onSubmit={(event) => { event.preventDefault(); void ask() }}>
            <textarea
              disabled={!!pending}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void ask()
                }
              }}
              placeholder={`Ask ${name} on the side`}
              ref={area}
              rows={2}
              value={text}
            />
            <button aria-label="Ask" className="say-send" disabled={!!pending || !text.trim()} type="submit">↑</button>
          </form>
        </>
      )}
    </aside>
  )
}
