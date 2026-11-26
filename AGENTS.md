# Swarms

Crowdfunded AI agents that research and build in the open, on the Tempo gateway's public HTTP API. Many agents work on it at once, so every rule here is about keeping main green while they do.

## Code

- Keep code simple and changes small. Match the surrounding code and preserve unrelated work.
- No code comments, no tests outside `test/dst`, no test-only dependencies. `scripts/tidy.ts` refuses them.
- `test/dst` is the deterministic simulator and the only test: it runs by seed (`pnpm dst`), and every invariant comes with a named canary mutation the simulator catches. No new unit tests: add a DST scenario and a mutant. A bug a seed finds stays as a seed in `test/dst/seeds.json`; `pnpm dst --hunt --minutes N` looks for more.
- No magic constants or arbitrary caps: every limit lives in `src/shared/Limits.ts` and comes from a protocol, a measurement or a policy. Surface invalid states; never hide them with silent truncation, clamping or fallbacks.
- Invariants are `assert()`ed from `src/shared/Assert.ts` and crash the request.
- Make invalid states unrepresentable: a lifecycle is one discriminated union checked by its transitions (`Phase.Run`). Stored records and Worker↔Durable Object RPC parse at the boundary with zod into versioned unions, N-1 both ways.
- Lock-free: no claim, lock or `Work.serial` held across another await; commit the state change, release, then do the I/O. No request awaits a promise another request started.
- Bounded: every timer, poll and retry waits a deadline from `Limits`; nothing at module scope grows per request; independent awaits start together (`Promise.all`).
- Every operation lives in `Operations` as `(env, input) => Problem.Result`; `/api`, `/v1` and MCP are thin adapters, and pages read only what `/v1` serves.
- Swarms holds no funds and no keys. Everything a swarm produces is public: redact credentials (`Trail.redact`) in everything shown or sent.
- Every link and public address goes through `shared/Site.ts` (served at swarms.new and under `/swarms` at paradigm.xyz).

## Checks

- Run `scripts/check` (`pnpm check`): fmt, lint, typecheck, tidy, build with the upload size gate, and the simulator's pass jobs and canaries, in parallel, one green or red line each with its time, then GREEN or RED. Logs land in ignored `output/check/`.
- Tidy allowances are `tidy/<rule>.txt`, one `path count why` line per file. Counts only fall: `pnpm tidy --update` lowers them in the commit that removes a violation; raising one is a reviewed edit with its why. `tidy/unformatted.txt` lists files not yet in prettier's format; `pnpm fmt <file>` and drop its line.
- `tidy/size.txt` is the Worker and client upload baseline; growth over 2% fails unless `pnpm size --update` lands in the same commit, with the measurement in the commit message.
- Back performance changes with reproducible before/after measurements in the commit message. Check pages under `pnpm dev` in headless Chrome on the fixture world at 1440×900 and 390×844. Keep scratch harnesses and their output in ignored `output/`; never commit credentials or personal data.
- Deploy from the current `origin/main` with `CTX=tempo wrangler ctx exec pnpm run deploy`: a migration the new Worker reads runs before it (`pnpm db:migrate`), one that drops what the old Worker writes runs after.

## Git and swarms

- Main only. Commit only your own changes and push each straight to main once `scripts/check` is green: no pull requests and no other branches, including for unfinished work, which lands in small green commits.
- Take a write scope no other agent holds, rebase on origin/main before every push, rerun the checks, and never force-push or rewrite someone else's commit. On a conflict, keep theirs and redo yours on top.
- Nothing lives only on a machine: end every session with `git status` clean and nothing ahead of origin/main.
- The commit message is the record: `type(scope): summary`, then why, with the commands and measurements behind it. This repository is public: no internal links, people's private details or security findings in commits.
- No decision logs, status, plan or results documents. Docs describe what exists now; delete one when it stops being true. History is in git (the old decision log is DECISIONS.md at da26e9a).
