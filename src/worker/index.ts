import { Hono } from 'hono'
import { z } from 'zod'
import type { Config, Detail, Pledged, Problem, Requested } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import * as Chain from './Chain.ts'
import * as Gateway from './Gateway.ts'
import * as Seal from './Seal.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'

export { Swarm } from './Swarm.ts'

const amount = z
  .union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()])
  .transform((value) => Memo.units(typeof value === 'number' ? value.toFixed(6) : value))
  .refine((value) => value >= Store.minPledge, `A pledge is at least ${Memo.decimal(Store.minPledge)} MACH.`)
  .refine((value) => value <= 100_000_000n, 'A pledge is at most 100 MACH.')

const schema = {
  approval: z
    .object({
      keyAuthorization: z.unknown().optional(),
      transaction: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
    })
    .refine((input) => input.keyAuthorization !== undefined || input.transaction !== undefined, {
      message: 'Send the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it.',
    }),
  pledge: z.object({ amount, note: z.string().trim().max(Memo.maxNote).nullish() }),
  swarm: z.object({
    goal: z.string().trim().min(10).max(2000),
    title: z.string().trim().min(3).max(80),
  }),
}

const app = new Hono<{ Bindings: Cloudflare.Env }>()

function problem(status: 400 | 404 | 409 | 502, code: string, detail: string) {
  return Response.json({ code, detail, status } satisfies Problem, { status })
}

function swarm(env: Cloudflare.Env, id: string): DurableObjectStub<Swarm> {
  return env.SWARMS.get(env.SWARMS.idFromName(id))
}

async function body<schema extends z.ZodType>(request: Request, parser: schema) {
  const parsed = parser.safeParse(await request.json().catch(() => undefined))
  return parsed.success ? parsed.data : problem(400, 'invalid_request', z.prettifyError(parsed.error))
}

function identifier() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

app.get('/api/config', (c) =>
  c.json({
    chainId: Chain.chain.id,
    explorer: Chain.chain.blockExplorers.default.url,
    gateway: c.env.GATEWAY_URL,
    mach: Chain.mach,
    minPledge: Memo.decimal(Store.minPledge),
    perWorker: Memo.decimal(Store.perWorker),
    reserve: Memo.decimal(Store.reserve),
    rpc: c.env.TEMPO_RPC,
  } satisfies Config),
)

app.get('/api/swarms', async (c) => c.json({ swarms: (await Store.list(c.env)).map((row) => Store.summary(row)) }))

app.post('/api/swarms', async (c) => {
  const input = await body(c.req.raw, schema.swarm)
  if (input instanceof Response) return input

  const id = identifier()
  await Store.insert(c.env, { goal: input.goal, id, title: input.title })
  const row = await Store.find(c.env, id)
  return row ? c.json(Store.summary(row), 201) : problem(502, 'unavailable', 'The swarm was not saved.')
})

app.get('/api/swarms/:id', async (c) => {
  const id = c.req.param('id')
  const row = await Store.find(c.env, id)
  if (!row) return problem(404, 'not_found', 'No swarm has this id.')

  const view = await swarm(c.env, id).view()
  const answered = view.rounds.findLast((round) => round.status === 'completed' && round.message)
  if (!row.answer && answered?.message) {
    row.answer = JSON.stringify(Answer.parse(answered.n, answered.message, answered.endedAt ?? Date.now()))
    await Store.update(c.env, id, { answer: row.answer })
  }
  const [pledges, notes] = await Promise.all([
    Store.pledges(c.env, id),
    Store.notes(c.env, id, BigInt(row.raised), new Set(view.steered)),
  ])
  return c.json({
    ...Store.summary(row, view.left === null ? undefined : Memo.units(view.left)),
    feed: view.feed,
    hands: view.hands,
    history: view.rounds,
    notes,
    pledges,
  } satisfies Detail)
})

app.get('/api/swarms/:id/feed', async (c) => {
  const after = Number(c.req.query('after') ?? '0')
  if (!Number.isSafeInteger(after) || after < 0)
    return problem(400, 'invalid_request', 'after must be a nonnegative integer.')
  return c.json({ entries: await swarm(c.env, c.req.param('id')).feed(after) })
})

