import type { Artifact, Form } from './Api.ts'

export const prefix = 'artifacts/'

export const slug = /^[a-z0-9][a-z0-9._-]{0,63}$/

const segment = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const forms: Record<string, Form> = {
  csv: 'table',
  gif: 'image',
  htm: 'page',
  html: 'page',
  jpeg: 'image',
  jpg: 'image',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  png: 'image',
  svg: 'image',
  tsv: 'table',
  webp: 'image',
}

export function form(path: string): Form {
  return forms[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'text'
}

const scripted: Record<string, string> = {
  htm: 'text/html; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  xml: 'application/xml',
}

export function scriptedType(path: string) {
  return scripted[path.split('.').pop()?.toLowerCase() ?? '']
}

export function path(value: unknown) {
  if (typeof value !== 'string' || value.length > 300) return undefined
  const parts = value.replace(/^\.\//, '').split('/')
  return parts.length <= 4 && parts.every((part) => segment.test(part) && part !== '..') ? parts.join('/') : undefined
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : null
}

function time(value: unknown) {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) && at > 0 ? at : null
}

export function read(key: string, value: unknown, version: number, base: string): Artifact | undefined {
  const name = key.slice(prefix.length)
  if (!key.startsWith(prefix) || !slug.test(name)) return undefined
  const manifest = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const entry = path(manifest['entry']) ?? 'index.html'
  return {
    entry,
    form: form(entry),
    kind: text(manifest['kind'], 24) ?? form(entry),
    slug: name,
    summary: text(manifest['summary'], 300),
    title: text(manifest['title'], 120) ?? name,
    updatedAt: time(manifest['updated'] ?? manifest['updatedAt']),
    url: `${base}/${name}/${entry.split('/').map(encodeURIComponent).join('/')}`,
    version,
  }
}
