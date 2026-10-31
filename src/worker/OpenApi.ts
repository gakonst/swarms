import { z } from 'zod'
import * as Memo from '../shared/Memo.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Store from './Store.ts'

type Json = Record<string, unknown>

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

const string = { type: 'string' }

const integer = { type: 'integer' }

const time = { description: 'Unix time in ms.', type: 'integer' }

const mach = { description: 'An amount with 6 decimals, such as "0.250000", in MACH or the pledge\'s token.', type: 'string' }

const nullable = (schema: Json) => ({ anyOf: [schema, { type: 'null' }] })

function object(properties: Record<string, unknown>, description?: string): Json {
  return {
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
    type: 'object',
  }
}

function input(schema: z.ZodType): Json {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Json
  return Object.fromEntries(Object.entries(json).filter((entry) => entry[0] !== '$schema'))
}

function ok(schema: Json, description: string, status = '200') {
  return { [status]: { content: { 'application/json': { schema } }, description } }
}

function failures(...statuses: Problem.Status[]) {
  return Object.fromEntries(statuses.map((status) => [String(status), { $ref: '#/components/responses/Problem' }]))
}

function parameter(name: string, where: 'path' | 'query', schema: Json, description: string) {
  return { description, in: where, name, required: where === 'path', schema }
}

const swarm = parameter('id', 'path', string, 'The swarm id, as in /s/<id>.')

const pledge = parameter('pledge', 'path', string, 'The pledge id from the pledge request.')

const budget = parameter('budget', 'path', string, 'The budget id from the budget request.')

const usd = { description: 'A USD stablecoin amount with 6 decimals, such as "0.250000".', type: 'string' }

const token = { enum: ['ousd', 'pathusd', 'usdce'], type: 'string' }

const currency = { enum: ['mach', 'ousd', 'pathusd', 'usdce'], type: 'string' }

const address = { pattern: '^0x[0-9a-fA-F]{40}$', type: 'string' }

const authorizeAccessKey = { description: "Pass to Tempo Wallet's wallet_connect as capabilities.authorizeAccessKey." }

