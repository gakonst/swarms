import type { Address } from 'viem'
import { z } from 'zod'
import { plans as named, type OwnAi, type Plan as Named, type PlanState, type SignIn } from '../../shared/Api.ts'
import { never } from '../../shared/Assert.ts'
import type * as Setup from '../../shared/Setup.ts'
import * as Limits from '../../shared/Limits.ts'

export const providers = ['anthropic', 'openai'] as const

export type Provider = (typeof providers)[number]

export type Gate = { at: 'unsigned' } | { at: 'offline' } | { at: 'open'; rider: Address }

export type Plan = { at: 'signed-in'; expires: number | null } | { at: 'signed-out'; state: string }

export type Access = { keys: ReadonlySet<Provider>; plans: ReadonlyMap<Named, Plan> }

export type Host = { at: 'swarm' } | { at: 'rider'; rider: Address }

export type Parsed<value> = { ok: true; value: value } | { detail: string; ok: false; status: typeof Limits.Http.upstream }

const key = z.looseObject({ added_at: z.number(), hint: z.string(), provider: z.string() })

const planned = z.looseObject({
  email: z.string().min(1).optional(),
  expires_at: z.number().optional(),
  poll_after_ms: z.number().optional(),
  state: z.string(),
  user_code: z.string().min(1).optional(),
  verification_url: z.string().min(1).optional(),
})

const answer = z.looseObject({
  keys: z.array(key),
  plans: z.looseObject({ antigravity: planned.optional(), codex: planned.optional(), claude: planned }),
  subject: z.string(),
})

const started = z.union([
  z
    .looseObject({ authorization_url: z.string().min(1), expires_at: z.number() })
    .transform((read) => ({ expires_at: read.expires_at, url: read.authorization_url })),
  z
    .looseObject({
      status: z.looseObject({
        expires_at: z.number().optional(),
        poll_after_ms: z.number().optional(),
        user_code: z.string().min(1),
        verification_url: z.string().min(1),
      }),
    })
    .transform((read) => ({
      code: read.status.user_code,
      expires_at: read.status.expires_at,
      poll_after_ms: read.status.poll_after_ms,
      url: read.status.verification_url,
    })),
])

function state(plan: z.infer<typeof planned>): PlanState {
  const { email, expires_at, poll_after_ms, state, user_code, verification_url } = plan
  return {
    state,
    ...(email === undefined ? {} : { email }),
    ...(expires_at === undefined ? {} : { expires_at }),
    ...(poll_after_ms === undefined ? {} : { poll_after_ms }),
    ...(user_code === undefined ? {} : { user_code }),
    ...(verification_url === undefined ? {} : { verification_url }),
  }
}

function known(provider: string): provider is Provider {
  return (providers as readonly string[]).includes(provider)
}

export function ownAi(raw: unknown): Parsed<OwnAi> {
  const parsed = answer.safeParse(raw)
  if (!parsed.success) {
    console.error('The gateway answered own AI with an unreadable record', parsed.error.issues)
    return { detail: 'The gateway answered with an unreadable own AI record.', ok: false, status: Limits.Http.upstream }
  }
  const keys = parsed.data.keys.flatMap((one) => {
    const provider = one.provider
    if (known(provider)) return [{ ...one, provider }]
    console.error('Skipping an own AI key of an unknown provider', provider)
    return []
  })
  const read = parsed.data.plans
  const plans: OwnAi['plans'] = { claude: state(read.claude) }
  if (read.codex) plans.codex = state(read.codex)
  if (read.antigravity) plans.antigravity = state(read.antigravity)
  return { ok: true, value: { keys, plans, subject: parsed.data.subject } }
}

export function signIn(raw: unknown): Parsed<SignIn> {
  const parsed = started.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  console.error('The gateway answered a plan sign-in with an unreadable record', parsed.error.issues)
  return { detail: 'The gateway answered with an unreadable plan sign-in.', ok: false, status: Limits.Http.upstream }
}

export function gate(address: Address | undefined, credentialed: boolean): Gate {
  if (!address) return { at: 'unsigned' }
  return credentialed ? { at: 'open', rider: address } : { at: 'offline' }
}

export function access(own: OwnAi): Access {
  const plans = named.flatMap((name): [Named, Plan][] => {
    const plan = own.plans[name]
    if (!plan) return []
    return [[name, plan.state === 'authenticated' ? { at: 'signed-in', expires: plan.expires_at ?? null } : { at: 'signed-out', state: plan.state }]]
  })
  return { keys: new Set(own.keys.map((one) => one.provider)), plans: new Map(plans) }
}

function signedIn(access: Access, plan: Named) {
  return access.plans.get(plan)?.at === 'signed-in'
}

export function runsOn(access: Access, harness: Setup.Harness) {
  switch (harness) {
    case 'claude':
      return signedIn(access, 'claude') || access.keys.has('anthropic')
    case 'codex':
      return signedIn(access, 'codex') || access.keys.has('openai')
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
