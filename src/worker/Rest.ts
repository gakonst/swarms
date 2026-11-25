import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Contributed } from '../shared/Api.ts'
import * as Site from '../shared/Site.ts'
import * as Feedback from './Feedback.ts'
import * as Machines from './Machines.ts'
import * as OAuth from './OAuth.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'
import * as Sessions from './Sessions.ts'
import * as Lobby from './Lobby.ts'
import * as Watch from './Watch.ts'

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

app.use('/v1/*', cors({ exposeHeaders: [Replica.header] }))
app.use('/openapi.json', cors())
app.use('/mcp', cors({ exposeHeaders: ['mcp-protocol-version', 'mcp-session-id', 'www-authenticate'] }))
app.use('/oauth/*', cors())
app.use('/.well-known/*', cors())

function context<T>(c: { executionCtx: T }): T | undefined {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}

export async function listen(env: Cloudflare.Env, scope: Watch.Scope, on: (signal: Watch.Signal) => void) {
  const upgrade = new Request('https://swarms/?listen=1&watch=1', { headers: { upgrade: 'websocket' } })
  if (scope.kind !== 'swarm') return Watch.tap(await (scope.kind === 'lobby' ? env.LOBBY.getByName('lobby') : Lobby.hall(env)).fetch(upgrade), on)
  const opened = await Operations.chatter(env, { swarm: scope.swarm }, upgrade)
  return opened.ok ? Watch.tap(opened.value, on) : Problem.json(opened)
}

app.use('/v1/*', async (c, next) => {
  if (c.req.method !== 'GET' || !Watch.wanted(c.req.header('accept'))) return next()
  const url = new URL(c.req.url)
  const since = url.searchParams.get('since')
  url.searchParams.delete('since')
  const topic = Watch.topic(url.pathname, url.searchParams)
  if (!topic) return next()
  const headers = new Headers(c.req.raw.headers)
  headers.set('accept', 'application/json')
  headers.delete('last-event-id')
  headers.delete('if-none-match')
  const read = async (query: Watch.Query, path?: string): Promise<Watch.Read> => {
    const target = new URL(path ?? url.pathname, url)
    if (!path) target.search = url.search
    for (const [key, value] of Object.entries(query)) {
      if (value === null) target.searchParams.delete(key)
      else target.searchParams.set(key, value)
    }
    const response = await app.fetch(new Request(target, { headers }), c.env, context(c))
    const text = await response.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {}
    return { body, status: response.status, text }
  }
  return Watch.open({ last: c.req.header('last-event-id') ?? since, listen: (on) => listen(c.env, topic.scope, on), read, signal: c.req.raw.signal, topic })
})

app.get('/openapi.json', async (c) => c.json((await import('./OpenApi.ts')).document(Site.url(c.env, c.req.url))))

app.all('/mcp', async (c) => (await import('./Mcp.ts')).handle(c.req.raw, c.env))

for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*']) app.get(path, (c) => c.json(OAuth.protectedResource(Site.url(c.env, c.req.url))))

