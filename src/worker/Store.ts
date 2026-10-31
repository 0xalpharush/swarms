import type { Answer, Budget, Contribution, Currency, Note, Pledge, Summary, Token } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'

export type Row = {
  answer: string | null
  contributors: number
  created_at: number
  daily: number
  goal: string
  id: string
  machines: number
  pool_left: number
  pool_spent: number
  raised: number
  remaining: number
  rounds: number
  sealed_wallet: string | null
  spent: number
  status: Summary['status']
  title: string
  updated_at: number
  wallet: `0x${string}` | null
  workers: number
}

export type Backing = {
  amount: string
  contributor: `0x${string}`
  created_at: number
  id: string
  note: string | null
  note_id: string | null
  request: string
  sealed_key: string | null
  spent: string
  status: 'pending' | Pledge['status']
  swarm: string
  token: Currency
}

export type Gift = {
  amount: string
  budget: string | null
  contributor: `0x${string}`
  created_at: number
  id: `0x${string}`
  kind: Contribution['kind']
  note: string | null
  note_id: string | null
  swarm: string
  token: Token
}

export type Allowance = {
  access_key: `0x${string}`
  amount: string
  authorization: string
  contributor: `0x${string}` | null
  created_at: number
  detail: string | null
  expires_at: number
  id: string
  key_authorization: string | null
  left_now: string | null
  next_at: number | null
  note: string | null
  note_id: string | null
  period: number
  period_end: number | null
  published: number
  pulled: string
  pulled_at: number | null
  sealed_key: string
  status: 'pending' | 'active' | 'revoked' | 'expired' | 'ended'
  swarm: string
  token: Token
  updated_at: number
}

export type Fields = Partial<
  Pick<Row, 'answer' | 'machines' | 'pool_left' | 'pool_spent' | 'rounds' | 'status' | 'workers'>
>

export type Changes = Partial<
  Pick<
    Allowance,
    'detail' | 'left_now' | 'next_at' | 'period_end' | 'published' | 'pulled' | 'pulled_at' | 'status'
  >
>

export const perWorker = 100_000n

export const reserve = 120_000n

export const minPledge = 250_000n

export const maxParallel = 4

export const stock = reserve + perWorker * BigInt(maxParallel - 1)

export const budget = { days: 30, max: 100_000_000n, min: minPledge, period: 86_400 } as const

const totals = `select s.*,
  coalesce((select sum(cast(amount as integer)) from pledges where swarm = s.id and status != 'pending'), 0)
    + coalesce((select sum(cast(amount as integer)) from contributions where swarm = s.id), 0) as raised,
  coalesce((select sum(cast(spent as integer)) from pledges where swarm = s.id and status != 'pending'), 0) + s.pool_spent as spent,
  coalesce((select sum(max(cast(amount as integer) - cast(spent as integer), 0)) from pledges where swarm = s.id and status = 'active'), 0) + s.pool_left as remaining,
  (select count(*) from (
    select contributor from pledges where swarm = s.id and status != 'pending'
    union select contributor from contributions where swarm = s.id
    union select contributor from budgets where swarm = s.id and status != 'pending'
  )) as contributors,
  coalesce((select sum(cast(amount as integer) * 86400 / period) from budgets where swarm = s.id and status = 'active'), 0) as daily
  from swarms s`

export function parallel(remaining: bigint) {
  return Math.min(maxParallel, Math.max(1, 1 + Number((remaining - reserve) / perWorker)))
}

export function summary(row: Row, current?: bigint): Summary {
  return {
    answer: row.answer ? (JSON.parse(row.answer) as Answer) : null,
    contributors: row.contributors,
    createdAt: row.created_at,
    daily: Memo.decimal(BigInt(row.daily)),
    goal: row.goal,
    id: row.id,
    machines: row.machines,
    parallel: parallel(current ?? BigInt(row.remaining)),
    pool: Memo.decimal(BigInt(row.pool_left)),
    raised: Memo.decimal(BigInt(row.raised)),
    remaining: Memo.decimal(BigInt(row.remaining)),
    rounds: row.rounds,
    spent: Memo.decimal(BigInt(row.spent)),
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    wallet: row.wallet,
    workers: row.workers,
  }
}

export async function list(env: Cloudflare.Env, status?: Summary['status']) {
  const { results } = await env.DB.prepare(
    `select * from (${totals}) where (raised > 0 or daily > 0)${status ? ' and status = ?' : ''} order by updated_at desc limit 100`,
  )
    .bind(...(status ? [status] : []))
    .all<Row>()
  return results
}

export async function exists(env: Cloudflare.Env, id: string) {
  return (await env.DB.prepare('select 1 from swarms where id = ?').bind(id).first()) !== null
}

export async function find(env: Cloudflare.Env, id: string) {
  return env.DB.prepare(totals + ' where s.id = ?')
    .bind(id)
    .first<Row>()
}

