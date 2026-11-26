import type { Artifact } from './Api.ts'
import * as Limits from './Limits.ts'

export const slug = 'wishlist'

export type State = 'open' | 'found' | 'dropped'

export type Wish = { found: string | null; state: State; use: string | null; want: string; why: string | null }

const most = Limits.SharedWishlist.most

function text(value: unknown, limit: number) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : null
}

function state(value: unknown): State {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (/no longer|not needed|dropped|closed|cancel/.test(status)) return 'dropped'
  if (/found|available|done|resolved|provided/.test(status)) return 'found'
  return 'open'
}

export function is(artifact: Pick<Artifact, 'form' | 'slug' | 'title'>) {
  return artifact.form === 'json' && (artifact.slug === slug || artifact.title.trim().toLowerCase() === slug)
}

export function read(value: unknown): Wish[] {
  const listed = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)['items'] : value
  if (!Array.isArray(listed)) return []
  return listed.slice(0, most).flatMap((item): Wish[] => {
    if (typeof item === 'string') {
      const want = text(item, Limits.SharedWishlist.wantChars)
      return want ? [{ found: null, state: 'open', use: null, want, why: null }] : []
    }
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
    const fields = item as Record<string, unknown>
    const want = text(fields['want'] ?? fields['wish'] ?? fields['need'] ?? fields['item'], Limits.SharedWishlist.wantChars)
    if (!want) return []
    return [{ found: text(fields['found'], Limits.SharedWishlist.wantChars), state: state(fields['status']), use: text(fields['use'] ?? fields['offer'], Limits.SharedWishlist.wantChars), want, why: text(fields['why'], Limits.SharedWishlist.whyChars) }]
  })
}

export function parse(source: string) {
  try {
    return read(JSON.parse(source))
  } catch {
    return []
  }
}

export function open(wishes: readonly Wish[]) {
  return wishes.filter((wish) => wish.state === 'open')
}
