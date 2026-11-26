# Concurrency

Swarms has to stay correct under heavy load by design, not because callers are careful. This file follows the rules of nanocode's [docs/CONCURRENCY.md](https://github.com/nanocodexyz/nanocode/blob/0da890f8c/docs/CONCURRENCY.md): every piece of shared state belongs to exactly one owner, ownership is a lease with an epoch, every durable write is a compare-and-set against that epoch or a revision, nothing waits on a lock without a deadline, and a child's result is folded into its parent exactly once, by id.

It holds the rules as they apply to a Cloudflare Worker with Durable Objects and D1, the map of every place that shares state today with its owner, what can race and how bad it is, the one bug that already double-folds results, and the state machines that replace the map. An entry leaves the map when the commit that removes it lands. Locations are `path:line` at the commit that adds this file.

## Rules

1. **One writer per scope per epoch.** A scope is one swarm's run, one node, one run of a node, one payment, one lent hand or one ride. Its owner is the swarm's Durable Object, and inside the object one board task's claim. Only the holder of the claim at the current epoch writes the scope.
2. **No lost acknowledged writes.** A write that answered ok (a D1 statement, a board verdict, an object storage write) stays visible to every later owner, including the object's next life after an eviction or a deploy.
3. **No lock across an await on the network.** A board claim used as a mutex (`Work.holding`, `Work.serial`) and held across a gateway call or a D1 round trip is a lock. The only waits allowed while holding a claim are the scope's own storage writes.
4. **No DDL on open.** Schema changes run once per format version, not on every object wake.
5. **Liveness is lease expiry.** An object restart, a dropped stream or a 5xx is a transport event. Ownership is lost only when a renew or a fenced write is refused.
6. **Every wait has a deadline,** and a missed deadline is a typed refusal (`Busy`, `Lost`, `Gone`), never a hang or a spin.
7. **Every fold is exactly once by id.** A child's result (a turn's end, a run's result, a branch's settlement, a check's outcome, a transfer) carries an id, and folding it twice changes nothing the second time.
8. **Every Worker and object RPC tolerates N-1 both ways.** A gradual deploy runs two Worker versions against the same objects, and an object keeps its old class until it restarts, so version skew is a concurrency hazard like any other. Every RPC is versioned, a new Worker works against the previous object and the previous Worker against the new one, and each has a test (see Version skew below).

### What a Durable Object gives and does not give

- One object per swarm (`SWARM.idFromName`) runs one request at a time **between awaits only**. While an object awaits `fetch`, D1 or a timer, its other requests, its alarm and its timers run. Every `await` in the object is an interleaving point.
- Storage writes (`ctx.storage.kv`, `ctx.storage.sql`) made with no I/O await between them commit together. A write sequence that awaits the network in the middle is not atomic: the object can be evicted or restarted there (a deploy restarts every object), and its next life sees the first half.
- In-memory fields of the object and module-level maps of the isolate vanish on restart, and a Worker isolate and an object may or may not share an isolate. Neither is ever a source of truth.
- Alarms are at-least-once and do not overlap, but requests run during an alarm's awaits.
- During a deploy the new Worker calls old objects and old Workers call new objects for a while (version skew).

## Owners today

| Scope | Owner | Durable state | Read model |
|---|---|---|---|
| Agent swarm run (`Phase.Run`: new, waiting, starting, working, ending, paused) | Swarm object: the alarm is its only stepper, and every write is a typed transition of `machines/Run.ts` fenced on the record's `rev` | object kv `run`, `agent`, `lease`, `heard`; board tasks `turn:<n>` | D1 `swarms.status/why/rounds` |
| Turn | the `turn:<n>` board claim | object SQL `turns`, `feed` | D1 `reports`, `search` |
| Tree swarm node, run, check | Swarm object, `Board.pool` claims of `r:<nid>:<k>` and `v:<nid>:<sha>` | board tasks `n:`, `r:`, `v:`, `s:`; kv `run:`, `folded:`, `picked:`, `quiet:`, `stuck:` | object SQL `tree_deltas` |
| Tree ledger (pledge, grant, commit, spend, settle, return, move) | the `budgeting` claim on the swarm's board | D1 `flows` (balance-checked insert) | `Flow.fold` |
| Agent swarm money (contributions, steers, branches) | the Worker request and D1 (no object owner); the swarm object owns each contribution's announcement (`told:<kind>:<hash>`) | D1 `contributions`, `steers`, `branches` | `Store.funds`, `Store.notes` |
| A rider's payment or move (tree pledge, steer, move) | the swarm object, by the payment's id (`src/worker/machines/Payment.ts`) | kv `pay:<id>` while paying, `paid:<id>` once its effects ran; D1 `flows` | `Flow.fold`, `Payment.audit` |
| Lent hand | board task `hand:<name>` (cap 32) | board; D1 `hands` | `Hands.lent` |
| Lobby list, #general | Lobby object (`lobby`, `general`) | kv `held:`, SQL `hall` | socket frames |
| Rider's session | D1 `sessions` | D1 | `Sessions.held` (30 s per isolate) |

## The map

