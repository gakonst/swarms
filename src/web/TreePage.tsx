import { useCallback, useEffect, useRef, useState } from 'react'
import type { Config, Detail, Member, NodeUpdates, NodeView, ProofsView, Said, TreeView } from '../shared/Api.ts'
import * as Prose from '../shared/Prose.ts'
import * as Status from '../shared/Status.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Api from './api.ts'
import { here, seeded } from './boot.ts'
import * as Grove from './grove.ts'
import { Branches } from './Branches.tsx'
import { Composer, lines, TreeChannel } from './Channel.tsx'
import { Code } from './Code.tsx'
import { Divider } from './Divider.tsx'
import { ago } from './format.ts'
import { Headline, Since } from './Headline.tsx'
import { useMedia, useNow, usePoll } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Inline } from './Markdown.tsx'
import { NodePanel, Ride } from './Node.tsx'
import * as Pay from './pay.ts'
import { Room } from './Room.tsx'
import { back, Link, navigate, useBase } from './router.tsx'
import { shareTree } from './channels.ts'
import { useShown } from './Share.tsx'
import { useSwipe } from './Shell.tsx'
import { scene } from './stage.ts'
import { at, backers, Explainer, Strip, type Tab, Tabs } from './Strip.tsx'
import { Filters, Mark } from './Tree.tsx'
import * as Wire from './wire.ts'

const downMs = 15_000

function chosen(raw: string | null): Grove.Filter {
  return Grove.filters.some(([key]) => key === raw) ? (raw as Grove.Filter) : 'all'
}

function unfolded(data: TreeView | undefined, selected: string) {
  const told = here().searchParams.get('open')
  const byId = new Map((data?.nodes ?? []).map((node) => [node.id, node] as const))
  const trail: string[] = []
  for (let node = byId.get(selected); node && node.id !== 'root' && trail.length < 64; node = node.parent ? byId.get(node.parent) : undefined) trail.push(node.id)
  if (told !== null) return new Set(['root', ...told.split(',').filter(Boolean), ...trail])
  return new Set(['root', ...(byId.get('root')?.children ?? []), ...trail])
}

function query(pairs: readonly (readonly [string, string])[]) {
  return pairs.map(([key, value]) => (value ? `${encodeURIComponent(key)}=${value.split(',').map(encodeURIComponent).join(',')}` : `${encodeURIComponent(key)}=`)).join('&')
}

function carried(to: string) {
  const now = new URLSearchParams(location.search)
  const kept = ['open', 'filter'].flatMap((key) => {
    const value = now.get(key)
    return value === null ? [] : [[key, value] as const]
  })
  return kept.length ? `${to}?${query(kept)}` : to
}

