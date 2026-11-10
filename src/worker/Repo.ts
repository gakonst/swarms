import type { Snapshot } from '../shared/Api.ts'
import type * as Progress from '../shared/Progress.ts'
import { redact } from '../shared/Trail.ts'
import * as Follow from './Follow.ts'
import * as Gateway from './Gateway.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'

function slug(title: string) {
  return (
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'swarm'
  )
}

export const snapshotMs = 60_000

const snapshotFiles = 2_000

const snapshotText = 64_000

type Repo = { name: string; state: 'none' | 'ready' }

const lookMs = 30 * 60_000

export function saw(self: Swarm, sha: string) {
  self.kv.put('seen', sha)
  self.kv.put('seenAt', Date.now())
}

export async function located(self: Swarm, row: Store.Row): Promise<Repo> {
  const ready = self.kv.get<string>('repo')
  if (ready) {
    if (row.repo !== ready) await Store.update(self.env, row.id, { repo: ready })
    return { name: ready, state: 'ready' }
  }
  const name = row.repo ?? slug(row.title)
  const looked = self.kv.get<number>('repoLooked') ?? 0
  if (!Follow.cued(self, 'git', looked) && Date.now() - looked < lookMs) return { name, state: 'none' }
  self.kv.put('repoLooked', Date.now())
  const owner = await gatewayWallet(self)
  const listed = owner ? await Gateway.code<{ repos: { name: string }[] }>(self.env, owner, row.id, `?at=${Date.now()}`) : undefined
  const found = listed?.repos.find((repo) => repo.name === name) ?? listed?.repos[0]
  if (found) {
    await Store.update(self.env, row.id, { repo: found.name })
    self.kv.put('repo', found.name)
    self.log('status', `The swarm's code now lives in its public repository ${found.name}, which its page shows.`)
    self.changed('detail', 'code')
    return { name: found.name, state: 'ready' }
  }
  return { name, state: 'none' }
}

export async function gatewayWallet(self: Swarm) {
  const known = self.kv.get<string>('owner')
  if (known) return known
  const me = await Gateway.me(self.env)
  if (!me.ok) return undefined
  self.kv.put('owner', me.value.wallet.toLowerCase())
  return me.value.wallet.toLowerCase()
}

export async function watch(self: Swarm, row: Store.Row) {
  const repo = await located(self, row)
  if (repo.state !== 'ready') return
  if (stale(self, repo.name)) await graph(self, row.id, repo.name).catch((error: unknown) => console.error('Reading the branches failed', error))
  const fresh = await pushed(self, row.id, repo.name, self.kv.get<string>('seen') ?? null)
  if (!fresh[0]) return
  saw(self, fresh[0].sha)
  await snapshot(self, row.id, repo.name).catch((error: unknown) => console.error('Reading the repository failed', error))
  self.changed('code')
  for (const commit of fresh.reverse()) self.log('status', `Pushed ${commit.sha.slice(0, 7)} to ${repo.name}: ${redact(commit.message.split('\n')[0] ?? '')}`)
}

export async function snapshot(self: Swarm, swarm: string, name: string) {
  const owner = await gatewayWallet(self)
  if (!owner) return
  const base = `/${encodeURIComponent(name)}`
  const [log, listed] = await Promise.all([
    Gateway.code<{ commits: Snapshot['commits'] }>(self.env, owner, swarm, `${base}/log?ref=main&limit=50&at=${Date.now()}`),
    Gateway.code<{ files: { path: string; type: string }[] }>(self.env, owner, swarm, `${base}/files?ref=main&at=${Date.now()}`),
  ])
  if (!log || !listed) return
  const files = listed.files.filter((file) => file.type !== 'tree').map((file) => file.path)
  const head = log.commits[0]
  const path = files.find((file) => /^readme(\.md)?$/i.test(file)) ?? files.find((file) => /readme/i.test(file)) ?? files[0]
  const [read, diff] = await Promise.all([
    head && path ? Gateway.code<{ size: number; text?: string }>(self.env, owner, swarm, `${base}/read?path=${encodeURIComponent(path)}&ref=${head.sha}`) : undefined,
    head ? Gateway.code<{ files: NonNullable<Snapshot['diff']> }>(self.env, owner, swarm, `${base}/diff?ref=${head.sha}`) : undefined,
  ])
  self.kv.put('snapshot', {
    at: Date.now(),
    commits: log.commits.map((commit) => ({ ...commit, message: redact(commit.message) })),
    diff: diff && diff.files.reduce((total, change) => total + change.patch.length, 0) <= snapshotText * 2 ? diff.files.map((change) => ({ ...change, patch: redact(change.patch) })) : null,
    files: files.slice(0, snapshotFiles),
    name,
    readme: path && read?.text !== undefined && read.text.length <= snapshotText ? { path, text: redact(read.text) } : null,
  } satisfies Snapshot)
  self.kv.delete('snapping')
}