const schemas = {
  Answer: object(
    {
      at: time,
      done: { description: 'The lead reports the goal met.', type: 'boolean' },
      next: nullable({ description: 'What the lead plans for the next round.', type: 'string' }),
      round: integer,
      text: { description: 'The report, markdown, without its STATUS line.', type: 'string' },
    },
    "The report of the swarm's newest completed round.",
  ),
  Answered: object({
    answer: nullable(ref('Answer')),
    running: nullable(ref('Running')),
    status: ref('Status'),
    swarm: string,
    title: string,
  }),
  Brief: object({
    endedAt: nullable(time),
    excerpt: nullable({ description: 'The start of the report as plain text.', type: 'string' }),
    n: integer,
    spent: mach,
    startedAt: time,
    status: { enum: ['running', 'completed', 'failed', 'cancelled'], type: 'string' },
  }),
  Budget: object(
    {
      amount: usd,
      at: time,
      contributor: nullable(address),
      detail: nullable(string),
      expiresAt: time,
      id: string,
      left: nullable({ ...usd, description: 'What the budget can still give this period.' }),
      nextAt: nullable({ ...time, description: 'When the swarm may pull next.' }),
      note: nullable(string),
      period: { description: 'Seconds per period; 86400 is a day.', type: 'integer' },
      pulled: usd,
      status: { enum: ['active', 'waiting', 'revoked', 'expired', 'ended'], type: 'string' },
      token,
    },
    "A daily budget: the swarm pulls up to amount each period from the contributor's wallet into its own.",
  ),
  Budgeted: object({ budget: ref('Budget'), swarm: ref('Summary') }),
  BudgetRequested: object({ authorizeAccessKey, budget: string }),
  Config: object({
    budget: object({ days: integer, max: usd, min: usd, period: integer }),
    chainId: integer,
    explorer: string,
    gateway: string,
    mach: string,
    minPledge: mach,
    perWorker: mach,
    reserve: mach,
    rpc: string,
    tokens: { items: object({ address, id: currency, pool: { description: 'Whether the swarm can pool it: transfers and budgets take pool tokens, pledges take all.', type: 'boolean' }, symbol: string }), type: 'array' },
  }),
  Contributed: object({ contribution: ref('Contribution'), swarm: ref('Summary') }),
  Contribution: object(
    {
      amount: usd,
      at: time,
      budget: nullable({ description: 'The budget a pull came from.', type: 'string' }),
      contributor: address,
      hash: { description: 'The transaction.', type: 'string' },
      kind: { enum: ['transfer', 'pull'], type: 'string' },
      note: nullable(string),
      token,
    },
    "Money in the swarm's wallet: a one-off transfer, or a pull from a daily budget.",
  ),
  Device: object(
    {
      expiresAt: time,
      interval: { description: 'Seconds between polls.', type: 'integer' },
      userCode: { description: 'The code Tempo Wallet shows; the user checks it matches.', type: 'string' },
      verificationUri: string,
      verificationUriFull: { description: 'The link to open, with the code in it.', type: 'string' },
    },
    'A Tempo Wallet approval on any device.',
  ),
  Entry: object({
    at: time,
    detail: nullable(string),
    kind: { enum: [...Operations.kinds], type: 'string' },
    round: integer,
    seq: integer,
    text: string,
  }),
  Found: object({
    hits: { items: ref('Hit'), type: 'array' },
    terms: { description: 'The words searched for.', items: string, type: 'array' },
  }),
  Hand: object({ connected: { type: 'boolean' }, name: string }),
  Researcher: object({
    id: string,
    parent: nullable(string),
    round: integer,
    name: string,
    task: string,
    state: { enum: ['pending', 'running', 'completed', 'failed', 'interrupted', 'closing', 'closed'], type: 'string' },
    action: nullable(string),
    output: nullable(string),
    updatedAt: time,
    events: integer,
    toolsCompleted: integer,
    lastSequence: integer,
  }, 'Observed subagent progress, preserved from the runtime event stream.'),
  Issued: object(
    {
      cli: { description: "Run on the machine to lend it: nc hand '<url>' --token <token>.", type: 'string' },
      command: { description: 'The same, after installing nanocode.', type: 'string' },
      label: string,
      library: { description: 'A Node module that attaches the hand with nanocode-ts Hand.connect.', type: 'string' },
      name: { description: 'The hand name, unique in the swarm.', type: 'string' },
      npm: { description: 'Installs nanocode-ts for the library form.', type: 'string' },
      swarm: string,
      tab: nullable({ description: 'nanocode.xyz/hand with the URL and token, to attach a browser tab.', type: 'string' }),
      token: { description: 'The hand token. Anyone holding it can attach a machine under this name.', type: 'string' },
      url: { description: 'The hand socket.', type: 'string' },
    },
    "A hand for a contributor's machine.",
  ),
  Lent: object({
    at: time,
    connected: { type: 'boolean' },
    label: string,
    name: string,
  }),
  Hit: object({
    at: nullable(time),
    entry: nullable(object({ kind: { enum: [...Operations.kinds], type: 'string' }, seq: integer })),
    kind: { enum: [...Operations.sources], type: 'string' },
    round: nullable(integer),
    snippet: { description: 'Matching text with the matches marked «like this».', type: 'string' },
    swarm: object({ id: string, status: ref('Status'), title: string }),
  }),
  Note: object({
    backers: integer,
    id: string,
    note: string,
    share: { description: 'Share of everything pledged, 0 to 1.', type: 'number' },
    steered: { description: 'The note reached the swarm.', type: 'boolean' },
    weight: mach,
  }),
  Overview: {
    allOf: [
      ref('Summary'),
      object({
        budgets: { items: ref('Budget'), type: 'array' },
        contributions: { items: ref('Contribution'), type: 'array' },
        hands: { items: ref('Hand'), type: 'array' },
        history: { items: ref('Brief'), type: 'array' },
        notes: { items: ref('Note'), type: 'array' },
        pledges: { items: ref('Pledge'), type: 'array' },
        running: nullable(ref('Running')),
        researchers: { items: ref('Researcher'), type: 'array' },
      }),
    ],
  },
  Page: object({
    entries: { items: ref('Entry'), type: 'array' },
    next: { description: 'Pass as after for the next page.', type: 'integer' },
  }),
  Pending: object({
    amount: mach,
    device: nullable(ref('Device')),
    note: nullable(string),
    pledge: string,
    status: { const: 'pending', type: 'string' },
  }),
  Pledge: object({
    amount: mach,
    at: time,
    contributor: string,
    id: string,
    note: nullable(string),
    spent: mach,
    status: { enum: ['active', 'spent', 'ended'], type: 'string' },
    token: currency,
  }),
  Pledged: object({
    pledge: ref('Pledge'),
    status: { enum: ['active', 'spent', 'ended'], type: 'string' },
    swarm: ref('Summary'),
  }),
  Problem: object({
    code: { enum: Object.keys(Problem.codes), type: 'string' },
    detail: string,
    status: integer,
  }),
  Requested: {
    properties: {
      authorizeAccessKey,
      device: ref('Device'),
      pledge: string,
    },
    required: ['authorizeAccessKey', 'pledge'],
    type: 'object',
  },
  Round: object({
    endedAt: nullable(time),
    message: nullable({ description: 'The full report, markdown.', type: 'string' }),
    n: integer,
    spent: mach,
    startedAt: time,
    status: { enum: ['running', 'completed', 'failed', 'cancelled'], type: 'string' },
  }),
  Running: object({ n: integer, startedAt: time }),
  Status: { enum: [...Operations.statuses], type: 'string' },
  Summary: object({
    answer: nullable(ref('Answer')),
    contributors: integer,
    createdAt: time,
    daily: { ...usd, description: 'What active daily budgets give a day.' },
    goal: string,
    id: string,
    machines: integer,
    parallel: { description: 'Agents a round may run at once, the lead included.', type: 'integer' },
    pool: { ...usd, description: "What the swarm's wallet holds to spend." },
    raised: { ...mach, description: 'Everything pledged, sent and pulled, stablecoins at par.' },
    remaining: mach,
    rounds: integer,
    spent: mach,
    status: ref('Status'),
    title: string,
    updatedAt: time,
    wallet: nullable({ ...address, description: "The swarm's own wallet, which takes transfers and budget pulls." }),
    workers: { description: 'Explorers at work in the running round.', type: 'integer' },
  }),
  Waited: object({
    changed: { type: 'boolean' },
    reason: { enum: ['ended', 'idle', 'timeout'], type: 'string' },
    round: nullable(ref('Round')),
    running: nullable(ref('Running')),
    swarm: ref('Summary'),
    waited: { description: 'Milliseconds waited.', type: 'integer' },
  }),
}

