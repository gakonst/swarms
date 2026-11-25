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

### What a Durable Object gives and does not give

- One object per swarm (`SWARM.idFromName`) runs one request at a time **between awaits only**. While an object awaits `fetch`, D1 or a timer, its other requests, its alarm and its timers run. Every `await` in the object is an interleaving point.
- Storage writes (`ctx.storage.kv`, `ctx.storage.sql`) made with no I/O await between them commit together. A write sequence that awaits the network in the middle is not atomic: the object can be evicted or restarted there (a deploy restarts every object), and its next life sees the first half.
- In-memory fields of the object and module-level maps of the isolate vanish on restart, and a Worker isolate and an object may or may not share an isolate. Neither is ever a source of truth.
- Alarms are at-least-once and do not overlap, but requests run during an alarm's awaits.
- During a deploy the new Worker calls old objects and old Workers call new objects for a while (version skew).

## Owners today

| Scope | Owner | Durable state | Read model |
|---|---|---|---|
| Agent swarm run (`Phase.Run`: new, waiting, starting, working, paused) | Swarm object, alarm under the `stepping` claim | object kv `run`, `agent`, `lease`, `heard`; board tasks `turn:<n>` | D1 `swarms.status/why/rounds` |
| Turn | the `turn:<n>` board claim | object SQL `turns`, `feed` | D1 `reports`, `search` |
| Tree swarm node, run, check | Swarm object, `Board.pool` claims of `r:<nid>:<k>` and `v:<nid>:<sha>` | board tasks `n:`, `r:`, `v:`, `s:`; kv `run:`, `folded:`, `picked:`, `quiet:`, `stuck:` | object SQL `tree_deltas` |
| Tree ledger (pledge, grant, commit, spend, settle, return, move) | the `budgeting` claim on the swarm's board | D1 `flows` (balance-checked insert) | `Flow.fold` |
| Agent swarm money (contributions, steers, branches) | the Worker request and D1 (no object owner) | D1 `contributions`, `steers`, `branches` | `Store.funds`, `Store.notes` |
| Lent hand | board task `hand:<name>` (cap 32) | board; D1 `hands` | `Hands.lent` |
| Lobby list, #general | Lobby object (`lobby`, `general`) | kv `held:`, SQL `hall` | socket frames |
| Rider's session | D1 `sessions` | D1 | `Sessions.held` (30 s per isolate) |

## The map

Hazard: **High** loses money, folds a result twice or wedges a swarm; **Medium** shows wrong or stale state, or duplicates a message, and heals by itself; **Low** costs a request or a wasted call.

### Board claims used as locks

