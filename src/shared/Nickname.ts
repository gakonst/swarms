import * as Limits from './Limits.ts'
export const least = Limits.SharedNickname.least

export const most = Limits.SharedNickname.most

export const reserved: ReadonlySet<string> = new Set([
  'a',
  'about',
  'admin',
  'api',
  'apple-touch-icon',
  'assets',
  'auth',
  'board',
  'chat',
  'code',
  'docs',
  'faq',
  'favicon',
  'favicon-96x96',
  'feedback',
  'fonts',
  'health',
  'ideas',
  'index',
  'join',
  'kit',
  'live',
  'login',
  'logout',
  'mcp',
  'me',
  'n',
  'names',
  'new',
  'node-modules',
  'oembed',
  'og',
  'openapi',
  'openapi-json',
  'problems',
  'public',
  'results',
  'robots',
  's',
  'search',
  'settings',
  'sitemap',
  'src',
  'static',
  'swarms',
  'telegram',
  'tg',
  'u',
  'v1',
  'x',
])

const shape = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const hex = /^[0-9a-f]{8,}$/

export function invalid(name: string) {
  if (name.length < least || name.length > most) return `A nickname is ${least} to ${most} characters.`
  if (!shape.test(name)) return 'A nickname is lowercase letters, digits and hyphens, and starts and ends with a letter or digit.'
  if (reserved.has(name) || hex.test(name)) return `The nickname ${name} is reserved.`
  return undefined
}

export function usable(name: string) {
  return invalid(name) === undefined
}

export function slug(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, most)
    .replace(/-+$/, '')
}

export function topic(name: string) {
  return name.replace(/-+/g, ' ')
}

export function path(swarm: { id: string; nickname?: string | null }) {
  return swarm.nickname ? `/${swarm.nickname}` : `/s/${encodeURIComponent(swarm.id)}`
}

const route = /^\/([a-z0-9-]+)(\/chat|\/code|\/results|\/board|\/about|\/[ntc]\/[0-9a-z]+)?\/?$/

export function parse(path: string): { name: string; tail: string } | undefined {
  const [, name = '', tail = ''] = route.exec(path) ?? []
  return usable(name) ? { name, tail } : undefined
}
