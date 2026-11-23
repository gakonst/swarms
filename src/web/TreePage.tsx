import { useCallback, useEffect, useState } from 'react'
import type { Config, Detail, NodeUpdates, NodeView, ProofsView, TreeView } from '../shared/Api.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import * as Grove from './grove.ts'
import { Branches, Peek } from './Branches.tsx'
import { Headline, Since } from './Headline.tsx'
import { useMedia, useNow, usePoll } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { NodePanel } from './Node.tsx'
import { Link, navigate, useBase, useQuery } from './router.tsx'
import { scene } from './stage.ts'
import { Filters } from './Tree.tsx'
import * as Wire from './wire.ts'

const downMs = 15_000

function chosen(raw: string | null): Grove.Filter {
  return Grove.filters.some(([key]) => key === raw) ? (raw as Grove.Filter) : 'all'
}

export function TreePage(props: { config: Config | undefined; detail: Detail; id: string; nid: string | undefined }) {
  const id = props.id
  const selected = props.nid ?? 'root'
  const base = useBase(id)
  const path = useCallback((nid: string) => (nid === 'root' ? base : `${base}/n/${nid}`), [base])
  const phone = useMedia('(max-width: 899px)')
  const now = useNow(30_000)
  const at = useQuery('in') ?? 'root'
  const [filter, setFilter] = useState<Grove.Filter>(() => chosen(here().searchParams.get('filter')))
  const [tree, retree] = usePoll(() => Api.tree(id, { depth: 2 }), () => (Wire.state(id, 'room') === 'down' ? downMs : null), `tree:${id}`)
  const [grove, setGrove] = useState<Grove.Grove | undefined>(() => tree.data && Grove.grow(tree.data))
  const [view, review, setView] = usePoll(() => Api.node(id, selected), null, `node:${id}:${selected}`)
  const [updates, reupdate, setUpdates] = usePoll(() => Api.nodeUpdates(id, selected), null, `updates:${id}:${selected}`)
  const [burn, reburn] = usePoll(() => Api.burn(id), null, `burn:${id}`)
  const [proofs, reproof, setProofs] = usePoll(() => Api.proofs(id), null, `proofs:${id}`)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['root', ...(tree.data?.nodes.find((node) => node.id === 'root')?.children ?? [])]))
  const [more, setMore] = useState<Readonly<Record<string, number>>>({})
  const [peek, setPeek] = useState<string | undefined>(() => (at === 'root' ? undefined : at))
  const focus = phone ? (peek ?? 'root') : selected

  useEffect(() => {
    if (at !== 'root') setPeek(at)
  }, [at])

  const wired = Wire.useWire(id, 'room', (signal) => {
    if (signal.type === 'delta') {
      const delta = signal.delta
      setGrove((current) => current && Grove.patch(current, delta))
      if (delta.node.id === selected) {
        setView((current: NodeView | undefined) => current && { ...current, ...delta.node, funders: current.funders, runs: current.runs })
        setUpdates((current: NodeUpdates | undefined) => current && { deltas: [delta, ...current.deltas.filter((each) => each.seq !== delta.seq)], next: Math.max(current.next, delta.seq) })
        if (delta.event === 'proven' || delta.event === 'ended' || delta.event === 'started' || delta.event === 'funded' || delta.event === 'moved' || delta.event === 'steered') review()
      }
      if (delta.event === 'proven' && delta.node.proof) {
        const check = delta.node.proof
        setProofs((current: ProofsView | undefined) => ({ proofs: [{ check, node: delta.node.id, title: delta.node.title }, ...(current?.proofs ?? []).filter((each) => each.node !== delta.node.id)] }))
      }
    }
    if (signal.type === 'stir' && signal.cause === 'welcome') {
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
    setOpen((current) => (current.size > 1 ? current : new Set(['root', ...(data.nodes.find((node) => node.id === 'root')?.children ?? [])])))
  }, [tree.data])

  useEffect(() => {
    document.title = `${props.detail.title} · Swarms`
  }, [props.detail.title])

  const nodes = grove?.nodes ?? {}

  useEffect(() => {
    if (!grove) return
    const trail = Grove.trail(grove.nodes, focus).map((node) => node.id)
    if (trail.some((nid) => !open.has(nid) && nid !== focus)) setOpen((current) => new Set([...current, ...trail.slice(0, -1)]))
  }, [focus, !!grove])

  useEffect(() => {
    if (!grove || !view.data || grove.nodes[selected]) return
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
    void climb(view.data.parent, 0)
    return () => {
      alive = false
    }
  }, [selected, !!view.data, !!grove])

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

  const pick = (node: Tree.Node) => {
    const again = node.id === focus
    if (node.form !== 'goal')
      setOpen((current) => {
        const next = new Set(current)
        if (again && next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
    unfold(node)
    if (phone) setPeek(node.id)
    else if (!again) navigate(path(node.id), { keep: true, replace: true })
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
  const nodeShown = !phone || props.nid !== undefined
  return (
    <article className="grove" data-node={phone && props.nid !== undefined ? 'open' : undefined} data-wire={wired}>
      <Headline burn={burn.data?.burn} headline={grove.headline} id={id} last={last} now={now} />
      <div className="grove-body">
        <section aria-label="The tree" className="grove-tree">
          <Filters filter={filter} nodes={nodes} onFilter={filtered} />
          <div className="grove-scroll">
            <Branches
              filter={filter}
              landed={grove.landed}
              more={more}
              nodes={nodes}
              now={now}
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
          <section aria-label="The selected node" className="grove-node">
            <NodePanel
              back={phone ? (selected === 'root' ? base : `${base}?in=${selected}`) : undefined}
              config={props.config}
              error={view.error}
              nid={selected}
              nodes={nodes}
              now={now}
              onChanged={() => {
                review()
                reupdate()
              }}
              swarm={id}
              updates={updates.data?.deltas}
              view={view.data?.id === selected ? view.data : undefined}
            />
          </section>
        )}
      </div>
    </article>
  )
}