| Entry | Location | What can race | Guard today | Hazard |
|---|---|---|---|---|
| `stepping`, the agent swarm's single step | `Swarm.alarm` `src/worker/Swarm.ts:709`, `Work.holding` `src/worker/Work.ts:91` | Alarm retry against a step still running; a request (`wake`, `funded`) setting the alarm mid-step | A 5 min lease renewed every third by `setInterval` (`Work.ts:94`). The step awaits the gateway for up to a 5 min stream window, a 3 s sleep and many D1 reads while holding it (rule 3). A refused renew is swallowed (`.catch(() => undefined)`), so work goes on after the lease is lost (rule 1). A held lock makes the alarm return without re-arming | High |
| `budgeting`, the tree ledger's mutex | `Nodes.budgeting` `src/worker/Nodes.ts:381`, `Work.serial` `src/worker/Work.ts:104` | Every pledge, steer, move, top-up, settle, late charge and `consider` in the object | `Work.serial` spins every 50 ms with **no deadline** (rule 6) while the holder awaits D1 (`Flow.rows`, `Flow.write`) and the board. Each try appends a claim and a release to the board log. Callers include request paths (`Riding.pledge` `src/worker/Riding.ts:205`) and the pool (`Nodes.topUp` from `Runner.watch`) | High |
| `budgeting` for branch budgets | `Branching.rebudget` `src/worker/Branching.ts:36` | Two funds or stops of one branch | Same spin, held across `Store.funds` (D1) and `Gateway.budget` (network, up to 120 s) | Medium |
| `exposing`, `snapping` | `Swarm.heal` `src/worker/Swarm.ts:483`, `Swarm.code` `src/worker/Swarm.ts:730` | Concurrent views each starting the same background work | Claim refused means skip: correct, but held across gateway calls | Low |
| `notes` heed lock | `Turns.heed` `src/worker/Turns.ts:224` | Two turns' ends heeding notes | Claim, heed, release with no await outside the board: fine | Low |
| Node claim to finish or heed | `Nodes.proven` `src/worker/Nodes.ts:624`, `Nodes.heedNode` `src/worker/Nodes.ts:643` | A check proving a node while a run's spawn heeds its steers | `proven` throws when the claim is held, so a check that arrives while `heedNode` holds the node fails its verify task (retried) | Medium |
| Instance locks let go at board open | `Work.reclaim` `src/worker/Work.ts:84` | A past life's `stepping` | Correct only because the object claims as one actor in every life; it relies on reclaim running before this life claims anything (`Work.opening`) | Low |
| Run and verify claims let go on the first tick | `Runner.tick` `src/worker/Runner.ts:757` | `Runner.verified` (`Runner.ts:556`) and `Riding.*` call `Runner.ensure` before the alarm's first tick, so this life's pool can already hold `v:` claims, which are never in `rt.aborts`; the first tick releases them under the running `check` | `!rt.aborts.has(task.id)` covers runs that registered, not checks, and not runs still before `rt.aborts.set` (`Runner.ts:328`) | High |

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
| Tree runtime | `Runner.runtime` (`aborts`, `doing`, `pools`, `follow`, `listing`), `src/worker/Runner.ts:44` | Lost on restart; the first tick rebuilds it from the board (see the claim entry above) | Medium |
| `flushing` | `src/worker/Nodes.ts:288` | A WeakSet keyed by the object instance guards `statements`: right within a life only | Low |
| Lobby's last sent | `Lobby.sent` `src/worker/Lobby.ts:31` | Lost on restart, so the coalescing window restarts; summaries carry no version, so a late `tell` can show an older summary after a newer one | Low |
| Lobby told marker | `Swarm.beacon` (kv `lobby`) | Set before `Lobby.tell` lands, and the tell's failure is swallowed, so a failed tell is never repeated for that summary | Low |

### Object storage writes split by awaits

| Entry | Location | What a restart in the middle leaves | Hazard |
|---|---|---|---|
| Turn end | `Turns.finish` `src/worker/Turns.ts:424-491` | See "Double folds" below: the turn's update is posted and announced again | High |
| Run result fold | `Runner.watch` `src/worker/Runner.ts:482-498`, `Nodes.ran` `src/worker/Nodes.ts:673` | Fixed by this commit, see below | High (fixed) |
| Event cursor | `Follow.listen` `src/worker/Follow.ts:157-161`, polling `:77-79` | Events are digested (feed rows written) and then the board renew is awaited before the cursor is saved, so a restart there replays the batch: feed rows, runs and room lines from those events are written twice | Medium |
| Steer to the lead | `Swarm.steer` `src/worker/Swarm.ts:746-773` | Two requests steering the same note both pass the `steered`/`heard` check before either records it (`Gateway.prompt` is awaited in between), and both send it to the agent; a restart after the prompt and before `hear` sends it again next time | Medium |
| Steer to a run's subagent | `Runner.watch` `src/worker/Runner.ts:461-467` | `Gateway.tell`, then `lease.heed`: a restart in between tells the subagent twice; steers left unrelayed are reposted to the node from a local counter (`:480`) | Medium |
| Spawn | `Runner.run` `src/worker/Runner.ts:336-358` | `run:<task>` is saved after the spawn; a restart in between adopts the subagent by role (`:338`) or by the spawn key: correct | Low |
| Hand issue | `Hands.issue` `src/worker/Hands.ts:95-103` | Claim, then D1 row, then the gateway mint: a restart leaves a claimed slot with no row until its 24 h lease lapses | Low |
| Archive | `Swarm.archive` `src/worker/Swarm.ts:1057` | Sweeps machines and settles branches before `archivedAt`: a restart repeats them (each is idempotent) | Low |
| DDL in the constructor | `Swarm` constructor `src/worker/Swarm.ts:201-226`, `Lobby` `src/worker/Lobby.ts:36` | Every wake runs every `CREATE ... IF NOT EXISTS`, one `PRAGMA table_info` per added column and the kv migration check (rule 4). Cheap per wake, but it is the request path | Low |
| Board open on every wake | `Swarm.board` `src/worker/Swarm.ts:228`, `Host.open` | The first call after a wake compiles the board's wasm module and folds its whole log from SQLite, then `Work.reclaim` scans held tasks. The log grows with every claim and release (two rows per `budgeting` try), so a wake costs more as the swarm ages | Medium |

