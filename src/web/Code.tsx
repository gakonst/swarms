import { File } from '@pierre/diffs/react'
import type { FileTreeOptions, FileTreeSsrPayload } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Code as Repo, Snapshot, Unavailable } from '../shared/Api.ts'
import * as Site from '../shared/Site.ts'
import * as Limits from '../shared/Limits.ts'
import * as Api from './api.ts'
import { ago } from './format.ts'
import { message, useMedia, useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'
import * as Wire from './wire.ts'

type Commit = Snapshot['commits'][number]

type Tree = { commits: Commit[]; files: string[]; readme: { path: string; text: string } | null }

type Preload = (options: FileTreeOptions & { id: string }) => FileTreeSsrPayload

const theme = { theme: 'pierre-light' } as const

const kept = new Map<string, Promise<{ size: number; text?: string }>>()

const prose = /\.(md|markdown)$/i


let preload: Preload | undefined

class Unpaid extends Error {}

export function preloads(next: Preload) {
  preload = next
}

function local(swarm: string) {
  return `/api/swarms/${encodeURIComponent(swarm)}/git`
}

async function fetched<value>(url: string): Promise<value> {
  if (Api.fixture) return import('./fixtures.ts').then((fixtures) => fixtures.git(url) as Promise<value>)
  const response = await fetch(Site.at(url))
  const data = (await response.json().catch(() => undefined)) as value | undefined
  if (!response.ok || !data) throw new Error(response.status === 404 ? 'Not found.' : "The code can't be read right now. Try again in a minute.")
  const told = data as Partial<Unavailable>
  if (told.state === 'unavailable' && typeof told.message === 'string') throw new Unpaid(told.message)
  return data
}

function source(swarm: string, path: string, sha: string) {
  const url = `${local(swarm)}/read?path=${encodeURIComponent(path)}&ref=${sha}`
  const known = kept.get(url)
  if (known) return known
  const pending = fetched<{ size: number; text?: string }>(url)
  pending.catch(() => kept.delete(url))
  kept.set(url, pending)
  return pending
}

function readme(paths: readonly string[]) {
  const top = paths.filter((path) => !path.includes('/'))
  return top.find((path) => /^readme\.md$/i.test(path)) ?? top.find((path) => /^readme(\.[a-z]+)?$/i.test(path))
}

function Copy(props: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="repo-copy" onClick={() => void navigator.clipboard?.writeText(props.text).then(() => { setDone(true); setTimeout(() => setDone(false), Limits.Client.copiedMs) })} type="button">
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function Files(props: { files: readonly string[]; id: string; onOpen: (path: string) => void; open: string | undefined }) {
  const options = { flattenEmptyDirectories: true, id: props.id, initialExpansion: 1, initialVisibleRowCount: 30, paths: props.files }
  const [preloaded] = useState(() => (typeof document === 'undefined' ? preload?.(options) : document.getElementById(props.id)?.shadowRoot ? { id: props.id, shadowHtml: '' } : undefined))
  const latest = useRef({ files: new Set(props.files), onOpen: props.onOpen })
  latest.current = { files: new Set(props.files), onOpen: props.onOpen }
  const { model } = useFileTree({
    ...options,
    onSelectionChange: (paths) => {
      const path = paths.at(-1)
      if (path && latest.current.files.has(path)) latest.current.onOpen(path)
    },
  })
  const shown = useRef(props.files)

  useEffect(() => {
    if (shown.current === props.files) return
    shown.current = props.files
    model.resetPaths(props.files)
  }, [model, props.files])

  useEffect(() => {
    for (const path of model.getSelectedPaths()) if (path !== props.open) model.getItem(path)?.deselect()
    if (props.open && !model.getItem(props.open)?.isSelected()) model.getItem(props.open)?.select()
  }, [model, props.open])

  return <FileTree className="repo-tree" model={model} {...(preloaded ? { preloadedData: preloaded } : {})} />
}

function Viewer(props: { path: string; preset?: string | undefined; sha: string; swarm: string }) {
  const [state, setState] = useState<{ error?: string; text?: { size: number; text?: string } }>(() => (props.preset === undefined ? {} : { text: { size: props.preset.length, text: props.preset } }))
  const narrow = useMedia('(max-width: 799px)')

  useEffect(() => {
    if (props.preset !== undefined) return setState({ text: { size: props.preset.length, text: props.preset } })
    let alive = true
    setState({})
    source(props.swarm, props.path, props.sha).then(
      (text) => alive && setState({ text }),
      (error: unknown) => alive && setState({ error: message(error) }),
    )
    return () => {
      alive = false
    }
  }, [props.path, props.preset, props.sha, props.swarm])

  const file = useMemo(() => (state.text?.text === undefined ? undefined : { cacheKey: `${props.sha}:${props.path}`, contents: state.text.text, name: props.path }), [props.path, props.sha, state.text])

  if (state.error) return <p className="repo-quiet">{state.error}</p>
  if (!state.text) return <p className="repo-quiet" aria-busy="true">Opening {props.path}…</p>
  if (!file) return <p className="repo-quiet">{props.path} is a binary file, {state.text.size.toLocaleString('en-US')} bytes.</p>
  if (prose.test(props.path))
    return (
      <section className="repo-readme" aria-label={props.path}>
        <header>{props.path.split('/').at(-1)}</header>
        <Markdown text={file.contents} />
      </section>
    )
  return <File className="repo-source" file={file} options={narrow ? { ...theme, overflow: 'wrap' } : theme} />
}

export function Code(props: { repo: Repo | null; swarm: string }) {
  const swarm = props.swarm
  const repo = props.repo
  const now = useNow(60_000)
  const [tree, setTree] = useState<{ error?: string; unavailable?: string; value?: Tree }>(() => {
    const known = Api.coded(swarm)
    return known && known.name === repo?.name ? { value: known } : {}
  })
  const [open, setOpen] = useState<string>()
  const [stirs, setStirs] = useState(0)
  Wire.useWire(swarm, 'room', (signal) => {
    if (Wire.stirred(signal, 'code')) setStirs((count) => count + 1)
  })

  useEffect(() => {
    if (!repo) return
    let alive = true
    const direct = async (): Promise<Tree> => {
      const [log, files] = await Promise.all([
        fetched<{ commits: Commit[] }>(`${local(swarm)}/log?ref=main&limit=20`),
        fetched<{ files: { path: string; type: string }[] }>(`${local(swarm)}/files?ref=main`),
      ])
      const paths = files.files.filter((file) => file.type !== 'tree').map((file) => file.path)
      const head = log.commits[0]?.sha
      const path = readme(paths)
      const read = head && path ? await source(swarm, path, head).catch(() => undefined) : undefined
      return { commits: log.commits, files: paths, readme: path && read?.text !== undefined ? { path, text: read.text } : null }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The code can't be read right now. Try again in a minute.")), Limits.Client.codeReadMs)
    })
    const read = Api.code(swarm, stirs > 0)
      .catch(() => null)
      .then((snapshot) => (snapshot && snapshot.name === repo.name ? snapshot : direct()))
    Promise.race([read, late])
      .finally(() => clearTimeout(timer))
      .then(
        (value) => alive && setTree({ value }),
        (error: unknown) => alive && setTree((known) => (known.value ? known : error instanceof Unpaid ? { unavailable: error.message } : { error: message(error) })),
      )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [swarm, repo?.name, stirs])

  if (!repo)
    return (
      <div className="repo">
        <p className="repo-empty">The code shows up here once the AI saves its first version.</p>
      </div>
    )

  const command = `git clone ${repo.clone} ${repo.name}`
  const value = tree.value
  const head = value?.commits[0]
  const crumbs = open ? open.split('/') : []

  return (
    <div className="repo">
      <header className="repo-head">
        <div className="repo-name">
          <span aria-hidden="true" className="repo-glyph">{'</>'}</span>
          <b>{repo.name}</b>
          {value && <span className="repo-meta">{value.commits.length >= 20 ? '20+ commits' : `${value.commits.length} commit${value.commits.length === 1 ? '' : 's'}`} · {value.files.length} file{value.files.length === 1 ? '' : 's'}</span>}
        </div>
        <div className="repo-clone">
          <code title={command}>{command}</code>
          <Copy text={command} />
        </div>
      </header>

      {tree.unavailable && !value ? (
        <p className="repo-empty">{tree.unavailable}</p>
      ) : tree.error && !value ? (
        <p className="repo-quiet">{tree.error} <button className="repo-again" onClick={() => { setTree({}); setStirs((count) => count + 1) }} type="button">Try again</button></p>
      ) : !value ? (
        <div className="repo-files repo-ghost" aria-busy="true"><p className="repo-quiet">Reading the code…</p></div>
      ) : !head ? (
        <p className="repo-empty">No commits yet. Each one shows up here as it lands.</p>
      ) : (
        <>
          <div className="repo-files">
            <div className="repo-latest">
              <span className="repo-latest-text">{head.message.split('\n')[0]}</span>
              <code>{head.sha.slice(0, 7)}</code>
              {head.date && <span>{ago(Date.parse(head.date), now)}</span>}
            </div>
            <nav aria-label="Path" className="repo-crumbs">
              <button onClick={() => setOpen(undefined)} type="button">{repo.name}</button>
              {crumbs.map((crumb, index) => (
                <span key={index}>
                  <i aria-hidden="true">/</i>
                  {index === crumbs.length - 1 ? <b>{crumb}</b> : crumb}
                </span>
              ))}
              {open && <button className="repo-shut" onClick={() => setOpen(undefined)} type="button">← Files</button>}
            </nav>
            <div className="repo-browse" data-open={open !== undefined || undefined}>
              <Files files={value.files} id={`repo-${swarm}`} onOpen={setOpen} open={open} />
              <div className="repo-view">
                {open ? (
                  <div className="repo-file">
                    <Viewer path={open} preset={value.readme?.path === open ? value.readme.text : undefined} sha={head.sha} swarm={swarm} />
                  </div>
                ) : value.readme ? (
                  <section className="repo-readme" aria-label={value.readme.path}>
                    <header>{value.readme.path}</header>
                    <Markdown text={value.readme.text} />
                  </section>
                ) : (
                  <p className="repo-quiet">Pick a file to read it.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
