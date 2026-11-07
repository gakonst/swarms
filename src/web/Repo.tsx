import { PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type { Config, Detail } from '../shared/Api.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { type Change, Clone, type Commit, local, patch, prefetch, read, seed as keepSnapshot, peek, unified, Viewer, warm } from './Code.tsx'
import { ago, short, stamp } from './format.ts'
import { message, useMedia, useNow, usePoll, useVisible } from './hooks.ts'
import { Link } from './router.tsx'
import { Status } from './Visual.tsx'
import * as Wire from './wire.ts'

type Mark = 'added' | 'deleted' | 'modified' | 'renamed'

const pollMs = 60_000

const flashMs = 12_000

const marks: Record<string, Mark> = { A: 'added', D: 'deleted', R: 'renamed' }

function mark(change: Change): Mark {
  return marks[change.state?.[0]?.toUpperCase() ?? ''] ?? 'modified'
}

function title(commit: Commit) {
  return commit.message.split('\n')[0] ?? ''
}

function query() {
  const params = here().searchParams
  return { path: params.get('path') ?? undefined, ref: params.get('ref') ?? undefined }
}

function remember(ref: string | undefined, path: string | undefined) {
  const url = new URL(location.href)
  for (const [name, value] of [['ref', ref], ['path', path]] as const) {
    if (value) url.searchParams.set(name, value)
    else url.searchParams.delete(name)
  }
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function Tree(props: { changes: readonly Change[]; onSelect: (path: string) => void; paths: readonly string[] }) {
  const onSelect = props.onSelect
  const known = useMemo(() => new Set(props.paths), [props.paths])
  const marks = useMemo(() => props.changes.filter((change) => known.has(change.path)).map((change) => ({ path: change.path, status: mark(change) })), [props.changes, known])
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus: marks,
    initialExpandedPaths: [],
    onSelectionChange: (selected) => {
      const path = selected.find((item) => known.has(item))
      if (path) onSelect(path)
    },
    paths: props.paths,
    search: true,
  })

  useEffect(() => {
    model.resetPaths(props.paths)
  }, [model, props.paths])

  useEffect(() => {
    model.setGitStatus(marks)
  }, [model, marks])

  return <FileTree className="repo-tree" model={model} style={{ '--repo-tree-rows': Math.min(props.paths.length, 10) } as CSSProperties} />
}

function author(name: string) {
  return /^0x[0-9a-f]{40}$/i.test(name) ? short(name) : name
}

function Changes(props: { changes: readonly Change[] }) {
  const narrow = useMedia('(max-width: 799px)')
  const shown = props.changes
  if (!shown.length) return <p className="empty">No files changed.</p>
  return (
    <div className="code-diff">
      {shown.map((change) =>
        change.patch ? (
          <PatchDiff className="code-view" key={change.path} options={narrow ? { ...unified, overflow: 'wrap' } : unified} patch={patch(change)} />
        ) : (
          <p className="fine" key={change.path}>
            {change.path}: {mark(change)}, +{change.additions} −{change.deletions}
          </p>
        ),
      )}
    </div>
  )
}

function Timeline(props: {
  commits: readonly Commit[]
  fresh: ReadonlySet<string>
  more: boolean
  onMore: () => void
  onPick: (sha: string) => void
  selected: string
}) {
  const now = useNow(props.commits.some((commit) => commit.date && Date.now() - Date.parse(commit.date) < 60_000) ? 1000 : 30_000)
  return (
    <ol className="repo-commits">
      {props.commits.map((commit) => {
        return (
          <li data-fresh={props.fresh.has(commit.sha)} data-on={commit.sha === props.selected} key={commit.sha}>
            <button onClick={() => props.onPick(commit.sha)} type="button">
              <span className="repo-commit-title">{title(commit)}</span>
              <span className="repo-commit-meta">
                <code>{commit.sha.slice(0, 7)}</code>
                {commit.author?.name && <span title={commit.author.name}>{author(commit.author.name)}</span>}
                {commit.date && <span>{ago(Date.parse(commit.date), now)}</span>}
              </span>
            </button>
          </li>
        )
      })}
      {props.more && (
        <li>
          <button className="btn btn-minimal" onClick={props.onMore} type="button">
            Older commits
          </button>
        </li>
      )}
    </ol>
  )
}

