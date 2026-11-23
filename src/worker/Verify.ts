import type * as Tree from '../shared/Tree.ts'

export type Request = { nid: string; sha: string; statement: string; swarm: string; theorem: string }

export type Read = { nid: string; outcome: Tree.Check | { failed: string }; sha: string; swarm: string } | null

export async function request(env: Cloudflare.Env, input: Request): Promise<{ ok: true } | { detail: string; ok: false }> {
  void env
  void input
  return { ok: true }
}

export async function seed(env: Cloudflare.Env, swarm: string): Promise<{ ok: true; repo: string | null } | { detail: string; ok: false }> {
  void env
  void swarm
  return { ok: true, repo: null }
}

export async function read(env: Cloudflare.Env, request: globalThis.Request): Promise<Read> {
  void env
  void request
  return null
}
