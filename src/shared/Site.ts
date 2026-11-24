export const base = '/swarms'

export const domain = 'swarms.new'

export const paradigm = 'https://paradigm.xyz'

export const essay = 'https://www.paradigm.xyz/writing/swarms'

export function prefix(asked: { hostname: string }) {
  return asked.hostname === domain ? '' : base
}

export function root() {
  const page = globalThis as unknown as { location?: { hostname: string }; window?: unknown }
  const booted = page.window === undefined ? globalThis.__swarmsServer?.boot() : globalThis.__SWARMS_BOOT__
  return booted?.base ?? (page.location ? prefix(page.location) : base)
}

export function www(asked: URL) {
  return asked.hostname === `www.${domain}` ? `https://${domain}${asked.pathname}${asked.search}` : undefined
}

export function under(path: string, at = root()) {
  return at === '' || path === at || path.startsWith(`${at}/`)
}

export function strip(path: string, at = root()) {
  return at === '' ? path : path === at ? '/' : path.startsWith(`${at}/`) ? path.slice(at.length) : path
}

export function at(path: string, prefixed = root()) {
  return path.startsWith('/') && !under(path, prefixed) ? prefixed + path : path
}

export function home(env: { SWARMS_URL: string }) {
  const given = env.SWARMS_URL.replace(/\/+$/, '')
  const at = prefix(new URL(given))
  return given.endsWith(at) ? given : given + at
}

export function url(env: { SWARMS_URL: string }, asked: URL | string) {
  const request = typeof asked === 'string' ? new URL(asked) : asked
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(request.hostname) || request.hostname.endsWith('.local') || request.hostname === domain ? request.origin + prefix(request) : home(env)
}

export function place(asked: URL) {
  const at = prefix(asked)
  const legacy = at === '' && under(asked.pathname, base)
  return { path: strip(asked.pathname, legacy ? base : at), stray: legacy || !under(asked.pathname, at) }
}