export async function insert(
  env: Cloudflare.Env,
  input: Pick<Row, 'goal' | 'id' | 'title'> & { sealed_wallet: string; wallet: string },
) {
  const now = Date.now()
  await env.DB.prepare(
    'insert into swarms (id, title, goal, wallet, sealed_wallet, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(input.id, input.title, input.goal, input.wallet, input.sealed_wallet, now, now)
    .run()
}

export async function provision(env: Cloudflare.Env, id: string, input: { sealed_wallet: string; wallet: string }) {
  await env.DB.prepare('update swarms set wallet = ?, sealed_wallet = ? where id = ? and wallet is null')
    .bind(input.wallet, input.sealed_wallet, id)
    .run()
}

export async function update(env: Cloudflare.Env, id: string, fields: Fields) {
  const entries = Object.entries(fields)
  await env.DB.prepare(
    `update swarms set ${entries.map(([name]) => name + ' = ?, ').join('')}updated_at = ? where id = ?`,
  )
    .bind(...entries.map(([, value]) => value), Date.now(), id)
    .run()
}

export async function request(
  env: Cloudflare.Env,
  input: Pick<Backing, 'amount' | 'id' | 'note' | 'note_id' | 'request' | 'swarm' | 'token'>,
) {
  const now = Date.now()
  await env.DB.prepare(
    'insert into pledges (id, swarm, request, amount, token, note, note_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(input.id, input.swarm, input.request, input.amount, input.token, input.note, input.note_id, now, now)
    .run()
}

export async function backing(env: Cloudflare.Env, swarm: string, id: string) {
  return env.DB.prepare('select * from pledges where swarm = ? and id = ?').bind(swarm, id).first<Backing>()
}

export async function activate(
  env: Cloudflare.Env,
  id: string,
  input: { contributor: string; sealed_key: string },
) {
  const result = await env.DB.prepare(
    "update pledges set contributor = ?, sealed_key = ?, status = 'active', updated_at = ? where id = ? and status = 'pending'",
  )
    .bind(input.contributor.toLowerCase(), input.sealed_key, Date.now(), id)
    .run()
  return result.meta.changes > 0
}

export async function forget(env: Cloudflare.Env, id: string) {
  await env.DB.prepare("delete from pledges where id = ? and status = 'pending'").bind(id).run()
}

export async function spend(env: Cloudflare.Env, id: string, spent: bigint, status?: Pledge['status']) {
  await env.DB.prepare(
    'update pledges set spent = ?, status = coalesce(?, status), updated_at = ? where id = ?',
  )
    .bind(String(spent), status ?? null, Date.now(), id)
    .run()
}

export async function active(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare(
    "select * from pledges where swarm = ? and status = 'active' order by cast(amount as integer) - cast(spent as integer) desc, created_at",
  )
    .bind(swarm)
    .all<Backing>()
  return results
}

export async function pledges(env: Cloudflare.Env, swarm: string): Promise<Pledge[]> {
  const { results } = await env.DB.prepare(
    "select * from pledges where swarm = ? and status != 'pending' order by created_at desc limit 200",
  )
    .bind(swarm)
    .all<Backing>()
  return results.map((row) => ({
    amount: Memo.decimal(BigInt(row.amount)),
    at: row.created_at,
    contributor: row.contributor,
    id: row.id,
    note: row.note,
    spent: Memo.decimal(BigInt(row.spent)),
    status: row.status === 'pending' ? 'active' : row.status,
    token: row.token,
  }))
}

export async function give(env: Cloudflare.Env, input: Omit<Gift, 'created_at'>) {
  const result = await env.DB.prepare(
    'insert or ignore into contributions (id, swarm, kind, budget, contributor, token, amount, note, note_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      input.id.toLowerCase(),
      input.swarm,
      input.kind,
      input.budget,
      input.contributor.toLowerCase(),
      input.token,
      input.amount,
      input.note,
      input.note_id,
      Date.now(),
    )
    .run()
  return result.meta.changes > 0
}

export async function gift(env: Cloudflare.Env, id: string) {
  return env.DB.prepare('select * from contributions where id = ?').bind(id.toLowerCase()).first<Gift>()
}

export async function annotate(env: Cloudflare.Env, id: string, input: { note: string; note_id: string }) {
  const result = await env.DB.prepare(
    "update contributions set note = ?, note_id = ? where id = ? and kind = 'transfer' and note is null",
  )
    .bind(input.note, input.note_id, id.toLowerCase())
    .run()
  return result.meta.changes > 0
}

export function contribution(row: Gift): Contribution {
  return {
    amount: Memo.decimal(BigInt(row.amount)),
    at: row.created_at,
    budget: row.budget,
    contributor: row.contributor,
    hash: row.id,
    kind: row.kind,
    note: row.note,
    token: row.token,
  }
}

export async function contributions(env: Cloudflare.Env, swarm: string): Promise<Contribution[]> {
  const { results } = await env.DB.prepare(
    'select * from contributions where swarm = ? order by created_at desc limit 200',
  )
    .bind(swarm)
    .all<Gift>()
  return results.map(contribution)
}

export async function shares(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare(
    'select contributor, sum(cast(amount as integer)) as amount from contributions where swarm = ? group by contributor order by amount desc',
  )
    .bind(swarm)
    .all<{ amount: number; contributor: `0x${string}` }>()
  return results.map((row) => ({ amount: BigInt(row.amount), contributor: row.contributor }))
}

export async function allow(
  env: Cloudflare.Env,
  input: Pick<
    Allowance,
    'access_key' | 'amount' | 'authorization' | 'expires_at' | 'id' | 'note' | 'note_id' | 'period' | 'sealed_key' | 'swarm' | 'token'
  >,
) {
  const now = Date.now()
  await env.DB.prepare(
    'insert into budgets (id, swarm, token, amount, period, expires_at, access_key, sealed_key, authorization, note, note_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      input.id,
      input.swarm,
      input.token,
      input.amount,
      input.period,
      input.expires_at,
      input.access_key,
      input.sealed_key,
      input.authorization,
      input.note,
      input.note_id,
      now,
      now,
    )
    .run()
}

export async function allowance(env: Cloudflare.Env, swarm: string, id: string) {
  return env.DB.prepare('select * from budgets where swarm = ? and id = ?').bind(swarm, id).first<Allowance>()
}

export async function approve(
  env: Cloudflare.Env,
  id: string,
  input: { amount: string; contributor: string; key_authorization: string; published: boolean },
) {
  const result = await env.DB.prepare(
    "update budgets set amount = ?, contributor = ?, key_authorization = ?, published = ?, left_now = ?, status = 'active', updated_at = ? where id = ? and status = 'pending'",
  )
    .bind(
      input.amount,
      input.contributor.toLowerCase(),
      input.key_authorization,
      input.published ? 1 : 0,
      input.amount,
      Date.now(),
      id,
    )
    .run()
  return result.meta.changes > 0
}

export async function change(env: Cloudflare.Env, id: string, changes: Changes) {
  const entries = Object.entries(changes)
  await env.DB.prepare(
    `update budgets set ${entries.map(([name]) => name + ' = ?, ').join('')}updated_at = ? where id = ?`,
  )
    .bind(...entries.map(([, value]) => value), Date.now(), id)
    .run()
}

export async function allowances(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare(
    "select * from budgets where swarm = ? and status = 'active' order by coalesce(pulled_at, 0), created_at",
  )
    .bind(swarm)
    .all<Allowance>()
  return results
}

export async function end(env: Cloudflare.Env, swarm: string) {
  await env.DB.prepare(
    "update budgets set status = 'ended', next_at = null, updated_at = ? where swarm = ? and status = 'active'",
  )
    .bind(Date.now(), swarm)
    .run()
}

export function view(row: Allowance, now = Date.now()): Budget {
  return {
    amount: Memo.decimal(BigInt(row.amount)),
    at: row.created_at,
    contributor: row.contributor,
    detail: row.detail,
    expiresAt: row.expires_at,
    id: row.id,
    left: row.left_now === null ? null : Memo.decimal(BigInt(row.left_now)),
    nextAt: row.next_at,
    note: row.note,
    period: row.period,
    pulled: Memo.decimal(BigInt(row.pulled)),
    status:
      row.status === 'pending'
        ? 'active'
        : row.status === 'active' && row.expires_at <= now
          ? 'expired'
          : row.status === 'active' && row.next_at !== null && row.next_at > now
            ? 'waiting'
            : row.status,
    token: row.token,
  }
}

export async function budgets(env: Cloudflare.Env, swarm: string): Promise<Budget[]> {
  const { results } = await env.DB.prepare(
    "select * from budgets where swarm = ? and status != 'pending' order by created_at desc limit 200",
  )
    .bind(swarm)
    .all<Allowance>()
  const now = Date.now()
  return results.map((row) => view(row, now))
}

export async function notes(
  env: Cloudflare.Env,
  swarm: string,
  raised: bigint,
  steered: ReadonlySet<string>,
): Promise<Note[]> {
  const { results } = await env.DB.prepare(
    `select note_id as id, min(note) as note, sum(weight) as weight, count(distinct contributor) as backers from (
      select note_id, note, cast(amount as integer) as weight, contributor from pledges where swarm = ?1 and status != 'pending' and note_id is not null
      union all
      select note_id, note, cast(amount as integer) as weight, contributor from contributions where swarm = ?1 and note_id is not null
    ) group by note_id order by weight desc limit 50`,
  )
    .bind(swarm)
    .all<{ backers: number; id: string; note: string; weight: number }>()
  return results.map((row) => ({
    backers: row.backers,
    id: row.id,
    note: row.note,
    share: raised > 0n ? Number((BigInt(row.weight) * 10_000n) / raised) / 10_000 : 0,
    steered: steered.has(row.id),
    weight: Memo.decimal(BigInt(row.weight)),
  }))
}

export async function noteId(note: string) {
  const normalized = note.trim().toLowerCase().replace(/\s+/g, ' ')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