### D1 read-modify-write

| Entry | Location | Guard | Hazard |
|---|---|---|---|
| Ledger write | `Flow.write` `src/worker/Flow.ts:13` | One statement: the insert lands only if every part is covered by the source bucket, and its id is the idempotency key (`on conflict do nothing`). This is already a compare-and-set on the balance | Low |
| Ledger ids derived from a read | `Riding.steer` `src/worker/Riding.ts:236`, `Riding.move` `:267`, `grantKey` `src/worker/Nodes.ts:440`, `topUp` `:550` | The id includes `rows.length` read just before, so a client's retry after a success gets a new id and moves the money twice; correct only under `budgeting` and only once per request | Medium |
| Swarm status projection | `Swarm.project`, `Store.update` `src/worker/Store.ts:342` | Blind `update swarms set ...`: last writer wins, no revision | Medium |
| Branch settlement | `Store.settle` `src/worker/Store.ts:796`, `Branching.settle` `src/worker/Branching.ts:47` | Insert ids `settle:<agent>:<branch>:...` with `on conflict do nothing`, inside `Work.once`: idempotent | Low |
| Fund a branch | `Operations.fund` `src/worker/Operations.ts:1277-1351` | Inserts the steer, calls the object, and on failure deletes it (`Store.unsteer`, `:1345`): a Worker that dies in between leaves money behind a branch the gateway never budgeted | Medium |
| Contribution | `Operations.contribute` `src/worker/Operations.ts:1709` | `Store.give` keyed by the transaction hash, then the object call; the tree path calls `treePledge` every time (`:1736`), which is idempotent through `Flow.write`'s id; a Worker that dies after `give` and before `contributed` loses the room announcement, not money | Low |
| Hands rows | `Hands.free` `src/worker/Hands.ts:138` | D1 first, then the board: a failure leaves the claim, retried on the next issue: intended | Low |

### Retries and waits

| Entry | Location | Deadline | Hazard |
|---|---|---|---|
| `Work.serial` spin | `src/worker/Work.ts:104` | None | High |
| Wait for a Lean check | `Runner.check` `src/worker/Runner.ts:537` | None but the lease, which the pool renews while it waits, so a callback that never comes holds a verifier slot forever | High |
| Spawn retry | `Runner.spawn` `src/worker/Runner.ts:196`, `:208` | 120 s | Low |
| Turn report poll | `Runner.ask` `src/worker/Runner.ts:233` | 120 s | Low |
| Run watch loop | `Runner.watch` `src/worker/Runner.ts:437` | Ends when nothing changed for the lease length | Low |
| Dispatcher follow stream | `Runner.follow` `src/worker/Runner.ts:673` | Reconnects with backoff while runs are open, unowned (`void`) | Low |
| Event stream window | `Follow.listen` `src/worker/Follow.ts:120` | At most 5 min, under `stepping` | Medium (it is why `stepping` is held across the network) |
| Settle sleep | `Turns.finish` `src/worker/Turns.ts:434` | 3 s, under `stepping` | Low |
| Verify request retry | `Runner.check` `src/worker/Runner.ts:532` | 3 tries with backoff | Low |
| `wait` long poll | `Operations.wait` `src/worker/Operations.ts:774` | The caller's timeout | Low |
| Gateway calls | `Gateway.send` `src/worker/Gateway.ts:92` | 120 s each, no retry inside; D1 calls have no client deadline at all | Medium |

