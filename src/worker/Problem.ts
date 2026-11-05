import { z } from 'zod'
import type { Problem } from '../shared/Api.ts'

export type Code =
  | 'access_denied'
  | 'conflict'
  | 'expired'
  | 'insufficient_balance'
  | 'invalid_request'
  | 'not_found'
  | 'not_member'
  | 'rate_limited'
  | 'unauthorized'
  | 'unavailable'
  | 'upstream_failed'
  | 'username_required'

export type Status = 400 | 401 | 403 | 404 | 405 | 409 | 410 | 429 | 502

export type Failure = { code: Code; detail: string; status: Status }

export type Result<value> = { ok: true; value: value } | ({ ok: false } & Failure)

export const codes = {
  access_denied: 'The contributor declined the pledge in Tempo Wallet.',
  conflict: 'The swarm is done, the pledge or budget is already approved, or the transaction is already counted.',
  expired: 'The Tempo Wallet approval expired before anyone approved it.',
  insufficient_balance: "The wallet holds less of the token than the pledge, so the pledge was dropped, or a steer asks for more than its author's backing not yet behind a note.",
  invalid_request: 'The input failed validation; detail says which field.',
  not_found: 'No swarm, pledge, budget or route has this id, or Tempo has no receipt for the transaction yet.',
  not_member: "Only the swarm's backers (a pledge, a transfer, a daily budget or a lent machine) post in its room or ask it side questions, and on a team-steered swarm only its team steers it.",
  rate_limited: 'Too many side questions from this backer in the last hour.',
  unauthorized: 'Sign in with Tempo Wallet at /v1/auth and send the session token as Authorization: Bearer <token>.',
  unavailable: 'The swarm could not be saved.',
  upstream_failed: 'The Tempo gateway or Tempo Wallet failed or refused.',
  username_required: 'The signed-in account has no username yet; set one with POST /v1/me { name } before posting, steering or asking side questions.',
} as const satisfies Record<Code, string>

export function ok<value>(value: value): Result<value> {
  return { ok: true, value }
}

export function fail(status: Status, code: Code, detail: string): Result<never> {
  return { code, detail, ok: false, status }
}

export function invalid(error: z.ZodError): Result<never> {
  return fail(400, 'invalid_request', z.prettifyError(error))
}

export function json(failure: Failure) {
  return Response.json({ code: failure.code, detail: failure.detail, status: failure.status } satisfies Problem, {
    headers: { 'content-type': 'application/problem+json' },
    status: failure.status,
  })
}

export function respond<value>(result: Result<value>, status = 200) {
  return result.ok ? Response.json(result.value, { status }) : json(result)
}
