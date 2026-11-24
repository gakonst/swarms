export type Hello = 'new' | 'seen'

export const cookie = 'swarms_hello'

export function parse(header: string | null | undefined): Hello {
  return /(?:^|;\s*)swarms_hello=1(?:;|$)/.test(header ?? '') ? 'seen' : 'new'
}

export function written() {
  return cookie + '=1; path=/; max-age=31536000; samesite=lax'
}
