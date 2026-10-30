import { Hono } from 'hono'
import { parseEventLogs } from 'viem'
import type { Address, Hex } from 'viem'
import { getTransactionReceipt } from 'viem/actions'
import { Abis } from 'viem/tempo'
import { z } from 'zod'
import type { BudgetRequested, Budgeted, Config, Contributed, Detail, Pledged, Problem, Requested } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import * as Budget from './Budget.ts'
import * as Chain from './Chain.ts'
import * as Gateway from './Gateway.ts'
import * as Seal from './Seal.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'
import * as Vault from './Vault.ts'

export { Swarm } from './Swarm.ts'

const decimal = z
  .union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()])
  .transform((value) => Memo.units(typeof value === 'number' ? value.toFixed(6) : value))

const amount = decimal
  .refine((value) => value >= Store.minPledge, `A pledge is at least ${Memo.decimal(Store.minPledge)} MACH.`)
  .refine((value) => value <= 100_000_000n, 'A pledge is at most 100 MACH.')

const note = z.string().trim().max(Memo.maxNote).nullish()

const schema = {
  approval: z
    .object({
      keyAuthorization: z.unknown().optional(),
      transaction: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
    })
    .refine((input) => input.keyAuthorization !== undefined || input.transaction !== undefined, {
      message: 'Send the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it.',
    }),
  budget: z.object({
    amount: decimal
      .refine((value) => value >= Store.budget.min, `A daily budget is at least ${Memo.decimal(Store.budget.min)}.`)
      .refine((value) => value <= Store.budget.max, `A daily budget is at most ${Memo.decimal(Store.budget.max)}.`),
    note,
    token: z.enum(Chain.ids),
  }),
  contribution: z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), note }),
  pledge: z.object({ amount, note }),
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

async function provisioned(env: Cloudflare.Env, row: Store.Row) {
  if (row.wallet) return { ...row, wallet: row.wallet }
  await Store.provision(env, row.id, await Vault.create(env.SWARMS_SECRET))
  const updated = await Store.find(env, row.id)
  if (!updated?.wallet) throw new Error('The swarm has no wallet.')
  return { ...updated, wallet: updated.wallet }
}

app.get('/api/config', (c) =>
  c.json({
    budget: {
      days: Store.budget.days,
      max: Memo.decimal(Store.budget.max),
      min: Memo.decimal(Store.budget.min),
      period: Store.budget.period,
    },
    chainId: Chain.chain.id,
    explorer: Chain.chain.blockExplorers.default.url,
    gateway: c.env.GATEWAY_URL,
    mach: Chain.mach,
    minPledge: Memo.decimal(Store.minPledge),
    perWorker: Memo.decimal(Store.perWorker),
    reserve: Memo.decimal(Store.reserve),
    rpc: c.env.TEMPO_RPC,
    tokens: Chain.ids.map((id) => ({ address: Chain.tokens[id].address, id, symbol: Chain.tokens[id].symbol })),
  } satisfies Config),
)

app.get('/api/swarms', async (c) => c.json({ swarms: (await Store.list(c.env)).map((row) => Store.summary(row)) }))

app.post('/api/swarms', async (c) => {
  const input = await body(c.req.raw, schema.swarm)
  if (input instanceof Response) return input

  const id = identifier()
  await Store.insert(c.env, { goal: input.goal, id, title: input.title, ...(await Vault.create(c.env.SWARMS_SECRET)) })
  const row = await Store.find(c.env, id)
  return row ? c.json(Store.summary(row), 201) : problem(502, 'unavailable', 'The swarm was not saved.')
})

