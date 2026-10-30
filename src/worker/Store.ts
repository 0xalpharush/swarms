import type { Answer, Note, Pledge, Summary } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'

export type Row = {
  answer: string | null
  contributors: number
  created_at: number
  goal: string
  id: string
  machines: number
  raised: number
  remaining: number
  rounds: number
  spent: number
  status: Summary['status']
  title: string
  updated_at: number
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
}

export type Fields = Partial<Pick<Row, 'answer' | 'machines' | 'rounds' | 'status' | 'workers'>>

export const perWorker = 100_000n

export const reserve = 120_000n

export const minPledge = 250_000n

export const maxParallel = 4

const totals = `select s.*,
  coalesce((select sum(cast(amount as integer)) from pledges where swarm = s.id and status != 'pending'), 0) as raised,
  coalesce((select sum(cast(spent as integer)) from pledges where swarm = s.id and status != 'pending'), 0) as spent,
  coalesce((select sum(max(cast(amount as integer) - cast(spent as integer), 0)) from pledges where swarm = s.id and status = 'active'), 0) as remaining,
  (select count(distinct contributor) from pledges where swarm = s.id and status != 'pending') as contributors
  from swarms s`

export function parallel(remaining: bigint) {
  return Math.min(maxParallel, Math.max(1, 1 + Number((remaining - reserve) / perWorker)))
}

export function summary(row: Row, current?: bigint): Summary {
  return {
    answer: row.answer ? (JSON.parse(row.answer) as Answer) : null,
    contributors: row.contributors,
    createdAt: row.created_at,
    goal: row.goal,
    id: row.id,
    machines: row.machines,
    parallel: parallel(current ?? BigInt(row.remaining)),
    raised: Memo.decimal(BigInt(row.raised)),
    remaining: Memo.decimal(BigInt(row.remaining)),
    rounds: row.rounds,
    spent: Memo.decimal(BigInt(row.spent)),
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    workers: row.workers,
  }
}

export async function list(env: Cloudflare.Env) {
  const { results } = await env.DB.prepare(
    `select * from (${totals}) where raised > 0 order by updated_at desc limit 100`,
  ).all<Row>()
  return results
}

export async function find(env: Cloudflare.Env, id: string) {
  return env.DB.prepare(totals + ' where s.id = ?')
    .bind(id)
    .first<Row>()
}

export async function insert(env: Cloudflare.Env, input: Pick<Row, 'goal' | 'id' | 'title'>) {
  const now = Date.now()
  await env.DB.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, ?, ?)')
    .bind(input.id, input.title, input.goal, now, now)
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
  input: Pick<Backing, 'amount' | 'id' | 'note' | 'note_id' | 'request' | 'swarm'>,
) {
  const now = Date.now()
  await env.DB.prepare(
    'insert into pledges (id, swarm, request, amount, note, note_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(input.id, input.swarm, input.request, input.amount, input.note, input.note_id, now, now)
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
  }))
}

export async function notes(
  env: Cloudflare.Env,
  swarm: string,
  raised: bigint,
  steered: ReadonlySet<string>,
): Promise<Note[]> {
  const { results } = await env.DB.prepare(
    "select note_id as id, min(note) as note, sum(cast(amount as integer)) as weight, count(distinct contributor) as backers from pledges where swarm = ? and status != 'pending' and note_id is not null group by note_id order by weight desc limit 50",
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