### Alarms

| Entry | Location | Hazard |
|---|---|---|
| Swarm alarm | `Swarm.alarm` `src/worker/Swarm.ts:698` | Re-armed by `getAlarm` then `setAlarm` pairs in nine places (`Swarm.wake`, `funded`, `heal`, `plant`, `Turns.pause`, `Riding.arm`, `Runner.arm`, `Feed`), each an await apart, so two of them can both read the old alarm and the later of two times wins. Every one only moves the alarm earlier or to now, and the step recomputes its next time, so the cost is an extra wake, not a lost one, except when `stepping` is held and the alarm returns without re-arming | Medium |
| Lobby alarm | `Lobby.alarm` `src/worker/Lobby.ts:106` | Coalescing only | Low |

### Worker and object version skew

| Entry | Location | Failure | Hazard |
|---|---|---|---|
| New RPC on an old object | `Operations.viewed` `src/worker/Operations.ts:498`, `test/skew.test.ts`, `test/rpc-older.json` | During a deploy the new Worker called `viewed` on objects still running the old class and every swarm page answered 500. Since 817a88a every new object method the Worker calls falls back to the one it replaces, and `test/skew.test.ts` runs the Worker against the previous object's methods. What it does not cover: a method whose arguments or answer change shape under the same name, and an old Worker calling a new object | Medium |
| Shapes in object storage | kv `run`, `agent`, `lease`, `folded:`, board labels | An old object reads what a new one wrote after a rollback, and the board's log format follows the nanocode-ts pin | Medium |
| D1 migrations | `migrations/`, AGENTS.md's deploy order | Correct only by the order AGENTS.md prescribes | Medium |

## Double folds

The known double-delivery bug: a child's result folded into its parent more than once. Both folds below write their effects in steps separated by awaits, and mark the fold done only at the end. A restart (any deploy restarts every object), a lost lease or a step that throws in between makes the next owner fold the same result again, because nothing says the fold had started.

### A run's result (tree swarms), fixed here

