import type * as Tree from '../shared/Tree.ts'

export type Request = { nid: string; sha: string; statement: string; swarm: string; theorem: string }

export type Read = { nid: string; outcome: Tree.Check | { failed: string }; sha: string; swarm: string } | null

export async function request(env: Cloudflare.Env, input: Request): Promise<{ ok: true } | { detail: string; ok: false }> {
  void env
  void input
  return { detail: 'The verifier is not set up yet.', ok: false }
}

export async function read(env: Cloudflare.Env, request: globalThis.Request): Promise<Read> {
  void env
  void request
  return null
}
