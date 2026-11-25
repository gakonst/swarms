import { Accounts } from 'accounts'
import { backend, siwe, viem } from 'accounts/plugins'
import type { Address } from 'viem'
import { http } from 'viem'
import { z } from 'zod'
import * as Site from '../shared/Site.ts'
import * as Chain from './Chain.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'
import { bearer, days, path, store } from './Sessions.ts'

function create(env: Cloudflare.Env, origin: string) {
  return Accounts.create({
    chain: Chain.chain.id,
    clientId: origin,
    plugins: [
      backend({ store: store(Replica.primary(env).DB) }),
      siwe({ lifetime: days * 86_400_000, origin, statement: 'Sign in to Swarms to chat in the rooms of the swarms you back.' }),
      viem({ transport: http(env.TEMPO_RPC) }),
    ],
  })
}

const instances = new Map<string, ReturnType<typeof create>>()

// Sign-in is for the site the Worker serves: SWARMS_URL, or the local host a dev server answers on
// (Site.url), so a page on localhost signs in without a tunnel. A challenge's stored message names
// its origin, so completing and reading sessions works with any instance.
function accounts(env: Cloudflare.Env, origin = new URL(env.SWARMS_URL).origin) {
  let instance = instances.get(origin)
  if (!instance) {
    instance = create(env, origin)
    instances.set(origin, instance)
  }
  return instance
}

const verifying = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  id: z.string().min(1).max(128),
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
})

function refused(error: unknown): Problem.Result<never> {
  if (error instanceof Error && error.name === 'Plugins.siwe.InvalidError') return Problem.fail(401, 'unauthorized', error.message)
  return Problem.fail(502, 'upstream_failed', `Tempo did not answer while checking the signature: ${error instanceof Error ? error.message : String(error)}`)
}

export async function challenge(env: Cloudflare.Env, request: Request): Promise<Problem.Result<{ id: string; message: string }>> {
  try {
    const site = Site.url(env, request.url)
    return Problem.ok(await accounts(env, new URL(site).origin).siwe.start({ request: request.headers.has('origin') ? request : new Request(site) }))
  } catch (error) {
    return refused(error)
  }
}

export async function verify(env: Cloudflare.Env, input: Record<string, unknown>): Promise<Problem.Result<{ token: string }>> {
  const parsed = verifying.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)

  try {
    const session = await accounts(env).siwe.complete({ ...parsed.data, address: parsed.data.address as Address, signature: parsed.data.signature as `0x${string}` })
    return Problem.ok({ token: session.id })
  } catch (error) {
    return refused(error)
  }
}

export async function logout(env: Cloudflare.Env, request: Request): Promise<Problem.Result<{ ended: boolean }>> {
  const token = bearer(request)
  if (!token) return Problem.ok({ ended: false })
  await accounts(env).backend.end({ id: token }).catch(() => {})
  return Problem.ok({ ended: true })
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => ({}))
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

export function routed(method: string, at: string) {
  return method === 'POST' && (at === path || at === path + '/challenge' || at === path + '/logout')
}

export async function serve(env: Cloudflare.Env, request: Request, at: string) {
  if (at === path + '/challenge') return Problem.respond(await challenge(env, request))
  if (at === path + '/logout') return Problem.respond(await logout(env, request))
  return Problem.respond(await verify(env, await body(request)))
}
