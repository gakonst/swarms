import { Board } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/cloudflare'
import wasm from 'nanocode-ts/nanocode_board.wasm?module'

export function open(storage: DurableObjectStorage, scope: string, actor: string): Promise<Board.Board> {
  const host = Sql.create(storage)
  return Board.open({ actor, module: wasm, scope, sql: { transaction: host.transaction.bind(host) } })
}
