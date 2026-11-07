import { useEffect, useRef, useState } from 'react'
import type { Config, Detail, Said } from '../shared/Api.ts'
import * as Btw from '../shared/Btw.ts'
import { decimal, units } from '../shared/Memo.ts'
import { Alert, explain } from './Alert.tsx'
import { useBranches } from './Branches.tsx'
import * as Api from './api.ts'
import { usd } from './format.ts'
import { message } from './hooks.ts'
import { Markdown } from './Markdown.tsx'
import { useCredit } from './money.ts'
import { useGate } from './Steering.tsx'
import { Username } from './Username.tsx'
import * as Wallet from './wallet.ts'

const stakes = ['0.5', '1', '5'] as const

type Mode = 'artifact' | 'steer'

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

function amount(text: string) {
  const typed = text.replace(/^\$/, '').replace(',', '.').trim()
  return valid(typed) ? typed : undefined
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
  const door = useGate(props.swarm)
  const listed = useBranches(props.swarm.id, props.swarm.status === 'running')
  const branches = (listed.data?.branches ?? []).filter((branch) => branch.parent === null)
  const target = branches.find((branch) => branch.id === props.branch)
  const name = target ? target.who : 'the agent'
  const Name = target ? target.who : 'The agent'
  const [thread, setThread] = useState<Btw.Exchange[]>(() => recall(props.swarm.id, props.branch))
  const [pending, setPending] = useState<string>()
  const [text, setText] = useState('')
  const [stake, setStake] = useState<string>('0.5')
  const [mode, setMode] = useState<Mode>('steer')
  const [offer, setOffer] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<{ detail: string; title: string }>()
  const [hint, setHint] = useState<string>()
  const area = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const send = useRef<HTMLButtonElement>(null)
  const credit = useCredit()
  const team = typeof door === 'object' && door.at === 'open' && door.from === 'team'
  const kept = Btw.fit(thread)
  const typed = text.trim()
  const command = Btw.command(text)
  const ok = valid(stake)
  const price = ok ? usd(decimal(units(stake))) : undefined
  const asking = !thread.length && mode === 'artifact' && !!typed && !command
  const shown = thread.length > 0 || (offer && !!typed && !command)
  const chosen: Mode = thread.length ? mode : 'artifact'
  const note = asking ? Btw.note([{ answer: '', question: typed }], true) : Btw.note(kept, chosen === 'artifact')

  useEffect(() => {
    setThread(recall(props.swarm.id, props.branch))
    setError(undefined)
    setDone(undefined)
    setHint(undefined)
  }, [props.swarm.id, props.branch])

  const collapsing = (rest: string) => {
    const asked = amount(rest)
    if (asked) setStake(asked)
    setMode('steer')
    setText('')
    setDone(undefined)
    setError(undefined)
    if (!recall(props.swarm.id, props.branch).length) return setHint(`Nothing to collapse yet. Ask ${name} something on the side first; /collapse then steers it with that thread.`)
    setHint(undefined)
    requestAnimationFrame(() => send.current?.focus())
  }

  useEffect(() => {
    if (!props.question.at) return
    const asked = Btw.command(props.question.text)
    if (asked?.name === 'collapse') return collapsing(asked.rest)
    setText(asked ? asked.rest : props.question.text)
    requestAnimationFrame(() => area.current?.focus())
  }, [props.question])

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [thread.length, pending])

  const remember = (next: Btw.Exchange[]) => {
    setThread(next)
    keep(props.swarm.id, props.branch, next)
  }

  const ask = async (question = typed): Promise<Btw.Exchange[] | undefined> => {
    if (!question || pending) return undefined
    setError(undefined)
    setDone(undefined)
    setHint(undefined)
    setPending(question)
    setText('')
    try {
      const answered = await Api.btw(props.swarm.id, { ...(props.branch === null ? {} : { branch: props.branch }), question, thread: Btw.fit(thread) })
      const next = [...thread, answered].slice(-Btw.maxThread)
      remember(next)
      return next
    } catch (reason) {
      setText(question)
      setError(message(reason))
      return undefined
    } finally {
      setPending(undefined)
    }
  }

  const submit = () => {
    if (!command) return void ask()
    if (command.name === 'close') return props.onClose()
    if (command.name === 'collapse') return collapsing(command.rest)
    if (command.rest) void ask(command.rest)
    else setText('')
  }

  const steer = async () => {
    const config = props.config
    if (!config || busy || pending || !ok) return
    const artifact = chosen === 'artifact'
    const asked = asking ? await ask() : thread
    if (!asked?.length) return
    setError(undefined)
    setDone(undefined)
    setHint(undefined)
    const sent = Btw.fit(asked)
    const line = Btw.note(sent, artifact)
    const need = units(stake)
    const paid = usd(decimal(need))
    try {
      if (typeof door !== 'object' || door.at !== 'open') throw new Error("Only this swarm's team steers it. Ask one of its admins in the room to add you.")
      if (door.from === 'backing') await credit.cover(config, props.swarm, need, setBusy)
      setBusy(artifact ? 'Asking for the artifact…' : 'Collapsing into a steer…')
      if (props.branch === null) {
        const posted = await Api.say(props.swarm.id, { artifact, btw: sent, steer: decimal(need), text: `@swarm ${line}` })
        props.onSaid(posted.message)
      } else await Api.fund(props.swarm.id, props.branch, { amount: decimal(need), artifact, message: Btw.collapse(sent, artifact) })
      const from = door.from === 'team' ? `${paid} of the swarm's money (your team budget)` : `${paid} from your wallet`
      const what = sent.length === 1 ? 'your question and its answer' : `your ${sent.length} questions and their answers`
      setDone(
        artifact
          ? { detail: `${from} went behind “${line}”, with ${what}. ${Name} publishes or updates an artifact of it and carries on; it shows under Artifacts.`, title: `Asked ${name} for an artifact` }
          : { detail: `${from} went behind “${line}”, with ${what}. ${Name} reads the whole thread ${target ? 'at once' : 'on its next step'}, and the steer shows in the transcript.`, title: `Collapsed into a steer of ${name}` },
      )
      setOffer(false)
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
      setDone({ detail: 'Your last question and its answer are in the room. Nothing was paid and the agent was not steered.', title: 'Shared to the room' })
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const gate = (() => {
    if (door === 'checking') return <p aria-busy="true" className="side-note" />
    if (door === 'signed-out')
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
    if (door === 'unnamed') return <Username why="Pick a username to ask the swarm on the side and steer it." />
    if (door.at === 'not-member') return <p className="side-note"><b>Only its team asks this swarm on the side.</b> Its admins add who may.</p>
    return undefined
  })()

  const what = (() => {
    const from = team ? `Puts ${price ?? 'the amount'} of the swarm's money (your team budget${typeof door === 'object' && door.at === 'open' && door.left !== null ? `, ${usd(door.left)} left` : ''})` : `Sends ${price ?? 'the amount you choose'} from your wallet to the swarm and puts it`
    const thread = asking ? 'your question and its answer' : kept.length === 1 ? 'this question and its answer' : `these ${kept.length} questions and their answers`
    const first = asking ? `Asks this first (the swarm pays for the answer). Then it ${from.charAt(0).toLowerCase()}${from.slice(1)}` : from
    if (chosen === 'artifact') return `${first} behind “${note}”, with ${thread}, asking ${name} to publish or update an artifact that shows what you asked about.`
    return `${first} behind “${note}”, with ${thread}. ${Name} reads the whole thread ${target ? 'at once' : 'on its next step'} and weighs it by that money.`
  })()

  const label = (() => {
    if (busy) return busy
    const money = price ?? '…'
    if (chosen === 'artifact') return team ? `Ask for an artifact with ${money}` : `Add ${money} and ask for an artifact`
    return team ? `Collapse with ${money}` : `Add ${money} and collapse`
  })()

  return (
    <aside aria-label="Ask on the side" className="side">
      <header className="side-head">
        <div className="side-title">
          <b>/btw</b>
          <select aria-label="Who to ask" onChange={(event) => props.onBranch(event.target.value === 'lead' ? null : Number(event.target.value))} value={props.branch ?? 'lead'}>
            <option value="lead">The agent</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.who}</option>
            ))}
          </select>
        </div>
        <button aria-label="Close" className="side-close" onClick={props.onClose} type="button">×</button>
      </header>
      <p className="side-how"><b>Asking takes nothing from your wallet:</b> {name} answers from its own context without stopping its work, and the swarm pays for each answer. <b>/collapse</b> is what costs you: it sends the amount you choose, with this thread, to steer {name}.</p>
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
      {done && <Alert title={done.title} tone="good">{done.detail}</Alert>}
      {hint && <p className="side-note">{hint}</p>}
      {gate ?? (
        <>
          {shown && (
            <section aria-label="Collapse into a steer" className="side-act">
              {thread.length > 0 && (
                <div aria-label="What to do with this thread" className="side-modes" role="radiogroup">
                  <button aria-checked={mode === 'steer'} disabled={!!busy} onClick={() => setMode('steer')} role="radio" type="button">/collapse into a steer</button>
                  <button aria-checked={mode === 'artifact'} disabled={!!busy} onClick={() => setMode('artifact')} role="radio" type="button">Ask for an artifact</button>
                </div>
              )}
              <p className="side-what">{what}</p>
              <div className="say-stake" role="radiogroup" aria-label="How much behind it">
                {stakes.map((value) => (
                  <button aria-checked={stake === value} disabled={!!busy} key={value} onClick={() => setStake(value)} role="radio" type="button">${value === '0.5' ? '0.50' : value}</button>
                ))}
                <label className="say-own">$<input aria-label="Your amount" disabled={!!busy} inputMode="decimal" onChange={(event) => setStake(event.target.value.replace(',', '.').replace('$', ''))} onFocus={(event) => event.target.select()} placeholder="…" value={(stakes as readonly string[]).includes(stake) ? '' : stake} /></label>
              </div>
              {!ok && <p className="side-note">At least $0.01.</p>}
              <div className="side-buttons">
                <button className="side-send" disabled={!!busy || !!pending || !ok} onClick={() => void steer()} ref={send} type="button">{label}</button>
                {thread.length > 0 && <button className="side-quiet" disabled={!!busy} onClick={() => void share()} title="Post your last question and its answer in the room. Free; it does not steer the agent." type="button">Share to room</button>}
                {thread.length > 0 && <button className="side-quiet" disabled={!!busy} onClick={() => { remember([]); setDone(undefined) }} title="Forget this thread. Nothing is sent." type="button">Clear</button>}
                {!thread.length && <button className="side-quiet" disabled={!!busy} onClick={() => setOffer(false)} type="button">Cancel</button>}
              </div>
            </section>
          )}
          <form className="side-box" onSubmit={(event) => { event.preventDefault(); submit() }}>
            <textarea
              disabled={!!pending}
              onChange={(event) => { setText(event.target.value); setHint(undefined) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder={thread.length ? `Ask ${name} a follow-up, or type /collapse` : `Ask ${name} on the side`}
              ref={area}
              rows={2}
              value={text}
            />
            <button aria-label="Ask" className="say-send" disabled={!!pending || !typed} type="submit">↑</button>
          </form>
          {!thread.length && !!typed && !command && !offer && <button className="say-side" disabled={!!pending} onClick={() => { setMode('artifact'); setOffer(true) }} type="button">Or ask this and request an artifact of the answer, with money behind it <span aria-hidden="true">→</span></button>}
        </>
      )}
    </aside>
  )
}
