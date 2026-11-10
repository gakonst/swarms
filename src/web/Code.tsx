import { File } from '@pierre/diffs/react'
import { useEffect, useMemo, useState } from 'react'
import type { Code as Repo, Snapshot } from '../shared/Api.ts'
import * as Site from '../shared/Site.ts'
import * as Api from './api.ts'
import { ago } from './format.ts'
import { message, useMedia, useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'
import * as Wire from './wire.ts'

type Commit = Snapshot['commits'][number]

type Tree = { commits: Commit[]; files: string[]; readme: { path: string; text: string } | null }

type Entry = { kind: 'dir' | 'file'; name: string; path: string }

const theme = { theme: 'pierre-light' } as const

const kept = new Map<string, Promise<{ size: number; text?: string }>>()

function local(swarm: string) {
  return `/api/swarms/${encodeURIComponent(swarm)}/git`
}

async function fetched<value>(url: string): Promise<value> {
  if (Api.fixture) return import('./fixtures.ts').then((fixtures) => fixtures.git(url) as Promise<value>)
  const response = await fetch(Site.at(url))
  const data = (await response.json().catch(() => undefined)) as value | undefined
  if (!response.ok || !data) throw new Error(response.status === 404 ? 'Not found.' : "The code can't be read right now. Try again in a minute.")
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

function readme(paths: readonly string[], dir: string) {
  const inside = paths.filter((path) => (dir ? path.startsWith(dir + '/') && !path.slice(dir.length + 1).includes('/') : !path.includes('/')))
  return inside.find((path) => /(^|\/)readme\.md$/i.test(path)) ?? inside.find((path) => /(^|\/)readme(\.[a-z]+)?$/i.test(path))
}

function listing(paths: readonly string[], dir: string): Entry[] {
  const prefix = dir ? dir + '/' : ''
  const seen = new Map<string, Entry>()
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const [name = '', ...deeper] = rest.split('/')
    if (!name || seen.has(name)) continue
    seen.set(name, { kind: deeper.length ? 'dir' : 'file', name, path: prefix + name })
  }
  return [...seen.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
}

function Copy(props: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="repo-copy" onClick={() => void navigator.clipboard?.writeText(props.text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) })} type="button">
      {done ? 'Copied' : 'Copy'}
    </button>
  )
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
  return <File className="repo-source" file={file} options={narrow ? { ...theme, overflow: 'wrap' } : theme} />
}

export function Code(props: { repo: Repo | null; swarm: string }) {
  const swarm = props.swarm
  const repo = props.repo
  const now = useNow(60_000)
  const [tree, setTree] = useState<{ error?: string; value?: Tree }>(() => {
    const known = Api.coded(swarm)
    return known && known.name === repo?.name ? { value: known } : {}
  })
  const [at, setAt] = useState('')
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
      const path = readme(paths, '')
      const read = head && path ? await source(swarm, path, head).catch(() => undefined) : undefined
      return { commits: log.commits, files: paths, readme: path && read?.text !== undefined ? { path, text: read.text } : null }
    }
    Api.code(swarm, stirs > 0)
      .catch(() => null)
      .then((snapshot) => (snapshot && snapshot.name === repo.name ? snapshot : direct()))
      .then(
        (value) => alive && setTree({ value }),
        (error: unknown) => alive && setTree((known) => (known.value ? known : { error: message(error) })),
      )
    return () => {
      alive = false
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
  const entries = value ? listing(value.files, at) : []
  const crumbs = at ? at.split('/') : []
  const shownReadme = at ? (value ? readme(value.files, at) : undefined) : value?.readme?.path
  const within = open !== undefined && open.split('/').slice(0, -1).join('/') === at

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

      {tree.error && !value ? (
        <p className="repo-quiet">{tree.error}</p>
      ) : !value ? (
        <div className="repo-files repo-ghost" aria-busy="true" />
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
              <button onClick={() => { setAt(''); setOpen(undefined) }} type="button">{repo.name}</button>
              {crumbs.map((crumb, index) => (
                <span key={index}>
                  <i aria-hidden="true">/</i>
                  <button onClick={() => { setAt(crumbs.slice(0, index + 1).join('/')); setOpen(undefined) }} type="button">{crumb}</button>
                </span>
              ))}
              {open && within && <span><i aria-hidden="true">/</i><b>{open.split('/').at(-1)}</b></span>}
              {open && <button className="repo-shut" onClick={() => setOpen(undefined)} type="button">← Files</button>}
            </nav>
            <div className="repo-browse" data-open={open !== undefined || undefined}>
              <ul className="repo-list">
                {at && (
                  <li>
                    <button onClick={() => setAt(crumbs.slice(0, -1).join('/'))} type="button"><span aria-hidden="true" className="repo-icon">↰</span><span>..</span></button>
                  </li>
                )}
                {entries.map((entry) => (
                  <li key={entry.path}>
                    <button aria-current={entry.path === open || undefined} onClick={() => (entry.kind === 'dir' ? setAt(entry.path) : setOpen(entry.path))} type="button">
                      <span aria-hidden="true" className="repo-icon" data-kind={entry.kind}>{entry.kind === 'dir' ? '▸' : '·'}</span>
                      <span>{entry.name}{entry.kind === 'dir' ? '/' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="repo-view">
                {open ? (
                  <div className="repo-file">
                    <Viewer path={open} preset={value.readme?.path === open ? value.readme.text : undefined} sha={head.sha} swarm={swarm} />
                  </div>
                ) : shownReadme ? (
                  <section className="repo-readme" aria-label={shownReadme}>
                    <header>{shownReadme.split('/').at(-1)}</header>
                    {value.readme?.path === shownReadme ? <Markdown text={value.readme.text} /> : <Readme path={shownReadme} sha={head.sha} swarm={swarm} />}
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

function Readme(props: { path: string; sha: string; swarm: string }) {
  const [text, setText] = useState<string>()
  useEffect(() => {
    let alive = true
    setText(undefined)
    source(props.swarm, props.path, props.sha).then((read) => alive && setText(read.text ?? ''), () => alive && setText(''))
    return () => {
      alive = false
    }
  }, [props.path, props.sha, props.swarm])
  return text === undefined ? <p className="repo-quiet">Opening {props.path}…</p> : <Markdown text={text} />
}
