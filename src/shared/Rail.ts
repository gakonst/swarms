export type Rail = 'collapsed' | 'expanded'

export const cookie = 'swarms_rail'

export function parse(header: string | null | undefined): Rail {
  return /(?:^|;\s*)swarms_rail=expanded(?:;|$)/.test(header ?? '') ? 'expanded' : 'collapsed'
}

export function toggle(rail: Rail): Rail {
  return rail === 'expanded' ? 'collapsed' : 'expanded'
}

export function written(rail: Rail) {
  return `${cookie}=${rail}; path=/; samesite=lax`
}