export function TreePage(props: { channel?: string | undefined; config: Config | undefined; detail: Detail; id: string; nid: string | undefined; view: Tab }) {
  const id = props.id
  const view = props.view
  const selected = props.nid ?? props.channel ?? 'root'
  const thread = props.nid !== undefined && props.nid !== 'root'
  const base = useBase(id)
  const path = useCallback((nid: string) => (nid === 'root' ? `${base}/board` : `${base}/t/${nid}`), [base])
  const phone = useMedia('(max-width: 899px)')
  const now = useNow(30_000)
  const [filter, setFilter] = useState<Grove.Filter>(() => chosen(here().searchParams.get('filter')))
  const [detail, redetail] = usePoll(() => Api.swarm(id, false), null, id)
  const [tree, retree] = usePoll(() => Api.tree(id, { depth: 2 }), () => (Wire.state(id, 'room') === 'down' ? downMs : null), `tree:${id}`)
  const [grove, setGrove] = useState<Grove.Grove | undefined>(() => tree.data && Grove.grow(tree.data))
  const [node, review, setView] = usePoll(() => Api.node(id, selected), null, `node:${id}:${selected}`)
  const [updates, reupdate, setUpdates] = usePoll(() => Api.nodeUpdates(id, selected), null, `updates:${id}:${selected}`)
  const held = props.channel ?? (thread && grove ? Grove.trail(grove.nodes, selected).find((node) => node.parent === 'root')?.id : undefined)
  const room = held ?? selected
  const [roomNode, reroom] = usePoll(() => Api.node(id, room), null, `node:${id}:${room}`)
  const [roomUpdates, reroomUpdates] = usePoll(() => Api.nodeUpdates(id, room), null, `updates:${id}:${room}`)
  const [burn, reburn] = usePoll(() => Api.burn(id), null, `burn:${id}`)
  const [proofs, reproof, setProofs] = usePoll(() => Api.proofs(id), null, `proofs:${id}`)
  const told = useRef(here().searchParams.has('open'))
  const [open, setOpen] = useState<ReadonlySet<string>>(() => unfolded(tree.data, selected))
  const scroller = useRef<HTMLDivElement>(null)
  const scrolled = useRef<string | undefined>(undefined)
  const [more, setMore] = useState<Readonly<Record<string, number>>>({})
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set([view]))
  const [unread, setUnread] = useState(0)
  const [riding, setRiding] = useState<{ anchor?: HTMLElement | undefined; nid: string } | undefined>()
  const [composing, setComposing] = useState<string | undefined>()
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())
  const [settled, setSettled] = useState<string | undefined>()
  const [members, setMembers] = useState<readonly Member[]>(() => seeded<{ members: Member[] }>(`room:${id}`)?.members ?? [])
  const swarm = detail.data ?? props.detail
  useShown(swarm)
  Pay.useKept(Pay.slot(id, 'root'), () => setRiding((current) => current ?? { nid: 'root' }))

  useEffect(() => {
    setSeen((current) => (current.has(view) ? current : new Set([...current, view])))
  }, [view])

  const wired = Wire.useWire(id, 'room', (signal) => {
    if (signal.type === 'delta') {
      const delta = signal.delta
      setGrove((current) => current && Grove.patch(current, delta))
      if (delta.event === 'funded') redetail()
      if (delta.node.id === selected) {
        setView((current: NodeView | undefined) => current && { ...current, ...delta.node, funders: current.funders, runs: current.runs })
        if (delta.event !== 'doing') setUpdates((current: NodeUpdates | undefined) => current && { deltas: [delta, ...current.deltas.filter((each) => each.seq !== delta.seq)], next: Math.max(current.next, delta.seq) })
        if (delta.event === 'proven' || delta.event === 'ended' || delta.event === 'started' || delta.event === 'funded' || delta.event === 'moved' || delta.event === 'steered') review()
      }
      if (held && delta.node.id === held && held !== selected && delta.event !== 'doing') {
        reroom()
        reroomUpdates()
      }
      if (delta.event === 'proven' && delta.node.proof) {
        const check = delta.node.proof
        setProofs((current: ProofsView | undefined) => ({ proofs: [{ check, node: delta.node.id, title: delta.node.title }, ...(current?.proofs ?? []).filter((each) => each.node !== delta.node.id)] }))
      }
    }
    if (signal.type === 'stir' && signal.cause === 'welcome') {
      redetail()
      retree()
      reburn()
      reproof()
      review()
      reupdate()
    }
  })

  useEffect(() => {
    const data: TreeView | undefined = tree.data
    if (!data) return
    setGrove((current) => (!current || data.seq >= current.seq ? Grove.grow(data, current) : current))
    if (!told.current) setOpen((current) => (current.size > 1 ? current : unfolded(data, selected)))
  }, [tree.data])

  useEffect(() => {
    document.title = `${Prose.plain(swarm.title)} · Swarms`
  }, [swarm.title])

  const nodes = grove?.nodes ?? {}

  useEffect(() => {
    if (grove) shareTree(id, grove.nodes)
  }, [grove, id])

  useEffect(() => {
    if (!grove) return
    const trail = Grove.trail(grove.nodes, selected).map((node) => node.id)
    if (trail.some((nid) => !open.has(nid))) setOpen((current) => new Set([...current, ...trail]))
  }, [selected, !!grove])

  useEffect(() => {
    const box = scroller.current
    if (!box || selected === 'root' || scrolled.current === selected) return
    const row = box.querySelector<HTMLElement>('.limb[data-selected] > .bud')
    if (!row) return
    scrolled.current = selected
    const outer = box.getBoundingClientRect()
    const inner = row.getBoundingClientRect()
    if (inner.top < outer.top || inner.bottom > outer.bottom) box.scrollTop += inner.top - outer.top - Math.min(outer.height / 4, 80)
  })

  useEffect(() => {
    if (!grove || !node.data || grove.nodes[selected]) return
    let alive = true
    const climb = async (from: string | null, steps: number) => {
      if (!from || steps > 8 || !alive) return
      const got = await Api.tree(id, { depth: 1, root: from }).catch(() => undefined)
      if (!got || !alive) return
      setGrove((current) => current && Grove.graft(current, got))
      const top = got.nodes.find((node) => node.id === from)
      setOpen((current) => new Set([...current, from]))
      if (top?.parent && !grove.nodes[top.parent]) await climb(top.parent, steps + 1)
      else if (top?.parent) setOpen((current) => new Set([...current, top.parent!]))
    }
    const climbed = selected
    void climb(node.data.parent, 0).finally(() => alive && setSettled(climbed))
    return () => {
      alive = false
    }
  }, [selected, !!node.data, !!grove])

  const heard = useCallback((_said: readonly Said[], _me: unknown, list: readonly Member[]) => setMembers(list), [])
  const ride = useCallback((anchor: HTMLElement) => setRiding({ anchor, nid: 'root' }), [])
  const steer = useCallback(() => setRiding({ nid: 'root' }), [])

  useEffect(
    () =>
      Pay.listen((_slot, act) => {
        const owed = Pay.sent(act)
        if (act.at === 'counting' && owed?.swarm === id && owed.parent && owed.node) {
          const made = owed.node
          setFresh((current) => (current.has(made) ? current : new Set([...current, made])))
        }
        if (act.at !== 'counted' || act.swarm !== id) return
        redetail()
        const made = act.node
        if (!made) return
        setGrove((current) => current && { ...current, landed: { ...current.landed, [made]: Date.now() } })
        const parent = act.parent
        if (!parent) return
        setOpen((current) => (current.has(parent) ? current : new Set([...current, parent])))
        void Api.tree(id, { depth: 1, root: parent }).then((got) => setGrove((current) => current && Grove.graft(current, got)), () => {})
        if (phone) navigate(path(made), { keep: true })
        else navigate(carried(path(made)), { keep: true, replace: true })
      }),
    [id, phone, path],
  )
  const results = useCallback(() => navigate(`${base}/results`, { keep: true, replace: true }), [base])

  const close = () => (phone ? back(carried(`${base}/board`)) : navigate(carried(`${base}/board`), { keep: true, replace: true }))
  const swiped = useSwipe({ right: close })

  const filtered = (next: Grove.Filter) => {
    setFilter(next)
    const url = new URL(location.href)
    if (next === 'all') url.searchParams.delete('filter')
    else url.searchParams.set('filter', next)
    history.replaceState(history.state, '', url.pathname + url.search)
  }

  const unfold = (node: Tree.Node) => {
    if (!node.children.length) return
    if (grove && Grove.missing(grove.nodes, node.id)) void Api.tree(id, { depth: 2, root: node.id }).then((got) => setGrove((current) => current && Grove.graft(current, got)), () => {})
  }

  const fold = (node: Tree.Node) => {
    const next = new Set(open)
    if (next.has(node.id)) next.delete(node.id)
    else {
      next.add(node.id)
      unfold(node)
    }
    told.current = true
    setOpen(next)
    const rest = [...new URLSearchParams(location.search)].filter(([key]) => key !== 'open')
    history.replaceState(history.state, '', `${location.pathname}?${query([...rest, ['open', [...next].filter((nid) => nid !== 'root').join(',')]])}`)
  }

  const pick = (node: Tree.Node) => {
    if (node.form !== 'goal' && !open.has(node.id)) setOpen((current) => new Set([...current, node.id]))
    unfold(node)
    if (node.id === selected) return
    if (phone) navigate(path(node.id), { keep: true })
    else navigate(carried(path(node.id)), { keep: true, replace: true })
  }

  const show = (next: Tab) => {
    if (next === view) return
    navigate(next === 'board' ? carried(`${base}/board`) : at(base, next), { keep: true, replace: true })
  }

  const propose = (nid: string) => `${path(nid)}?propose`

  if (!grove)
    return tree.error ? (
      <Lost title="This tree did not load.">
        <button className="lost-row" onClick={() => retree()} type="button">Try again <span aria-hidden="true">↻</span></button>
        <Link className="lost-row" to="/ideas">All swarms <span aria-hidden="true">→</span></Link>
      </Lost>
    ) : (
      <section aria-busy="true" className="page lost"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    )

  const last = proofs.data?.proofs[0]
  const head = grove.headline
  const names = new Map<string, string>()
  for (const each of Object.values(nodes)) for (const funder of each.funders) if (funder.who.address) names.set(funder.who.address.toLowerCase(), funder.who.handle)
  for (const member of members) names.set(member.address.toLowerCase(), member.handle)
  const top = backers(swarm.contributions, names)
  const stood = Status.standing({ ...swarm, inFlight: head.inFlight })
  const root = nodes['root']
  const repo = proofs.data?.proofs[0]?.check.repo
  const count = root ? root.children.length : 0
  return (
    <article className="grove" data-room={held ? '' : undefined} data-tab={view} data-thread={thread || undefined} data-wire={wired}>
      <Strip backers={top} onRide={root ? ride : undefined} raised={swarm.balance} riders={swarm.contributors} title={swarm.title} topic={swarm.goal}>
        <span><b>{head.proven.toLocaleString('en-US')}</b> proven</span>
        <span data-live={head.inFlight > 0 || undefined}><b>{head.inFlight.toLocaleString('en-US')}</b> in flight</span>
        <span className="strip-mood" data-mood={stood.mood} title={Status.line(stood.word)}><i />{Status.pill(stood.word)}</span>
      </Strip>
      <Tabs base={base} board={count ? `Threads ${count}` : 'Threads'} onShow={show} unread={unread} view={view} />
      <div className="panel panel-chat" hidden={!!held}>
        <Room config={props.config} onArtifact={results} onBack={steer} onMessages={heard} onResults={results} onUnread={setUnread} steer={false} swarm={swarm} visible={!held && (view === 'chat' || view === 'board' || !phone)} />
      </div>
      {(seen.has('board') || seen.has('chat')) && (
        <div className="grove-body panel panel-board" hidden={view !== 'board' && view !== 'chat'}>
          <section aria-label="Threads" className="grove-tree">
            <Filters filter={filter} nodes={nodes} onFilter={filtered} />
            <div className="grove-scroll" data-finding={(thread && !nodes[selected] && !node.error && settled !== selected) || undefined} ref={scroller}>
              <Branches
                composing={composing}
                config={props.config}
                filter={filter}
                fresh={fresh}
                landed={grove.landed}
                more={more}
                nodes={nodes}
                now={now}
                onCompose={setComposing}
                onFold={fold}
                onMore={(nid, count) => setMore((current) => ({ ...current, [nid]: count }))}
                onPick={pick}
                open={open}
                path={path}
                propose={propose}
                selected={selected === 'root' ? '' : selected}
                shape={scene.has('spine') ? 'spine' : 'tree'}
                swarm={id}
              />
            </div>
            <Since id={id} nodes={nodes} now={now} />
          </section>
        </div>
      )}
      <Divider hidden={view !== 'board' && view !== 'chat'} />
      {seen.has('results') && (
        <div className="panel panel-page" hidden={view !== 'results'}>
          <Headline burn={burn.data?.burn} headline={head} id={id} last={last} now={now} />
          {proofs.data && proofs.data.proofs.length > 0 ? (
            <ol className="proofs">
              {proofs.data.proofs.map((proof) => (
                <li key={proof.node}>
                  <Link className="proof" keep to={path(proof.node)}><Mark status="proven" /><Inline text={proof.title} /><time>{ago(proof.check.at, now)}</time></Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tree-empty">Nothing proven yet. What Lean checks lands here.</p>
          )}
        </div>
      )}
      {seen.has('code') && (
        <div className="panel panel-page" hidden={view !== 'code'}>
          {swarm.code ? (
            <Code repo={swarm.code} swarm={id} />
          ) : repo ? (
            <>
              <p className="code-lead">Every proven item is a commit in <a href={`https://github.com/${repo}`} rel="noreferrer" target="_blank">{repo} ↗</a></p>
              <ol className="proofs">
                {proofs.data?.proofs.map((proof) => (
                  <li key={proof.node}>
                    <a className="proof" href={`https://github.com/${proof.check.repo}/commit/${proof.check.commit}`} rel="noreferrer" target="_blank"><code>{proof.check.commit.slice(0, 7)}</code><span>{proof.check.theorem}</span><time>{ago(proof.check.at, now)}</time></a>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="tree-empty">No code yet. Each proof lands here as a commit once Lean checks it.</p>
          )}
        </div>
      )}
      {seen.has('about') && (
        <div className="panel panel-page" hidden={view !== 'about'}>
          <Explainer spec={root?.spec} swarm={swarm} />
        </div>
      )}
      {held && nodes[held] && (
        <div className="panel panel-chat">
        <TreeChannel
          config={props.config}
          lines={lines(nodes[held], roomNode.data?.id === held ? roomNode.data : undefined, roomUpdates.data?.deltas)}
          node={nodes[held]}
          nodes={nodes}
          now={now}
          onPost={async (text) => {
            await Api.suggest(id, { parent: held, text })
            reroom()
          }}
          onRide={(anchor) => setRiding({ anchor, nid: held })}
          path={path}
          swarm={id}
          swarmTitle={swarm.title}
          thread={thread ? selected : undefined}
        />
        </div>
      )}
      {thread && (
        <aside aria-label="Thread" className="thread" {...swiped}>
          <header className="thread-head">
            <button aria-label="Close the thread" className="thread-close" onClick={close} type="button"><span aria-hidden="true">{phone ? '‹' : '×'}</span></button>
            <p><b>Thread</b><span><i aria-hidden="true">#</i><Inline text={held && nodes[held] ? nodes[held]!.title : swarm.title} /></span></p>
          </header>
          <div className="thread-body">
            <NodePanel
              config={props.config}
              error={node.error}
              nid={selected}
              nodes={nodes}
              now={now}
              onChanged={() => {
                review()
                reupdate()
                redetail()
              }}
              onRide={(anchor) => setRiding((current) => (!anchor && current?.nid === selected ? current : { anchor, nid: selected }))}
              swarm={id}
              updates={updates.data?.deltas}
              view={node.data?.id === selected ? node.data : undefined}
            />
          </div>
          {nodes[selected] && (
            <Composer
              config={props.config}
              disabled={Grove.closed(nodes[selected]!) ? 'This thread has ended.' : undefined}
              fine="A note on this item, free. Five a day; triage may turn it into an item."
              label="Message this thread"
              onPost={async (text) => {
                await Api.suggest(id, { parent: selected, text })
                review()
              }}
              placeholder="Message this thread"
            />
          )}
        </aside>
      )}
      {riding && nodes[riding.nid] && <Ride anchor={riding.anchor} config={props.config} key={riding.nid} node={nodes[riding.nid]!} onClose={() => setRiding(undefined)} onDone={() => redetail()} swarm={id} />}
    </article>
  )
}
