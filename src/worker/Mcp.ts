import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import * as Site from '../shared/Site.ts'
import * as Feedback from './Feedback.ts'
import * as Machines from './Machines.ts'
import * as OAuth from './OAuth.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'

function instructions(origin: string) {
  return [
    `Swarms (${origin}) are crowdfunded, long-running AI agents on the Tempo gateway. Anyone starts a swarm with a title and a goal, which can be anything an agent can do with code, machines and the web: research a question, build and ship software, port or audit code, gather data, write. It waits in status funding until someone funds it, and then one nanocode agent works on it in a single continuous thread, spending on models, Modal machines and any subagents it spawns. Whenever it pauses to reply, it posts an update; the newest update is the swarm's answer, and the swarm then tells it to keep going. It keeps the code it writes in a public git repository that swarm_get names, with a read-only clone URL (code.clone) for git clone. A swarm is never done: it works while its money lasts and waits whenever it runs out (paused, and new money resumes it).`,
    "Money comes one way: anyone sends MACH, OUSD, USDC.e or pathUSD from their own wallet to the Tempo gateway with a memo that names the swarm, and the swarm counts it by its transaction hash. The gateway holds it as the swarm's credit and spends it only on what the swarm's agent does; a swarm holds no wallet, and money sent is not returned. Money may carry a note: money behind the same note backs it together, the agent reads the notes ranked by the money behind them whenever it keeps going, and a note that arrives while it works reaches it at once.",
    "Contributors can also lend a swarm their own machine as a hand: swarm_hand issues one and returns the nanocode command (nc hand '<url>' --token <token>) and a nanocode-ts snippet (Hand.connect) to run on that machine. The swarm's agent then runs commands there, and is told the machine and its data belong to a contributor. A hand can set its own prices, such as a price per file; the swarm pays them through the gateway from its money and caps what each hand may charge. Issue a hand only when the user asks, and make sure they know the swarm's agents will run commands on the machine.",
    "Swarms publish artifacts as they work, such as a live dashboard of their results, a chart or a write-up; swarm_artifacts lists them with a url to fetch.",
    "Every swarm has a room where its backers talk. Anyone can read it with swarm_chat. Backers post on the swarm's page after signing in with Tempo ID, mention each other by username (or, without one, a name made from their address such as @quark-1a2b), and steer with @swarm: such a message puts an amount of its author's backing, not yet behind a note, behind the rest of the message as a note, which weighs like any other note and reaches the agent at once if it is working.",
    'To answer questions about what the swarms found or did, search first (swarms_search with keywords; set swarm to include that swarm\'s feed of tool calls, commands, machines and messages), then read what matched with swarm_updates, swarm_answer, swarm_get or swarm_feed, and cite the swarm and when. swarms_list shows the funded swarms. Reading is free and needs no account.',
    "When something in Swarms is broken or confusing, or the user wants to report it, swarm_feedback files it with the team that runs Swarms and answers a link where its status shows.",
    `Tools answer once. To follow a swarm in real time, open the same read over HTTP as server-sent events: ${origin}/v1/swarms/<id>/tree, /chat, /feed, /ledger or any other GET under /v1 with Accept: text/event-stream sends a snapshot and then each change, and resumes from Last-Event-ID.`,
    'Reading needs no account. Tools that write sign in with OAuth (the user signs in with Tempo ID and picks scopes: swarms:write, swarms:money, swarms:admin); each tool names its scope, and a call past the granted scopes answers 401 or 403 so the client can sign in again. Tools that move money or cannot be undone (swarm_fund, swarm_contribute with a hash, swarm_hand_remove, swarm_archive, a nickname change) refuse with the exact confirm phrase to send: show the user what will happen, and send the phrase only after they agree.',
    `Fund only when the user asks to. swarm_contribute prepares a transfer (the gateway's address, the memo that names the swarm and its note, call data and a link to the page that sends it) and counts one by its hash. swarm_wait waits up to ${Operations.maxWait} s for the agent's next update, and swarm_watch up to ${watchMost} s, answering the feed since a cursor.`,
  ].join('\n\n')
}

type Need = OAuth.Scope | ((input: Record<string, unknown>) => OAuth.Scope)

