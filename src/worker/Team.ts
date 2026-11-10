import type { Address } from 'viem'
import type { Member, Roster, Seat } from '../shared/Api.ts'
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

export function cached(swarm: string) {
  const known = held.get(swarm)
  return known && Date.now() - known.at < freshMs ? known.roster : undefined
}

type Chair = { address: Address; limit: bigint | null; role: Seat['role'] }

async function mates(env: Cloudflare.Env, team: string) {
  const [listed, operator] = await Promise.all([Gateway.teammates(env, team), Gateway.wallet(env)])
  if (!listed.ok) throw new Error(`The gateway did not list the swarm's team: ${listed.detail}`)
  return {
    chairs: listed.value.members
      .filter((mate) => mate.member.toLowerCase() !== operator)
      .map((mate): Chair => ({ address: mate.member.toLowerCase() as Address, limit: units(mate.limit), role: mate.role })),
    memberBudget: units(listed.value.memberBudget),
  }
}

export async function roster(env: Cloudflare.Env, row: Store.Row, loaded?: readonly Member[]): Promise<Roster> {
  const [listed, used] = await Promise.all([
    row.team ? mates(env, row.team) : undefined,
    row.team || row.steering === 'team' ? Store.allotted(env, row.id, Date.now() - period) : new Map<string, bigint>(),
  ])
  const chairs = listed?.chairs ?? []
  const budget = listed?.memberBudget ?? null
  const fallback = chairs.some((chair) => chair.role === 'admin') ? null : (row.creator ?? biggest(loaded ?? (await Store.members(env, row.id))))
  const lead = fallback?.toLowerCase() as Address | undefined
  const sat: Chair[] = lead && row.steering === 'team' && !chairs.some((chair) => chair.address === lead) ? [{ address: lead, limit: null, role: 'admin' }, ...chairs] : chairs
  const names = await Store.handles(env, sat.map((chair) => chair.address))
  const seats = sat
    .map((chair): Seat => {
      const spent = used.get(chair.address) ?? 0n
      return {
        address: chair.address,
        handle: names.get(chair.address) ?? Mention.short(chair.address),
        left: chair.limit === null ? null : Memo.decimal(chair.limit > spent ? chair.limit - spent : 0n),
        limit: chair.limit === null ? null : Memo.decimal(chair.limit),
        role: chair.address === lead ? 'admin' : chair.role,
        spent: Memo.decimal(spent),
      }
    })
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1))
  const value: Roster = {
    admins: lead ? [lead] : seats.filter((seat) => seat.role === 'admin').map((seat) => seat.address),
    memberBudget: budget === null ? null : Memo.decimal(budget),
    seats,
    steering: row.steering,
    team: row.team,
  }
  held.set(row.id, { at: Date.now(), roster: value })
  return value
}

export async function seat(env: Cloudflare.Env, row: Store.Row, address: Address, loaded?: readonly Member[]) {
  return (await roster(env, row, loaded)).seats.find((found) => found.address === address.toLowerCase())
}

export async function steerer(env: Cloudflare.Env, row: Store.Row, address: Address, loaded?: readonly Member[]) {
  return row.steering === 'team' ? seat(env, row, address, loaded).catch(() => undefined) : undefined
}

export async function admin(env: Cloudflare.Env, row: Store.Row, address: Address) {
  return (await roster(env, row)).admins.includes(address.toLowerCase() as Address)
}

async function led(env: Cloudflare.Env, team: string, admin: Address): Promise<Problem.Result<null>> {
  const address = admin.toLowerCase()
  const leads = async () => (await mates(env, team).catch(() => undefined))?.chairs.find((chair) => chair.address === address)
  const chair = await leads()
  if (chair?.role === 'admin') return Problem.ok(null)
  if (chair) await Gateway.dismiss(env, team, address)
  const added = await Gateway.enlist(env, team, { member: address, role: 'admin' })
  if (added.ok || (await leads())?.role === 'admin') return Problem.ok(null)
  return Problem.fail(502, 'upstream_failed', `The gateway did not add the swarm's admin to its team: ${added.detail}`)
}

export async function ensure(env: Cloudflare.Env, row: Store.Row, admin: Address): Promise<Problem.Result<Store.Row>> {
  if (row.team) {
    const seated = await led(env, row.team, admin)
    return seated.ok ? Problem.ok(row) : seated
  }
  const made = await Gateway.team(env, (row.title.trim() || 'Swarm ' + row.id).slice(0, 64))
  if (!made.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not create the swarm's team: ${made.detail}`)
  const added = await Gateway.enlist(env, made.value.address, { member: admin, role: 'admin' })
  if (!added.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not add the swarm's admin to its team: ${added.detail}`)
  await Store.update(env, row.id, { team: made.value.address.toLowerCase() as Address })
  forget(row.id)
  return Problem.ok({ ...row, team: made.value.address.toLowerCase() as Address })
}

function biggest(members: readonly Member[]) {
  const backers = members.filter((member) => Memo.units(member.backed) > 0n)
  return backers.reduce<Member | undefined>((top, member) => (!top || Memo.units(member.backed) > Memo.units(top.backed) ? member : top), undefined)?.address ?? null
}

function units(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  return Memo.units(String(value))
}
