import { Hono } from 'hono'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Rest from './Rest.ts'

export { Swarm } from './Swarm.ts'

const app = new Hono<{ Bindings: Cloudflare.Env }>()

app.get('/api/config', (c) => c.json(Operations.config(c.env)))

app.get('/api/swarms', async (c) => Problem.respond(await Operations.list(c.env, {})))

app.post('/api/swarms', async (c) => Problem.respond(await Operations.create(c.env, await Rest.body(c.req.raw)), 201))

app.get('/api/swarms/:id', async (c) => Problem.respond(await Operations.detail(c.env, { swarm: c.req.param('id') })))

app.get('/api/swarms/:id/feed', async (c) =>
  Problem.respond(await Operations.feed(c.env, { after: c.req.query('after'), swarm: c.req.param('id') })),
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

app.all('/api/*', () => Problem.json({ code: 'not_found', detail: 'No such route.', status: 404 }))

app.route('/', Rest.app)

export default app