Hazard: **High** loses money, folds a result twice or wedges a swarm; **Medium** shows wrong or stale state, or duplicates a message, and heals by itself; **Low** costs a request or a wasted call.

### Board claims used as locks

| Entry | Location | What can race | Guard today | Hazard |
|---|---|---|---|---|
| `stepping`, the agent swarm's single step | `Swarm.alarm` `src/worker/Swarm.ts:709`, `Work.holding` `src/worker/Work.ts:91` | Alarm retry against a step still running; a request (`wake`, `funded`) setting the alarm mid-step | A 5 min lease renewed every third by `setInterval` (`Work.ts:94`). The step awaits the gateway for up to a 5 min stream window, a 3 s sleep and many D1 reads while holding it (rule 3). A refused renew is swallowed (`.catch(() => undefined)`), so work goes on after the lease is lost (rule 1). A held lock makes the alarm return without re-arming. **Fixed:** `stepping` is gone. The alarm is the only stepper (alarms do not overlap, requests only move the alarm), so nothing is held across the stream window or the gateway; a past life still stepping is refused by the run record's `rev` (`machines/Run.ts`), and the alarm always re-arms from the step's answer. `Work.holding` follows the lease machine (`machines/Lease.ts`): a refused renew, or a lease that runs out unrenewed, is `Lost`, which aborts the work's signal, answers `lost` instead of the work's value and does not release a claim that is no longer its own | High (fixed) |
| `budgeting`, the tree ledger's mutex | `Nodes.budgeting` `src/worker/Nodes.ts:381`, `Work.serial` `src/worker/Work.ts:104` | Every pledge, steer, move, top-up, settle, late charge and `consider` in the object | `Work.serial` spins every 50 ms with **no deadline** (rule 6) while the holder awaits D1 (`Flow.rows`, `Flow.write`) and the board. Each try appends a claim and a release to the board log. Callers include request paths (`Riding.pledge` `src/worker/Riding.ts:205`) and the pool (`Nodes.topUp` from `Runner.watch`). **Rider paths fixed:** `Riding.pledge`, `steer` and `move` no longer take it; their one balance-checked insert is the compare-and-set and their ids are keys, so they need no lock (Payment and ride below). The pool's grants, commits, top-ups and `Triage` still take it. **Spin bounded:** `Work.serial` waits at most 30 s (`Work.serialWaitMs`) and then throws the typed `Work.Busy` (rule 6), and a lease lost while holding it throws `Work.Lost`; the lock is still held across D1, which the owning loop of Payment and ride below replaces | High (rider paths fixed, spin bounded) |
| `budgeting` for branch budgets | `Branching.rebudget` `src/worker/Branching.ts:36` | Two funds or stops of one branch | Same spin, held across `Store.funds` (D1) and `Gateway.budget` (network, up to 120 s) | Medium |
| `exposing`, `snapping` | `Swarm.heal` `src/worker/Swarm.ts:483`, `Swarm.code` `src/worker/Swarm.ts:730` | Concurrent views each starting the same background work | Claim refused means skip: correct, but held across gateway calls | Low |
| `notes` heed lock | `Turns.heed` `src/worker/Turns.ts:224` | Two turns' ends heeding notes | Claim, heed, release with no await outside the board: fine | Low |
| Node claim to finish or heed | `Nodes.proven` `src/worker/Nodes.ts:624`, `Nodes.heedNode` `src/worker/Nodes.ts:643` | A check proving a node while a run's spawn heeds its steers | `proven` throws when the claim is held, so a check that arrives while `heedNode` holds the node fails its verify task (retried)  **Fixed:** the node is a machine (`machines/Tree.ts` `node`, read from the board by `Nodes.nodeState`): `prove` and `end` are refused on a proven or ended node, and `proven` waits up to 10 s (`Nodes.heldMs`) for a claim `heedNode` holds over board writes only, so a check that arrives mid-heed proves the node instead of failing its task | Medium (fixed) |
| Instance locks let go at board open | `Work.reclaim` `src/worker/Work.ts:84` | A past life's `stepping` | Correct only because the object claims as one actor in every life; it relies on reclaim running before this life claims anything (`Work.opening`) | Low |
| Run and verify claims let go on the first tick | `Runner.tick` `src/worker/Runner.ts:757` | `Runner.verified` (`Runner.ts:556`) and `Riding.*` call `Runner.ensure` before the alarm's first tick, so this life's pool can already hold `v:` claims, which are never in `rt.aborts`; the first tick releases them under the running `check` | `!rt.aborts.has(task.id)` covers runs that registered, not checks, and not runs still before `rt.aborts.set` (`Runner.ts:328`)  **Fixed:** every claim this life's pools hand to `run` or `check` is recorded in `Runtime.claims` before the first await (the pool calls them synchronously after its claim lands), and the first tick and `verified` release only a claim not in it, which is an older life's | High (fixed) |

### In-memory shared state

