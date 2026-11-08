import { Hono } from 'hono'
import * as Artifacts from './Artifacts.ts'
import * as Code from './Code.ts'
import * as Edge from './Edge.ts'
import * as Feedback from './Feedback.ts'
import * as Lobby from './Lobby.ts'
import * as Operations from './Operations.ts'
import * as Page from './Page.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'
import * as Rest from './Rest.ts'
import * as Sessions from './Sessions.ts'
import * as Telegram from './Telegram.ts'
import * as Timing from './Timing.ts'
import * as XFrames from './XFrames.ts'

export { Lobby } from './Lobby.ts'
export { Swarm } from './Swarm.ts'

const app = new Hono<{ Bindings: Cloudflare.Env }>()

app.use('*', (c, next) =>
  Timing.run(async () => {
    c.env = { ...c.env, DB: Timing.database(c.env.DB) }
    await next()
    const timing = Timing.header()
    if (!timing || c.res.headers.has('server-timing')) return
    const headers = new Headers(c.res.headers)
    headers.set('server-timing', timing)
    const response = new Response(c.res.body, { headers, status: c.res.status, statusText: c.res.statusText, ...(c.res.webSocket ? { webSocket: c.res.webSocket } : {}) })
    c.res = undefined
    c.res = response
  }),
)

app.use('*', async (c, next) => {
  await next()
  const path = new URL(c.req.url).pathname
  if (c.req.method !== 'GET' || c.res.status !== 200 || !(path.startsWith('/api/') || path.startsWith('/v1/'))) return
  if (!(c.res.headers.get('content-type') ?? '').startsWith('application/json') || c.res.headers.has('etag')) return
  const body = await c.res.arrayBuffer()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', body))
  const etag = `W/"${Array.from(digest.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('')}"`
  const headers = new Headers(c.res.headers)
  headers.set('etag', etag)
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-cache')
  const match = (c.req.header('if-none-match') ?? '').split(',').some((tag) => tag.trim() === etag)
  c.res = undefined
  c.res = match ? new Response(null, { headers, status: 304 }) : new Response(body, { headers, status: 200 })
})

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  const writing = Replica.writes(c.req.method, path)
  if (Replica.readable(c.req.method, path)) c.env = Replica.read(c.env, c.req.raw)
  else if (writing) c.env = Replica.write(c.env)
  await next()
  if (!writing || !c.res.ok) return
  const marked = Replica.mark(c.env, c.res)
  if (marked === c.res) return
  c.res = undefined
  c.res = marked
})

app.get('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  const accept = c.req.header('accept') ?? ''
  if (!Page.rendered(path) || (accept !== '' && !/text\/html|\*\/\*/.test(accept))) return next()
  return Page.page(c.req.raw, c.env)
})

function framed(env: Cloudflare.Env, id: string | undefined): Edge.Draw {
  return async (request) => {
    const url = new URL(request.url)
    if (id === undefined) {
      const listed = await Operations.list(env, {}).catch(() => undefined)
      return { response: XFrames.start(url.origin, listed?.ok ? listed.value.swarms : [], url, env.TELEGRAM_BOT), whole: Promise.resolve(!!listed?.ok) }
    }
    const result = await Operations.get(env, { swarm: id })
    return { response: result.ok ? XFrames.swarm(url.origin, result.value, url, env.TELEGRAM_BOT) : result.status === 404 ? XFrames.lost(url.origin, url, env.TELEGRAM_BOT) : Problem.json(result), whole: Promise.resolve(result.ok) }
  }
}

app.get('/x', (c) => Edge.page(c.req.raw, '', framed(c.env, undefined)))

app.get('/x/card.svg', (c) => XFrames.card(c.req.query('title') ?? 'Fund a swarm'))

app.get('/x/s/:id', (c) => Edge.page(c.req.raw, '', framed(c.env, c.req.param('id'))))

app.get('/tg', (c) => Edge.page(c.req.raw, '', framed(c.env, Telegram.started(new URL(c.req.url)))))

app.get('/tg/s/:id', (c) => Edge.page(c.req.raw, '', framed(c.env, c.req.param('id'))))

app.post('/telegram', (c) => Telegram.hook(c.env, c.req.raw))

app.get('/a/:id/:slug', (c) => c.redirect(`${new URL(c.req.url).pathname}/`, 301))