export type Graph = {
  at: number
  branches: { name: string; sha: string | null }[]
  logs: Record<string, Progress.Commit[]>
  main: Progress.Commit[]
  name: string
  trunk: string
}

export const graphMs = 60_000

const graphBranches = 40

const trunkCommits = 100

const branchCommits = 50

const trunkText = 2_000

const branchText = 600

export function stale(self: Swarm, name: string) {
  const known = self.kv.get<Graph>('graph')
  if (known && known.name === name && Date.now() - known.at < graphMs) return false
  return Date.now() - (self.kv.get<number>('graphing') ?? 0) > graphMs
}

function trimmed(commit: Progress.Commit, most: number): Progress.Commit {
  return { date: commit.date ?? null, message: redact(commit.message.slice(0, most)), parents: commit.parents ?? [], sha: commit.sha }
}

export async function graph(self: Swarm, swarm: string, name: string) {
  self.kv.put('graphing', Date.now())
  const owner = await gatewayWallet(self)
  if (!owner) return
  const base = `/${encodeURIComponent(name)}`
  type Logged = { commits: Progress.Commit[] }
  const listed = await Gateway.code<{ branches: { name: string; sha: string | null }[] }>(self.env, owner, swarm, `${base}/branches?limit=100&at=${Date.now()}`)
  if (!listed) return
  const trunk = ['main', 'master'].find((wanted) => listed.branches.some((branch) => branch.name === wanted))
  const head = listed.branches.find((branch) => branch.name === trunk)?.sha
  if (!trunk || !head) return
  const known = self.kv.get<Graph>('graph')
  const prior = known?.name === name ? known : undefined
  const main =
    prior?.main[0]?.sha === head
      ? prior.main
      : (await Gateway.code<Logged>(self.env, owner, swarm, `${base}/log?ref=${head}&limit=${trunkCommits}`))?.commits.map((commit) => trimmed(commit, trunkText))
  if (!main) return
  const onMain = new Set(main.map((commit) => commit.sha))
  const others = listed.branches.filter((branch) => branch.name !== trunk).slice(0, graphBranches)
  const logs = Object.fromEntries(
    await Promise.all(
      others.map(async (branch) => {
        const kept = prior?.logs[branch.name]
        if (kept && branch.sha && prior?.branches.find((found) => found.name === branch.name)?.sha === branch.sha) return [branch.name, kept] as const
        if (!branch.sha) return [branch.name, kept ?? []] as const
        const read = await Gateway.code<Logged>(self.env, owner, swarm, `${base}/log?ref=${branch.sha}&limit=${branchCommits}`)
        if (!read) return [branch.name, kept ?? []] as const
        const fork = read.commits.findIndex((commit) => onMain.has(commit.sha))
        return [branch.name, (fork < 0 ? read.commits : read.commits.slice(0, fork + 1)).map((commit) => trimmed(commit, branchText))] as const
      }),
    ),
  )
  self.kv.put('graph', { at: Date.now(), branches: others, logs, main, name, trunk } satisfies Graph)
  self.kv.delete('graphing')
}

export async function history(self: Swarm, swarm: string, name: string, limit: number) {
  const owner = await gatewayWallet(self)
  const read = owner
    ? await Gateway.code<{ commits: Gateway.Commit[] }>(self.env, owner, swarm, `/${name}/log?ref=main&limit=${limit}&at=${Date.now()}`)
    : undefined
  return read?.commits ?? []
}

export async function head(self: Swarm, swarm: string, name: string) {
  return (await history(self, swarm, name, 1))[0]?.sha ?? null
}

export async function pushed(self: Swarm, swarm: string, name: string, base: string | null) {
  const commits = await history(self, swarm, name, 50)
  const at = base ? commits.findIndex((commit) => commit.sha === base) : -1
  return at >= 0 ? commits.slice(0, at) : commits
}