app.get('/api/swarms/:id/live', (c) =>
  swarm(c.env, c.req.param('id')).fetch(new Request('https://swarm/live', { signal: c.req.raw.signal })),
)

app.post('/api/swarms/:id/pledges', async (c) => {
  const id = c.req.param('id')
  const input = await body(c.req.raw, schema.pledge)
  if (input instanceof Response) return input
  const row = await Store.find(c.env, id)
  if (!row) return problem(404, 'not_found', 'No swarm has this id.')
  if (row.status === 'done') return problem(409, 'conflict', 'This swarm is done.')

  const deposit = Number(input.amount) / 1e6
  const requested = await Gateway.request(c.env, {
    days: 7,
    deposit,
    limit: Math.max(1, Math.ceil(deposit)),
    topUp: 0,
  })
  if (!requested.ok) return problem(502, 'upstream_failed', `The gateway did not start a key: ${requested.detail}`)

  const note = input.note || null
  const pledge = identifier()
  await Store.request(c.env, {
    amount: String(input.amount),
    id: pledge,
    note,
    note_id: note ? await Store.noteId(note) : null,
    request: requested.value.id,
    swarm: id,
  })
  return c.json({ authorizeAccessKey: requested.value.authorizeAccessKey, pledge } satisfies Requested, 201)
})

app.post('/api/swarms/:id/pledges/:pledge', async (c) => {
  const id = c.req.param('id')
  const input = await body(c.req.raw, schema.approval)
  if (input instanceof Response) return input
  const [row, backing] = await Promise.all([Store.find(c.env, id), Store.backing(c.env, id, c.req.param('pledge'))])
  if (!row || !backing) return problem(404, 'not_found', 'No pledge has this id.')
  if (backing.status !== 'pending') return problem(409, 'conflict', 'This pledge is already approved.')

  const completed = await Gateway.complete(c.env, {
    id: backing.request,
    ...(input.keyAuthorization === undefined ? {} : { keyAuthorization: input.keyAuthorization }),
    name: `Swarms: ${row.title}`.slice(0, 64),
    ...(input.transaction === undefined ? {} : { transaction: input.transaction }),
  })
  if (!completed.ok) return problem(400, 'invalid_request', `The gateway refused the approval: ${completed.detail}`)
  const key = completed.value.key
  const me = await Gateway.me(c.env, key)
  if (!me.ok) return problem(502, 'upstream_failed', `The gateway did not describe the key: ${me.detail}`)

  const balance = me.value.usage.wallet.balance
  if (balance !== null && Memo.units(balance) < BigInt(backing.amount)) {
    await Promise.all([Gateway.revoke(c.env, key), Store.forget(c.env, backing.id)])
    return problem(
      409,
      'insufficient_balance',
      `The wallet holds ${balance} MACH, less than the ${Memo.decimal(BigInt(backing.amount))} MACH pledge. Add MACH and pledge again.`,
    )
  }

  const contributor = me.value.wallet
  const activated = await Store.activate(c.env, backing.id, {
    contributor,
    sealed_key: await Seal.seal(c.env.SWARMS_SECRET, key),
  })
  if (!activated) {
    await Gateway.revoke(c.env, key)
    return problem(409, 'conflict', 'This pledge is already approved.')
  }
  await swarm(c.env, id).pledged({
    amount: Memo.decimal(BigInt(backing.amount)),
    contributor,
    note: backing.note,
    noteId: backing.note_id,
    swarm: id,
  })

  const updated = (await Store.find(c.env, id)) ?? row
  return c.json(
    {
      pledge: {
        amount: Memo.decimal(BigInt(backing.amount)),
        at: backing.created_at,
        contributor,
        id: backing.id,
        note: backing.note,
        spent: '0.000000',
        status: 'active',
      },
      swarm: Store.summary(updated),
    } satisfies Pledged,
    201,
  )
})

app.all('/api/*', () => problem(404, 'not_found', 'No such route.'))

export default app