function Browser(props: { base: string; detail: Detail; live: boolean; stirs: number; wired: Wire.State }) {
  const initial = useRef(query())
  const [seed] = useState(() => {
    const known = Api.coded(props.detail.id)
    if (!known || known.name !== props.detail.code?.name) return undefined
    keepSnapshot(props.base, known)
    return known
  })
  const [log, setLog] = useState<{ commits: Commit[]; cursor: string | null; error?: string; seeded?: boolean } | undefined>(seed && { commits: seed.commits, cursor: null, seeded: true })
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [pinned, setPinned] = useState<string | undefined>(initial.current.ref)
  const [path, setPath] = useState<string | undefined>(initial.current.path)
  const [tab, setTab] = useState<'changes' | 'file'>(initial.current.path ? 'file' : 'changes')
  const [tree, setTree] = useState<{ error?: string; paths?: string[]; ref?: string }>(() => (seed?.commits[0] && !initial.current.ref ? { paths: seed.files, ref: seed.commits[0].sha } : {}))
  const [diff, setDiff] = useState<{ changes?: Change[]; error?: string; ref?: string }>(() => (seed?.diff && seed.commits[0] && !initial.current.ref ? { changes: seed.diff, ref: seed.commits[0].sha } : {}))
  const known = useRef(new Set<string>())
  const logged = useRef({ at: 0, stirs: -1 })
  const visible = useVisible()

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const every = props.wired === 'down' && visible && props.live ? pollMs : null
    const plan = () => {
      if (every !== null) timer = setTimeout(() => void run(), Math.max(0, logged.current.at + every - Date.now()))
    }
    const run = async () => {
      logged.current = { at: Date.now(), stirs: props.stirs }
      try {
        const page = await read<{ commits: Commit[]; cursor: string | null }>(`${props.base}/log?ref=main&limit=50&at=${Math.floor(Date.now() / pollMs)}.${props.stirs}`)
        if (!alive) return
        const added = known.current.size ? page.commits.filter((commit) => !known.current.has(commit.sha)).map((commit) => commit.sha) : []
        for (const commit of page.commits) known.current.add(commit.sha)
        setLog((previous) => {
          if (!previous || previous.seeded) return page
          const newer = page.commits.filter((commit) => !previous.commits.some((old) => old.sha === commit.sha))
          return { commits: [...newer, ...previous.commits], cursor: previous.cursor }
        })
        if (added.length) {
          setFresh((previous) => new Set([...previous, ...added]))
          setTimeout(() => alive && setFresh((previous) => new Set([...previous].filter((sha) => !added.includes(sha)))), flashMs)
        }
      } catch (error) {
        if (alive) setLog((previous) => previous ?? { commits: [], cursor: null, error: message(error) })
      }
      if (alive) plan()
    }
    if (logged.current.stirs !== props.stirs) void run()
    else plan()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [props.base, props.live, props.stirs, props.wired, visible])

  const head = log?.commits[0]?.sha
  const ref = pinned ?? head

  useEffect(() => {
    remember(pinned, path)
  }, [pinned, path])

  useEffect(() => {
    if (!ref) return
    let alive = true
    const listed = peek<{ files: { path: string; type: string }[] }>(`${props.base}/files?ref=${ref}`)
    const changed = peek<{ files: Change[] }>(`${props.base}/diff?ref=${ref}`)
    if (listed && tree.ref !== ref) setTree({ paths: listed.files.filter((file) => file.type !== 'tree').map((file) => file.path), ref })
    if (changed && diff.ref !== ref) setDiff({ changes: changed.files, ref })
    if (!listed && (tree.ref !== ref || !tree.paths)) read<{ files: { path: string; type: string }[] }>(`${props.base}/files?ref=${ref}`).then(
      (files) => alive && setTree({ paths: files.files.filter((file) => file.type !== 'tree').map((file) => file.path), ref }),
      (error: unknown) => alive && setTree({ error: message(error), ref }),
    )
    if (!changed && (diff.ref !== ref || !diff.changes)) read<{ files: Change[] }>(`${props.base}/diff?ref=${ref}`).then(
      (found) => alive && setDiff({ changes: found.files, ref }),
      (error: unknown) => alive && setDiff({ error: message(error), ref }),
    )
    return () => {
      alive = false
    }
  }, [props.base, ref])

  useEffect(() => {
    if (tree.paths && tree.ref) prefetch(props.base, tree.paths, tree.ref)
  }, [props.base, tree.paths, tree.ref])

  const shas = log?.commits.slice(0, 8).map((commit) => commit.sha).join(',')
  useEffect(() => {
    if (!shas) return
    const timer = setTimeout(() => warm(shas.split(',').flatMap((sha) => [`${props.base}/diff?ref=${sha}`, `${props.base}/files?ref=${sha}`]), 3), 800)
    return () => clearTimeout(timer)
  }, [props.base, shas])

  const older = async () => {
    if (!log?.cursor) return
    const page = await read<{ commits: Commit[]; cursor: string | null }>(`${props.base}/log?ref=main&limit=50&cursor=${encodeURIComponent(log.cursor)}`).catch(() => undefined)
    if (!page) return
    for (const commit of page.commits) known.current.add(commit.sha)
    setLog({ commits: [...log.commits, ...page.commits.filter((commit) => !log.commits.some((old) => old.sha === commit.sha))], cursor: page.cursor })
  }

  if (log?.error && !log.commits.length) return <p className="error">{log.error}</p>
  if (!log) return <p className="empty">Loading the repository…</p>
  if (!ref)
    return (
      <p className="empty">
        No commits yet. {props.live ? 'The swarm is working: each commit appears here as it lands.' : 'Each commit the agent pushes shows up here.'}
      </p>
    )

  const commit = log.commits.find((found) => found.sha === ref)
  const changes = diff.ref === ref ? (diff.changes ?? []) : []
  const pick = (sha: string) => {
    setPinned(sha === head ? undefined : sha)
    setTab(path && changes.some((change) => change.path === path) ? 'file' : 'changes')
  }

  return (
    <div className="repo">
      <aside className="repo-side">
        <p className="label">Files at {ref.slice(0, 7)}</p>
        {tree.error && tree.ref === ref ? (
          <p className="error">{tree.error}</p>
        ) : tree.paths ? (
          <Tree
            changes={changes}
            onSelect={(next) => {
              setPath(next)
              setTab('file')
            }}
            paths={tree.paths}
          />
        ) : (
          <p className="empty">Loading files…</p>
        )}
      </aside>
      <section className="repo-main">
        <header className="repo-head">
          <div>
            <h2>{commit ? title(commit) : ref.slice(0, 7)}</h2>
            <p className="fine">
              <code>{ref.slice(0, 7)}</code>
              {commit?.author?.name && <> · <span title={commit.author.name}>{author(commit.author.name)}</span></>}
              {commit?.date && <> · {stamp(Date.parse(commit.date))}</>}
              {pinned ? (
                <>
                  {' '}
                  ·{' '}
                  <button className="btn btn-minimal" onClick={() => setPinned(undefined)} type="button">
                    Follow main
                  </button>
                </>
              ) : (
                <> · main{props.live ? ', live' : ''}</>
              )}
            </p>
          </div>
          <div className="repo-tabs" role="tablist">
            <button aria-selected={tab === 'changes'} onClick={() => setTab('changes')} role="tab" type="button">
              Changes{diff.ref === ref && diff.changes ? ` · ${diff.changes.length}` : ''}
            </button>
            <button aria-selected={tab === 'file'} disabled={!path} onClick={() => setTab('file')} role="tab" type="button">
              {path ?? 'File'}
            </button>
          </div>
        </header>
        <div className="repo-body">
          {tab === 'file' && path ? (
            <Viewer base={props.base} path={path} sha={ref} />
          ) : diff.ref !== ref ? (
            <p className="empty">Loading the diff…</p>
          ) : diff.error ? (
            <p className="error">{diff.error}</p>
          ) : (
            <Changes changes={changes} />
          )}
        </div>
      </section>
      <aside className="repo-log">
        <p className="label">
          {log.commits.length}
          {log.cursor ? '+' : ''} commits on main
        </p>
        <Timeline commits={log.commits} fresh={fresh} more={Boolean(log.cursor)} onMore={() => void older()} onPick={pick} selected={ref} />
      </aside>
    </div>
  )
}