app.on(['GET', 'HEAD'], '/a/:id/:slug/*', (c) => {
  const [, , id = '', slug = '', ...rest] = new URL(c.req.url).pathname.split('/')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response('No such swarm.', { status: 404 })
  let path: string
  try {
    path = rest.map(decodeURIComponent).join('/')
  } catch {
    return new Response('No such artifact file.', { status: 404 })
  }
  return Artifacts.serve(c.env, c.req.raw, id, slug, path)
})

app.all(Feedback.path, (c) => Feedback.feedback(c.env).fetch(c.req.raw))

app.all(`${Feedback.path}/*`, (c) => Feedback.feedback(c.env).fetch(c.req.raw))

app.all(Sessions.path, (c) => Sessions.auth(c.env).fetch(c.req.raw))

app.all(`${Sessions.path}/*`, (c) => Sessions.auth(c.env).fetch(c.req.raw))

app.get('/api/config', async (c) => c.json(await Operations.config(c.env)))

app.get('/api/me', async (c) => Problem.respond(await Operations.account(c.env, await Sessions.who(c.env, c.req.raw))))

app.post('/api/me', async (c) => Problem.respond(await Operations.rename(c.env, await Rest.body(c.req.raw), await Sessions.who(c.env, c.req.raw))))

app.get('/api/swarms', async (c) => {
  const listed = await Operations.list(c.env, {})
  return Problem.respond(listed.ok ? Problem.ok(Operations.listed(listed.value)) : listed)
})

app.get('/api/swarms/live', (c) => Lobby.enter(c.env, c.req.raw))

app.get('/v1/swarms/live', (c) => Lobby.enter(c.env, c.req.raw))

app.post('/api/swarms', async (c) => Problem.respond(await Operations.create(c.env, await Rest.body(c.req.raw), await Sessions.who(c.env, c.req.raw)), 201))

app.get('/api/swarms/:id', async (c) => {
  const id = c.req.param('id')
  const salt = Edge.minute()
  const first = Edge.asked(c.req.raw, 'sd') ? await Operations.stamp(c.env, id) : undefined
  const early = first && Edge.tag('sd', c.req.raw, first.version, salt)
  if (early && Edge.matches(c.req.raw, early)) return Edge.unchanged(early)
  const shown = await Operations.stamped(c.env, { swarm: id }, c.req.query('feed') !== '0')
  if (!shown.ok) return Problem.json(shown)
  return Edge.tagged(c.json(shown.value.detail), early || (shown.value.stamp.quiet ? Edge.tag('sd', c.req.raw, shown.value.stamp.version, salt) : undefined))
})

app.get('/api/swarms/:id/git/:read', async (c) => {
  const read = c.req.param('read')
  if (!Code.readable(read)) return Problem.json({ code: 'not_found', detail: 'No such route.', status: 404 })
  return Code.proxy(c.env, c.executionCtx, c.req.raw, c.req.param('id'), read)
})
app.get('/api/swarms/:id/code', async (c) => Problem.respond(await Operations.code(c.env, { swarm: c.req.param('id') })))
app.get('/api/swarms/:id/feed', async (c) => {
  const paged = await Operations.paged(c.env, {
    after: c.req.query('after'),
    limit: c.req.query('limit'),
    before: c.req.query('before'),
    swarm: c.req.param('id'),
    who: c.req.query('who'),
  })
  if (!paged.ok) return Problem.json(paged)
  const tag = Edge.tag('sf', c.req.raw, String(paged.value.last))
  return Edge.matches(c.req.raw, tag) ? Edge.unchanged(tag) : Edge.tagged(c.json(paged.value.page), tag)
})

app.get('/api/swarms/:id/live', async (c) =>
  Rest.stream(await Operations.live(c.env, { swarm: c.req.param('id') }, c.req.raw.signal, c.req.query('after'))),
)

