import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as Feedback from './Feedback.ts'
import * as Machines from './Machines.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'

function instructions(origin: string) {
  return [
    `Swarms (${origin}) are crowdfunded, long-running AI agents on the Tempo gateway. Anyone starts a swarm with a title and a goal, which can be anything an agent can do with code, machines and the web: research a question, build and ship software, port or audit code, gather data, write. It waits in status funding until someone funds it, and then one nanocode agent works on it in a single continuous thread, spending on models, Modal machines and any subagents it spawns. Whenever it pauses to reply, it posts an update; the newest update is the swarm's answer, and the swarm then tells it to keep going. It keeps the code it writes in a public git repository that swarm_get names, with a read-only clone URL (code.clone) for git clone. A swarm runs until its agent reports the goal met (done), or waits whenever its money runs out (paused, and new money resumes it).`,
    "Money comes one way: anyone sends MACH, OUSD, USDC.e or pathUSD from their own wallet to the Tempo gateway with a memo that names the swarm, and the swarm counts it by its transaction hash. The gateway holds it as the swarm's credit and spends it only on what the swarm's agent does; a swarm holds no wallet, and money sent is not returned. Money may carry a note: money behind the same note backs it together, the agent reads the notes ranked by the money behind them whenever it keeps going, and a note that arrives while it works reaches it at once.",
    "Contributors can also lend a swarm their own machine as a hand: swarm_hand issues one and returns the nanocode command (nc hand '<url>' --token <token>) and a nanocode-ts snippet (Hand.connect) to run on that machine. The swarm's agent then runs commands there, and is told the machine and its data belong to a contributor. A hand can set its own prices, such as a price per file; the swarm pays them through the gateway from its money and caps what each hand may charge. Issue a hand only when the user asks, and make sure they know the swarm's agents will run commands on the machine.",
    "Swarms publish artifacts as they work, such as a live dashboard of their results, a chart or a write-up; swarm_artifacts lists them with a url to fetch.",
    "Every swarm has a room where its backers talk. Anyone can read it with swarm_chat. Backers post on the swarm's page after signing in with Tempo Wallet, mention each other by username (or, without one, a name made from their address such as @quark-1a2b), and steer with @swarm: such a message puts an amount of its author's backing, not yet behind a note, behind the rest of the message as a note, which weighs like any other note and reaches the agent at once if it is working.",
    'To answer questions about what the swarms found or did, search first (swarms_search with keywords; set swarm to include that swarm\'s feed of tool calls, commands, machines and messages), then read what matched with swarm_updates, swarm_answer, swarm_get or swarm_feed, and cite the swarm and when. swarms_list shows the funded swarms. Reading is free and needs no account.',
    "When something in Swarms is broken or confusing, or the user wants to report it, swarm_feedback files it with the team that runs Swarms and answers a link where its status shows.",
    `Fund only when the user asks to. swarm_contribute prepares a transfer (the gateway's address, the memo that names the swarm and its note, call data and a link to the page that sends it) and counts one by its hash. swarm_wait waits up to ${Operations.maxWait} s for the agent's next update.`,
  ].join('\n\n')
}

