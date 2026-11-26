import * as Timing from './Timing.ts'

export const names = ['SWARMS_GATEWAY_KEY', 'SWARMS_GITHUB_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'] as const

export type Name = (typeof names)[number]

export type Secrets = Partial<Record<Name, string>>

type Source = { secrets(): Promise<Secrets> | Secrets }

let kept: Secrets | undefined

async function vaulted(vault: Source) {
  return kept ?? (kept = await Timing.span('vault', Promise.resolve(vault.secrets())))
}

export async function secret(env: object, name: Name): Promise<string | undefined> {
  const own = (env as Record<string, unknown>)[name]
  if (typeof own === 'string') return own
  const vault = (env as { VAULT?: Source }).VAULT
  return vault ? (await vaulted(vault))[name] : undefined
}

export function reset() {
  kept = undefined
}
