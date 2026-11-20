# Board swarm

A swarm of separate processes that coordinate only through a nanocode Board, a task log kept in one SQLite file. It needs no API keys and finishes in about ten seconds.

```sh
cd examples/board-swarm
npm install
npm run example
npm test
```

- **Lead** (`src/lead.ts`) posts the goal and seven tasks under it, each with the tasks it needs: generate a corpus, count words in three shards, checksum the corpus with `sha256sum`, merge the counts and write `report.md`. It holds the goal's lease while it watches, and finishes the goal once every task is done.
- **Workers** (`src/worker.ts`, three by default) each open the same board, claim ready tasks with a lease, renew it at a third of the lease while they work, read steers between steps and finish with an outcome.
- **A crash.** Half a second into `count-2` the lead kills its worker with SIGKILL. The task stays claimed until the lease runs out, then another worker claims it and the board reports `tookOver: true`.
- **A steer.** When a worker claims `report`, the lead steers it: "List only the top 5 words". The worker heeds the steer and writes the top 5 instead of the top 10.

The lead prints the timeline (board phase changes and every worker's claims, renewals, heeds and finishes) and a summary, and writes both with the run's files to `output/run` (`--dir` moves it). It exits non-zero unless every task is done, the takeover happened and the steer was heeded, which is also what `npm test` checks.

Storage is `Sql.open(path)` from `nanocode-ts/node`, a `SqlHost` over `node:sqlite` in WAL mode, so every process opens its own connection to the same file and `Board.open` from `nanocode-ts` folds the shared log. Each process is an `agent:<name>` actor; the lead charters the board and grants agents `manage` on it. Needs Node 22.18 or later. With `ANTHROPIC_API_KEY` set, the worker that writes the report also runs a nanocode agent turn and adds its one-line note to the outcome.

Options: `npm run example -- --workers 4 --lease-ms 1500 --kill-after-ms 500 --timeout-ms 60000`.
