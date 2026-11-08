import { useEffect, useState } from 'react'
import type { Artifact } from '../shared/Api.ts'
import * as Wishlist from '../shared/Wishlist.ts'
import { message } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

function source(artifact: Artifact) {
  return /^https?:/.test(artifact.url) ? `${artifact.url}?v=${artifact.version}` : artifact.url
}

function rows(text: string, separator: string) {
  const table: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length && table.length < 500; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === separator) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      if (row.some((value) => value !== '')) table.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell || row.length) table.push([...row, cell])
  return table
}

export function useWishes(list: readonly Artifact[] | undefined) {
  const artifact = list?.find(Wishlist.is)
  const url = artifact ? source(artifact) : undefined
  const [wishes, setWishes] = useState<readonly Wishlist.Wish[]>([])

  useEffect(() => {
    if (!url) return
    let alive = true
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then(
        (text) => alive && setWishes(Wishlist.parse(text)),
        () => undefined,
      )
    return () => {
      alive = false
    }
  }, [url])

  return artifact ? Wishlist.open(wishes) : []
}

function Grid(props: { rows: string[][] }) {
  const [head = [], ...body] = props.rows
  return (
    <div className="artifact-table">
      <table>
        <thead>
          <tr>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Text(props: { artifact: Artifact }) {
  const artifact = props.artifact
  const [state, setState] = useState<{ error?: string; text?: string }>({})
  const url = source(artifact)

  useEffect(() => {
    let alive = true
    setState({})
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`It answered ${response.status}.`)
        return response.text()
      })
      .then(
        (text) => alive && setState({ text }),
        (error: unknown) => alive && setState({ error: message(error) }),
      )
    return () => {
      alive = false
    }
  }, [url])

  if (state.error) return <p className="viewer-note">{state.error}</p>
  if (state.text === undefined) return <p className="viewer-note">Loading…</p>
  if (artifact.form === 'markdown') return <div className="viewer-prose"><Markdown base={artifact.url} text={state.text} /></div>
  if (artifact.form === 'table') return <Grid rows={rows(state.text, artifact.entry.endsWith('.tsv') ? '\t' : ',')} />
  if (artifact.form === 'json') {
    try {
      const value: unknown = JSON.parse(state.text)
      if (Array.isArray(value) && value.length && value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
        const keys = [...new Set(value.flatMap((item) => Object.keys(item as object)))]
        return <Grid rows={[keys, ...value.slice(0, 500).map((item) => keys.map((key) => { const cell = (item as Record<string, unknown>)[key]; return typeof cell === 'string' ? cell : JSON.stringify(cell) ?? '' }))]} />
      }
      return <pre className="viewer-pre">{JSON.stringify(value, null, 2)}</pre>
    } catch {
      return <pre className="viewer-pre">{state.text}</pre>
    }
  }
  return <pre className="viewer-pre">{state.text}</pre>
}

export function Viewer(props: { artifact: Artifact; onClose: () => void }) {
  const artifact = props.artifact
  const link = /^https?:/.test(artifact.url)

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose()
    addEventListener('keydown', close)
    document.documentElement.dataset['viewing'] = 'true'
    return () => {
      removeEventListener('keydown', close)
      delete document.documentElement.dataset['viewing']
    }
  }, [props.onClose])

  return (
    <section aria-label={artifact.title} aria-modal="true" className="viewer" data-form={artifact.form} role="dialog">
      <header className="viewer-bar">
        <button aria-label="Close" className="viewer-close" onClick={props.onClose} type="button">←</button>
        <h2>{artifact.title}</h2>
        {link && <a className="viewer-open" href={source(artifact)} rel="noreferrer" target="_blank">Open ↗</a>}
      </header>
      <div className="viewer-body">
        {artifact.form === 'page' ? (
          <iframe allow="fullscreen" className="viewer-frame" key={`${artifact.slug}:${artifact.version}`} referrerPolicy="no-referrer" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals" src={source(artifact)} title={artifact.title} />
        ) : artifact.form === 'image' ? (
          <div className="viewer-image"><img alt={artifact.title} src={source(artifact)} /></div>
        ) : (
          <Text artifact={artifact} />
        )}
      </div>
    </section>
  )
}