app.get('/api/swarms/:id', async (c) => {
  const id = c.req.param('id')
  const found = await Store.find(c.env, id)
  if (!found) return problem(404, 'not_found', 'No swarm has this id.')
  const row = await provisioned(c.env, found)

  const view = await swarm(c.env, id).view()
  const answered = view.rounds.findLast((round) => round.status === 'completed' && round.message)
  if (!row.answer && answered?.message) {
    row.answer = JSON.stringify(Answer.parse(answered.n, answered.message, answered.endedAt ?? Date.now()))
    await Store.update(c.env, id, { answer: row.answer })
  }
  const [pledges, notes, budgets, contributions] = await Promise.all([
    Store.pledges(c.env, id),
    Store.notes(c.env, id, BigInt(row.raised), new Set(view.steered)),
    Store.budgets(c.env, id),
    Store.contributions(c.env, id),
  ])
  return c.json({
    ...Store.summary(row, view.left === null ? undefined : Memo.units(view.left)),
    budgets,
    contributions,
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

app.post('/api/swarms/:id/contributions', async (c) => {
  const id = c.req.param('id')
  const input = await body(c.req.raw, schema.contribution)
  if (input instanceof Response) return input
  const found = await Store.find(c.env, id)
  if (!found) return problem(404, 'not_found', 'No swarm has this id.')
  if (found.status === 'done') return problem(409, 'conflict', 'This swarm is done.')
  const row = await provisioned(c.env, found)

  const receipt = await getTransactionReceipt(Chain.client(c.env), { hash: input.hash as Hex }).catch(() => undefined)
  if (!receipt) return problem(404, 'not_found', 'Tempo has no receipt for this transaction yet.')
  if (receipt.status !== 'success') return problem(400, 'invalid_request', 'The transaction reverted.')

  const wallet = row.wallet.toLowerCase()
  const sender = receipt.from.toLowerCase()
  const logs = parseEventLogs({ abi: Abis.tip20, logs: receipt.logs })
  const transfers = logs.flatMap((log) => {
    const token = Chain.token(log.address)
    return log.eventName === 'Transfer' &&
      token &&
      log.args.to.toLowerCase() === wallet &&
      log.args.from.toLowerCase() === sender &&
      sender !== wallet
      ? [{ amount: log.args.amount, token }]
      : []
  })
  const first = transfers[0]
  if (!first)
    return problem(
      400,
      'invalid_request',
      `That transaction sends no USDC.e, pathUSD or OUSD from its sender to this swarm's address ${row.wallet}. MACH cannot be sent to a swarm: pledge it instead.`,
    )

  const text = input.note || null
  const memos = logs.flatMap((log) =>
    log.eventName === 'TransferWithMemo' && log.args.to.toLowerCase() === wallet ? [log.args.memo.toLowerCase()] : [],
  )
  if (text && !memos.includes(Memo.memo(id, text).toLowerCase()))
    return problem(
      400,
      'invalid_request',
      `The transfer's memo does not commit to this note. Send it with the memo keccak256("note:${id}:<note>").`,
    )

  const total = transfers.reduce((sum, transfer) => sum + transfer.amount, 0n)
  const noteId = text ? await Store.noteId(text) : null
  const existing = await Store.gift(c.env, input.hash)
  if (existing) {
    if (!text || existing.note || existing.kind !== 'transfer' || !noteId)
      return problem(409, 'conflict', 'This transaction is already counted.')
    await Store.annotate(c.env, input.hash, { note: text, note_id: noteId })
  } else {
    await Store.give(c.env, {
      amount: String(total),
      budget: null,
      contributor: sender as Address,
      id: input.hash as Hex,
      kind: 'transfer',
      note: text,
      note_id: noteId,
      swarm: id,
      token: first.token,
    })
  }
  await swarm(c.env, id).contributed({
    amount: Memo.decimal(total),
    contributor: sender as Address,
    hash: input.hash,
    note: text,
    noteId,
    swarm: id,
    token: first.token,
  })

  const [gift, updated] = await Promise.all([Store.gift(c.env, input.hash), Store.find(c.env, id)])
  if (!gift) return problem(502, 'unavailable', 'The contribution was not saved.')
  return c.json({ contribution: Store.contribution(gift), swarm: Store.summary(updated ?? row) } satisfies Contributed, existing ? 200 : 201)
})

app.post('/api/swarms/:id/budgets', async (c) => {
  const id = c.req.param('id')
  const input = await body(c.req.raw, schema.budget)
  if (input instanceof Response) return input
  const found = await Store.find(c.env, id)
  if (!found) return problem(404, 'not_found', 'No swarm has this id.')
  if (found.status === 'done') return problem(409, 'conflict', 'This swarm is done.')
  const row = await provisioned(c.env, found)

  const requested = await Budget.request(c.env, {
    amount: input.amount,
    days: Store.budget.days,
    period: Store.budget.period,
    recipient: row.wallet,
    token: input.token,
  })
  const text = input.note || null
  const budget = identifier()
  await Store.allow(c.env, {
    access_key: requested.authorizeAccessKey.address,
    amount: String(input.amount),
    authorization: JSON.stringify(requested.authorizeAccessKey),
    expires_at: requested.authorizeAccessKey.expiry * 1000,
    id: budget,
    note: text,
    note_id: text ? await Store.noteId(text) : null,
    period: Store.budget.period,
    sealed_key: requested.sealed,
    swarm: id,
    token: input.token,
  })
  return c.json({ authorizeAccessKey: requested.authorizeAccessKey, budget } satisfies BudgetRequested, 201)
})

app.post('/api/swarms/:id/budgets/:budget', async (c) => {
  const id = c.req.param('id')
  const input = await body(c.req.raw, schema.approval)
  if (input instanceof Response) return input
  const [row, allowance] = await Promise.all([Store.find(c.env, id), Store.allowance(c.env, id, c.req.param('budget'))])
  if (!row || !allowance) return problem(404, 'not_found', 'No budget has this id.')
  if (allowance.status !== 'pending') return problem(409, 'conflict', 'This budget is already approved.')

  const approved = await Budget.approve(c.env, JSON.parse(allowance.authorization) as Budget.Request, {
    keyAuthorization: input.keyAuthorization,
    transaction: input.transaction as Hex | undefined,
  })
  if (typeof approved === 'string') return problem(400, 'invalid_request', approved)
  const activated = await Store.approve(c.env, allowance.id, {
    amount: String(approved.limit),
    contributor: approved.contributor,
    key_authorization: JSON.stringify(approved.keyAuthorization),
    published: approved.published,
  })
  if (!activated) return problem(409, 'conflict', 'This budget is already approved.')
  await swarm(c.env, id).budgeted({
    amount: Memo.decimal(approved.limit),
    contributor: approved.contributor,
    note: allowance.note,
    period: allowance.period,
    swarm: id,
    token: allowance.token,
  })

  const [updated, saved] = await Promise.all([Store.find(c.env, id), Store.allowance(c.env, id, allowance.id)])
  return c.json({ budget: Store.view(saved ?? allowance), swarm: Store.summary(updated ?? row) } satisfies Budgeted, 201)
})

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

  const text = input.note || null
  const pledge = identifier()
  await Store.request(c.env, {
    amount: String(input.amount),
    id: pledge,
    note: text,
    note_id: text ? await Store.noteId(text) : null,
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
