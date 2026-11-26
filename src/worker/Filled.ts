export const names = ['SWARMS_GATEWAY_KEY', 'SWARMS_GITHUB_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'] as const

export type Secrets = Partial<Record<(typeof names)[number], string>>

type Source = { secrets(): Promise<Secrets> | Secrets }

let kept: Secrets | undefined

export async function filled<E extends object>(env: E, vault: Source | undefined, need: readonly string[] = names): Promise<E> {
  const own = env as Record<string, unknown>
  if (!vault || need.every((name) => typeof own[name] === 'string')) return env
  const secrets = kept ?? (kept = await vault.secrets())
  return Object.assign(Object.create(Object.getPrototypeOf(env)), env, secrets) as E
}

export function reset() {
  kept = undefined
}
