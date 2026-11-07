import { useEffect, useState } from 'react'
import type { Artifact, Form } from '../shared/Api.ts'
import * as Wishlist from '../shared/Wishlist.ts'
import { ago } from './format.ts'
import { message, useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

const glyphs = { image: '◩', json: '{ }', markdown: '¶', page: '▦', table: '▤', text: '≡' } as const satisfies Record<Form, string>

const named = { image: 'Image', json: 'Data', markdown: 'Write-up', page: 'Live page', table: 'Table', text: 'Text' } as const satisfies Record<Form, string>

function source(artifact: Artifact, nonce: number) {
  return /^https?:/.test(artifact.url) ? `${artifact.url}?v=${artifact.version}${nonce ? `.${nonce}` : ''}` : artifact.url
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
  const url = artifact ? source(artifact, 0) : undefined
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

  return { artifact, wishes: artifact ? wishes : [] }
}

const stated = { dropped: 'No longer needed', found: 'Found', open: 'Open' } as const satisfies Record<Wishlist.State, string>

function Wishes(props: { onRoom: () => void; wishes: readonly Wishlist.Wish[] }) {
  if (!props.wishes.length) return <p className="empty artifact-note">The wishlist is empty.</p>
  const order = { dropped: 2, found: 1, open: 0 }
  return (
    <div className="wishes">
      <ol className="wish-rows">
        {[...props.wishes].sort((a, b) => order[a.state] - order[b.state]).map((wish, index) => (
          <li className="wish" data-state={wish.state} key={index}>
            <div className="wish-top">
              <b>{wish.want}</b>
              <span className="wish-state" data-state={wish.state}>{stated[wish.state]}</span>
            </div>
            {wish.why && <p>{wish.why}</p>}
            {wish.use && <p className="wish-use">{wish.use}</p>}
            {wish.found && <p className="wish-found">{wish.found}</p>}
          </li>
        ))}
      </ol>
      {Wishlist.open(props.wishes).length > 0 && <Help onRoom={props.onRoom} />}
    </div>
  )
}

function Help(props: { onRoom: () => void }) {
  return (
    <button className="wish-help" onClick={props.onRoom} type="button">
      <span>Can you help? Tell the swarm in the room, or in a note when you fund it.</span>
      <span aria-hidden="true">→</span>
    </button>
  )
}

function Wanted(props: { onOpen: () => void; onRoom: () => void; wishes: readonly Wishlist.Wish[] }) {
  const open = Wishlist.open(props.wishes)
  return (
    <section aria-label="Wishlist" className="wish-call">
      <button className="wish-call-head" onClick={props.onOpen} type="button">
        <span className="wish-call-title">
          <b>Wishlist</b>
          <span>{open.length === 1 ? '1 open wish' : `${open.length} open wishes`}</span>
        </span>
        <span className="wish-call-items">
          {open.slice(0, 3).map((wish, index) => (
            <span key={index}>{wish.want}</span>
          ))}
        </span>
      </button>
      <Help onRoom={props.onRoom} />
    </section>
  )
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

function Text(props: { artifact: Artifact; nonce: number; onRoom: () => void }) {
  const artifact = props.artifact
  const [state, setState] = useState<{ error?: string; text?: string }>({})
  const url = source(artifact, props.nonce)

  useEffect(() => {
    let alive = true
    setState({})
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`The artifact answered ${response.status}.`)
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

  if (state.error) return <p className="error artifact-note">{state.error}</p>
  if (state.text === undefined) return <p className="empty artifact-note">Loading…</p>
  if (artifact.form === 'markdown') return <div className="artifact-prose"><Markdown base={artifact.url} text={state.text} /></div>
  if (artifact.form === 'table') return <Grid rows={rows(state.text, artifact.entry.endsWith('.tsv') ? '\t' : ',')} />
  if (Wishlist.is(artifact)) return <Wishes onRoom={props.onRoom} wishes={Wishlist.parse(state.text)} />
  if (artifact.form === 'json') {
    try {
      const value: unknown = JSON.parse(state.text)
      if (Array.isArray(value) && value.length && value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
        const keys = [...new Set(value.flatMap((item) => Object.keys(item as object)))]
        return <Grid rows={[keys, ...value.slice(0, 500).map((item) => keys.map((key) => { const cell = (item as Record<string, unknown>)[key]; return typeof cell === 'string' ? cell : JSON.stringify(cell) ?? '' }))]} />
      }
      return <pre className="artifact-pre">{JSON.stringify(value, null, 2)}</pre>
    } catch {
      return <pre className="artifact-pre">{state.text}</pre>
    }
  }
  return <pre className="artifact-pre">{state.text}</pre>
}

function View(props: { artifact: Artifact; onRoom: () => void }) {
  const artifact = props.artifact
  const now = useNow(30_000)
  const [nonce, setNonce] = useState(0)
  const [full, setFull] = useState(false)
  const link = /^https?:/.test(artifact.url)

  useEffect(() => {
    if (!full) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setFull(false)
    addEventListener('keydown', close)
    return () => removeEventListener('keydown', close)
  }, [full])

  return (
    <section aria-label={artifact.title} className="artifact-view" data-form={artifact.form} data-full={full}>
      <header className="artifact-bar">
        <div className="artifact-name">
          <h2>{artifact.title}</h2>
          <p>
            {artifact.kind} · version {artifact.version}
            {artifact.updatedAt ? ` · updated ${ago(artifact.updatedAt, now)}` : ''}
          </p>
        </div>
        <div className="artifact-actions">
          <button className="btn btn-low" onClick={() => setNonce(Date.now())} title="Load it again" type="button">Reload</button>
          <button className="btn btn-low" onClick={() => setFull(!full)} type="button">{full ? 'Close' : 'Expand'}</button>
          {link && <a className="btn btn-low" href={source(artifact, nonce)} rel="noreferrer" target="_blank">Open ↗</a>}
        </div>
      </header>
      {artifact.summary && <p className="artifact-summary">{artifact.summary}</p>}
      <div className="artifact-body">
        {artifact.form === 'page' ? (
          <iframe
            allow="fullscreen"
            className="artifact-frame"
            key={`${artifact.slug}:${artifact.version}:${nonce}`}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
            src={source(artifact, nonce)}
            title={artifact.title}
          />
        ) : artifact.form === 'image' ? (
          <div className="artifact-image">
            <img alt={artifact.title} src={source(artifact, nonce)} />
          </div>
        ) : (
          <Text artifact={artifact} nonce={nonce} onRoom={props.onRoom} />
        )}
      </div>
    </section>
  )
}

export function Artifacts(props: { artifacts: readonly Artifact[] | undefined; error: string | undefined; onRoom: () => void; onSelect: (slug: string) => void; selected: string | undefined; wishes: { artifact: Artifact | undefined; wishes: readonly Wishlist.Wish[] }; working: boolean }) {
  const now = useNow(30_000)
  const list = props.artifacts
  if (!list)
    return <p className="empty artifact-note">{props.error ? `Could not list the artifacts. ${props.error}` : 'Looking for artifacts…'}</p>
  if (!list.length)
    return (
      <div className="artifact-empty">
        <h2>No dashboards yet.</h2>
        <p>Ask for one: <span className="mention" data-swarm="true">@swarm</span> publish a live leaderboard.</p>
      </div>
    )
  const current = list.find((artifact) => artifact.slug === props.selected) ?? list[0]
  const wished = props.wishes.artifact
  const calling = wished !== undefined && wished.slug !== current?.slug && Wishlist.open(props.wishes.wishes).length > 0
  return (
    <div className="artifacts" data-wished={calling}>
      {calling && <Wanted onOpen={() => props.onSelect(wished.slug)} onRoom={props.onRoom} wishes={props.wishes.wishes} />}
      <ol className="artifact-list">
        {list.map((artifact) => (
          <li key={artifact.slug}>
            <button aria-pressed={artifact.slug === current?.slug} className="artifact-item" onClick={() => props.onSelect(artifact.slug)} type="button">
              <span aria-hidden className="artifact-glyph" data-form={Wishlist.is(artifact) ? 'wishlist' : artifact.form}>{Wishlist.is(artifact) ? '✦' : glyphs[artifact.form]}</span>
              <span className="artifact-item-text">
                <b>{artifact.title}</b>
                <span>
                  {Wishlist.is(artifact) ? 'Wishlist' : named[artifact.form]}
                  {artifact.updatedAt ? ` · ${ago(artifact.updatedAt, now)}` : ` · v${artifact.version}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {current && <View artifact={current} key={current.slug} onRoom={props.onRoom} />}
    </div>
  )
}
