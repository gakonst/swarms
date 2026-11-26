import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { Listing, Roster, Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Pictures from '../shared/Picture.ts'
import { Alert, explain } from './Alert.tsx'
import { message, useWallet } from './hooks.ts'
import * as Api from './api.ts'
import * as Local from './local.ts'
import { Badge } from './Picture.tsx'
import { useRoster } from './Steering.tsx'
import * as Limits from '../shared/Limits.ts'

const emojis = ['🧪', '🧠', '🔬', '🧮', '📐', '🧬', '🔐', '⚡', '🛰️', '🚀', '🤖', '📈', '🌍', '🦀', '🎯', '🔥'] as const

type Shown = Pick<Summary, 'nickname' | 'picture' | 'title'>

type Look = { at: 'kept' } | { at: 'pattern' } | { at: 'emoji'; color: Pictures.Color; emoji: string } | { at: 'image'; blob: Blob; url: string }

type Draft = { look: Look; nickname: string; title: string }

export type Editing = { at: 'closed' } | { at: 'open'; draft: Draft; error?: unknown } | { at: 'saving'; draft: Draft }

function apply(id: string, shown: Shown) {
  Local.patch<Summary>(id, (current) => ({ ...current, ...shown }))
  Local.patch<Listing>('swarms', (current) => ({ ...current, swarms: current.swarms.map((swarm) => (swarm.id === id ? { ...swarm, ...shown } : swarm)) }))
}

function pictured(look: Look, before: Summary['picture']): Pictures.Picture | null {
  if (look.at === 'kept') return before ?? null
  if (look.at === 'pattern') return null
  if (look.at === 'emoji') return { color: look.color, emoji: look.emoji }
  return { url: look.url }
}

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Pictures.side
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot read the picture.')
  const scale = Math.max(side / bitmap.width, side / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  context.drawImage(bitmap, (side - width) / 2, (side - height) / 2, width, height)
  bitmap.close()
  for (const [type, quality] of [['image/webp', Limits.WebEdit.webpQuality], ['image/webp', Limits.WebEdit.webpSmallQuality], ['image/png', undefined]] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
    if (blob && blob.type === type && blob.size <= Pictures.most) return blob
  }
  throw new Error('The picture is too large even at 128 by 128.')
}

export function useAdmin(id: string, steering: Summary['steering']) {
  const me = useWallet().session?.address?.toLowerCase()
  const roster: Roster | undefined = useRoster(id, steering)
  return !!me && !!roster?.admins.some((admin) => admin.toLowerCase() === me)
}

export function Edit(props: { swarm: Summary }) {
  const swarm = props.swarm
  const admin = useAdmin(swarm.id, swarm.steering)
  const [editing, setEditing] = useState<Editing>({ at: 'closed' })
  if (!admin || swarm.archivedAt) return null
  const open = () => setEditing({ at: 'open', draft: { look: { at: 'kept' }, nickname: swarm.nickname ?? '', title: swarm.title } })
  const save = async (draft: Draft) => {
    const before: Shown = { nickname: swarm.nickname, picture: swarm.picture ?? null, title: swarm.title }
    const title = draft.title.trim()
    const nickname = draft.nickname.trim().toLowerCase() || null
    const edits: Api.Edits = {
      ...(title !== swarm.title ? { title } : {}),
      ...(nickname !== swarm.nickname ? { nickname } : {}),
      ...(draft.look.at === 'pattern' && swarm.picture ? { picture: null } : {}),
      ...(draft.look.at === 'emoji' ? { picture: { color: draft.look.color, emoji: draft.look.emoji } } : {}),
    }
    apply(swarm.id, { nickname, picture: pictured(draft.look, swarm.picture), title })
    setEditing({ at: 'saving', draft })
    let landed: Summary | undefined
    try {
      if (Object.keys(edits).length) landed = await Api.edit(swarm.id, edits)
      if (draft.look.at === 'image') landed = await Api.paint(swarm.id, draft.look.blob)
      if (landed) apply(swarm.id, { nickname: landed.nickname, picture: landed.picture ?? null, title: landed.title })
      setEditing({ at: 'closed' })
    } catch (error) {
      apply(swarm.id, landed ? { nickname: landed.nickname, picture: landed.picture ?? null, title: landed.title } : before)
      setEditing({ at: 'open', draft, error })
    }
  }
  return (
    <>
      <button aria-label="Edit the swarm's name, address and picture" className="strip-edit" data-saving={editing.at === 'saving' || undefined} disabled={editing.at === 'saving'} onClick={open} title="Edit" type="button">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3z" /></svg>
        {editing.at === 'saving' && <span>Saving…</span>}
      </button>
      {editing.at === 'open' && <Sheet draft={editing.draft} error={editing.error} onClose={() => setEditing({ at: 'closed' })} onSave={(draft) => void save(draft)} swarm={swarm} />}
    </>
  )
}

function Sheet(props: { draft: Draft; error: unknown; onClose: () => void; onSave: (draft: Draft) => void; swarm: Summary }) {
  const [draft, setDraft] = useState(props.draft)
  const [reading, setReading] = useState<{ at: 'idle' } | { at: 'reading' } | { at: 'failed'; why: string }>({ at: 'idle' })
  const file = useRef<HTMLInputElement>(null)
  const first = useRef<HTMLInputElement>(null)
  const swarm = props.swarm
  useEffect(() => {
    first.current?.focus()
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose()
    addEventListener('keydown', escape)
    return () => removeEventListener('keydown', escape)
  }, [])
  const title = draft.title.trim()
  const nickname = draft.nickname.trim().toLowerCase()
  const why = !title ? 'Give it a title.' : title.length > Limits.Operations.titleChars ? 'Keep the title to 80 characters.' : nickname ? Nickname.invalid(nickname) : undefined
  const changed = title !== swarm.title || (nickname || null) !== swarm.nickname || draft.look.at !== 'kept'
  const look = (next: Look) => setDraft((current) => ({ ...current, look: next }))
  const emoji = draft.look.at === 'emoji' ? draft.look : { color: 'green' as Pictures.Color, emoji: '🧪' }
  const preview: Summary = { ...swarm, picture: pictured(draft.look, swarm.picture) }
  const pick = async (chosen: File | undefined) => {
    if (!chosen) return
    setReading({ at: 'reading' })
    try {
      const blob = await shrink(chosen)
      look({ at: 'image', blob, url: URL.createObjectURL(blob) })
      setReading({ at: 'idle' })
    } catch (error) {
      setReading({ at: 'failed', why: error instanceof Error ? error.message : 'The picture could not be read.' })
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!why && changed) props.onSave(draft)
  }
  const failed = props.error ? explain(message(props.error)) : undefined
  return (
    <div className="sheet edit-sheet" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <form aria-label="Edit this swarm" className="sheet-card edit-card" onSubmit={submit}>
        <button aria-label="Close" className="sheet-close" onClick={props.onClose} type="button">×</button>
        <div className="edit-face">
          <span className="edit-badge"><Badge head={undefined} live={false} swarm={preview} /></span>
          <div className="edit-looks">
            <div aria-label="Emoji" className="edit-emojis" role="radiogroup">
              {emojis.map((each) => (
                <button aria-checked={draft.look.at === 'emoji' && draft.look.emoji === each} className="edit-emoji" key={each} onClick={() => look({ at: 'emoji', color: emoji.color, emoji: each })} role="radio" type="button">{each}</button>
              ))}
            </div>
            <div aria-label="Color" className="edit-colors" role="radiogroup">
              {Pictures.colors.map((color) => (
                <button aria-checked={draft.look.at === 'emoji' && draft.look.color === color} aria-label={color} className="edit-color" data-color={color} key={color} onClick={() => look({ at: 'emoji', color, emoji: emoji.emoji })} role="radio" type="button"><i className="badge" data-color={color} /></button>
              ))}
            </div>
            <p className="edit-other">
              <button className="edit-link" disabled={reading.at === 'reading'} onClick={() => file.current?.click()} type="button">{reading.at === 'reading' ? 'Reading…' : 'Upload a picture'}</button>
              {(swarm.picture || draft.look.at !== 'kept') && <button className="edit-link" onClick={() => look(swarm.picture ? { at: 'pattern' } : { at: 'kept' })} type="button">Use the pattern</button>}
              <input accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => void pick(event.target.files?.[0])} ref={file} type="file" />
            </p>
            {reading.at === 'failed' && <p className="edit-why" role="alert">{reading.why}</p>}
          </div>
        </div>
        <label className="edit-field">
          <span>Title</span>
          <input maxLength={Limits.Operations.titleChars} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} ref={first} value={draft.title} />
        </label>
        <label className="edit-field">
          <span>Address</span>
          <span className="edit-address">
            <i aria-hidden="true">swarms.new/</i>
            <input autoCapitalize="none" autoComplete="off" maxLength={Nickname.most} onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))} placeholder={'s/' + swarm.id} spellCheck={false} value={draft.nickname} />
          </span>
        </label>
        {why && (title || nickname) && <p className="edit-why">{why}</p>}
        {failed && <Alert title={failed.title} tone="bad">{failed.detail}</Alert>}
        <div className="edit-go">
          <button className="btn btn-high" disabled={!!why || !changed} type="submit">Save</button>
          <button className="btn btn-medium" onClick={props.onClose} type="button">Cancel</button>
        </div>
      </form>
    </div>
  )
}
