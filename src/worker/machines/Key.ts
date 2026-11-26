import type { Address } from 'viem'
import { z } from 'zod'
import type { OwnAi } from '../../shared/Api.ts'
import { never } from '../../shared/Assert.ts'
import type * as Setup from '../../shared/Setup.ts'

export const providers = ['anthropic', 'openai'] as const

export type Provider = (typeof providers)[number]

export type Gate = { at: 'unsigned' } | { at: 'offline' } | { at: 'open'; rider: Address }

export type Plan = { at: 'signed-in'; expires: number | null } | { at: 'signed-out'; state: string }

export type Access = { keys: ReadonlySet<Provider>; plan: Plan }

export type Host = { at: 'swarm' } | { at: 'rider'; rider: Address }

export type Parsed<value> = { ok: true; value: value } | { detail: string; ok: false; status: 502 }

const key = z.looseObject({ added_at: z.number(), hint: z.string(), provider: z.string() })

const answer = z.looseObject({
  keys: z.array(key),
  plans: z.looseObject({ claude: z.looseObject({ expires_at: z.number().optional(), state: z.string() }) }),
  subject: z.string(),
})

const started = z.looseObject({ authorization_url: z.string().min(1), expires_at: z.number() })

function known(provider: string): provider is Provider {
  return (providers as readonly string[]).includes(provider)
}

export function ownAi(raw: unknown): Parsed<OwnAi> {
  const parsed = answer.safeParse(raw)
  if (!parsed.success) {
    console.error('The gateway answered own AI with an unreadable record', parsed.error.issues)
    return { detail: 'The gateway answered with an unreadable own AI record.', ok: false, status: 502 }
  }
  const keys = parsed.data.keys.flatMap((one) => {
    const provider = one.provider
    if (known(provider)) return [{ ...one, provider }]
    console.error('Skipping an own AI key of an unknown provider', provider)
    return []
  })
  const { expires_at, ...claude } = parsed.data.plans.claude
  const plans = { ...parsed.data.plans, claude: expires_at === undefined ? claude : { ...claude, expires_at } }
  return { ok: true, value: { ...parsed.data, keys, plans } }
}

export function signIn(raw: unknown): Parsed<{ authorization_url: string; expires_at: number }> {
  const parsed = started.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  console.error('The gateway answered a Claude sign-in with an unreadable record', parsed.error.issues)
  return { detail: 'The gateway answered with an unreadable Claude sign-in.', ok: false, status: 502 }
}

export function gate(address: Address | undefined, credentialed: boolean): Gate {
  if (!address) return { at: 'unsigned' }
  return credentialed ? { at: 'open', rider: address } : { at: 'offline' }
}

export function access(own: OwnAi): Access {
  const claude = own.plans.claude
  const plan: Plan = claude.state === 'authenticated' ? { at: 'signed-in', expires: claude.expires_at ?? null } : { at: 'signed-out', state: claude.state }
  return { keys: new Set(own.keys.map((one) => one.provider)), plan }
}

export function runsOn(access: Access, harness: Setup.Harness) {
  switch (harness) {
    case 'claude':
      return access.plan.at === 'signed-in' || access.keys.has('anthropic')
    case 'codex':
      return access.keys.has('openai')
    default:
      return never(harness, 'harness')
  }
}

export function host(ai: string | null | undefined): Host {
  return ai ? { at: 'rider', rider: ai as Address } : { at: 'swarm' }
}

export function handBack(current: Host, rider: Address): Host | null {
  switch (current.at) {
    case 'swarm':
      return null
    case 'rider':
      return current.rider === rider ? { at: 'swarm' } : null
    default:
      return never(current, 'swarm host')
  }
}
