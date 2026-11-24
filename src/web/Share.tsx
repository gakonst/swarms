import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Prose from '../shared/Prose.ts'
import * as Site from '../shared/Site.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { usd } from './format.ts'
import { Inline } from './Markdown.tsx'
import { remember, remembered, usePoll } from './hooks.ts'
import * as Pay from './pay.ts'
import { navigate } from './router.tsx'

type Shown = Pick<Summary, 'balance' | 'contributors' | 'form' | 'id' | 'nickname' | 'title'>

function cut(amount: string) {
  return usd(amount).replace(/\.00$/, '')
}

export function links(swarm: Shown, amount?: string) {
  const origin = here().origin
  const page = origin + Site.at(Nickname.path({ id: swarm.id, nickname: swarm.nickname }))
  const card = origin + Site.at(`/x/s/${encodeURIComponent(swarm.id)}`)
  const riders = `${swarm.contributors} rider${swarm.contributors === 1 ? '' : 's'}, ${cut(swarm.balance)} in`
  const title = Prose.plain(swarm.title)
  const text = amount ? `I'm riding ${title} with ${cut(amount)}. ${riders}.` : `${title}: ${riders}.`
  return { intent: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(card)}`, page }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export type Cheer = { amount: string; node?: string | undefined; swarm: string; title?: string | undefined }

let cheer: Cheer | undefined

const listeners = new Set<() => void>()

function show(next: Cheer | undefined) {
  cheer = next
  for (const listener of listeners) listener()
}

export function celebrate(next: Cheer) {
  show(next)
}

Pay.listen((_slot, act) => {
  if (act.at === 'counted') celebrate({ amount: act.amount, node: act.node, swarm: act.swarm, title: act.title })
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function toBoard(swarm: Shown) {
  const board = document.querySelector<HTMLElement>('.branches')
  if (board && board.offsetParent !== null && !document.querySelector('.grove[data-node="open"]')) board.scrollIntoView({ behavior: 'smooth', block: 'start' })
  else navigate(`${Nickname.path({ id: swarm.id, nickname: swarm.nickname })}/board`)
}

export function Cheered() {
  const shown = useSyncExternalStore(subscribe, () => cheer, () => undefined)
  if (!shown) return null
  return <Sheet cheer={shown} key={`${shown.swarm}:${shown.node ?? ''}:${shown.amount}`} />
}

function Sheet(props: { cheer: Cheer }) {
  const id = props.cheer.swarm
  const [swarm, setSwarm] = useState<Shown | undefined>(() => remembered<Shown>(id))
  const [copied, setCopied] = useState(false)
  const go = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    let alive = true
    Api.swarm(id, false).then((detail) => {
      remember(id, detail)
      if (alive) setSwarm(detail)
    }, () => {})
    go.current?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && show(undefined)
    addEventListener('keydown', escape)
    return () => {
      alive = false
      removeEventListener('keydown', escape)
    }
  }, [id])
  const close = () => show(undefined)
  const shared = swarm && links(swarm, props.cheer.amount)
  return (
    <div className="sheet cheer-sheet" onClick={(event) => event.target === event.currentTarget && close()}>
      <div aria-label="You're riding" aria-modal="true" className="sheet-card cheer" role="dialog">
        <button aria-label="Close" className="sheet-close" onClick={close} type="button">×</button>
        <p aria-hidden="true" className="cheer-mark">✓</p>
        <h3 className="cheer-head">You're riding · {cut(props.cheer.amount)}</h3>
        {(props.cheer.title ?? swarm) && <p className="cheer-what"><Inline text={props.cheer.title ?? swarm?.title ?? ''} /></p>}
        {swarm && <p className="cheer-stats"><b>{swarm.contributors}</b> rider{swarm.contributors === 1 ? '' : 's'} · <b>{cut(swarm.balance)}</b> in</p>}
        <div className="cheer-go">
          <a className="btn btn-high" href={shared?.intent} onClick={close} ref={go} rel="noreferrer" target="_blank">Share on X</a>
          <button className="btn btn-medium" disabled={!shared} onClick={() => shared && void copy(shared.page).then(setCopied)} type="button">{copied ? 'Link copied' : 'Invite friends'}</button>
          {swarm?.form === 'tree' && (
            <button
              className="btn btn-medium"
              onClick={() => {
                close()
                toBoard(swarm)
              }}
              type="button"
            >
              Ride another part
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ShareSwarm(props: { id: string }) {
  const [detail] = usePoll(() => Api.swarm(props.id, false), null, props.id)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    addEventListener('pointerdown', close)
    return () => removeEventListener('pointerdown', close)
  }, [open])
  const swarm = detail.data
  if (!swarm) return null
  const shared = links(swarm)
  const tap = () => {
    if (typeof navigator.share === 'function' && matchMedia('(hover: none)').matches) {
      void navigator.share({ title: swarm.title, url: shared.page }).catch(() => {})
      return
    }
    setCopied(false)
    setOpen(!open)
  }
  return (
    <div className="wallet-menu share-menu" data-open={open} ref={menu}>
      <button aria-expanded={open} aria-haspopup="menu" className="game-nav share-go" onClick={tap} type="button">Share</button>
      <div className="wallet-drop">
        <div className="wallet-list" role="menu">
          <a className="wallet-out" href={shared.intent} onClick={() => setOpen(false)} rel="noreferrer" role="menuitem" target="_blank">Share on X</a>
          <button className="wallet-out" onClick={() => void copy(shared.page).then(setCopied)} role="menuitem" type="button">{copied ? 'Link copied' : 'Copy link'}</button>
        </div>
      </div>
    </div>
  )
}
