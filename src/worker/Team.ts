import type { Address } from 'viem'
import type { Roster, Seat } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Gateway from './Gateway.ts'
import * as Problem from './Problem.ts'
import * as Store from './Store.ts'

export const period = 30 * 86_400_000

const freshMs = 30_000

const held = new Map<string, { at: number; roster: Roster }>()

export function forget(swarm: string) {
  held.delete(swarm)
}

export async function roster(env: Cloudflare.Env, row: Store.Row): Promise<Roster> {
  const known = held.get(row.id)
  if (known && Date.now() - known.at < freshMs) return known.roster

  const fallback = row.creator ?? (await Store.members(env, row.id))[0]?.address ?? null
  if (!row.team) {
    const open: Roster = { admins: fallback ? [fallback.toLowerCase() as Address] : [], memberBudget: null, seats: [], steering: row.steering, team: null }
    held.set(row.id, { at: Date.now(), roster: open })
    return open
  }

  const [listed, operator, used] = await Promise.all([Gateway.teammates(env, row.team), Gateway.wallet(env), Store.allotted(env, row.id, Date.now() - period)])
  if (!listed.ok) throw new Error(`The gateway did not list the swarm's team: ${listed.detail}`)
  const names = new Map((await Store.members(env, row.id)).map((member) => [member.address, member.handle]))
  const seats = listed.value.members
    .filter((mate) => mate.member.toLowerCase() !== operator)
    .map((mate): Seat => {
      const address = mate.member.toLowerCase() as Address
      const spent = used.get(address) ?? 0n
      const limit = units(mate.limit)
      return {
        address,
        handle: names.get(address) ?? Mention.short(address),
        left: limit === null ? null : Memo.decimal(limit > spent ? limit - spent : 0n),
        limit: limit === null ? null : Memo.decimal(limit),
        role: mate.role,
        spent: Memo.decimal(spent),
      }
    })
  const value: Roster = {
    admins: seats.filter((seat) => seat.role === 'admin').map((seat) => seat.address),
    memberBudget: units(listed.value.memberBudget) === null ? null : Memo.decimal(units(listed.value.memberBudget) ?? 0n),
    seats,
    steering: row.steering,
    team: row.team,
  }
  held.set(row.id, { at: Date.now(), roster: value })
  return value
}

export async function seat(env: Cloudflare.Env, row: Store.Row, address: Address) {
  return (await roster(env, row)).seats.find((found) => found.address === address.toLowerCase())
}

export async function admin(env: Cloudflare.Env, row: Store.Row, address: Address) {
  return (await roster(env, row)).admins.includes(address.toLowerCase() as Address)
}

export async function ensure(env: Cloudflare.Env, row: Store.Row, admin: Address): Promise<Problem.Result<Store.Row>> {
  if (row.team) return Problem.ok(row)
  const made = await Gateway.team(env, (row.title.trim() || 'Swarm ' + row.id).slice(0, 64))
  if (!made.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not create the swarm's team: ${made.detail}`)
  const added = await Gateway.enlist(env, made.value.address, { member: admin, role: 'admin' })
  if (!added.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not add the swarm's admin to its team: ${added.detail}`)
  await Store.update(env, row.id, { team: made.value.address.toLowerCase() as Address })
  forget(row.id)
  return Problem.ok({ ...row, team: made.value.address.toLowerCase() as Address })
}

function units(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  return Memo.units(String(value))
}
