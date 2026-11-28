import { z } from 'zod'
import type { Item } from '../shared/Drive.ts'
import { clip, redact } from '../shared/Trail.ts'
import * as Limits from '../shared/Limits.ts'
import * as Drive from './Drive.ts'
import * as Gateway from './Gateway.ts'
import * as Repo from './Repo.ts'
import type * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'

export const said = 'Started a fresh agent session: the old one grew too large to reopen.'

export const marker = 'This is a fresh agent session for this swarm.'

export const guards = { handoff: true }

const update = z.object({ text: z.string() }).loose()

const files = ['README.md', 'SUMMARY.md'] as const

function listed(items: Item[], title: string) {
  if (!items.length) return ''
  return [title, ...items.map((item) => '- #' + item.id + ' ' + item.title + (item.why ? ': ' + item.why : ''))].join('\n')
}

function board(self: Swarm) {
  const most = Limits.Session.handoffItems
  const items = Drive.items(self, Limits.Drive.shownItems)
  const done = items.filter((item) => item.state === 'done').slice(0, most)
  const open = items.filter((item) => item.state === 'open' || item.state === 'flying').slice(0, most)
  const dead = items.filter((item) => item.state === 'dead').slice(0, most)
  const parts = [listed(done, 'Done, with what each found:'), listed(open, 'Open:'), listed(dead, 'Dead ends:')].filter(Boolean)
  return parts.length ? ['The Board:', ...parts].join('\n') : ''
}

async function code(self: Swarm, swarm: string, name: string) {
  const owner = await Repo.gatewayWallet(self)
  if (!owner) return ''
  const commits = await Repo.history(self, swarm, name, Limits.Session.handoffCommits)
  const head = commits[0]
  const read = head
    ? await Promise.all(
        files.map((path) =>
          Gateway.code<{ text?: string }>(
            self.env,
            owner,
            swarm,
            '/' + encodeURIComponent(name) + '/read?path=' + encodeURIComponent(path) + '&ref=' + head.sha,
          ),
        ),
      )
    : []
  const quoted = files.flatMap((path, index) => {
    const text = read[index]?.text
    return text === undefined ? [] : [path + ' (its start):\n' + clip(text.trim(), Limits.Session.handoffFileChars)]
  })
  return [
    'The repository ' + name + ', newest commits on main:',
    ...commits.map((commit) => '- ' + commit.sha.slice(0, Limits.SharedTree.shortSha) + ' ' + (commit.message.split('\n')[0] ?? '')),
    ...quoted,
    'Read ' + files.join(', ') + ' and the code in full with the git tools before you change anything.',
  ].join('\n\n')
}

function last(row: Store.Row) {
  if (!row.answer) return ''
  const found = update.safeParse(JSON.parse(row.answer))
  return found.success && found.data.text.trim() ? 'The last update:\n' + clip(found.data.text.trim(), Limits.Session.handoffUpdateChars) : ''
}

export async function brief(self: Swarm, row: Store.Row, from: string, repo: { name: string; state: 'none' | 'ready' }) {
  if (!guards.handoff) return ''
  const opening =
    marker +
    ' The previous session (' +
    from +
    ') could not go on: its turns kept failing with restarts or host crashes because its history grew too large to reopen, so its conversation is gone. Everything it made is kept. Pick up from here and do not redo finished work.'
  const known = repo.state === 'ready' ? await code(self, row.id, repo.name) : ''
  return redact([opening, board(self), known, last(row)].filter(Boolean).join('\n\n'))
}
