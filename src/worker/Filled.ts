// The secrets the site Worker needs. They live only on the objects Worker
// (swarms), which hands them over through its Vault entrypoint.
export const names = ['SWARMS_GATEWAY_KEY', 'SWARMS_GITHUB_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'] as const

export type Secrets = Partial<Record<(typeof names)[number], string>>

type Source = { secrets(): Promise<Secrets> | Secrets }

let kept: Promise<Secrets> | undefined

// The site Worker reads its secrets once per isolate from the objects
// Worker's Vault, and only when its own env lacks them (local dev and tests
// set them directly).
export async function filled<E extends object>(env: E, vault: Source | undefined, need: readonly string[] = names): Promise<E> {
  const own = env as Record<string, unknown>
  if (!vault || need.every((name) => typeof own[name] === 'string')) return env
  kept ??= Promise.resolve(vault.secrets()).catch((error) => {
    kept = undefined
    throw error
  })
  const secrets = await kept
  return Object.assign(Object.create(Object.getPrototypeOf(env)), env, secrets) as E
}

export function reset() {
  kept = undefined
}