const needs: Record<string, Need> = {
  swarm_archive: 'swarms:admin',
  swarm_byok: 'swarms:write',
  swarm_contribute: (input) => (input['hash'] ? 'swarms:money' : 'swarms:read'),
  swarm_create: 'swarms:write',
  swarm_edit: 'swarms:admin',
  swarm_feedback: 'swarms:read',
  swarm_fund: 'swarms:money',
  swarm_hand: 'swarms:write',
  swarm_hand_remove: 'swarms:admin',
  swarm_move: 'swarms:money',
  swarm_nickname: 'swarms:admin',
  swarm_propose: 'swarms:write',
  swarm_steer: 'swarms:money',
  swarm_suggest: 'swarms:write',
}

const labels: Record<string, string> = { swarm_contribute: 'swarms:read to prepare a transfer, swarms:money to count one by its hash' }

type Registry = Map<string, (input: Record<string, unknown>) => OAuth.Scope>

type Message = { id?: unknown; method?: unknown; params?: { arguments?: unknown; name?: unknown } }

function blocked(body: unknown, caller: OAuth.Caller, registry: Registry) {
  for (const message of (Array.isArray(body) ? body : [body]) as Message[]) {
    if (!message || message.method !== 'tools/call' || typeof message.params?.name !== 'string') continue
    const need = registry.get(message.params.name)
    const input = typeof message.params.arguments === 'object' && message.params.arguments !== null ? (message.params.arguments as Record<string, unknown>) : {}
    const scope = need?.(input)
    if (scope && !caller.scopes.has(scope)) return { id: message.id ?? null, scope, tool: message.params.name }
  }
  return undefined
}

function refuse(site: string, caller: OAuth.Caller, refused: { id: unknown; scope: OAuth.Scope; tool: string }) {
  const signed = caller.bearer !== 'none'
  const wanted = [...new Set([...caller.scopes, refused.scope])].join(' ')
  const message = signed
    ? `${refused.tool} needs the ${refused.scope} scope, which this token was not granted. Sign in again and allow it.`
    : `${refused.tool} needs the ${refused.scope} scope: connect with OAuth (sign in with Tempo ID) first. Reading tools need no account.`
  return Response.json(
    { error: { code: -32001, data: { scope: refused.scope, tool: refused.tool }, message }, id: refused.id, jsonrpc: '2.0' },
    { headers: { 'www-authenticate': OAuth.challenge(site, { ...(signed ? { error: { code: 'insufficient_scope', description: message } } : {}), scope: wanted }) }, status: signed ? 403 : 401 },
  )
}

export async function handle(request: Request, env: Cloudflare.Env) {
  if (request.method !== 'POST')
    return Problem.json({ code: 'invalid_request', detail: 'Use POST for MCP over streamable HTTP.', status: 405 })

  const site = Site.url(env, request.url)
  const caller = await OAuth.caller(env, request)
  if (caller.bearer === 'invalid') {
    const description = 'The access token expired or was revoked: refresh it or sign in again.'
    return Response.json({ error: { code: -32001, message: description }, id: null, jsonrpc: '2.0' }, { headers: { 'www-authenticate': OAuth.challenge(site, { error: { code: 'invalid_token', description } }) }, status: 401 })
  }
  const registry: Registry = new Map()
  const server = create(env, Replica.read(env, request), site, caller, registry)
  const refused = blocked(await request.clone().json().catch(() => undefined), caller, registry)
  if (refused) return refuse(site, caller, refused)
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(request)
}

function text(value: unknown): CallToolResult {
  return { content: [{ text: JSON.stringify(value, null, 2), type: 'text' }] }
}

function reply<value>(result: Problem.Result<value>, shape: (value: value) => unknown = (value) => value): CallToolResult {
  if (!result.ok) return { ...text({ code: result.code, detail: result.detail, status: result.status }), isError: true }
  return text(shape(result.value))
}

const reading = { openWorldHint: false, readOnlyHint: true } as const

const confirming = z.string().trim().max(200).optional().describe('The exact confirmation phrase this call names when it refuses without one. Ask the user first: this moves money or cannot be undone.')

function confirmed(given: unknown, phrase: string): CallToolResult | undefined {
  const tidy = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  if (typeof given === 'string' && tidy(given) === tidy(phrase)) return undefined
  return { ...text({ code: 'confirm_required', confirm: phrase, detail: `This moves money or cannot be undone. Ask the user, then call again with confirm: "${phrase}".`, status: 428 }), isError: true }
}

function dollars(amount: string | number) {
  return `$${Number(amount)}`
}

function brief(value: Awaited<ReturnType<typeof Operations.get>>, origin: string) {
  if (!value.ok) return value
  const { about: _about, code: _code, contributions: _contributions, hands: _hands, notes: _notes, updates, ...rest } = value.value
  const latest = updates.at(-1) ?? null
  return Problem.ok({ ...rest, latest, page: `${origin}/${rest.nickname ?? `s/${rest.id}`}`, updates: updates.length })
}