| Entry | Location | Failure | Hazard |
|---|---|---|---|
| Row memo | `Swarm.memos`, `Swarm.memo` `src/worker/Swarm.ts:170`, `:278` | Keyed by `Store.epoch`, a per-isolate write counter (`src/worker/Store.ts:170`): a write in another isolate leaves the object's copy up to 10 s stale, and `project` (`Swarm.ts` `project`) compares status against it, so a status changed elsewhere is not rewritten | Medium |
| `Store.known`, `Store.repos`, `Store.recent` | `src/worker/Store.ts:168`, `:219`, `:264` | `known` grows without bound and never forgets an id; `recent` (nickname lookups, 30 s) and `repos` (60 s) are cleared only in the isolate that wrote | Low |
| Edge cache, memory then colo | `src/worker/Edge.ts:4`, `:8` | Two isolates refill the same key (`refreshing` is per isolate); a slower refill can put an older value after a newer one (`put` has no version compare) | Medium |
| Session, roster, pricing, credentials caches | `src/worker/Sessions.ts:21`, `src/worker/Team.ts:13`, `src/worker/Gateway.ts:148`, `:259` | A sign-out or a removed seat is honoured by other isolates up to 30 s later | Medium |
| Hands and machines listings | `src/worker/Operations.ts:1654`, `:1800` | Stale for their TTL in other isolates after a removal | Low |
| Event stream state | `Swarm.stream`, `cues`, `polled`, `window`, `reported` (`src/worker/Swarm.ts:161-199`) | `reported` (a turn's result frame, `src/worker/Follow.ts:236`) lives only in memory: a restart between the frame and `finish` drops it, and the result is read again from the gateway (correct, one more call) | Low |
| Subagent listing single-flight | `Swarm.listing`, `Swarm.subagents` `src/worker/Swarm.ts:865` | A request awaits a promise another request started (`:872`), against AGENTS.md; bounded only by the gateway's 120 s timeout | Low |
| Tree runtime | `Runner.runtime` (`aborts`, `doing`, `pools`, `follow`, `listing`), `src/worker/Runner.ts:44` | Lost on restart; the first tick rebuilds it from the board (see the claim entry above)  **Fixed for claims:** `Runtime.claims` names this life's claims, so rebuilding from the board no longer releases them | Medium (claims fixed) |
| `flushing` | `src/worker/Nodes.ts:288` | A WeakSet keyed by the object instance guards `statements`: right within a life only | Low |
| Lobby's last sent | `Lobby.sent` `src/worker/Lobby.ts:31` | Lost on restart, so the coalescing window restarts; summaries carry no version, so a late `tell` can show an older summary after a newer one | Low |
| Lobby told marker | `Swarm.beacon` (kv `lobby`) | Set before `Lobby.tell` lands, and the tell's failure is swallowed, so a failed tell is never repeated for that summary | Low |

### Object storage writes split by awaits

| Entry | Location | What a restart in the middle leaves | Hazard |
|---|---|---|---|
| Turn end | `Turns.finish` `src/worker/Turns.ts:424-491` | See "Double folds" below: the turn's update is posted and announced again. **Fixed:** the `ending` state, below | High (fixed) |
| Run result fold | `Runner.watch` `src/worker/Runner.ts:482-498`, `Nodes.ran` `src/worker/Nodes.ts:673` | Fixed by this commit, see below  `ran:<task>` is the fold machine's record (`machines/Tree.ts` `runFold`), versioned and readable by the previous object; `folded:<task>` is `Settled`, written with the record's removal (`Tree.settle`), and a fold of a settled run is refused | High (fixed) |
| Event cursor | `Follow.listen` `src/worker/Follow.ts:157-161`, polling `:77-79` | Events are digested (feed rows written) and then the board renew is awaited before the cursor is saved, so a restart there replays the batch: feed rows, runs and room lines from those events are written twice. **Fixed:** events at or below the saved cursor are skipped (`machines/Cursor.ts`: a page read again or a stream that reconnects from an older cursor folds nothing twice), and the cursor is saved in the same synchronous step as the rows its events wrote, before the renew is awaited | Medium (fixed) |
| Steer to the lead | `Swarm.steer` `src/worker/Swarm.ts:746-773` | Two requests steering the same note both pass the `steered`/`heard` check before either records it (`Gateway.prompt` is awaited in between), and both send it to the agent; a restart after the prompt and before `hear` sends it again next time | Medium |
| Steer to a run's subagent | `Runner.watch` `src/worker/Runner.ts:461-467` | `Gateway.tell`, then `lease.heed`: a restart in between tells the subagent twice; steers left unrelayed are reposted to the node from a local counter (`:480`)  **Fixed for the repost:** each unrelayed steer goes back to the node under the key `relay:<run>:<seq>`, so a refold reposts nothing twice. Still open: `Gateway.tell` takes no key, so a restart between the tell and the heed tells the subagent again | Medium (repost fixed) |
| Subagent state and spend read from the list | `Runner.watch`, `spentOf`, `late`, adoption `src/worker/Runner.ts:459`, `:705`, `:659`, `:353` | A list answered from an older state (a session snapshot or a reopened runtime after a reset, Swarms' 2 s listing promise) read a finished subagent as running or gone, folded it as a stalled run and settled the older, lower spend. **Fixed:** every read is folded into `seen:<agent>:<sub>` (`machines/Sub.ts`), whose state only rises, whose ended state and result never change and whose spend is the most any read reported; every reader uses the record, a run's record starts as `unknown` at its spawn, and a subagent is gone only when a list and two fresh ones after it all miss it (`Runner.observed`). `test/load.test.ts` (`staleList`, seeds 1 to 8, and its mutant), `test/seen.test.ts` | High (fixed) |
| Spawn | `Runner.run` `src/worker/Runner.ts:336-358` | `run:<task>` is saved after the spawn; a restart in between adopts the subagent by role (`:338`) or by the spawn key: correct | Low |
| Hand issue | `Hands.issue` `src/worker/Hands.ts:95-103` | Claim, then D1 row, then the gateway mint: a restart leaves a claimed slot with no row until its 24 h lease lapses  **Fixed:** the hand machine (`machines/Hand.ts`) writes `lent:<name>` = `issued` in the same step as the claim's verdict and `minted` with the mint's answer; a record left `issued` (its token never reached anyone) or `revoking` by an earlier life or a stopped call is finished by `Hands.repair` before the next issue or removal: detached, its row returned, its task finished | Low (fixed) |
| Archive | `Swarm.archive` `src/worker/Swarm.ts:1057` | Sweeps machines and settles branches before `archivedAt`: a restart repeats them (each is idempotent) | Low |
| DDL in the constructor | `Swarm` constructor `src/worker/Swarm.ts:201-226`, `Lobby` `src/worker/Lobby.ts:36` | Every wake runs every `CREATE ... IF NOT EXISTS`, one `PRAGMA table_info` per added column and the kv migration check (rule 4). Cheap per wake, but it is the request path | Low |
| Board open on every wake | `Swarm.board` `src/worker/Swarm.ts:228`, `Host.open` | The first call after a wake compiles the board's wasm module and folds its whole log from SQLite, then `Work.reclaim` scans held tasks. The log grows with every claim and release (two rows per `budgeting` try), so a wake costs more as the swarm ages | Medium |

### D1 read-modify-write

| Entry | Location | Guard | Hazard |
|---|---|---|---|
| Ledger write | `Flow.write` `src/worker/Flow.ts:13` | One statement: the insert lands only if every part is covered by the source bucket, and its id is the idempotency key (`on conflict do nothing`). This is already a compare-and-set on the balance | Low |
| Ledger ids derived from a read | `Riding.steer` `src/worker/Riding.ts:236`, `Riding.move` `:267`, `grantKey` `src/worker/Nodes.ts:440`, `topUp` `:550` | The id includes `rows.length` read just before, so a client's retry after a success gets a new id and moves the money twice; correct only under `budgeting` and only once per request. **Fixed for `Riding.steer` and `Riding.move`:** the id is `Payment.id(kind, scope, rider, key)` from the request's `key` (a request without one, from the previous Worker, gets a fresh id as before). `grantKey` and `topUp` remain: `Flow.rows` groups rows, so its length can repeat and two different grants can share an id (the second is silently dropped) | Medium (rider paths fixed) |
| Swarm status projection | `Swarm.project`, `Store.update` `src/worker/Store.ts:342` | Blind `update swarms set ...`: last writer wins, no revision | Medium |
| Branch settlement | `Store.settle` `src/worker/Store.ts:796`, `Branching.settle` `src/worker/Branching.ts:47` | Insert ids `settle:<agent>:<branch>:...` with `on conflict do nothing`, inside `Work.once`: idempotent | Low |
| Fund a branch | `Operations.fund` `src/worker/Operations.ts:1277-1351` | Inserts the steer, calls the object, and on failure deletes it (`Store.unsteer`, `:1345`): a Worker that dies in between leaves money behind a branch the gateway never budgeted. **Fixed for keyed requests:** a fund with `key` inserts its steer once by id (`on conflict do nothing`), and its retry finds it (`Store.placed`) and sets the gateway budget again (an absolute value), so a death in between heals on the page's retry; the room line is said only by the request that placed it. Without a key it is as before | Medium (keyed fixed) |
| Contribution | `Operations.contribute` `src/worker/Operations.ts:1709` | `Store.give` keyed by the transaction hash, then the object call; the tree path calls `treePledge` every time (`:1736`), which is idempotent through `Flow.write`'s id; a Worker that dies after `give` and before `contributed` loses the room announcement, not money. **Fixed:** `Swarm.contributed` logs and announces once per hash (`Payment.once`, kv `told:<kind>:<hash>`, in the same synchronous step), and a retry of a counted hash calls the new `counted` (falls back to `funded`), so a lost announcement is made by the page's next retry and never twice; `Riding.pledge` runs its effects once per hash the same way (`Payment.settle`) | Low (fixed) |
| Backing lowered to what it can pay | `Money.settle`, `Store.lower` `src/worker/Store.ts:413` | Two refreshes (the alarm and a request) each read the backing and the gateway, then wrote the amount blind: an older read landing after a newer one raised it back. **Fixed:** `lower` is a compare-and-set on the amount it read (`and amount = ?4`), and its steer take-back runs only when the update did (`changes() > 0`) | Medium (fixed) |
| Backing lowered under what the swarm spent | `Money.settle`, `Store.lower` | A backing that paid past its limit was lowered to `spent + left` on one refresh and raised back on the next, so raised fell under spent (Fermat, 6f4541d2f211, $-0.919659 left at 8ab64b3). **Fixed:** 5edf802 counts a backing at least at what it paid, and `lower` lands only if the swarm's contributions still add up to at least `pool_spent + sponsor_spent + spent_before`, in the same statement | High (fixed) |
| One rider twice in a ledger write | `Flow.write` `src/worker/Flow.ts:13` | Each part was checked alone against the bucket, so a write naming one contributor twice could overdraw. **Fixed:** parts are merged by contributor first | Low (fixed) |
| Hands rows | `Hands.free` `src/worker/Hands.ts:138` | D1 first, then the board: a failure leaves the claim, retried on the next issue: intended  **Fenced:** each write compares the row's state: `seen_at` moves only on a row not returned, a failed mint deletes only a row never seen or returned, and a removal deletes only a returned row, so a stale listing cannot revive a returned hand | Low (fixed) |

### Retries and waits

| Entry | Location | Deadline | Hazard |
|---|---|---|---|
| `Work.serial` spin | `src/worker/Work.ts:104` | **Fixed:** 30 s, then `Work.Busy` | High (fixed) |
| Wait for a Lean check | `Runner.check` `src/worker/Runner.ts:537` | None but the lease, which the pool renews while it waits, so a callback that never comes holds a verifier slot forever  **Fixed:** the check machine (`machines/Tree.ts` `waitCheck`, kv `check:<vid>`) waits at most `Runner.timing.checkMs` (1 h) from when the verifier took it, then is `Expired`: the verify task fails, its slot frees and the node is told once (steer key `expired:<vid>`). A restart in `waiting` does not ask the verifier again, and the first result to come back wins (a later one, or one after expiry, is refused as stale) | High (fixed) |
| Spawn retry | `Runner.spawn` `src/worker/Runner.ts:196`, `:208` | 120 s | Low |
| Turn report poll | `Runner.ask` `src/worker/Runner.ts:233` | 120 s | Low |
| Run watch loop | `Runner.watch` `src/worker/Runner.ts:437` | Ends when nothing changed for the lease length | Low |
| Dispatcher follow stream | `Runner.follow` `src/worker/Runner.ts:673` | Reconnects with backoff while runs are open, unowned (`void`) | Low |
| Event stream window | `Follow.listen` `src/worker/Follow.ts:120` | At most 5 min, under no claim (`stepping` is gone) | Low (fixed) |
| Settle sleep | `Turns.finish` `src/worker/Turns.ts:434` | 3 s, under no claim, once per turn end (before its first effect lands) | Low (fixed) |
| Verify request retry | `Runner.check` `src/worker/Runner.ts:532` | 3 tries with backoff | Low |
| `wait` long poll | `Operations.wait` `src/worker/Operations.ts:774` | The caller's timeout | Low |
| Gateway calls | `Gateway.send` `src/worker/Gateway.ts:92` | 120 s each, no retry inside; D1 calls have no client deadline at all | Medium |

### Alarms

| Entry | Location | Hazard |
|---|---|---|
| Swarm alarm | `Swarm.alarm` `src/worker/Swarm.ts:698` | Re-armed by `getAlarm` then `setAlarm` pairs in nine places (`Swarm.wake`, `funded`, `heal`, `plant`, `Turns.pause`, `Riding.arm`, `Runner.arm`, `Feed`), each an await apart, so two of them can both read the old alarm and the later of two times wins. Every one only moves the alarm earlier or to now, and the step recomputes its next time, so the cost is an extra wake, not a lost one, except when `stepping` is held and the alarm returns without re-arming. **Fixed for that case:** `stepping` is gone, so the agent swarm's alarm always re-arms from its step | Low (fixed for the agent form) |
| Lobby alarm | `Lobby.alarm` `src/worker/Lobby.ts:106` | Coalescing only | Low |

### Spent never exceeds raised

The gateway pays a swarm's calls from its approvals and credit itself; there is no payer callback in Swarms to reserve in. What Swarms dispatches or counts keeps spent ≤ raised:

- A turn is dispatched only when the step's reserve fits under the smaller of what the gateway can pay and raised less spent (`Money.room`).
- A contribution is never lowered under what the swarm spent (`Store.lower`, one statement).
- A tree run reserves its money (`commit`) before its subagent is spawned, its budgets come from that reservation, and settling returns the rest; reservations and spends are rows in one balance-checked insert, so concurrent runs see each other's.

`test/payment.test.ts` checks spent ≤ raised and spent + reserved ≤ raised after every write (mutant: `Flow.guards.covered` off), and the load simulation checks it per swarm at every gateway spend, spawn and budget (`overspent`).

### Version skew

The rule (rule 8) and its record are in DECISIONS.md at da26e9a (git show da26e9a:DECISIONS.md), "A Worker and its objects can be one version apart for minutes after a deploy (2026-11-25)", landed in 817a88a, after b0b7582 fixed the swarm view's 500:

- Every Worker to object RPC tolerates N-1 in both directions.
- A new object method the Worker calls goes through `older(call, fallback, why)` (`src/worker/Operations.ts:489`), which falls back to the method it replaces, and is listed in `test/rpc-older.json`.
- Object methods are not removed or renamed for one release.
- `test/skew.test.ts` enforces both: it runs the Worker against a stub of the previous object and checks every swarm read route answers 200, and that no object method the previous Worker calls was removed.

Still open in the table below: an RPC whose arguments or answer change shape under the same name, and object storage shapes read across a rollback. Both need a version on the call or the record, not only on the method name.

### Worker and object version skew

| Entry | Location | Failure | Hazard |
|---|---|---|---|
| New RPC on an old object | `Operations.viewed` `src/worker/Operations.ts:498`, `test/skew.test.ts`, `test/rpc-older.json` | During a deploy the new Worker called `viewed` on objects still running the old class and every swarm page answered 500. Since 817a88a every new object method the Worker calls falls back to the one it replaces (Version skew above). What it does not cover: a method whose arguments or answer change shape under the same name | Medium |
| Shapes in object storage | kv `run`, `agent`, `lease`, `folded:`, board labels | An old object reads what a new one wrote after a rollback, and the board's log format follows the nanocode-ts pin. **Fixed for kv `run`:** the record carries `v` and `rev`, which the previous code ignores, and `ending` is stored as `working` with an `ending` field, which the previous code reads as a turn still running (after a rollback it ends that turn again, as it did before); a record the previous code writes back drops `rev`, which reads as 0 and makes a fenced write refuse rather than overwrite it **Versioned for the tree and hands:** `ran:<task>` carries `v` and `state` beside the fields the previous object reads (`checking`, `fresh`, `quieted`), and a record without them reads as the state they imply; `check:<vid>`, `lent:<name>` and `seen:<agent>:<sub>` (`v: 1`; a record of another version reads as none) are new keys the previous object ignores (after a rollback it asks the verifier again for a waiting check, and keeps writing `removed`, which the new object still reads) | Medium |
| D1 migrations | `migrations/`, AGENTS.md's deploy order | Correct only by the order AGENTS.md prescribes | Medium |

## Double folds

The known double-delivery bug: a child's result folded into its parent more than once. Both folds below write their effects in steps separated by awaits, and mark the fold done only at the end. A restart (any deploy restarts every object), a lost lease or a step that throws in between makes the next owner fold the same result again, because nothing says the fold had started.

### A run's result (tree swarms), fixed here

Path: the pool claims `r:<nid>:<k>` and runs `Runner.run` → `Runner.watch` (`src/worker/Runner.ts:429`) sees the subagent end → `Nodes.settleRun` (once, idempotent) → `Nodes.ran` (`src/worker/Nodes.ts:673`) emits `progress` (a tree delta, a line in the node's room thread and a socket frame), bumps `stuck:<nid>`, awaits `Nodes.state` (D1) and posts each child (board) → only then `kv folded:<task>` (`Runner.ts:496`). 085fca5 made a fold that reached `folded:` finish from it, but a stop between the first emit and `folded:` (a restart, or a `LeaseLost` while posting a child) made the next claim run `watch` again: the subagent is still listed as completed, so `Nodes.ran` emitted `progress` a second time (and `checking` for a proof), emitted `posted` again for every child the first attempt had posted (`Board.post` answers ok for an identical repost), and counted as new only the children the first attempt had not posted, so a split whose children all landed before the stop raised `quiet:<nid>` instead of resetting it, and the node paused early.

Reproduced by `test/fold.test.ts` ("a run's result whose fold stopped half way…"): the second child's post throws `LeaseLost`, the object restarts (`Runner.stop`, a fresh runtime, `Runner.tick`), and the run finishes from a second fold. Before this commit: 2 `progress` deltas for one result. Fix: `Nodes.ran` keeps its progress in `ran:<task>` (`Nodes.Folding`), written in the same synchronous step as each effect it guards (the `progress` emit and `stuck`, the `checking` emit, the set of children that were new at the first attempt, the `quiet` count), and `Nodes.post` emits `posted` only for a node it created. `watch` drops `ran:<task>` in the same step that writes `folded:<task>`. The test now passes; it fails on the code before.

### A turn's end (agent swarms), fixed

Path: the alarm holds `stepping` → `Turns.step` → `Follow.follow` reads the turn's report → `Turns.finish` (`src/worker/Turns.ts:424`) writes `turns.ended_at`, finishes the `turn:<n>` task, posts the D1 report (`Work.once`, idempotent), logs "Posted an update…" (`:466`), announces "Update: …" in the room (`:473`), then awaits `expose` (gateway listings) and the money refresh, and only then moves the run out of `working` (`:490`). A restart anywhere after the log leaves the run `working` with its claim, so the next alarm adopts the same turn, reads the same completed report and runs `finish` again: the update is logged and announced twice (and `heed`, `publish`, `expose` run again).

Reproduced by `test/fold.test.ts` ("a turn whose end stopped half way", until then marked `todo`): `expose`'s first gateway call never answers, a second life of the object over the same storage rings its alarm, and the feed had 2 "Posted an update" rows and the room 2 "Update:" lines. Fix: the turn state machine (`machines/Run.ts`). `Turns.finish` moves the run `working → ending` in one write with the report it ends on, before any effect; each effect (`turned`, `heard`, `attempted`, `reported`, `logged`, `published`, `announced`, `exposed`) is marked done in the record, the synchronous ones (the `turns` row, the feed line, the room line) in the same step as the effect, and the figures the end decided on (spent, commits, whether money refused it) are kept with `turned`. A restart, a second report for the turn or the next alarm resumes from the record (`Turns.ended`) and repeats nothing that landed; `ending → waiting | paused` is fenced on the record's `rev`, so the first life, waking late, is refused and stops. The test passes, `test/lifecycle.test.ts` adds the first life waking late, and with the done marks turned off it goes red.

### The same shape elsewhere

- `Triage.apply` from `Runner.watch` (`src/worker/Runner.ts:486`) applies the triage agent's actions before `folded:`; actions that are not keyed (grants by `grantKey`) apply twice on a refold.
- `Follow`'s event cursor (above) replays a batch of events into the feed.
- `Runner.watch`'s steer relay tells a subagent twice across a restart (its repost to the node is keyed now; the tell needs a key on the gateway).
- `Work.once` (`src/worker/Work.ts:115`) runs `work` and then `finish`: a finish whose commit is reported as failed (nanocode f1864c5ca fixed false commit reports after a failed append, after the pinned nanocode-ts 887f3cc was built) releases and reruns `work`. Its users are idempotent today (D1 ids), so this is a latent hazard.

## Proposed state machines

Each scope gets one record, changed only by typed transitions, owned by one claim of the swarm's board. Every transition writes its new state and its effects' ids in one synchronous storage step, then performs the effects, each keyed by an id derived from the scope and its epoch, so a replay after a restart repeats only effects whose ids did not land. A child's result is applied as `fold(id)`: a set of folded ids is part of the parent's state, and a fold whose id is in it is a no-op.

### Swarm (agent form)

```text
New
Funding                                  no rider yet
Waiting   { until, from?: Pause, sent? } idle between turns
Starting  { n, claim, prompt, told }     the prompt is sent under id = claim
Working   { n, claim, epoch, turn }      the turn's claim is the only writer of the turn
Ending    { n, claim, report, done: EffectId[] }   entered before the first effect of finish
Paused    { at, pause, settled? }
Archived  { at }                         terminal
```

- `Working → Ending` is written in the same step as the report it ends on, and `Ending` replays only the effects not in `done` (update logged, room announced, D1 report, heed, publish, expose), each keyed `turn:<n>:<effect>`. `Ending → Waiting | Paused` closes it. This fixes the turn double fold.
- Landed: `Ending` as above (stored as `working` with an `ending` field for rollback), the transition table in `machines/Run.ts` (`working` leaves only through `ending`) and the `rev` fence on every write that passes the rev it read. Not yet: the D1 `swarms.status` epoch compare-and-set, which needs a column and a migration.
- Landed: the step no longer holds `stepping` across the stream: the alarm is the only stepper (alarms do not overlap) and a request only moves the alarm, so `stepping` goes away. The stream window becomes an effect whose cursor is written in the same step as the rows it produced.
- D1 `swarms.status` is written with `where id = ? and epoch < ?` from a per-swarm epoch the object bumps on every transition, so an older life or an older Worker cannot overwrite a newer status.

### Node, run and check (tree form)

```text
Node:  Proposed → Open → Splitting { run } → Open | Proven { check } | Ended { kind, why }
Run:   Committed { amount } → Spawning { key } → Running { sub, epoch } → Folding { result, done } → Settled { spent }
Check: Requested { sha } → Waiting { deadline } → Passed | Failed | Expired
```

- A run's `Folding` is the generalization of `ran:<task>` above, and `Settled` replaces `folded:` plus `s:<run>`. The parent node folds a run once by its id `r:<nid>:<k>`.
- `Check.Waiting` has a deadline (rule 6): `Expired` releases the verifier slot and the run that asked can ask again.
- Built in `src/worker/machines/Tree.ts`: `node` (with `Running { run, check? }`, since a run's fold posts its check before the run settles), `fold` and `runFold` (`Told → Checking → Splitting → Quieted`, then `Settled`), and `check` and `waitCheck` (`Requested → Waiting { deadline } → Passed | Failed | Expired`). `test/tree-machine.test.ts` drives each with seeded crashes, duplicates and stale deliveries, and one mutant per guard turns it red.
- Restart handling stops releasing claims by guessing (`Runner.tick`'s first pass): a claim made by this life carries this life's epoch, so the first pass releases only claims of an older epoch. Built as `Runtime.claims`, the set of this life's claims.

### Run lease

The nanocode lease: `Unowned → Claiming → Owned { epoch, until } → Draining → Released`, and `Lost` when a renew is refused. `Work.holding` stops swallowing a refused renew: `Lost` aborts the work's signal, and every write after it is refused because it carries the old epoch.

Landed in `machines/Lease.ts` and `Work.holding`: the lease is that machine, with `Lost` also when the lease runs out with no renew answering, and a renew that throws (a transport error) changes nothing (rule 5). The work gets `{ epoch, signal, writable }`: the signal aborts at `Lost`, `holding` answers `{ lost }` instead of the work's value, and a lost claim is not released. Not yet: the work's D1 and gateway writes do not carry the epoch, so a fenced write needs nanocode's claim epoch (item 4 below) or a check of `writable()` before it.

### Payment and ride

Built in `src/worker/machines/Payment.ts` (`step` and `transfer`, the only transitions; `settle`, `once`, `audit`) and simulated in `test/payment.test.ts`. Every write is one D1 statement that is its own compare-and-set (a balance-checked insert, or an update on the value read), keyed by the transaction hash or the request's key, and each attempt has a deadline (`within`, 30 s, answering `Busy`). `Paying` is written to kv before the write; the effects (room lines, deltas) run in the same synchronous step that writes `paid:<id>`, so a restart resumes and finds its write by id, a duplicate or stale delivery finds `paid:<id>` and changes nothing, and `Payment.audit` checks every bucket non-negative and held = pledged - spent exactly, in micro-dollars (`Riding.health`'s `ok`). Records carry `v` and are read leniently, so an object on either side of a rollback finishes what the other started.

```text
Transfer: Seen { hash } → Credited { amount } → Counted { contribution } → Announced
Ride:     Owed { id, amount, from, to } → Paying { id } → Paid { id } | Refused { id, why }
```

- Every ledger write keeps `Flow.write`'s balance-checked insert, which is already the compare-and-set, but its id comes from the caller's request (an idempotency key the page sends), not from `rows.length` (`Riding.steer`, `Riding.move`, `grantKey`, `topUp`). A retried request then lands once.
- `Paying` is written before the gateway or D1 call, so a restart finds it and reads back the outcome by id instead of paying again. A branch fund (`Operations.fund`) becomes `Owed → Paying → Paid | Refused` in the swarm object, replacing the insert, call and compensating delete in the Worker.
- `budgeting` stays one owner (the object) but stops being a spinning lock: ledger requests become messages to one owning loop in the object, answered in order, each with a deadline that answers `Busy`.

### Hand

```text
Issued { name, claim } → Minted → Seen { until } → Stale → Returned    (terminal; a name is never reissued)
```

The D1 row is written in the same transition as the claim's result, from the board's verdict, so a slot is never held without a row.

Built in `src/worker/machines/Hand.ts` as `Issued → Minted → Revoking → Returned` (`Revoking → Minted` when the gateway refuses an owner's removal; `Seen` and `Stale` are the claim's lease, not stored). The record is kv `lent:<name>`; the object's `removed` list, which the previous object reads, is written in the same step as an owner's `Returned`. `test/hand-machine.test.ts` lends, sees and removes hands with a crash before and after every gateway call and D1 write, restarting the object on the same storage.

### Which awaits may hold a claim, and which waits need deadlines

- May hold a claim: the scope's own object storage writes and board verdicts. Must not: gateway calls, D1 reads, timers, streams. Today `budgeting` and `exposing` break this (`stepping` is gone).
- Need deadlines: `Work.serial` (`Busy` after 30 s, landed), `Runner.check`'s wait (becomes `Expired`), every D1 call (a client timeout), the board's open.

### D1 writes that need a revision or epoch compare-and-set

`swarms.status/why/rounds/answer` (`Store.update`), `swarms.cover` (`Store.pictured`), `hands` rows, and `steers` inserted by `Operations.fund`. `flows`, `contributions`, `branches` and `reports` are already keyed and need only caller-supplied ids.

## What nanocode-ts would replace, and what Swarms needs from it

The pin is nanocode-ts `build-887f3cc` (built 2026-11-20 from nanocode 887f3cc, `package.json`).

Would replace custom code:

- `Board.work(id, { leaseMs }, step)` and `Board.pool` replace `Work.holding`'s `setInterval` renewal, provided a refused renewal aborts the step (`LeaseLost`), so `Work.holding`, `Work.serial` and `Work.once` shrink to calls of it.
- `Board.post(task, { key })` and `Board.steer(id, text, { key })` replace the `rows.length` and counter-derived keys.
- `Board.group(writes)` makes a transition and its first effect one board write, which is what `Ending` and `Folding` need.
- `Board.reply` on the parent task carries a child's result to its parent, so a fold reads it from the board instead of the gateway's listing.

Needs from nanocode:

1. A pin at or after nanocode f1864c5ca (2026-11-20 23:39 UTC), which reads back a failed append instead of reusing its seq: the pinned build predates it, so a board verdict can report a write as failed that committed, and `Work.once` reruns its work.
2. Boards that open into a retaining fold (nanocode-ts 83dfd0144, 2026-11-23), so an object's wake does not refold the whole board log.
3. `post` that says whether it created the task or found an identical one (today both are ok), so a caller can tell a first post from a repost.
4. The claim's epoch exposed on `Claimed` and `Task`, so Swarms can fence D1 and gateway writes with it, and a claim with a wait deadline (`claim(id, { leaseMs, waitMs })` answering `Held` after it) to replace the spin.
5. Keyed exactly-once folds: a `fold(parent, childId, body)` op that lands once per child id, or `reply` with a key, so a parent's fold of a child result is idempotent by construction.
