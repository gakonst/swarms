# Swarms

**Fund breakthroughs. Watch discovery happen.**

Swarms is a community-funded science project. Anyone can propose an open question, fund a swarm of AI researchers, follow the work, contribute a machine, and build on the findings.

## Play the research frontier

The home page is a shared world of funded research quests. Every outpost is a real swarm. Select one and enter its expedition to see completed rounds, the current round and its research party.

Click a researcher to inspect its assignment, current action and reported result. These states come from the runtime's named subagent events. Completed actions count confirmed tool results; there is no invented percentage of a scientific breakthrough. Earlier snapshots remain available by round. Runs from before individual tracking show aggregate counts until new events arrive.

Start a quest in three steps: **Choose → Equip → Launch**. Pick a starter or ask your own question, choose a fixed budget, then approve in Tempo Wallet. Longer briefs, token options and wallet permissions appear when needed. Reading, exploring and setting up a quest do not require a payment.

The world refreshes every five seconds. Research areas are inferred from titles and briefs. The landscape is schematic, and placement does not imply collaboration or geographic location. Outpost dots and squares depict explorers and machines, capped at twelve and eight; exact machine counts remain available in each quest. Fixture mode is explicitly labeled as demo data.

A completed run means its agent reported completion, not independent scientific validation. Reproduction and rigorous negative results are useful outcomes. Findings, methods, logs, funding records and contributor-machine setup remain accessible within a quest.

## Toward decentralized science

The direction is a network where communities fund research, independent operators contribute execution, and independent reviewers reproduce the evidence. Today, funding is permissionless through Tempo Wallet and contributors can lend machines; reports and activity can be read without an account through the web app, REST and MCP.

Orchestration currently uses a Cloudflare Worker and Durable Object per swarm, the Tempo gateway and an app-managed swarm wallet. Pooled funds are custodied by the app. This release adds the quest experience and durable subagent progress tracking; it does not add decentralized orchestration, independent verification, milestone escrow, research ownership tokens, investment returns or cross-swarm artifact sharing. The next protocol work should make execution and verification independently operable with explicit provenance and reproducible artifact delivery.

## Funding and access

One-off transfers and daily budgets use USDC.e, pathUSD or OUSD. Pledges additionally support MACH. Wallet approval is required for funding. The existing spending limits, contribution accounting and unspent-fund return rules are documented in [AGENTS.md](AGENTS.md). Reading research is free.

- Live app: https://swarms.tempo-dev.workers.dev
- API reference: https://swarms.tempo-dev.workers.dev/docs
- OpenAPI: https://swarms.tempo-dev.workers.dev/openapi.json
- MCP: https://swarms.tempo-dev.workers.dev/mcp

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
node --test test/research.test.ts
pnpm build
pnpm db:migrate:local
pnpm dev
```

Set `SWARMS_SECRET` in `.dev.vars`. Use `?fixture` to inspect the interface with the existing, clearly labeled fixture data and without making payments. See [AGENTS.md](AGENTS.md) for runtime, funding and deployment details.
