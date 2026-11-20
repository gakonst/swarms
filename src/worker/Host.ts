// Where a swarm's boards live: nanocode-ts's Board over the object's own
// SQLite, through the Cloudflare SqlHost, with the board's wasm bundled into
// the Worker.

import { Board } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/cloudflare'
import wasm from 'nanocode-ts/nanocode_wasm.wasm?module'

export function open(storage: DurableObjectStorage, scope: string, actor: string): Promise<Board.Board> {
  return Board.open({ actor, module: wasm, scope, sql: Sql.create(storage) })
}
