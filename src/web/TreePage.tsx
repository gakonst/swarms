import { useCallback, useEffect, useRef, useState } from 'react'
import type { Config, Detail, Member, NodeUpdates, NodeView, ProofsView, Said, TreeView } from '../shared/Api.ts'
import * as Prose from '../shared/Prose.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Api from './api.ts'
import { here, seeded } from './boot.ts'
import * as Grove from './grove.ts'
import { Branches, Peek } from './Branches.tsx'
import { Code } from './Code.tsx'
import { ago } from './format.ts'
import { Headline, Since } from './Headline.tsx'
import { useMedia, useNow, usePoll } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Inline } from './Markdown.tsx'
import { NodePanel, Ride } from './Node.tsx'
import { Room } from './Room.tsx'
import { Link, navigate, useBase, useQuery } from './router.tsx'
import { scene } from './stage.ts'
import { at, backers, Explainer, side, Strip, type Tab, Tabs } from './Strip.tsx'
import { Filters, Mark } from './Tree.tsx'
import * as Wire from './wire.ts'

const downMs = 15_000

function chosen(raw: string | null): Grove.Filter {
  return Grove.filters.some(([key]) => key === raw) ? (raw as Grove.Filter) : 'all'
}

function unfolded(data: TreeView | undefined) {
  const told = here().searchParams.get('open')
  if (told !== null) return new Set(['root', ...told.split(',').filter(Boolean)])
  return new Set(['root', ...(data?.nodes.find((node) => node.id === 'root')?.children ?? [])])
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

export function TreePage(props: { config: Config | undefined; detail: Detail; id: string; nid: string | undefined; view: Tab }) {
  const id = props.id
  const view = props.view
  const selected = props.nid ?? 'root'
  const base = useBase(id)
  const path = useCallback((nid: string) => (nid === 'root' ? `${base}/board` : `${base}/n/${nid}`), [base])
  const phone = useMedia('(max-width: 899px)')
  const now = useNow(30_000)
  const inside = useQuery('in') ?? 'root'
  const [filter, setFilter] = useState<Grove.Filter>(() => chosen(here().searchParams.get('filter')))
  const [detail, redetail] = usePoll(() => Api.swarm(id, false), null, id)
  const [tree, retree] = usePoll(() => Api.tree(id, { depth: 2 }), () => (Wire.state(id, 'room') === 'down' ? downMs : null), `tree:${id}`)
  const [grove, setGrove] = useState<Grove.Grove | undefined>(() => tree.data && Grove.grow(tree.data))
  const [node, review, setView] = usePoll(() => Api.node(id, selected), null, `node:${id}:${selected}`)
  const [updates, reupdate, setUpdates] = usePoll(() => Api.nodeUpdates(id, selected), null, `updates:${id}:${selected}`)
  const [burn, reburn] = usePoll(() => Api.burn(id), null, `burn:${id}`)
  const [proofs, reproof, setProofs] = usePoll(() => Api.proofs(id), null, `proofs:${id}`)
  const told = useRef(here().searchParams.has('open'))
  const [open, setOpen] = useState<ReadonlySet<string>>(() => unfolded(tree.data))
  const [more, setMore] = useState<Readonly<Record<string, number>>>({})
  const [peek, setPeek] = useState<string | undefined>(() => (inside === 'root' ? undefined : inside))
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set([view, side(view)]))
  const [unread, setUnread] = useState(0)
  const [riding, setRiding] = useState(false)
  const [members, setMembers] = useState<readonly Member[]>(() => seeded<{ members: Member[] }>(`room:${id}`)?.members ?? [])
  const board = useRef(view === 'board' ? path(selected) : `${base}/board`)
  const focus = phone ? (peek ?? 'root') : selected
  const swarm = detail.data ?? props.detail

  useEffect(() => {
    if (inside !== 'root') setPeek(inside)
  }, [inside])

  useEffect(() => {
    setSeen((current) => (current.has(view) && current.has(side(view)) ? current : new Set([...current, view, side(view)])))
    if (view === 'board') board.current = path(selected)
  }, [view, selected, path])

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
    if (!told.current) setOpen((current) => (current.size > 1 ? current : unfolded(data)))
  }, [tree.data])

  useEffect(() => {
    document.title = `${Prose.plain(swarm.title)} · Swarms`
  }, [swarm.title])

  const nodes = grove?.nodes ?? {}

  useEffect(() => {
    if (!grove) return
    const trail = Grove.trail(grove.nodes, focus).map((node) => node.id)
    if (trail.some((nid) => !open.has(nid) && nid !== focus)) setOpen((current) => new Set([...current, ...trail.slice(0, -1)]))
  }, [focus, !!grove])

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
    void climb(node.data.parent, 0)
    return () => {
      alive = false
    }
  }, [selected, !!node.data, !!grove])

  const heard = useCallback((_said: readonly Said[], _me: unknown, list: readonly Member[]) => setMembers(list), [])
  const ride = useCallback(() => setRiding(true), [])
  const results = useCallback(() => navigate(`${base}/results`, { keep: true, replace: true }), [base])

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
    if (phone) setPeek(node.id)
    else if (node.id !== focus) navigate(carried(path(node.id)), { keep: true, replace: true })
  }

  const show = (next: Tab) => {
    if (next === view) return
    navigate(next === 'board' ? carried(board.current) : at(base, next), { keep: true, replace: true })
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
  const root = nodes['root']
  const nodeShown = !phone || props.nid !== undefined
  const repo = proofs.data?.proofs[0]?.check.repo
  return (
    <article className="grove" data-node={view === 'board' && phone && props.nid !== undefined ? 'open' : undefined} data-tab={view} data-wire={wired}>
      <Strip
        backers={top}
        latest={last ? <>Last proven <Link keep to={path(last.node)}><Inline text={last.title} /></Link> · {ago(last.check.at, now)}</> : head.proven > 0 ? 'Checked by Lean' : 'Nothing proven yet. Lean decides what is proven.'}
        onRide={root ? ride : undefined}
        raised={swarm.balance}
        riders={swarm.contributors}
        title={swarm.title}
      >
        <span><b>{head.proven.toLocaleString('en-US')}</b> proven</span>
        <span data-live={head.inFlight > 0 || undefined}><b>{head.inFlight.toLocaleString('en-US')}</b> in flight</span>
      </Strip>
      <Tabs base={base} onShow={show} unread={unread} view={view} />
      <div className="panel panel-chat" data-side="true" hidden={view !== 'chat'}>
        <Room config={props.config} onArtifact={results} onBack={ride} onMessages={heard} onResults={results} onUnread={setUnread} steer={false} swarm={swarm} visible={view === 'chat' || !phone} />
      </div>
      {seen.has('board') && (
        <div className="grove-body panel" data-desk={view === 'chat' || undefined} hidden={side(view) !== 'board'}>
          <section aria-label="The board" className="grove-tree">
            <Filters filter={filter} nodes={nodes} onFilter={filtered} />
            <div className="grove-scroll">
              <Branches
                filter={filter}
                landed={grove.landed}
                more={more}
                nodes={nodes}
                now={now}
                onFold={fold}
                onMore={(nid, count) => setMore((current) => ({ ...current, [nid]: count }))}
                onPick={pick}
                onPropose={(node) => navigate(propose(node.id), { keep: true, replace: !phone })}
                open={open}
                path={path}
                propose={propose}
                selected={phone ? (peek ?? '') : selected}
                shape={scene.has('spine') ? 'spine' : 'tree'}
              />
            </div>
            {phone && peek && nodes[peek] && <Peek node={nodes[peek]!} nodes={nodes} to={path(peek)} />}
            <Since id={id} nodes={nodes} now={now} />
          </section>
          {nodeShown && (
            <section aria-label="The selected item" className="grove-node">
              <NodePanel
                back={phone ? (selected === 'root' ? `${base}/board` : `${base}/board?in=${selected}`) : undefined}
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
                swarm={id}
                updates={updates.data?.deltas}
                view={node.data?.id === selected ? node.data : undefined}
              />
            </section>
          )}
        </div>
      )}
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
      {riding && root && <Ride config={props.config} node={root} onClose={() => setRiding(false)} onDone={() => redetail()} swarm={id} />}
    </article>
  )
}
