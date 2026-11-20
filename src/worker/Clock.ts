export const quietMs = 600_000

export const hourMs = 3_600_000

export const restMs = 10 * 60_000

export const retryMs = 30_000

export const minuteMs = 60_000

export const dayMs = 86_400_000

export const refreshMs = 10_000

export const followMs = 2_000

export const gatewayMs = 120_000

export const shelfMs = 30_000

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
