export const base = '/swarms'

export const paradigm = 'https://paradigm.xyz'

export function under(path: string) {
  return path === base || path.startsWith(`${base}/`)
}

export function strip(path: string) {
  return path === base ? '/' : path.startsWith(`${base}/`) ? path.slice(base.length) : path
}

export function at(path: string) {
  return path.startsWith('/') && !under(path) ? base + path : path
}

export function home(env: { SWARMS_URL: string }) {
  const given = env.SWARMS_URL.replace(/\/+$/, '')
  return given.endsWith(base) ? given : given + base
}

export function url(env: { SWARMS_URL: string }, asked: URL | string) {
  const request = typeof asked === 'string' ? new URL(asked) : asked
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(request.hostname) || request.hostname.endsWith('.local') ? request.origin + base : home(env)
}
