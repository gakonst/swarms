import type { Steering } from './Api.ts'

export type Door = { posts: boolean; steers: 'backing' | 'team' | null }

export function of(steering: Steering, who: { rider: boolean; seat: boolean }): Door {
  if (steering === 'team') return { posts: who.rider || who.seat, steers: who.seat ? 'team' : null }
  return { posts: who.rider, steers: who.rider ? 'backing' : null }
}
