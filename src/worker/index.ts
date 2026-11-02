import { Hono } from 'hono'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Rest from './Rest.ts'
import * as Sessions from './Sessions.ts'
import * as XFrames from './XFrames.ts'

export { Swarm } from './Swarm.ts'

const app = new Hono<{ Bindings: Cloudflare.Env }>()

app.get('/x', (c) => XFrames.start(new URL(c.req.url).origin))

app.get('/x/card.svg', (c) => XFrames.card(c.req.query('title') ?? 'Fund a research swarm'))

app.get('/x/s/:id', async (c) => {
  const result = await Operations.get(c.env, { swarm: c.req.param('id') })
  return result.ok ? XFrames.swarm(new URL(c.req.url).origin, result.value) : Problem.json(result)
})

app.all(Sessions.path, (c) => Sessions.auth(c.env).fetch(c.req.raw))

app.all(`${Sessions.path}/*`, (c) => Sessions.auth(c.env).fetch(c.req.raw))

app.get('/api/config', (c) => c.json(Operations.config(c.env)))

app.get('/api/swarms', async (c) => Problem.respond(await Operations.list(c.env, {})))

app.post('/api/swarms', async (c) => Problem.respond(await Operations.create(c.env, await Rest.body(c.req.raw)), 201))

app.get('/api/swarms/:id', async (c) => Problem.respond(await Operations.detail(c.env, { swarm: c.req.param('id') })))

app.get('/api/swarms/:id/feed', async (c) =>
  Problem.respond(
    await Operations.feed(c.env, {
      after: c.req.query('after'),
      limit: c.req.query('limit'),
      round: c.req.query('round'),
      swarm: c.req.param('id'),
      who: c.req.query('who'),
    }),
  ),
)

app.get('/api/swarms/:id/live', async (c) =>
  Rest.stream(await Operations.live(c.env, { swarm: c.req.param('id') }, c.req.raw.signal)),
)

app.post('/api/swarms/:id/contributions', async (c) =>
  Rest.contributed(await Operations.contribute(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') })),
)

app.post('/api/swarms/:id/budgets', async (c) =>
  Problem.respond(await Operations.budget(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }), 201),
)

app.post('/api/swarms/:id/budgets/:budget', async (c) =>
  Problem.respond(
    await Operations.allow(c.env, { ...(await Rest.body(c.req.raw)), budget: c.req.param('budget'), swarm: c.req.param('id') }),
    201,
  ),
)

app.get('/api/swarms/:id/chat', async (c) =>
  Problem.respond(await Operations.room(c.env, { ...c.req.query(), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw))),
)

app.post('/api/swarms/:id/chat', async (c) =>
  Problem.respond(
    await Operations.say(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }, await Sessions.who(c.env, c.req.raw)),
    201,
  ),
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

app.post('/api/swarms/:id/pledges', async (c) =>
  Problem.respond(await Operations.pledge(c.env, { ...(await Rest.body(c.req.raw)), swarm: c.req.param('id') }), 201),
)

app.post('/api/swarms/:id/pledges/:pledge', async (c) =>
  Rest.settled(
    await Operations.approve(c.env, {
      ...(await Rest.body(c.req.raw)),
      pledge: c.req.param('pledge'),
      swarm: c.req.param('id'),
    }),
  ),
)

app.post('/api/swarms/:id/pay', async (c) => {
  const paid = await Operations.pay(c.env, c.req.param('id'), c.req.header('authorization') ?? '', await Rest.body(c.req.raw))
  if ('authorization' in paid) return c.json(paid)
  return Response.json(
    { code: paid.code, detail: paid.detail, status: paid.status },
    { headers: paid.retry ? { 'retry-after': String(paid.retry) } : {}, status: paid.status },
  )
})

app.all('/api/*', () => Problem.json({ code: 'not_found', detail: 'No such route.', status: 404 }))

app.route('/', Rest.app)

export default app

