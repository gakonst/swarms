import { Board } from 'nanocode-ts'
import { module, sql } from '../board.ts'

export const raw = Symbol('raw')

export const fence = Symbol('fence')

export type Fence = { board: <T extends object>(board: T) => T }

const hosts = new WeakMap<object, ReturnType<typeof sql>>()

export async function open(storage: object, scope: string, actor: string) {
  const held = storage as { [raw]?: object; [fence]?: Fence }
  const real = held[raw] ?? storage
  let host = hosts.get(real)
  if (!host) hosts.set(real, (host = sql()))
  const board = await Board.open({ actor, module, scope, sql: host })
  return held[fence] ? held[fence].board(board) : board
}