export function Repo(props: { config: Config | undefined; id: string }) {
  const [stirs, setStirs] = useState(0)
  const wired = Wire.useWire(props.id, 'listen', (signal) => {
    if (signal.type === 'pulse') setDetail((data) => Wire.pulsed(data, signal))
    if (Wire.stirred(signal, 'detail')) reload()
    if (Wire.stirred(signal, 'code')) setStirs((count) => count + 1)
  })
  const [detail, reload, setDetail] = usePoll(() => Api.swarm(props.id, false), wired === 'down' ? pollMs : null, props.id)
  const swarm = detail.data
  const code = swarm?.code

  useEffect(() => {
    if (swarm) document.title = `Code · ${swarm.title} · Swarms`
  }, [swarm?.title])

  return (
    <section className="page repo-page">
      <p className="repo-back">
        <Link to={`/s/${encodeURIComponent(props.id)}`}>← {swarm?.title ?? 'Back to the swarm'}</Link>
      </p>
      <div className="repo-title">
        <h1 className="display">{code ? code.name : 'Code'}</h1>
        {swarm && <Status status={swarm.status} />}
      </div>
      {detail.error && !swarm ? (
        <p className="error">{detail.error}</p>
      ) : !swarm || !props.config ? (
        <p className="empty">Loading…</p>
      ) : !code ? (
        <p className="empty">This swarm has no repository yet. It shows up here once the agent creates one.</p>
      ) : (
        <>
          <Clone repo={code} />
          <Browser base={local(swarm.id)} detail={swarm} live={swarm.status !== 'done'} stirs={stirs} wired={wired} />
        </>
      )}
    </section>
  )
}