export async function handle(request: Request, env: Cloudflare.Env) {
  if (request.method !== 'POST')
    return Problem.json({ code: 'invalid_request', detail: 'Use POST for MCP over streamable HTTP.', status: 405 })

  const server = create(env, Replica.read(env, request), new URL(request.url).origin)
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

function create(env: Cloudflare.Env, read: Cloudflare.Env, origin: string) {
  const server = new McpServer({ name: 'swarms', version: '1.0.0' }, { instructions: instructions(origin) })

  server.registerTool(
    'swarms_list',
    {
      annotations: reading,
      description:
        'List the funded swarms, most recently active first (at most 100), each with its title, goal, status, balance (everything its backers put in), spent and remaining (balance less spent), machines, backers and latest answer. status filters: funding (funded, its agent has not started yet), running (its agent is working), paused (out of money; new money resumes it) or done.',
      inputSchema: Operations.schema.list.shape,
    },
    async (input) => reply(await Operations.list(read, input)),
  )

  server.registerTool(
    'swarm_get',
    {
      annotations: reading,
      description:
        "One swarm: its goal, status and money, its latest answer, every update (time, what it cost and a short excerpt; read them in full with swarm_updates), whether its agent is working and since when, the steering notes ranked by the money behind them and their share of the balance, the transfers that funded it and the machines attached now.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.get(read, input)),
  )

  server.registerTool(
    'swarm_answer',
    {
      annotations: reading,
      description:
        "A swarm's latest answer: its agent's newest update in full (markdown), and whether the agent is working now.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.answer(read, input)),
  )

  server.registerTool(
    'swarm_updates',
    {
      annotations: reading,
      description:
        "A swarm's updates, oldest first: each time its agent paused to reply, what it reported (markdown), when (ms), what it spent since the update before and the commits it pushed. limit keeps the newest.",
      inputSchema: Operations.schema.updates.shape,
    },
    async (input) => reply(await Operations.updates(read, input)),
  )

  server.registerTool(
    'swarm_feed',
    {
      annotations: reading,
      description:
        "A swarm's transcript, oldest first: its agent's messages and reasoning summaries (message, thinking), tool calls, scripts, shell commands and subagents (tool), outputs (output), Modal machines (machine), money coming in and going back (funds), steering (steer), the swarm starting, pausing and posting updates (status) and failures (error), each with seq, time, text, an optional detail and who (null for the agent, else the subagent's name). Page forward with after set to the previous page's next, or back with before.",
      inputSchema: Operations.schema.feed.shape,
    },
    async (input) => reply(await Operations.feed(read, input)),
  )

  server.registerTool(
    'problems_list',
    { annotations: reading, description: 'The curated idea bank on the New page: each problem with its id, short label, hint, title and full brief, whether it is open, and the swarm working on it if one is. Pass an open problem id as problem to swarm_create.', inputSchema: {} },
    async () => reply(await Operations.problems(read)),
  )

  server.registerTool(
    'swarm_machines',
    { annotations: reading, description: "Every machine a swarm used over its whole life, as its Machines tab shows them: Modal sandboxes from compute_create (with their image, CPU, memory, GPU, lease and timeout, and their sandbox ids), Browserbase browsers, and contributors' lent nanocode hands (label, price, what their owners were paid, requests), each with whether it is connected, when it started and stopped, and how many commands ran on it (runs.count, runs.failed). List the commands with swarm_machine_commands.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.machines(read, input)),
  )

  server.registerTool(
    'swarm_machine_commands',
    { annotations: reading, description: "Every command that ran on one machine over the swarm's whole life, a page at a time (newest first by default, or oldest first), each with its seq, time (ms), who ran it (null for the swarm's agent, else the subagent's name), the command, its exit code, whether it failed, how long it took (ms, when known) and, for compute_spawn, the job's log path. Outputs are not included: read one with swarm_machine_command. Page on with cursor set to the previous page's next.", inputSchema: Machines.schema.commands.shape },
    async (input) => reply(await Machines.commands(read, input)),
  )

  server.registerTool(
    'swarm_machine_command',
    { annotations: reading, description: "One command of a machine with its whole output: the gateway's copy of the tool result when the agent's session still has it (source gateway), else the swarm's feed copy, which keeps the first 2,000 characters (source feed, truncated true when cut). Also its input as the agent sent it.", inputSchema: Machines.schema.command.shape },
    async (input) => reply(await Machines.command(read, input)),
  )

  server.registerTool(
    'swarm_machine_logs',
    { annotations: reading, description: "A sandbox's own log from the gateway (Modal's system, stdout and stderr lines, such as the image build, an out-of-memory kill or why it ended), kept by Swarms once fetched; the gateway keeps it up to 7 days after the sandbox ended. Lines oldest first, the newest page by default; page back with before set to the previous answer's next. complete says Swarms fetched all of it and will not ask the gateway again.", inputSchema: Machines.schema.logs.shape },
    async (input) => reply(await Machines.logs(read, input)),
  )

  server.registerTool(
    'swarm_machine_job',
    { annotations: reading, description: "The log of a job started with compute_spawn (the command's seq from swarm_machine_commands), read from the sandbox while it runs and kept by Swarms, with its exit code once it finished. After the sandbox ends, the part already fetched stays.", inputSchema: Machines.schema.job.shape },
    async (input) => reply(await Machines.job(read, input)),
  )

  server.registerTool(
    'swarm_machines_export',
    { annotations: reading, description: "Where to download everything about a swarm's machines, or one machine, as one NDJSON file: each machine, every command with its whole output, each sandbox's gateway log and each spawned job's log. Answers the URL and a curl command; the file can be large.", inputSchema: Machines.schema.export.shape },
    async (input) => {
      const parsed = Machines.schema.export.safeParse(input)
      if (!parsed.success) return reply(Problem.invalid(parsed.error))
      const url = `${origin}/v1/swarms/${encodeURIComponent(parsed.data.swarm)}/machines${parsed.data.machine ? `/${encodeURIComponent(parsed.data.machine)}` : ''}/export`
      return text({ curl: `curl -fsSL '${url}' -o swarm-${parsed.data.swarm}-machines.ndjson`, format: 'NDJSON: one JSON object a line, with type export, machine, command, logs, log, job and end', url })
    },
  )

  server.registerTool(
    'swarm_backers',
    { annotations: reading, description: "A swarm's Ideas tab: its ideas (notes) ranked by the money behind them, with backers and share, and every backer with what they sent and whether they lent a machine, most first.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.backers(read, input)),
  )

  server.registerTool(
    'swarm_branches',
    { annotations: reading, description: "A swarm's branches, which its page's transcript filters by: its agent's subagents, each with its role, task, state, budget (the most it and the subagents under it may spend together), what it spent, and what backers put behind it. Backers fund a branch, or move their money between branches, on the swarm's page or with POST /v1/swarms/<id>/branches/<branch>/fund and /move.", inputSchema: Operations.schema.branches.shape },
    async (input) => reply(await Operations.branches(read, input)),
  )

  server.registerTool(
    'swarm_progress',
    { annotations: reading, description: "A swarm's progress for a goal that comes down to one number, from its autoresearch artifact: the metric, its direction and goal, main's history (every change to main, each merge naming the branch it took, with the metric after it), and every branch with what it explored, its state, what it found and whether main merged it. progress is null for a swarm that keeps no such record.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.progress(read, input)),
  )

  server.registerTool(
    'swarm_artifacts',
    {
      annotations: reading,
      description:
        "A swarm's artifacts: the dashboards, charts, tables and write-ups its agents published for contributors to follow along, each with its title, kind, summary, form (page for HTML, image, markdown, table, json or text), version and url. Read a markdown, table, json or text artifact by fetching its url; a page is an HTML dashboard for a browser.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.artifacts(read, input, origin)),
  )

  server.registerTool(
    'swarm_chat',
    {
      annotations: reading,
      description:
        "A swarm's room, oldest first: its backers' messages, each with its author's wallet address (the room shows it as a handle such as @quark-1a2b), the backers it mentions, and steer when it was an @swarm message that put some of its author's backing behind an idea (amount, note, the note's weight and share, and live when it reached the working agent at once). Messages without an author mark money coming in, the agent starting and stopping, and its updates. members lists every backer with what they put in, how much of it is behind notes and how they back the swarm. By default the newest messages; page back with before, or read newer ones with after.",
      inputSchema: Operations.schema.room.shape,
    },
    async (input) => reply(await Operations.room(read, input)),
  )

  server.registerTool(
    'swarms_search',
    {
      annotations: reading,
      description:
        "Full-text search over what the swarms did: every swarm's title and goal, its agent's updates and the steering notes, ranked best first with the matches marked «like this» in a snippet. With swarm set it searches only that swarm and also its feed (tool calls, shell commands, machines, messages and errors). Send keywords rather than a question; hits match any of them. Read an update hit with swarm_updates (by its at), and a feed hit with swarm_feed (after = its entry.seq - 1).",
      inputSchema: Operations.schema.search.shape,
    },
    async (input) => reply(await Operations.search(read, input)),
  )

  server.registerTool(
    'swarm_create',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
      description: `Start a swarm with a title, a goal and a model template (cheap by default, the cheapest models; GET /v1/config lists every model's price). It costs nothing and waits in status funding until someone sends it money (swarm_contribute, or Fund on its page), and only funded swarms appear in swarms_list. Returns the swarm; its page is ${origin}/s/<id>.`,
      inputSchema: Operations.schema.create.shape,
    },
    async (input) => reply(await Operations.create(env, input)),
  )

  server.registerTool(
    'swarm_contribute',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description:
        "Send money to a swarm from the user's own wallet: MACH, OUSD, USDC.e or pathUSD, each counted at $1. Without hash it prepares the transfer: the gateway's address (to), the token's address, the memo that names the swarm and commits to the note, with amount the transferWithMemo call to send, and a link to the swarm's page with it filled in, where Tempo Wallet backs it and the page counts it: MACH of 1 or more is approved there as a spending limit that stays in the wallet until the swarm spends it, and anything else is sent. Show the link to the user, or send the call from a wallet the user controls. With hash it counts a transfer already sent; each transaction counts once. A note counts only when the memo commits to it.",
      inputSchema: Operations.schema.transfer.shape,
    },
    async (input) => {
      if (input.hash) return reply(await Operations.contribute(env, { hash: input.hash, note: input.note, swarm: input.swarm }), (value) => value.contributed)
      return reply(await Operations.transfer(env, input, origin), (value) => ({
        ...value,
        message: `Send ${value.amount ?? 'any amount of'} ${value.symbol} to ${value.to} with transferWithMemo and the memo ${value.memo}, or open ${value.link} to back it with Tempo Wallet from the swarm's page, which counts it. After sending it any other way, call swarm_contribute with the transaction hash.`,
      }))
    },
  )

  server.registerTool(
    'swarm_hand',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description:
        "Issue a hand so the user can lend their own machine to a swarm. Returns a unique hand name, the CLI command to run on that machine (cli: nc hand '<url>' --token <token>; command installs nanocode first) and a nanocode-ts library snippet (library, after npm) that attaches with Hand.connect. Once it runs, the swarm's agent and its subagents can run commands and read and write files there, paid from the swarm's money, and are told it belongs to a contributor and to ask before anything destructive. The token is shown once: anyone holding it can attach a machine under that name. Stopping the command detaches the machine. Call it only when the user asks, and tell them what the swarm's agents will be able to do on it.",
      inputSchema: Operations.schema.hand.shape,
    },
    async (input) => reply(await Operations.hand(env, input)),
  )

  server.registerTool(
    'swarm_feedback',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description:
        "Free. Report a bug, ask for a feature or ask a question about Swarms (this site, its API and MCP tools, a swarm's page, its money or its room) to the team that runs it. Call it when the user asks to report something, or when a Swarms tool keeps failing or answers something that cannot be right and you cannot fix it. Say in message what was tried, what was expected and what happened; set swarm when it is about one swarm, and put the calls, ids and exact errors in context. Never include credentials. Returns the issue id and a link where its status and resolution show. A problem with a gateway tool a swarm's agent uses (model calls, machines, kv, git) is the gateway's: its send_feedback tool reaches that team.",
      inputSchema: Feedback.schema.shape,
    },
    async (input) => reply(await Feedback.file(env, input)),
  )

  server.registerTool(
    'swarm_wait',
    {
      annotations: reading,
      description: `Wait up to timeout seconds (at most ${Operations.maxWait}) for a swarm's agent to post its next update, then return that update and the swarm. It returns at once when an update newer than after was already posted (changed: true, reason updated), or when the agent is not working and the swarm is funding, paused or done (reason idle); otherwise reason timeout. Call it again to keep waiting; the swarm itself has no time limit.`,
      inputSchema: Operations.schema.wait.shape,
    },
    async (input, extra) => reply(await Operations.wait(read, input, extra.signal)),
  )

  return server
}