for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/*', '/.well-known/openid-configuration', '/.well-known/openid-configuration/*']) app.get(path, (c) => c.json(OAuth.server(Site.url(c.env, c.req.url))))

app.post('/oauth/register', async (c) => OAuth.respond(await OAuth.register(c.env, await body(c.req.raw)), 201))

app.get('/oauth/request', async (c) => OAuth.respond(await OAuth.request(c.env, c.req.query(), Site.url(c.env, c.req.url))))

app.post('/oauth/approve', async (c) => OAuth.respond(await OAuth.approve(c.env, await body(c.req.raw), c.req.header('authorization')?.replace(/^Bearer\s+/i, ''), Site.url(c.env, c.req.url))))

app.post('/oauth/token', async (c) => OAuth.respond(await OAuth.token(c.env, await OAuth.form(c.req.raw))))

app.post('/oauth/revoke', async (c) => {
  await OAuth.revoke(c.env, await OAuth.form(c.req.raw))
  return new Response(null, { headers: { 'cache-control': 'no-store' }, status: 200 })
})

app.get('/v1/config', async (c) => c.json(await Operations.config(c.env)))

app.post(`${Sessions.path}/challenge`, async (c) => Problem.respond(await Sessions.challenge(c.env, c.req.raw)))

app.post(Sessions.path, async (c) => Problem.respond(await Sessions.verify(c.env, await body(c.req.raw))))

app.post(`${Sessions.path}/logout`, async (c) => Problem.respond(await Sessions.logout(c.env, c.req.raw)))

app.post('/v1/feedback', async (c) => Problem.respond(await Feedback.file(c.env, await body(c.req.raw)), 201))

app.get('/v1/me', async (c) => Problem.respond(await Operations.account(c.env, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/me', async (c) => Problem.respond(await Operations.rename(c.env, await body(c.req.raw), await Sessions.who(c.env, c.req.raw))))

app.get('/v1/me/ai', async (c) => Problem.respond(await Operations.ownAi(c.env, await Sessions.who(c.env, c.req.raw))))

app.put('/v1/me/ai/keys/:provider', async (c) =>
  Problem.respond(await Operations.ownKey(c.env, { ...(await body(c.req.raw)), provider: c.req.param('provider') }, await Sessions.who(c.env, c.req.raw))),
)

app.delete('/v1/me/ai/keys/:provider', async (c) => Problem.respond(await Operations.ownDrop(c.env, { provider: c.req.param('provider') }, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/me/ai/claude', async (c) => Problem.respond(await Operations.ownSignIn(c.env, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/me/ai/claude/complete', async (c) => Problem.respond(await Operations.ownSignedIn(c.env, await body(c.req.raw), await Sessions.who(c.env, c.req.raw))))

app.delete('/v1/me/ai/claude', async (c) => Problem.respond(await Operations.ownSignOut(c.env, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/swarms/:id/ai', async (c) => Problem.respond(await Operations.hostAi(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))))

app.get('/v1/swarms', async (c) => Problem.respond(await Operations.list(c.env, c.req.query())))

app.post('/v1/swarms', async (c) => Problem.respond(await Operations.create(c.env, await body(c.req.raw), await Sessions.who(c.env, c.req.raw)), 201))

app.get('/v1/search', async (c) =>
  Problem.respond(await Operations.search(c.env, { ...c.req.query(), query: c.req.query('q') ?? c.req.query('query') })),
)

app.get('/v1/swarms/:id', async (c) => Problem.respond(await Operations.get(c.env, { swarm: c.req.param('id') })))

app.patch('/v1/swarms/:id', async (c) =>
  Problem.respond(await Operations.edit(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw), await Operations.keyed(c.env, c.req.header('authorization')?.replace(/^Bearer\s+/i, '')))),
)

app.put('/v1/swarms/:id/picture', async (c) =>
  Problem.respond(await Operations.paint(c.env, { data: new Uint8Array(await c.req.raw.arrayBuffer()), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw), await Operations.keyed(c.env, c.req.header('authorization')?.replace(/^Bearer\s+/i, '')))),
)

app.delete('/v1/swarms/:id/picture', async (c) =>
  Problem.respond(await Operations.edit(c.env, { picture: null, swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw), await Operations.keyed(c.env, c.req.header('authorization')?.replace(/^Bearer\s+/i, '')))),
)

app.get('/v1/swarms/:id/picture', async (c) => {
  const found = await Operations.picture(c.env, { swarm: c.req.param('id') })
  if (!found.ok) return Problem.json(found)
  const current = c.req.query('v') === found.value.at.toString(36)
  return new Response(found.value.bytes, {
    headers: { 'cache-control': current ? 'public, max-age=31536000, immutable' : 'public, max-age=60', 'content-security-policy': "default-src 'none'", 'content-type': found.value.type, 'x-content-type-options': 'nosniff' },
  })
})

app.get('/v1/names/:name', async (c) => Problem.respond(await Operations.named(c.env, { name: c.req.param('name') })))

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

app.get('/v1/swarms/:id/hands', async (c) => Problem.respond(await Operations.hands(c.env, { swarm: c.req.param('id') })))

app.post('/v1/swarms/:id/hands', async (c) =>
  Problem.respond(
    await Operations.hand(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw), await Operations.keyed(c.env, c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))),
    201,
  ),
)

app.delete('/v1/swarms/:id/hands/:hand', async (c) =>
  Problem.respond(await Operations.unhand(c.env, { hand: c.req.param('hand'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw), await Operations.keyed(c.env, c.req.header('authorization')?.replace(/^Bearer\s+/i, '')))),
)

app.get('/v1/problems', async (c) => Problem.respond(await Operations.problems(c.env)))

app.get('/v1/health', async (c) => Problem.respond(await Operations.health(c.env)))

app.get('/v1/swarms/:id/machines', async (c) => Problem.respond(await Operations.machines(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/machines/export', async (c) => stream(await Machines.exported(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/machines/:machine/export', async (c) => stream(await Machines.exported(c.env, { machine: c.req.param('machine'), swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/machines/:machine/commands', async (c) =>
  Problem.respond(await Machines.commands(c.env, { ...c.req.query(), machine: c.req.param('machine'), swarm: c.req.param('id') })),
)

app.get('/v1/swarms/:id/machines/:machine/commands/:seq', async (c) =>
  Problem.respond(await Machines.command(c.env, { machine: c.req.param('machine'), seq: c.req.param('seq'), swarm: c.req.param('id') })),
)

app.get('/v1/swarms/:id/machines/:machine/commands/:seq/log', async (c) =>
  Problem.respond(await Machines.job(c.env, { machine: c.req.param('machine'), seq: c.req.param('seq'), swarm: c.req.param('id') })),
)

app.get('/v1/swarms/:id/machines/:machine/logs', async (c) =>
  Problem.respond(await Machines.logs(c.env, { ...c.req.query(), machine: c.req.param('machine'), swarm: c.req.param('id') })),
)

app.get('/v1/swarms/:id/backers', async (c) => Problem.respond(await Operations.backers(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/progress', async (c) => Problem.respond(await Operations.progress(c.env, { ...c.req.query(), swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/artifacts', async (c) =>
  Problem.respond(await Operations.artifacts(c.env, { swarm: c.req.param('id') }, Site.url(c.env, c.req.url))),
)

app.get('/v1/general/chat', async (c) => Problem.respond(await Operations.general(c.env, c.req.query())))

app.post('/v1/general/chat', async (c) => Problem.respond(await Operations.shout(c.env, await body(c.req.raw), await Sessions.who(c.env, c.req.raw)), 201))

app.get('/v1/swarms/:id/chat', async (c) =>
  Problem.respond(await Operations.room(c.env, { ...c.req.query(), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/chat', async (c) =>
  Problem.respond(
    await Operations.say(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)),
    201,
  ),
)

app.get('/v1/swarms/:id/chat/:message{[0-9]+}', async (c) =>
  Problem.respond(await Operations.replies(c.env, { ...c.req.query(), message: c.req.param('message'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/chat/:message{[0-9]+}/reactions', async (c) =>
  Problem.respond(await Operations.react(c.env, { ...(await body(c.req.raw)), message: c.req.param('message'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
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

app.get('/v1/swarms/:id/tree', async (c) => Problem.respond(await Operations.tree(c.env, { ...c.req.query(), swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/nodes/:nid', async (c) => Problem.respond(await Operations.node(c.env, { node: c.req.param('nid'), swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/deltas', async (c) => Problem.respond(await Operations.nodeUpdates(c.env, { ...c.req.query(), swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/code', async (c) => Problem.respond(await Operations.code(c.env, { swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/nodes/:nid/updates', async (c) => Problem.respond(await Operations.nodeUpdates(c.env, { ...c.req.query(), node: c.req.param('nid'), swarm: c.req.param('id') })))

app.get('/v1/swarms/:id/proofs', async (c) => Problem.respond(await Operations.proofs(c.env, { swarm: c.req.param('id') })))

app.post('/v1/swarms/:id/nodes', async (c) =>
  Problem.respond(await Operations.propose(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, Site.url(c.env, c.req.url), await Sessions.who(c.env, c.req.raw)), 201),
)

app.post('/v1/swarms/:id/ideas', async (c) => Problem.respond(await Operations.suggest(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)), 201))

app.post('/v1/swarms/:id/transfer', async (c) => Problem.respond(await Operations.transfer(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, Site.url(c.env, c.req.url))))

app.post('/v1/swarms/:id/nodes/:nid/steer', async (c) =>
  Problem.respond(await Operations.nodeSteer(c.env, { ...(await body(c.req.raw)), node: c.req.param('nid'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/nodes/:nid/move', async (c) =>
  Problem.respond(await Operations.nodeMove(c.env, { ...(await body(c.req.raw)), node: c.req.param('nid'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/nodes/:nid/end', async (c) =>
  Problem.respond(await Operations.nodeEnd(c.env, { ...(await body(c.req.raw)), node: c.req.param('nid'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/v1/swarms/:id/nodes/:nid/review', async (c) => Problem.respond(await Operations.review(c.env, { node: c.req.param('nid'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/swarms/:id/triage', async (c) => Problem.respond(await Operations.triage(c.env, { ...(await body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/swarms/:id/archive', async (c) =>
  Problem.respond(await Operations.archive(c.env, { swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw), await Operations.keyed(c.env, c.req.header('authorization')?.replace(/^Bearer\s+/i, '')))),
)

app.get('/v1/swarms/:id/ledger', async (c) => Problem.respond(await Operations.ledger(c.env, { swarm: c.req.param('id') })))

app.get('/v1/riders/:who', async (c) => Problem.respond(await Operations.rider(c.env, { who: c.req.param('who') })))

app.get('/v1/me/swarms/:id', async (c) => Problem.respond(await Operations.standing(c.env, { swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))))

app.post('/v1/hooks/github', async (c) => Problem.respond(await Operations.verified(c.env, c.req.raw)))

app.all('/v1/*', () => Problem.json({ code: 'not_found', detail: 'No such route. See /openapi.json.', status: 404 }))