app.post('/api/swarms/:id/contributions', async (c) =>
  Rest.contributed(await Operations.contribute(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') })),
)

app.get('/api/swarms/:id/artifacts', async (c) =>
  Problem.respond(await Operations.artifacts(c.env, { swarm: c.req.param('id') }, new URL(c.req.url).origin)),
)

app.get('/api/swarms/:id/chat', async (c) => {
  const id = c.req.param('id')
  const salt = `${Edge.minute()}|${c.req.header('authorization') ?? ''}`
  const first = Edge.asked(c.req.raw, 'sc') ? await Operations.stamp(c.env, id) : undefined
  const early = first && Edge.tag('sc', c.req.raw, first.version, salt)
  if (early && Edge.matches(c.req.raw, early)) return Edge.unchanged(early)
  const heard = await Operations.listened(c.env, { ...c.req.query(), swarm: id }, await Sessions.who(c.env, c.req.raw))
  if (!heard.ok) return Problem.json(heard)
  return Edge.tagged(c.json(heard.value.room), early || (heard.value.stamp.quiet ? Edge.tag('sc', c.req.raw, heard.value.stamp.version, salt) : undefined))
})

app.post('/api/swarms/:id/chat', async (c) =>
  Problem.respond(
    await Operations.say(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)),
    201,
  ),
)

app.get('/api/swarms/:id/team', async (c) => Problem.respond(await Operations.team(c.env, { swarm: c.req.param('id') })))

app.post('/api/swarms/:id/team', async (c) =>
  Problem.respond(await Operations.steer(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/api/swarms/:id/team/members', async (c) =>
  Problem.respond(await Operations.seat(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)), 201),
)

app.delete('/api/swarms/:id/team/members/:member', async (c) =>
  Problem.respond(await Operations.unseat(c.env, { member: c.req.param('member'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/api/swarms/:id/btw', async (c) =>
  Problem.respond(await Operations.btw(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.get('/api/swarms/:id/branches', async (c) => Problem.respond(await Operations.branches(c.env, { swarm: c.req.param('id') })))

app.post('/api/swarms/:id/branches/:branch/fund', async (c) =>
  Problem.respond(await Operations.fund(c.env, { ...(await Rest.body(c.req.raw)), branch: c.req.param('branch'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/api/swarms/:id/branches/:branch/move', async (c) =>
  Problem.respond(await Operations.move(c.env, { ...(await Rest.body(c.req.raw)), branch: c.req.param('branch'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/api/swarms/:id/branches/:branch/stop', async (c) =>
  Problem.respond(await Operations.stop(c.env, { branch: c.req.param('branch'), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.get('/api/swarms/:id/chat/live', async (c) => Rest.socket(await Operations.chatter(c.env, { swarm: c.req.param('id') }, c.req.raw)))

app.get('/v1/swarms/:id/chat/live', async (c) => Rest.socket(await Operations.chatter(c.env, { swarm: c.req.param('id') }, c.req.raw)))

app.get('/api/swarms/:id/hands', async (c) => Problem.respond(await Operations.hands(c.env, { swarm: c.req.param('id') })))

app.post('/api/swarms/:id/hands', async (c) =>
  Problem.respond(
    await Operations.hand(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)),
    201,
  ),
)

app.post('/api/swarms/:id/pay', async (c) => {
  const paid = await Operations.pay(c.env, c.req.param('id'), c.req.header('authorization') ?? '', await Rest.body(c.req.raw))
  if ('authorization' in paid || 'feeToken' in paid || 'usd' in paid) return c.json(paid)
  return Response.json(
    { code: paid.code, detail: paid.detail, status: paid.status },
    { headers: paid.retry ? { 'retry-after': String(paid.retry) } : {}, status: paid.status },
  )
})

app.all('/api/*', () => Problem.json({ code: 'not_found', detail: 'No such route.', status: 404 }))

app.route('/', Rest.app)

app.get('*', (c) => {
  const accept = c.req.header('accept') ?? ''
  if (accept !== '' && !/text\/html|\*\/\*/.test(accept)) return c.notFound()
  return Page.lost(c.req.raw, c.env)
})

async function scheduled(_controller: ScheduledController, env: Cloudflare.Env) {
  const { results } = await env.DB.prepare('SELECT id FROM swarms').all<{ id: string }>()
  const swept = await Promise.all(
    results.map(async (row) => {
      try {
        return { id: row.id, ...(await env.SWARMS.get(env.SWARMS.idFromName(row.id)).instruct()) }
      } catch (error) {
        return { agent: null, error: String(error), id: row.id, instructed: false, state: 'unknown' }
      }
    }),
  )
  const left = swept.filter((swarm) => swarm.agent && !swarm.instructed)
  console.log(JSON.stringify({ instruct: swept.length, left: left.map((swarm) => `${swarm.id}:${swarm.state}`), withoutAgent: swept.filter((swarm) => !swarm.agent).length }))
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Cloudflare.Env>

