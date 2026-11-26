import * as Limits from '../shared/Limits.ts'
export const quietMs = Limits.Clock.quietMs

export const hourMs = Limits.Clock.hourMs

export const restMs = Limits.Clock.restMs

export const retryMs = Limits.Clock.retryMs

export const minuteMs = Limits.Clock.minuteMs

export const dayMs = Limits.Clock.dayMs

export const refreshMs = Limits.Clock.refreshMs

export const followMs = Limits.Clock.followMs

export const gatewayMs = Limits.Clock.gatewayMs

export const shelfMs = Limits.Clock.shelfMs

export async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: Parameters<typeof clearTimeout>[0]
  try {
    return await Promise.race([work, new Promise<undefined>((resolve) => (timer = setTimeout(resolve, ms)))])
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
