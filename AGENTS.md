# Swarms

Crowdfunded AI agents that research and build in the open, on the Tempo gateway (https://gateway.tempo-dev.workers.dev). Anyone starts a swarm with a goal and backs it with money; its agent works while the money lasts, and everything it makes is public.

# Development

- Keep code simple and changes small. Match the surrounding code and preserve unrelated work. No code comments.
- Swarms uses only the gateway's public HTTP API, as an outside developer would, so it also tests that API. Every operation lives in `Operations` as a function of `(env, input)` returning a `Problem.Result`; the web app's `/api`, the public `/v1` (described by `/openapi.json`) and the MCP tools are thin adapters over it, and every page reads only what `/v1` also serves.
- Swarms holds no funds and no keys: backers' money goes to the gateway, as a transfer to the swarm's credit or an approved backing, and the gateway pays the agent from it. A swarm's money is its `balance` (everything backers put in, which the gateway can pull for it), what it `spent`, and `remaining`, the balance less what was spent. A swarm stops only when it is out of money, and is never done.
- The agent is a stock gateway agent. Swarms sends it only people's words, and adds only the swarm's own instructions (`Persona.render`), frozen when its lead is created, so a change to them reaches only swarms created after it.
- Everything a swarm produces is public. Redact credentials (`Trail.redact`) in everything shown or sent.
- Make invalid states unrepresentable: a lifecycle is one record checked by its transitions (`Phase.Run`). Derive each fact in one place (`Status.standing`, `Steering.gate`), store nothing the database can derive, and make a query faster rather than add a cache.
- Stream rather than poll: pages follow the room socket, the lobby and `/live`, and poll only while a socket is down. No request awaits a promise another request started; a per-isolate cache holds settled values.
- The site is served under `/swarms` at paradigm.xyz, which proxies to the Worker: every link, request and public address goes through `shared/Site.ts`, never a bare `/path` or the request origin.
- Pages render on the server, and nothing flashes or shifts on load. Less text. A row or card is the click target rather than a button beside it. The site speaks dollars and names no token. On a phone the page never scrolls, only its panels; inputs are 16 px and tap areas at least 24 px.
- Dead code is found, not guessed: TypeScript's `findReferences`, `tsc --noUnusedLocals`, and CSS classes that appear nowhere in `src` or `index.html`.
- Check with `pnpm check`, `pnpm build` and `node --test --experimental-strip-types test/*.test.ts`, and check pages under `pnpm dev` in headless Chrome on the fixture world (`?fixture`, `?scene=`, the storyboard at `/board`) at 1440×900 and as a 390×844 touch phone. Keep scratch harnesses and their output outside the repository; never commit credentials or personal data.
- Run locally with `pnpm dev` and `pnpm db:migrate:local`; `.dev.vars` needs `SWARMS_GATEWAY_KEY`, `SWARMS_STATE` keeps local state and `SWARMS_GATEWAY` points at a local gateway. Signing in with Tempo Wallet needs the page served at `SWARMS_URL`, through a tunnel.
- Deploy from the current `origin/main`: a migration that adds or fixes what the new Worker reads runs before the deploy (`pnpm db:migrate`), one that drops what the old Worker writes runs after it, and the deploy is `CTX=tempo wrangler ctx exec pnpm run deploy`. Read the operator key's usage (`GET /api/keys/me`) before spending from it. Record what was checked on production and what was not run.
- This file holds principles only and rarely changes. DECISIONS.md is the growing log: add what each change establishes and why, under the section it belongs to, with the commands, dates and measurements behind it.
