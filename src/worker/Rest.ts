import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Contributed, Pending, Pledged } from '../shared/Api.ts'
import * as Mcp from './Mcp.ts'
import * as OpenApi from './OpenApi.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'
import * as Sessions from './Sessions.ts'

export const app = new Hono<{ Bindings: Cloudflare.Env }>()

export async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => ({}))
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

export function stream(result: Problem.Result<Response>) {
  return result.ok ? new Response(result.value.body, result.value) : Problem.json(result)
}

export function socket(result: Problem.Result<Response>) {
  return result.ok ? result.value : Problem.json(result)
}

export function contributed(result: Problem.Result<{ contributed: Contributed; created: boolean }>) {
  return result.ok ? Response.json(result.value.contributed, { status: result.value.created ? 201 : 200 }) : Problem.json(result)
}

export function settled(result: Problem.Result<Pledged | Pending>) {
  return Problem.respond(result, result.ok && result.value.status === 'pending' ? 202 : 201)
}

app.use('/v1/*', cors({ exposeHeaders: [Replica.header] }))
app.use('/openapi.json', cors())
app.use('/mcp', cors({ exposeHeaders: ['mcp-protocol-version', 'mcp-session-id'] }))

app.get('/openapi.json', (c) => c.json(OpenApi.document(new URL(c.req.url).origin)))

app.all('/mcp', (c) => Mcp.handle(c.req.raw, c.env))

app.get('/v1/config', (c) => c.json(Operations.config(c.env)))

app.get('/v1/me', async (c) => Problem.respond(await Operations.account(c.env, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/me', async (c) => Problem.respond(await Operations.rename(c.env, await body(c.req.raw), await Sessions.who(c.env, c.req.raw))))

app.get('/v1/swarms', async (c) => Problem.respond(await Operations.list(c.env, c.req.query())))

app.post('/v1/swarms', async (c) => Problem.respond(await Operations.create(c.env, await body(c.req.raw), await Sessions.who(c.env, c.req.raw)), 201))

app.get('/v1/search', async (c) =>
  Problem.respond(await Operations.search(c.env, { ...c.req.query(), query: c.req.query('q') ?? c.req.query('query') })),
)

app.get('/v1/swarms/:id', async (c) => Problem.respond(await Operations.get(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/answer', async (c) => Problem.respond(await Operations.answer(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/updates', async (c) => Problem.respond(await Operations.updates(c.env, { ...c.req.query(), swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/feed', async (c) =>
  Problem.respond(await Operations.feed(c.env, { ...c.req.query(), swarm: c.req.param('id') })),
)

app.get('/v1/swarms/:id/search', async (c) =>
  Problem.respond(
    await Operations.search(c.env, {
      ...c.req.query(),
      query: c.req.query('q') ?? c.req.query('query'),
      swarm: c.req.param('id'),
    }),
  ),
)

app.get('/v1/swarms/:id/live', async (c) =>
  stream(await Operations.live(c.env, { swarm: c.req.param('id') }, c.req.raw.signal, c.req.query('after'))),
)

app.get('/v1/swarms/:id/wait', async (c) =>
  Problem.respond(await Operations.wait(c.env, { ...c.req.query(), swarm: c.req.param('id') }, c.req.raw.signal)),
)

app.post('/v1/swarms/:id/contributions', async (c) =>
  contributed(await Operations.contribute(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') })),
)

app.post('/v1/swarms/:id/budgets', async (c) =>
  Problem.respond(await Operations.budget(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }), 201),
)

app.post('/v1/swarms/:id/budgets/:budget', async (c) =>
  Problem.respond(
    await Operations.allow(c.env, { ...(await body(c.req.raw)), budget: c.req.param('budget'), swarm: c.req.param('id') }),
    201,
  ),
)

app.get('/v1/swarms/:id/hands', async (c) => Problem.respond(await Operations.hands(c.env, { swarm: c.req.param('id') })))

app.post('/v1/swarms/:id/hands', async (c) =>
  Problem.respond(
    await Operations.hand(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)),
    201,
  ),
)

app.get('/v1/problems', async (c) => Problem.respond(await Operations.problems(c.env)))

app.get('/v1/swarms/:id/machines', async (c) => Problem.respond(await Operations.machines(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/backers', async (c) => Problem.respond(await Operations.backers(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/artifacts', async (c) =>
  Problem.respond(await Operations.artifacts(c.env, { swarm: c.req.param('id') }, new URL(c.req.url).origin)),
)

app.get('/v1/swarms/:id/chat', async (c) =>
  Problem.respond(await Operations.room(c.env, { ...c.req.query(), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/chat', async (c) =>
  Problem.respond(
    await Operations.say(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)),
    201,
  ),
)

app.get('/v1/swarms/:id/team', async (c) => Problem.respond(await Operations.team(c.env, { swarm: c.req.param('id') })))

app.post('/v1/swarms/:id/team', async (c) =>
  Problem.respond(await Operations.steer(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/team/members', async (c) =>
  Problem.respond(await Operations.seat(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)), 201),
)

app.delete('/v1/swarms/:id/team/members/:member', async (c) =>
  Problem.respond(await Operations.unseat(c.env, { member: c.req.param('member'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/btw', async (c) =>
  Problem.respond(await Operations.btw(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.get('/v1/swarms/:id/branches', async (c) => Problem.respond(await Operations.branches(c.env, { swarm: c.req.param('id') })))

app.post('/v1/swarms/:id/branches/:branch/fund', async (c) =>
  Problem.respond(await Operations.fund(c.env, { ...(await body(c.req.raw)), branch: c.req.param('branch'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/branches/:branch/move', async (c) =>
  Problem.respond(await Operations.move(c.env, { ...(await body(c.req.raw)), branch: c.req.param('branch'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/branches/:branch/stop', async (c) =>
  Problem.respond(await Operations.stop(c.env, { branch: c.req.param('branch'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.get('/v1/swarms/:id/pledges', async (c) => Problem.respond(await Operations.pledges(c.env, { swarm: c.req.param('id') })))

app.post('/v1/swarms/:id/pledges', async (c) =>
  Problem.respond(await Operations.pledge(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }), 201),
)

app.get('/v1/swarms/:id/pledges/:pledge', async (c) =>
  Problem.respond(
    await Operations.status(
      c.env,
      { ...c.req.query(), pledge: c.req.param('pledge'), swarm: c.req.param('id') },
      c.req.raw.signal,
    ),
  ),
)

app.post('/v1/swarms/:id/pledges/:pledge', async (c) =>
  settled(
    await Operations.approve(c.env, { ...(await body(c.req.raw)), pledge: c.req.param('pledge'), swarm: c.req.param('id') }),
  ),
)

app.all('/v1/*', () => Problem.json({ code: 'not_found', detail: 'No such route. See /openapi.json.', status: 404 }))