const watchMost = 300

function create(env: Cloudflare.Env, read: Cloudflare.Env, origin: string, caller: OAuth.Caller, registry: Registry) {
  const server = new McpServer({ name: 'swarms', version: '1.1.0' }, { capabilities: { resources: { listChanged: false, subscribe: false } }, instructions: instructions(origin) })
  const address = caller.address
  const operated = caller.operated
  const registerTool: McpServer['registerTool'] = (name, config, handler) => {
    const need: Need = needs[name] ?? (config.annotations?.readOnlyHint ? 'swarms:read' : 'swarms:admin')
    const scope = typeof need === 'function' ? need : () => need
    const label = labels[name] ?? scope({})
    registry.set(name, scope)
    const guarded = (async (input: Record<string, unknown>, extra: unknown) => {
      const wanted = scope(input ?? {})
      if (!caller.scopes.has(wanted)) return { ...text({ code: 'insufficient_scope', detail: `${name} needs the ${wanted} scope.`, scope: wanted, status: caller.bearer === 'none' ? 401 : 403 }), isError: true }
      return (handler as (input: Record<string, unknown>, extra: unknown) => unknown)(input, extra)
    }) as unknown as typeof handler
    return server.registerTool(name, { ...config, _meta: { ...config._meta, 'swarms/scope': label }, description: `${config.description ?? ''} Scope: ${label}.` }, guarded)
  }

  registerTool(
    'swarms_list',
    {
      annotations: reading,
      description:
        'List the funded swarms, most recently active first (at most 100), each with its title, goal, status, balance (everything its backers put in), spent and remaining (balance less spent), machines, backers and latest answer. status filters: funding (funded, its agent has not started yet), running (its agent is working) or paused (out of money; new money resumes it).',
      inputSchema: Operations.schema.list.shape,
    },
    async (input) => reply(await Operations.list(read, input)),
  )

  registerTool(
    'swarm_get',
    {
      annotations: reading,
      description:
        "One swarm: its goal, status and money, its latest answer, every update (time, what it cost and a short excerpt; read them in full with swarm_updates), whether its agent is working and since when, the steering notes ranked by the money behind them and their share of the balance, the transfers that funded it and the machines attached now.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.get(read, input)),
  )

  registerTool(
    'swarm_answer',
    {
      annotations: reading,
      description:
        "A swarm's latest answer: its agent's newest update in full (markdown), and whether the agent is working now.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.answer(read, input)),
  )

  registerTool(
    'swarm_updates',
    {
      annotations: reading,
      description:
        "A swarm's updates, oldest first: each time its agent paused to reply, what it reported (markdown), when (ms), what it spent since the update before and the commits it pushed. limit keeps the newest.",
      inputSchema: Operations.schema.updates.shape,
    },
    async (input) => reply(await Operations.updates(read, input)),
  )

  registerTool(
    'swarm_feed',
    {
      annotations: reading,
      description:
        "A swarm's transcript, oldest first: its agent's messages and reasoning summaries (message, thinking), tool calls, scripts, shell commands and subagents (tool), outputs (output), Modal machines (machine), money coming in and going back (funds), steering (steer), the swarm starting, pausing and posting updates (status) and failures (error), each with seq, time, text, an optional detail and who (null for the agent, else the subagent's name). Page forward with after set to the previous page's next, or back with before.",
      inputSchema: Operations.schema.feed.shape,
    },
    async (input) => reply(await Operations.feed(read, input)),
  )

  registerTool(
    'problems_list',
    { annotations: reading, description: 'The curated idea bank on the New page: each problem with its id, short label, hint, title and full brief, whether it is open, and the swarm working on it if one is. Pass an open problem id as problem to swarm_create.', inputSchema: {} },
    async () => reply(await Operations.problems(read)),
  )

  registerTool(
    'swarm_machines',
    { annotations: reading, description: "Every machine a swarm used over its whole life, as its Machines tab shows them: Modal sandboxes from compute_create (with their image, CPU, memory, GPU, lease and timeout, and their sandbox ids), Browserbase browsers, and contributors' lent nanocode hands (label, price, what their owners were paid, requests), each with whether it is connected, when it started and stopped, and how many commands ran on it (runs.count, runs.failed). List the commands with swarm_machine_commands.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.machines(read, input)),
  )

  registerTool(
    'swarm_machine_commands',
    { annotations: reading, description: "Every command that ran on one machine over the swarm's whole life, a page at a time (newest first by default, or oldest first), each with its seq, time (ms), who ran it (null for the swarm's agent, else the subagent's name), the command, its exit code, whether it failed, how long it took (ms, when known) and, for compute_spawn, the job's log path. Outputs are not included: read one with swarm_machine_command. Page on with cursor set to the previous page's next.", inputSchema: Machines.schema.commands.shape },
    async (input) => reply(await Machines.commands(read, input)),
  )

  registerTool(
    'swarm_machine_command',
    { annotations: reading, description: "One command of a machine with its whole output: the gateway's copy of the tool result when the agent's session still has it (source gateway), else the swarm's feed copy, which keeps the first 2,000 characters (source feed, truncated true when cut). Also its input as the agent sent it.", inputSchema: Machines.schema.command.shape },
    async (input) => reply(await Machines.command(read, input)),
  )

  registerTool(
    'swarm_machine_logs',
    { annotations: reading, description: "A sandbox's own log from the gateway (Modal's system, stdout and stderr lines, such as the image build, an out-of-memory kill or why it ended), kept by Swarms once fetched; the gateway keeps it up to 7 days after the sandbox ended. Lines oldest first, the newest page by default; page back with before set to the previous answer's next. complete says Swarms fetched all of it and will not ask the gateway again.", inputSchema: Machines.schema.logs.shape },
    async (input) => reply(await Machines.logs(read, input)),
  )

  registerTool(
    'swarm_machine_job',
    { annotations: reading, description: "The log of a job started with compute_spawn (the command's seq from swarm_machine_commands), read from the sandbox while it runs and kept by Swarms, with its exit code once it finished. After the sandbox ends, the part already fetched stays.", inputSchema: Machines.schema.job.shape },
    async (input) => reply(await Machines.job(read, input)),
  )

  registerTool(
    'swarm_machines_export',
    { annotations: reading, description: "Where to download everything about a swarm's machines, or one machine, as one NDJSON file: each machine, every command with its whole output, each sandbox's gateway log and each spawned job's log. Answers the URL and a curl command; the file can be large.", inputSchema: Machines.schema.export.shape },
    async (input) => {
      const parsed = Machines.schema.export.safeParse(input)
      if (!parsed.success) return reply(Problem.invalid(parsed.error))
      const url = `${origin}/v1/swarms/${encodeURIComponent(parsed.data.swarm)}/machines${parsed.data.machine ? `/${encodeURIComponent(parsed.data.machine)}` : ''}/export`
      return text({ curl: `curl -fsSL '${url}' -o swarm-${parsed.data.swarm}-machines.ndjson`, format: 'NDJSON: one JSON object a line, with type export, machine, command, logs, log, job and end', url })
    },
  )

  registerTool(
    'swarm_backers',
    { annotations: reading, description: "A swarm's Ideas tab: its ideas (notes) ranked by the money behind them, with backers and share, and every backer with what they sent and whether they lent a machine, most first.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.backers(read, input)),
  )

  registerTool(
    'swarm_branches',
    { annotations: reading, description: "A swarm's branches, which its page's transcript filters by: its agent's subagents, each with its role, task, state, budget (the most it and the subagents under it may spend together), what it spent, and what backers put behind it. Backers fund a branch, or move their money between branches, on the swarm's page or with POST /v1/swarms/<id>/branches/<branch>/fund and /move.", inputSchema: Operations.schema.branches.shape },
    async (input) => reply(await Operations.branches(read, input)),
  )

  registerTool(
    'swarm_progress',
    { annotations: reading, description: "A swarm's progress for a goal that comes down to one number, from its autoresearch artifact: the metric, its direction and goal, main's history (every change to main, each merge naming the branch it took, with the metric after it), and every branch with what it explored, its state, what it found and whether main merged it. progress is null for a swarm that keeps no such record.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.progress(read, input)),
  )

  registerTool(
    'swarm_artifacts',
    {
      annotations: reading,
      description:
        "A swarm's artifacts: the dashboards, charts, tables and write-ups its agents published for contributors to follow along, each with its title, kind, summary, form (page for HTML, image, markdown, table, json or text), version and url. Read a markdown, table, json or text artifact by fetching its url; a page is an HTML dashboard for a browser.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.artifacts(read, input, origin)),
  )

  registerTool(
    'swarm_chat',
    {
      annotations: reading,
      description:
        "A swarm's room, oldest first: its backers' messages, each with its author's wallet address (the room shows it as a handle such as @quark-1a2b), the backers it mentions, and steer when it was an @swarm message that put some of its author's backing behind an idea (amount, note, the note's weight and share, and live when it reached the working agent at once). Messages without an author mark money coming in, the agent starting and stopping, and its updates. members lists every backer with what they put in, how much of it is behind notes and how they back the swarm. By default the newest messages; page back with before, or read newer ones with after.",
      inputSchema: Operations.schema.room.shape,
    },
    async (input) => reply(await Operations.room(read, input)),
  )

  registerTool(
    'swarms_search',
    {
      annotations: reading,
      description:
        "Full-text search over what the swarms did: every swarm's title and goal, its agent's updates and the steering notes, ranked best first with the matches marked «like this» in a snippet. With swarm set it searches only that swarm and also its feed (tool calls, shell commands, machines, messages and errors). Send keywords rather than a question; hits match any of them. Read an update hit with swarm_updates (by its at), and a feed hit with swarm_feed (after = its entry.seq - 1).",
      inputSchema: Operations.schema.search.shape,
    },
    async (input) => reply(await Operations.search(read, input)),
  )

  registerTool(
    'swarm_create',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
      description: `Start a swarm with a title, a goal and a model template (frontier-anthropic by default, Fable 5.2 throughout; GET /v1/config lists every model's price). It costs nothing and waits in status funding until someone sends it money (swarm_contribute, or Fund on its page), and only funded swarms appear in swarms_list. Returns the swarm; its page is ${origin}/<nickname> when given one, else ${origin}/s/<id>.`,
      inputSchema: Operations.schema.create.omit({ steering: true }).shape,
    },
    async (input) => reply(await Operations.create(env, input)),
  )

  registerTool(
    'swarm_contribute',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description:
        "Send money to a swarm from the user's own wallet: MACH, OUSD, USDC.e or pathUSD, each counted at $1. Without hash it prepares the transfer: the gateway's address (to), the token's address, the memo that names the swarm and commits to the note, with amount the transferWithMemo call to send, and a link to the swarm's page with it filled in, where Tempo ID sends it and the page counts it. Show the link to the user, or send the call from a wallet the user controls. With hash it counts a transfer already sent; each transaction counts once. A note counts only when the memo commits to it.",
      inputSchema: { ...Operations.schema.transfer.shape, confirm: confirming },
    },
    async (input) => {
      if (input.hash) {
        const refused = confirmed(input.confirm, `back ${input.swarm} ${input.hash.slice(0, 10)}`)
        if (refused) return refused
        return reply(await Operations.contribute(env, { hash: input.hash, node: input.node, note: input.note, swarm: input.swarm }), (value) => value.contributed)
      }
      return reply(await Operations.transfer(env, input, origin), (value) => ({
        ...value,
        message: `Send ${value.amount ?? 'any amount of'} ${value.symbol} to ${value.to} with transferWithMemo and the memo ${value.memo}, or open ${value.link} to back it with Tempo ID from the swarm's page, which counts it. After sending it any other way, call swarm_contribute with the transaction hash.`,
      }))
    },
  )

  const tree = 'A tree swarm is one tree of tasks (nodes: programs, approaches, lemmas, ideas). Riders put dollars on a node, a subtree or the root (the whole swarm) and propose nodes; the swarm\'s own workers run each funded node as a budgeted run, and money flows down from a node to the runnable nodes under it. Lean decides what is proven: a node is proven only when a public verifier built its proof against its frozen statement, and its Check links that run.'

  registerTool(
    'swarm_tree',
    { annotations: reading, description: `${tree} Returns the headline (proven, frontier, in flight, dead ends, spent, cost per proof) and the nodes from root down to depth, each with its status, money (pledged, inherited, granted, spent, left, committed, subtree), riders, run in flight and checked proof.`, inputSchema: Operations.schema.tree.shape },
    async (input) => reply(await Operations.tree(read, input)),
  )

  registerTool(
    'swarm_node',
    { annotations: reading, description: 'One node of a tree swarm in full: its words and Lean statement, status and why, its checked record, every rider, its runs with what each spent and returned, riders\' steers and the suggestions under it.', inputSchema: Operations.schema.node.shape },
    async (input) => reply(await Operations.node(read, input)),
  )

  registerTool(
    'swarm_proofs',
    { annotations: reading, description: 'Every Lean-checked proof of a tree swarm, newest first, each with its node and its Check: repository, commit, theorem, statement hash, axioms, toolchain and Mathlib pins, checker, command, exit code, duration, content hash and the public verifier run.', inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.proofs(read, input)),
  )

  registerTool(
    'swarm_propose',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description: `${tree} Propose a node under parent (signed in with Tempo ID, Authorization: Bearer <token>). Answers its id and a prepared transfer: the node is posted when a ride of at least $1 naming it is counted with swarm_contribute (hash and node). The same title under the same parent is the same node, so a duplicate adds money to it. Call it only when the user asks.`,
      inputSchema: Operations.schema.propose.shape,
    },
    async (input) => reply(await Operations.propose(env, input, origin, address)),
  )

  registerTool(
    'swarm_suggest',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description: 'Suggest an idea under a node of a tree swarm without money (signed in; 5 a day). Triage may adopt it as a node credited to you, and anyone may ride it. Call it only when the user asks.',
      inputSchema: Operations.schema.suggest.shape,
    },
    async (input) => reply(await Operations.suggest(env, input, address)),
  )

  registerTool(
    'swarm_steer',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description: 'Steer a node of a tree swarm with a note (signed in): amount moves that much of your free money in the swarm onto the node first; the note reaches its run in flight at once, with the money behind it, or the next run. Only a rider with money on the node steers it. Call it only when the user asks.',
      inputSchema: Operations.schema.nodeSteer.shape,
    },
    async (input) => reply(await Operations.nodeSteer(env, input, address)),
  )

  registerTool(
    'swarm_move',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description: 'Move your own uncommitted money in a tree swarm from one node (or "" for your free money) to another node or back to "" (signed in). Money committed to a run in flight stays with it until the run settles. Call it only when the user asks.',
      inputSchema: Operations.schema.nodeMove.shape,
    },
    async (input) => reply(await Operations.nodeMove(env, input, address)),
  )

  registerTool(
    'swarm_edit',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false },
      description: "Change a swarm's title, nickname or picture (an emoji on a color, or null for its pattern), signed in as one of its admins or the operator; any of them in one call, all or none applied. Call it only when the user asks.",
      inputSchema: { ...Operations.edits.shape, confirm: confirming },
    },
    async (input) => {
      const refused = input.nickname === undefined ? undefined : confirmed(input.confirm, `rename ${input.swarm} to ${input.nickname ?? 'none'}`)
      return refused ?? reply(await Operations.edit(env, input, address, operated))
    },
  )

  registerTool(
    'swarm_nickname',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false },
      description: "Set a swarm's nickname (signed in as one of its admins or the operator), which makes its page /<nickname>; the old nickname keeps sending visitors to the new page until another swarm takes it, and null drops it. Call it only when the user asks.",
      inputSchema: { ...Operations.schema.nickname.shape, confirm: confirming },
    },
    async (input) => confirmed(input.confirm, `rename ${input.swarm} to ${input.nickname ?? 'none'}`) ?? reply(await Operations.nickname(env, input, address, operated)),
  )

  registerTool(
    'swarm_hand',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description:
        "Issue a hand so the user can lend their own machine to a swarm. Returns a unique hand name, the CLI command to run on that machine (cli: nc hand '<url>' --token <token>; command installs nanocode first) and a nanocode-ts library snippet (library, after npm) that attaches with Hand.connect. Once it runs, the swarm's agent and its subagents can run commands and read and write files there, paid from the swarm's money, and are told it belongs to a contributor and to ask before anything destructive. The token is shown once: anyone holding it can attach a machine under that name. Stopping the command detaches the machine. Needs a signed-in session (Authorization: Bearer with a token from /v1/auth). Call it only when the user asks, and tell them what the swarm's agents will be able to do on it.",
      inputSchema: Operations.schema.hand.shape,
    },
    async (input) => reply(await Operations.hand(env, input, address, operated)),
  )

  registerTool(
    'swarm_hand_remove',
    {
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description:
        "Remove a hand from a swarm (signed in as one of its admins or the operator): revokes its token at the gateway, which cuts off a machine attached with it, and drops it from the swarm's hands and Machines tab. Call it only when the user asks.",
      inputSchema: { ...Operations.schema.unhand.shape, confirm: confirming },
    },
    async (input) => confirmed(input.confirm, `remove hand ${input.hand} from ${input.swarm}`) ?? reply(await Operations.unhand(env, input, address, operated)),
  )

  registerTool(
    'swarm_feedback',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description:
        "Free. Report a bug, ask for a feature or ask a question about Swarms (this site, its API and MCP tools, a swarm's page, its money or its room) to the team that runs it. Call it when the user asks to report something, or when a Swarms tool keeps failing or answers something that cannot be right and you cannot fix it. Say in message what was tried, what was expected and what happened; set swarm when it is about one swarm, and put the calls, ids and exact errors in context. Never include credentials. Returns the issue id and a link where its status and resolution show. A problem with a gateway tool a swarm's agent uses (model calls, machines, kv, git) is the gateway's: its send_feedback tool reaches that team.",
      inputSchema: Feedback.schema.shape,
    },
    async (input) => reply(await Feedback.file(env, input)),
  )

  registerTool(
    'swarm_wait',
    {
      annotations: reading,
      description: `Wait up to timeout seconds (at most ${Operations.maxWait}) for a swarm's agent to post its next update, then return that update and the swarm. It returns at once when an update newer than after was already posted (changed: true, reason updated), or when the agent is not working and the swarm is funding or paused (reason idle); otherwise reason timeout. Call it again to keep waiting; the swarm itself has no time limit.`,
      inputSchema: Operations.schema.wait.shape,
    },
    async (input, extra) => reply(await Operations.wait(read, input, extra.signal)),
  )

  registerTool(
    'swarm_status',
    { annotations: reading, description: "A swarm at a glance, as swarms status prints it: its title, goal, status, money (balance, spent, remaining), whether its agent is working and why it waits, its latest update in full, how many updates it posted and its page.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(brief(await Operations.get(read, input), origin)),
  )

  registerTool(
    'swarm_logs',
    { annotations: reading, description: "A swarm's newest feed entries, as swarms logs prints them: the last limit entries of its transcript (messages, tool calls, commands, machines, money, status and errors), oldest of them first, with next to follow on with swarm_watch or swarm_feed. kind and who filter as in swarm_feed.", inputSchema: { kind: Operations.schema.feed.shape.kind, limit: z.coerce.number().int().min(1).max(200).default(50).describe('How many of the newest entries.'), swarm: Operations.schema.swarm.shape.swarm, who: Operations.schema.feed.shape.who } },
    async (input) => reply(await Operations.feed(read, { ...input, before: Number.MAX_SAFE_INTEGER })),
  )

  registerTool(
    'swarm_watch',
    {
      annotations: reading,
      description: `Watch a swarm until something happens or a deadline passes, as swarms watch does, in one bounded call: it waits up to timeout seconds (at most ${watchMost}) for the agent's next update, returning sooner when the swarm is idle (funding or paused). It answers why it returned (updated, idle or timeout), every feed entry after after (at most 100), next to pass as after to keep watching, and the swarm's status. Call it again with next to keep watching; it never waits past its deadline.`,
      inputSchema: {
        after: z.coerce.number().int().min(0).optional().describe("Return the feed entries after this seq: the previous watch's next. Defaults to the newest entry, so only what happens from now is returned."),
        swarm: Operations.schema.swarm.shape.swarm,
        timeout: z.coerce.number().int().min(0).max(watchMost).default(120).describe(`Seconds to wait at most, up to ${watchMost}.`),
      },
    },
    async (input, extra) => {
      const deadline = Date.now() + input.timeout * 1000
      const start = input.after ?? (await Operations.paged(read, { before: Number.MAX_SAFE_INTEGER, limit: 1, swarm: input.swarm }))
      if (typeof start !== 'number' && !start.ok) return reply(start)
      const after = typeof start === 'number' ? start : start.value.last
      let reason: 'idle' | 'timeout' | 'updated' = 'timeout'
      for (let left = deadline - Date.now(); left > 0 && !extra.signal.aborted; left = deadline - Date.now()) {
        const waited = await Operations.wait(read, { swarm: input.swarm, timeout: Math.min(Operations.maxWait, Math.max(1, Math.floor(left / 1000))) }, extra.signal)
        if (!waited.ok) return reply(waited)
        if (waited.value.reason !== 'timeout') {
          reason = waited.value.reason
          break
        }
      }
      const [page, status] = await Promise.all([Operations.feed(read, { after, limit: 100, swarm: input.swarm }), Operations.get(read, { swarm: input.swarm })])
      if (!page.ok) return reply(page)
      const shown = brief(status, origin)
      return reply(shown, (value) => ({ entries: page.value.entries, next: page.value.next, reason, status: value }))
    },
  )

  registerTool(
    'swarm_hands',
    { annotations: reading, description: "The machines contributors lent a swarm as hands, as swarms hands ls prints them: each hand's name, label, who lent it, whether a machine is attached now, its prices and what it was paid. Issue one with swarm_hand and remove one with swarm_hand_remove.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.hands(read, input)),
  )

  registerTool(
    'swarm_fund',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description: "Put dollars of your backing in a swarm (not yet behind a note) behind one of its branches, the subagents its agent started (swarm_branches lists them), optionally steering the branch with a message, as swarms fund does. It moves money, so it refuses without confirm: it answers the exact phrase, such as fund <swarm>/<branch> $5, to send back once the user agrees. key makes a retry move the money once.",
      inputSchema: { ...Operations.schema.fund.shape, confirm: confirming },
    },
    async (input) => confirmed(input.confirm, `fund ${input.swarm}/${input.branch} ${dollars(input.amount)}`) ?? reply(await Operations.fund(env, input, address)),
  )

  registerTool(
    'swarm_archive',
    {
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false, readOnlyHint: false },
      description: "Archive a swarm (its admins or the operator), as swarms archive does: its running work stops, open branches settle, it takes no rides and its pages stay read-only; money left stays in its gateway credit. It cannot be undone, so it refuses without confirm: it answers the exact phrase, archive <swarm>, to send back once the user agrees.",
      inputSchema: { ...Operations.schema.swarm.shape, confirm: confirming },
    },
    async (input) => confirmed(input.confirm, `archive ${input.swarm}`) ?? reply(await Operations.archive(env, input, address, operated)),
  )

  registerTool(
    'swarm_byok',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description: "Your own AI, as swarms byok does: status lists your API keys (by hint) and Claude plan; set adds an Anthropic or OpenAI API key (checked with the provider, kept encrypted by the gateway, never shown again); remove drops one; use runs a swarm's agent on your own AI from now on, and stop hands it back to the swarm's money. Never echo the key back.",
      inputSchema: {
        action: z.enum(['status', 'set', 'remove', 'use', 'stop']).describe('What to do.'),
        key: Operations.schema.ownKey.shape.key.optional().describe('set: the API key.'),
        provider: Operations.schema.ownKey.shape.provider.optional().describe('set and remove: anthropic or openai.'),
        swarm: Operations.schema.swarm.shape.swarm.optional().describe('use and stop: the swarm.'),
      },
    },
    async (input) => {
      if (input.action === 'set') return reply(await Operations.ownKey(env, { key: input.key, provider: input.provider }, address))
      if (input.action === 'remove') return reply(await Operations.ownDrop(env, { provider: input.provider }, address))
      if (input.action === 'use' || input.action === 'stop') return reply(await Operations.hostAi(env, { on: input.action === 'use', swarm: input.swarm }, address))
      return reply(await Operations.ownAi(env, address))
    },
  )

  const listed = async () => {
    const found = await Operations.list(read, {})
    return found.ok ? found.value.swarms : []
  }

  const contents = (uri: URL, result: Problem.Result<unknown>) => {
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
    return { contents: [{ mimeType: 'application/json', text: JSON.stringify(result.value, null, 2), uri: uri.href }] }
  }

  const named = (variables: Record<string, string | string[]>) => {
    const value = variables['swarm']
    return decodeURIComponent(Array.isArray(value) ? (value[0] ?? '') : (value ?? ''))
  }

  server.registerResource(
    'swarm-status',
    new ResourceTemplate('swarm://{swarm}/status', { list: async () => ({ resources: (await listed()).map((swarm) => ({ description: swarm.goal.slice(0, 200), mimeType: 'application/json', name: `${swarm.title} status`, uri: `swarm://${swarm.id}/status` })) }) }),
    { description: "A swarm's status as swarm_status answers it: status, money, whether its agent is working, its latest update and its page.", mimeType: 'application/json', title: 'Swarm status' },
    async (uri, variables) => contents(uri, brief(await Operations.get(read, { swarm: named(variables) }), origin)),
  )

  server.registerResource(
    'swarm-tree',
    new ResourceTemplate('swarm://{swarm}/tree', { list: async () => ({ resources: (await listed()).filter((swarm) => swarm.form === 'tree').map((swarm) => ({ description: swarm.goal.slice(0, 200), mimeType: 'application/json', name: `${swarm.title} tree`, uri: `swarm://${swarm.id}/tree` })) }) }),
    { description: "A tree swarm's tree as swarm_tree answers it: the headline and its nodes three levels down, each with its status, money and checked proof.", mimeType: 'application/json', title: 'Swarm tree' },
    async (uri, variables) => contents(uri, await Operations.tree(read, { swarm: named(variables) })),
  )

  return server
}