export function document(origin: string) {
  return {
    components: {
      responses: {
        Problem: {
          content: { 'application/problem+json': { schema: ref('Problem') } },
          description: Object.entries(Problem.codes)
            .map((entry) => `${entry[0]}: ${entry[1]}`)
            .join(' '),
        },
      },
      schemas,
    },
    info: {
      description: `Swarms are crowdfunded, long-running AI agents on the Tempo gateway, funded by pledges in MACH or a stablecoin, one-off stablecoin transfers to the swarm's wallet and daily budgets, and steered by notes weighted by the money behind them. Reading needs no account. A pledge is a spending key the contributor approves in Tempo Wallet, at least ${Memo.decimal(Store.minPledge)} MACH; a daily budget is a key the swarm pulls with, approved the same way. Errors are problem JSON with a stable code. The same operations are MCP tools at ${origin}/mcp.`,
      title: 'Swarms',
      version: '1',
    },
    openapi: '3.1.0',
    paths: {
      '/v1/config': { get: { operationId: 'config', responses: ok(ref('Config'), 'Chain, token and pledge sizes.'), summary: 'Configuration' } },
      '/v1/search': {
        get: {
          description:
            "Full-text search over every swarm's title and goal, its round reports and its notes, best first. Hits match any of the words. With swarm set, also searches that swarm's feed.",
          operationId: 'search',
          parameters: [
            parameter('q', 'query', string, 'Keywords.'),
            parameter('swarm', 'query', string, 'Only this swarm, including its feed.'),
            parameter('kind', 'query', { enum: [...Operations.sources], type: 'string' }, 'Only hits of this kind.'),
            parameter('limit', 'query', { default: 10, maximum: 50, minimum: 1, type: 'integer' }, 'Indexed hits, and as many feed hits.'),
          ],
          responses: { ...ok(ref('Found'), 'Hits.'), ...failures(400, 404) },
          summary: 'Search',
        },
      },
      '/v1/swarms': {
        get: {
          description: 'Funded swarms, most recently active first, at most 100.',
          operationId: 'listSwarms',
          parameters: [parameter('status', 'query', ref('Status'), 'Only swarms with this status.')],
          responses: { ...ok(object({ swarms: { items: ref('Summary'), type: 'array' } }), 'Swarms.'), ...failures(400) },
          summary: 'List swarms',
        },
        post: {
          description: 'A new swarm waits in funding until its first pledge.',
          operationId: 'createSwarm',
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.create) } }, required: true },
          responses: { ...ok(ref('Summary'), 'The swarm.', '201'), ...failures(400, 502) },
          summary: 'Create a swarm',
        },
      },
      '/v1/swarms/{id}': {
        get: {
          operationId: 'getSwarm',
          parameters: [swarm],
          responses: { ...ok(ref('Overview'), 'The swarm with its notes, pledges, machines and rounds.'), ...failures(404) },
          summary: 'Get a swarm',
        },
      },
      '/v1/swarms/{id}/answer': {
        get: {
          operationId: 'getAnswer',
          parameters: [swarm],
          responses: { ...ok(ref('Answered'), 'The latest answer and the running round.'), ...failures(404) },
          summary: 'Latest answer',
        },
      },
      '/v1/swarms/{id}/feed': {
        get: {
          description: 'The activity log, oldest first, 200 entries a page at most.',
          operationId: 'getFeed',
          parameters: [
            swarm,
            parameter('after', 'query', { default: 0, minimum: 0, type: 'integer' }, 'Entries after this seq.'),
            parameter('kind', 'query', { enum: [...Operations.kinds], type: 'string' }, 'Only entries of this kind.'),
            parameter('limit', 'query', { default: 200, maximum: 200, minimum: 1, type: 'integer' }, 'Entries at most.'),
          ],
          responses: { ...ok(ref('Page'), 'A page of entries.'), ...failures(400, 404) },
          summary: 'Feed',
        },
      },
      '/v1/swarms/{id}/live': {
        get: {
          description:
            "Server-sent events of the running round as the lead writes: {type: round}, then text and thinking deltas ({type, item, delta, offset}) and whole messages ({type: message, item, text}), and {type: end} when the round ends. {type: idle} when nothing runs.",
          operationId: 'live',
          parameters: [swarm],
          responses: {
            '200': { content: { 'text/event-stream': { schema: string } }, description: 'An event stream.' },
            ...failures(404),
          },
          summary: 'Live stream',
        },
      },
      '/v1/swarms/{id}/budgets': {
        post: {
          description:
            "Starts a daily budget: pass authorizeAccessKey to Tempo Wallet's wallet_connect and post its keyAuthorization to the budget. The key may only send the token to the swarm's wallet, up to amount a day, for 30 days.",
          operationId: 'requestBudget',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.budget.omit({ swarm: true })) } },
            required: true,
          },
          responses: { ...ok(ref('BudgetRequested'), 'The budget to approve.', '201'), ...failures(400, 404, 409) },
          summary: 'Request a daily budget',
        },
      },
      '/v1/swarms/{id}/budgets/{budget}': {
        post: {
          description: 'Approves the budget with the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it.',
          operationId: 'approveBudget',
          parameters: [swarm, budget],
          requestBody: {
            content: {
              'application/json': { schema: input(Operations.schema.allowance.omit({ budget: true, swarm: true })) },
            },
            required: true,
          },
          responses: { ...ok(ref('Budgeted'), 'The active budget and its swarm.', '201'), ...failures(400, 404, 409) },
          summary: 'Approve a daily budget',
        },
      },
      '/v1/swarms/{id}/contributions': {
        post: {
          description:
            'Counts a transferWithMemo of USDC.e, pathUSD or OUSD from its sender to the swarm\'s wallet. A note counts only when the memo is keccak256("note:<swarm>:<note>"); a counted hash without a note can get one later. 201 when counted, 200 when a note was added.',
          operationId: 'contribute',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.contribution.omit({ swarm: true })) } },
            required: true,
          },
          responses: {
            ...ok(ref('Contributed'), 'The note was added to a counted transfer.'),
            ...ok(ref('Contributed'), 'The transfer was counted.', '201'),
            ...failures(400, 404, 409, 502),
          },
          summary: 'Count a transfer',
        },
      },
      '/v1/swarms/{id}/hands': {
        get: {
          operationId: 'listHands',
          parameters: [swarm],
          responses: { ...ok(object({ hands: { items: ref('Lent'), type: 'array' } }), 'Hands issued for contributor machines, newest first.'), ...failures(404) },
          summary: 'List contributor hands',
        },
        post: {
          description:
            "Issues a hand for a contributor's own machine: a unique name under the swarm's own gateway key, with the nanocode CLI command and a nanocode-ts snippet that attach it. The swarm's lead agent and explorers use connected hands in rounds paid from the swarm's wallet, and are told they belong to contributors.",
          operationId: 'issueHand',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.hand.omit({ swarm: true })) } } },
          responses: { ...ok(ref('Issued'), 'The hand.', '201'), ...failures(400, 404, 409, 502) },
          summary: 'Issue a hand',
        },
      },
      '/v1/swarms/{id}/pledges': {
        get: {
          operationId: 'listPledges',
          parameters: [swarm],
          responses: { ...ok(object({ pledges: { items: ref('Pledge'), type: 'array' } }), 'Approved pledges, newest first.'), ...failures(404) },
          summary: 'List pledges',
        },
        post: {
          description:
            'Starts a pledge. In a browser, pass authorizeAccessKey to Tempo Wallet and post its keyAuthorization to the pledge. Without one, send device: true and show device.verificationUriFull and device.userCode to the user, who approves on any device, then poll the pledge.',
          operationId: 'requestPledge',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.pledge.omit({ swarm: true })) } },
            required: true,
          },
          responses: { ...ok(ref('Requested'), 'The pledge to approve.', '201'), ...failures(400, 404, 409, 502) },
          summary: 'Request a pledge',
        },
      },
      '/v1/swarms/{id}/pledges/{pledge}': {
        get: {
          description:
            'The pledge. While a device pledge is pending this polls Tempo Wallet, for up to wait seconds; once approved it checks the wallet balance, activates the pledge and starts or steers the swarm.',
          operationId: 'getPledge',
          parameters: [
            swarm,
            pledge,
            parameter('wait', 'query', { default: 0, maximum: Operations.maxWait, minimum: 0, type: 'integer' }, 'Seconds to keep polling.'),
          ],
          responses: {
            '200': {
              content: { 'application/json': { schema: { oneOf: [ref('Pending'), ref('Pledged')] } } },
              description: 'Pending, or the approved pledge and its swarm.',
            },
            ...failures(400, 403, 404, 409, 410, 502),
          },
          summary: 'Pledge status',
        },
        post: {
          description:
            'Approves the pledge with the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it. An empty body polls a device pledge (202 while pending).',
          operationId: 'approvePledge',
          parameters: [swarm, pledge],
          requestBody: {
            content: {
              'application/json': { schema: input(Operations.schema.approval.omit({ pledge: true, swarm: true })) },
            },
          },
          responses: {
            ...ok(ref('Pledged'), 'The active pledge and its swarm.', '201'),
            ...ok(ref('Pending'), 'Still pending in Tempo Wallet.', '202'),
            ...failures(400, 403, 404, 409, 410, 502),
          },
          summary: 'Approve a pledge',
        },
      },
      '/v1/swarms/{id}/rounds': {
        get: {
          operationId: 'listRounds',
          parameters: [swarm],
          responses: { ...ok(object({ rounds: { items: ref('Round'), type: 'array' } }), 'Every round with its full report.'), ...failures(404) },
          summary: 'Rounds',
        },
      },
      '/v1/swarms/{id}/rounds/{round}': {
        get: {
          operationId: 'getRound',
          parameters: [swarm, parameter('round', 'path', { minimum: 1, type: 'integer' }, 'The round number.')],
          responses: { ...ok(ref('Round'), 'The round with its full report.'), ...failures(400, 404) },
          summary: 'One round',
        },
      },
      '/v1/swarms/{id}/search': {
        get: {
          operationId: 'searchSwarm',
          parameters: [
            swarm,
            parameter('q', 'query', string, 'Keywords.'),
            parameter('kind', 'query', { enum: [...Operations.sources], type: 'string' }, 'Only hits of this kind.'),
            parameter('limit', 'query', { default: 10, maximum: 50, minimum: 1, type: 'integer' }, 'Indexed hits, and as many feed hits.'),
          ],
          responses: { ...ok(ref('Found'), 'Hits in this swarm, its feed included.'), ...failures(400, 404) },
          summary: 'Search a swarm',
        },
      },
      '/v1/swarms/{id}/wait': {
        get: {
          description: `Long poll: answers once a round newer than after ended, at once when nothing runs, or after timeout seconds (at most ${Operations.maxWait}).`,
          operationId: 'wait',
          parameters: [
            swarm,
            parameter('after', 'query', { minimum: 0, type: 'integer' }, 'A round number; defaults to the newest ended round.'),
            parameter('timeout', 'query', { default: 45, maximum: Operations.maxWait, minimum: 0, type: 'integer' }, 'Seconds.'),
          ],
          responses: { ...ok(ref('Waited'), 'The round that ended, or why none did.'), ...failures(400, 404) },
          summary: 'Wait for the next round',
        },
      },
    },
    servers: [{ url: origin }],
  }
}

