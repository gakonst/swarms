# Swarms

Crowdfunded AI agents that research and build in the open on the Tempo gateway's public HTTP API. Many agents change this repository at once: every rule keeps main green while they do.

## Code

- Keep changes small and match the code around them. `scripts/tidy.ts` refuses comments, tests outside `test/dst`, numbers outside `src/shared/Limits.ts`, unbounded waits, module-scope collections and claims held across an await; `tidy/<rule>.txt` counts only fall.
- Make invalid states unrepresentable: a lifecycle is one discriminated union changed by its transitions (`src/worker/machines`), and an invariant is an `assert()` that crashes the request. Never hide a bad state with truncation, clamping or a fallback.
- A Durable Object interleaves at every await. Storage writes with no await between them commit together; anything split by an await must survive a restart in the middle, so write the state change and its effect's id in one step, then do the I/O.
- One writer per scope: a write carries the rev or epoch it read and is refused when stale. Ownership is lost only when a renew or fenced write is refused, never on a dropped stream or a 5xx. Every fold of a child result is keyed by its id and lands once.
- Every Worker and object RPC works one version apart both ways: list older methods in `test/rpc-older.json`, and parse stored records and RPC with zod into versioned unions.
- Schema changes run once per format version, not on every object wake.
- Every operation lives in `Operations` as `(env, input) => Problem.Result`; `/api`, `/v1` and MCP are thin adapters, and pages read only what `/v1` serves.
- Swarms holds no funds and no keys. Everything a swarm produces is public: redact credentials with `Trail.redact`. Links and public addresses come from `src/shared/Site.ts`.

## Tests

- `test/dst` is the only test: `pnpm dst` runs it by seed. Each invariant has a named canary, a mutant the simulator must catch (`pnpm dst --canaries`). A bug a seed found stays in `test/dst/seeds.json`; `pnpm dst --hunt --minutes N` looks for more.
- `test/*.test.ts` are unit tests still to port (`tidy/unit-tests.txt`): delete one only when a DST scenario and a canary catch the same bug.

## Checks and shipping

- `scripts/check` runs fmt, lint, typecheck, tidy, build with the size gate, the unit tests left and the simulator, and ends GREEN or RED. Logs land in `output/check/`.
- `tidy/size.txt` is the upload baseline: growth over 2% needs `pnpm size --update` with the measurement in the commit message. Back performance changes with before/after numbers.
- Check pages under `pnpm dev` with `?fixture` in headless Chrome at 1440x900 and 390x844.
- Deploy from current `origin/main` with `CTX=tempo wrangler ctx exec pnpm run deploy`; a migration the new Worker reads runs first (`pnpm db:migrate`), one that drops what the old Worker writes runs after.

## Git

- Main only: commit your own changes and push them with `scripts/land`: it rebases on origin/main, requires the full `scripts/check` GREEN and `pnpm test` fail 0 on that exact HEAD, then runs `git push origin HEAD:main`, rebasing and rerunning everything when the push is rejected (`Land.attempts` in `src/shared/Limits.ts`). Never force-push. On a conflict keep theirs and redo yours on top.
- Land only with `scripts/land`; never push on a partial check.
- End every session with `git status` clean and nothing ahead of origin/main.
- Commit messages are the record: `type(scope): summary`, then why, with commands and measurements. The repository is public: no internal links, private details or security findings.
- No plan, status or decision documents; history is in git.