Path: the pool claims `r:<nid>:<k>` and runs `Runner.run` → `Runner.watch` (`src/worker/Runner.ts:429`) sees the subagent end → `Nodes.settleRun` (once, idempotent) → `Nodes.ran` (`src/worker/Nodes.ts:673`) emits `progress` (a tree delta, a line in the node's room thread and a socket frame), bumps `stuck:<nid>`, awaits `Nodes.state` (D1) and posts each child (board) → only then `kv folded:<task>` (`Runner.ts:496`). 085fca5 made a fold that reached `folded:` finish from it, but a stop between the first emit and `folded:` (a restart, or a `LeaseLost` while posting a child) made the next claim run `watch` again: the subagent is still listed as completed, so `Nodes.ran` emitted `progress` a second time (and `checking` for a proof), emitted `posted` again for every child the first attempt had posted (`Board.post` answers ok for an identical repost), and counted as new only the children the first attempt had not posted, so a split whose children all landed before the stop raised `quiet:<nid>` instead of resetting it, and the node paused early.

Reproduced by `test/fold.test.ts` ("a run's result whose fold stopped half way…"): the second child's post throws `LeaseLost`, the object restarts (`Runner.stop`, a fresh runtime, `Runner.tick`), and the run finishes from a second fold. Before this commit: 2 `progress` deltas for one result. Fix: `Nodes.ran` keeps its progress in `ran:<task>` (`Nodes.Folding`), written in the same synchronous step as each effect it guards (the `progress` emit and `stuck`, the `checking` emit, the set of children that were new at the first attempt, the `quiet` count), and `Nodes.post` emits `posted` only for a node it created. `watch` drops `ran:<task>` in the same step that writes `folded:<task>`. The test now passes; it fails on the code before.

### A turn's end (agent swarms), still open

Path: the alarm holds `stepping` → `Turns.step` → `Follow.follow` reads the turn's report → `Turns.finish` (`src/worker/Turns.ts:424`) writes `turns.ended_at`, finishes the `turn:<n>` task, posts the D1 report (`Work.once`, idempotent), logs "Posted an update…" (`:466`), announces "Update: …" in the room (`:473`), then awaits `expose` (gateway listings) and the money refresh, and only then moves the run out of `working` (`:490`). A restart anywhere after the log leaves the run `working` with its claim, so the next alarm adopts the same turn, reads the same completed report and runs `finish` again: the update is logged and announced twice (and `heed`, `publish`, `expose` run again).

Reproduced by `test/fold.test.ts` ("a turn whose end stopped half way…", marked `todo`): `expose`'s first gateway call never answers, a second life of the object over the same storage rings its alarm, and the feed has 2 "Posted an update" rows and the room 2 "Update:" lines. Not fixed here, because the fix is the turn state machine below (`working → ending{n} → waiting`, entered before the first effect), which moves `finish`'s effects behind one durable transition rather than another kv flag.

### The same shape elsewhere

- `Triage.apply` from `Runner.watch` (`src/worker/Runner.ts:486`) applies the triage agent's actions before `folded:`; actions that are not keyed (grants by `grantKey`) apply twice on a refold.
- `Follow`'s event cursor (above) replays a batch of events into the feed.
- `Runner.watch`'s steer relay tells a subagent twice across a restart.
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
- The step no longer holds `stepping` across the stream: the alarm is the only stepper (alarms do not overlap) and a request only moves the alarm, so `stepping` goes away. The stream window becomes an effect whose cursor is written in the same step as the rows it produced.
- D1 `swarms.status` is written with `where id = ? and epoch < ?` from a per-swarm epoch the object bumps on every transition, so an older life or an older Worker cannot overwrite a newer status.

### Node, run and check (tree form)

```text
Node:  Proposed → Open → Splitting { run } → Open | Proven { check } | Ended { kind, why }
Run:   Committed { amount } → Spawning { key } → Running { sub, epoch } → Folding { result, done } → Settled { spent }
Check: Requested { sha } → Waiting { deadline } → Passed | Failed | Expired
```

- A run's `Folding` is the generalization of `ran:<task>` above, and `Settled` replaces `folded:` plus `s:<run>`. The parent node folds a run once by its id `r:<nid>:<k>`.
- `Check.Waiting` has a deadline (rule 6): `Expired` releases the verifier slot and the run that asked can ask again.
- Restart handling stops releasing claims by guessing (`Runner.tick`'s first pass): a claim made by this life carries this life's epoch, so the first pass releases only claims of an older epoch.

### Run lease

The nanocode lease: `Unowned → Claiming → Owned { epoch, until } → Draining → Released`, and `Lost` when a renew is refused. `Work.holding` stops swallowing a refused renew: `Lost` aborts the work's signal, and every write after it is refused because it carries the old epoch.

### Payment and ride

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

### Which awaits may hold a claim, and which waits need deadlines

- May hold a claim: the scope's own object storage writes and board verdicts. Must not: gateway calls, D1 reads, timers, streams. Today `stepping`, `budgeting` and `exposing` break this.
- Need deadlines: `Work.serial` (becomes `Busy`), `Runner.check`'s wait (becomes `Expired`), every D1 call (a client timeout), the board's open.

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
