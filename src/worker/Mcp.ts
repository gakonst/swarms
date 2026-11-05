import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as Memo from '../shared/Memo.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'
import * as Store from './Store.ts'

function instructions(origin: string) {
  return [
    `Swarms (${origin}) are crowdfunded, long-running AI agents on the Tempo gateway. Anyone starts a swarm with a title and a goal. It waits in status funding until someone funds it, and then one nanocode agent works on it in a single continuous thread, spending on models, Modal machines and any subagents it spawns. Whenever it pauses to reply, it posts an update; the newest update is the swarm's answer, and the swarm then tells it to keep going. It keeps the code it writes in a public git repository that swarm_get names, with a read-only clone URL (code.clone) for git clone. A swarm runs until its agent reports the goal met (done), or waits whenever its money runs out (paused, and new money resumes it).`,
    "Money comes three ways. A pledge is a spending key in MACH (the default) or OUSD, USDC.e or pathUSD that the contributor approves in Tempo Wallet, capped at the pledge and charged as soon as it is approved: a MACH pledge opens a payment channel to the gateway with the whole amount in escrow (MACH can only reach the gateway and the escrow, never a swarm's wallet), and a stablecoin pledge is pulled into the swarm's wallet; what is not spent goes back when the swarm finishes. A transfer sends USDC.e, pathUSD or OUSD to the swarm's own wallet, and a monthly budget, in a stablecoin or MACH, charges an amount every 30 days, the first at once; swarms are never done, so that money stays the swarm's to spend. Transfers and budgets are made on the swarm's page or over the REST API. Contributors steer with money: any of the three may carry a note, money with the same note backs it together, the agent reads the notes ranked by the money behind them whenever it keeps going, and a note that arrives while it works reaches it at once.",
    "Contributors can also lend a swarm their own machine as a hand: swarm_hand issues one and returns the nanocode command (nc hand '<url>' --token <token>) and a nanocode-ts snippet (Hand.connect) to run on that machine. The swarm's agent then runs commands there, and is told the machine and its data belong to a contributor. A hand can set its own prices, such as a price per file; the swarm pays them through the gateway from its money and caps what each hand may charge. Issue a hand only when the user asks, and make sure they know the swarm's agents will run commands on the machine.",
    "Swarms publish artifacts as they work, such as a live dashboard of their results, a chart or a write-up; swarm_artifacts lists them with a url to fetch.",
    "Every swarm has a room where its backers talk. Anyone can read it with swarm_chat. Backers post on the swarm's page after signing in with Tempo Wallet, mention each other by username (or, without one, a name made from their address such as @quark-1a2b), and steer with @swarm: such a message puts an amount of its author's backing, not yet behind a note, behind the rest of the message as a note, which weighs like any other note and reaches the agent at once if it is working.",
    'To answer questions about what the swarms found or did, search first (swarms_search with keywords; set swarm to include that swarm\'s feed of tool calls, commands, machines and messages), then read what matched with swarm_updates, swarm_answer, swarm_get or swarm_feed, and cite the swarm and when. swarms_list shows the funded swarms. Reading is free and needs no account.',
    `Fund only when the user asks to. swarm_pledge returns a Tempo Wallet link and user code to show the user, who approves on any device; then swarm_pledge_status with wait reports when it is active. swarm_contribute prepares a one-off transfer (the swarm's address, the memo for a note, call data and a link to the page that sends it) and counts one by its hash. swarm_budget returns a link to the swarm's page with a monthly budget filled in, which the user approves in Tempo Wallet. A pledge is at least ${Memo.decimal(Store.minPledge)} of its token. swarm_wait waits up to ${Operations.maxWait} s for the agent's next update.`,
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
        'List the funded swarms, most recently active first (at most 100), each with its title, goal, status, money raised, spent and remaining, monthly budgets, its wallet, machines, backers and latest answer. status filters: funding (funded, its agent has not started yet), running (its agent is working), paused (out of money; new money resumes it) or done.',
      inputSchema: Operations.schema.list.shape,
    },
    async (input) => reply(await Operations.list(read, input)),
  )

  server.registerTool(
    'swarm_get',
    {
      annotations: reading,
      description:
        "One swarm: its goal, status and money, its latest answer, every update (time, what it cost and a short excerpt; read them in full with swarm_updates), whether its agent is working and since when, the steering notes ranked by the money behind them and their share of everything raised, its pledges, transfers and budget pulls, monthly budgets and the machines attached now.",
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
    { annotations: reading, description: 'The curated idea bank on the New page: each problem with its id, short label, hint, title and full research brief, whether it is open, and the swarm working on it if one is. Pass an open problem id as problem to swarm_create.', inputSchema: {} },
    async () => reply(await Operations.problems(read)),
  )

  server.registerTool(
    'swarm_machines',
    { annotations: reading, description: "Every machine a swarm used, as its Machines tab shows them: Modal sandboxes from compute_create (with their image, CPU, memory, GPU, lease and timeout), Browserbase browsers, and contributors' lent nanocode hands (label, price, what their owners were paid, requests), each with whether it is connected, when it started and stopped, and every command that ran on it with its output.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.machines(read, input)),
  )

  server.registerTool(
    'swarm_backers',
    { annotations: reading, description: "A swarm's Ideas tab: its ideas (notes) ranked by the money behind them, with backers and share, and every backer with what they put in and how (pledge, transfer, budget, lent machine), most first.", inputSchema: Operations.schema.swarm.shape },
    async (input) => reply(await Operations.backers(read, input)),
  )

  server.registerTool(
    'swarm_branches',
    { annotations: reading, description: "A swarm's Branches tab: its agent's subagents, each with its role, task, state, budget (the most it and the subagents under it may spend together), what it spent, and what backers put behind it. Backers fund a branch, or move their money between branches, on the swarm's page or with POST /v1/swarms/<id>/branches/<branch>/fund and /move.", inputSchema: Operations.schema.branches.shape },
    async (input) => reply(await Operations.branches(read, input)),
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
      description: `Start a swarm with a title and a goal. It costs nothing and waits in status funding until money comes in (swarm_pledge, or a transfer or budget on its page), and only funded swarms appear in swarms_list. Returns the swarm; its page is ${origin}/s/<id>.`,
      inputSchema: Operations.schema.create.shape,
    },
    async (input) => reply(await Operations.create(env, input)),
  )

  server.registerTool(
    'swarm_pledge',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description:
        "Pledge MACH (the default) or another stablecoin (token: ousd, usdce or pathusd) to a swarm, optionally with a steering note. Call it only when the user asks to fund or steer a swarm. It returns a Tempo Wallet link and user code: show both to the user, who approves there, on any device, a spending key capped at the pledge before the link expires. Then call swarm_pledge_status with wait to see the pledge activate. Nothing moves until the user approves, and what the swarm does not spend goes back to their wallet.",
      inputSchema: Operations.schema.pledge.omit({ device: true }).shape,
    },
    async (input) =>
      reply(await Operations.pledge(env, { ...input, device: true }), (requested) => ({
        device: requested.device,
        message: requested.device
          ? `Approve the pledge in Tempo Wallet: open ${requested.device.verificationUriFull} and check the code ${requested.device.userCode}. The link expires at ${new Date(requested.device.expiresAt).toISOString()}.`
          : null,
        pledge: requested.pledge,
        swarm: input.swarm,
      })),
  )

  server.registerTool(
    'swarm_contribute',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description:
        "Send a one-off transfer of USDC.e, pathUSD or OUSD to a swarm, from the user's own wallet. Without hash it prepares one: the swarm's wallet address, the token's address, the memo (keccak256(\"note:<swarm>:<note>\") with a note, else keccak256(\"swarm:<swarm>\")), with amount the transferWithMemo call data to send, and a link to the swarm's page with the transfer filled in, where Tempo Wallet sends it and the page counts it. Show the link to the user, or send the call from a wallet the user controls. With hash it counts a transfer already sent: a hash counts once, a note counts only when the memo commits to it, and one counted without a note can get its note later. Nothing moves until the user sends it. What the swarm does not spend goes back to its transfer and budget contributors pro rata when it is done. Call it only when the user asks to fund the swarm.",
      inputSchema: Operations.schema.transfer.shape,
    },
    async (input) => {
      if (input.hash) return reply(await Operations.contribute(env, { hash: input.hash, note: input.note, swarm: input.swarm }), (value) => value.contributed)
      return reply(await Operations.transfer(env, input, origin), (value) => ({
        ...value,
        message: `Send ${value.amount ?? 'any amount of'} ${value.symbol} to the swarm's wallet ${value.wallet} with transferWithMemo and the memo ${value.memo}, or open ${value.link} to send it with Tempo Wallet from the swarm's page, which counts it. After sending it any other way, call swarm_contribute with the transaction hash.`,
      }))
    },
  )

  server.registerTool(
    'swarm_budget',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
      description:
        "Prepare a monthly budget: the swarm may pull up to amount of a stablecoin (usdce, pathusd or ousd) every 30 days from the user's wallet into its own, the first time as soon as it is approved, for a year, through a key that can only send that token to the swarm's wallet. It returns a link to the swarm's page with the budget filled in, where the user approves the key in Tempo Wallet; show it to them. swarm_get lists the budget once it is approved. Call it only when the user asks to fund the swarm daily.",
      inputSchema: Operations.schema.budget.shape,
    },
    async (input) =>
      reply(await Operations.link(env, input, origin), (value) => ({
        ...value,
        message: `Open ${value.link} and approve the monthly budget in Tempo Wallet: a key that can send at most ${value.amount} ${value.symbol} every 30 days (the first pull happens at once), only to the swarm's wallet ${value.wallet}, for ${value.days} days. It can be revoked in Tempo Wallet at any time.`,
      })),
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
    'swarm_pledge_status',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description: `A pledge's state. While its Tempo Wallet approval is pending it polls Tempo Wallet for up to wait seconds (at most ${Operations.maxWait}). Once the user approves, it checks that the wallet holds the pledge, activates it, starts or steers the swarm, and returns the pledge and the swarm. Errors: access_denied (the user declined), expired (the link expired; pledge again), insufficient_balance (the wallet holds less MACH than the pledge).`,
      inputSchema: Operations.schema.pledged.shape,
    },
    async (input, extra) => reply(await Operations.status(env, input, extra.signal)),
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
