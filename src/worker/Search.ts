import type { Hit, Round, Status } from '../shared/Api.ts'

type Row = { at: number | null; kind: Hit['kind']; ref: string; snippet: string; status: Status; swarm: string; title: string }

const stop = new Set(
  'a about after all an and any are as at be been by can could did do does for from get got had has have how i if in into is it its me my no not of on or our should so than that the their them then there these they this those to us was we were what when where which who whom why will with would you your'.split(
    ' ',
  ),
)

export function terms(query: string) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
  const kept = words.filter((word) => !stop.has(word))
  return (kept.length ? kept : words).slice(0, 12)
}

export async function query(
  env: Cloudflare.Env,
  input: { kind: Hit['kind'] | undefined; limit: number; swarm: string | undefined; terms: string[] },
): Promise<Hit[]> {
  const filters = [...(input.swarm ? ['search.swarm = ?'] : []), ...(input.kind ? ['search.kind = ?'] : [])]
  const { results } = await env.DB.prepare(
    `select search.swarm as swarm, search.kind as kind, search.ref as ref,
      snippet(search, 4, '«', '»', '…', 40) as snippet, s.title as title, s.status as status, r.ended_at as at
    from search
    join swarms s on s.id = search.swarm
    left join reports r on search.kind = 'report' and r.swarm = search.swarm and r.round = cast(search.ref as integer)
    where search match ? and (exists (select 1 from pledges p where p.swarm = s.id and p.status != 'pending')
      or exists (select 1 from contributions c where c.swarm = s.id)
      or exists (select 1 from budgets b where b.swarm = s.id and b.status = 'active'))${filters.map((filter) => ' and ' + filter).join('')}
    order by bm25(search, 0, 0, 0, 2, 1) limit ?`,
  )
    .bind(
      input.terms.map((term) => `"${term}"`).join(' OR '),
      ...(input.swarm ? [input.swarm] : []),
      ...(input.kind ? [input.kind] : []),
      input.limit,
    )
    .all<Row>()
  return results.map((row) => ({
    at: row.at,
    entry: null,
    kind: row.kind,
    round: row.kind === 'report' ? Number(row.ref) : null,
    snippet: row.snippet,
    swarm: { id: row.swarm, status: row.status, title: row.title },
  }))
}

export async function swarm(env: Cloudflare.Env, input: { goal: string; id: string; title: string }) {
  await env.DB.prepare("insert into search (swarm, kind, ref, title, body) values (?, 'swarm', '', ?, ?)")
    .bind(input.id, input.title, input.goal)
    .run()
}

export async function note(env: Cloudflare.Env, swarm: string, id: string, note: string) {
  await env.DB.batch([
    env.DB.prepare("delete from search where swarm = ? and kind = 'note' and ref = ?").bind(swarm, id),
    env.DB.prepare("insert into search (swarm, kind, ref, title, body) values (?, 'note', ?, '', ?)").bind(swarm, id, note),
  ])
}

export async function report(env: Cloudflare.Env, swarm: string, round: Round) {
  if (round.endedAt !== null) await env.DB.batch(statements(env, swarm, round))
}

export async function sync(env: Cloudflare.Env, swarm: string, rounds: readonly Round[]) {
  const ended = rounds.filter((round) => round.endedAt !== null)
  if (!ended.length) return

  const { results } = await env.DB.prepare('select round, ended_at from reports where swarm = ?')
    .bind(swarm)
    .all<{ ended_at: number; round: number }>()
  const known = new Map(results.map((row) => [row.round, row.ended_at]))
  const missing = ended.filter((round) => known.get(round.n) !== round.endedAt)
  if (missing.length) await env.DB.batch(missing.flatMap((round) => statements(env, swarm, round)))
}

export async function lagging(env: Cloudflare.Env) {
  const { results } = await env.DB.prepare(
    "select id from swarms s where rounds > (select count(*) from reports r where r.swarm = s.id) + (status = 'running') order by updated_at desc limit 5",
  ).all<{ id: string }>()
  return results.map((row) => row.id)
}

function statements(env: Cloudflare.Env, swarm: string, round: Round) {
  return [
    env.DB.prepare(
      'insert into reports (swarm, round, status, message, started_at, ended_at, spent) values (?, ?, ?, ?, ?, ?, ?) on conflict (swarm, round) do update set status = excluded.status, message = excluded.message, started_at = excluded.started_at, ended_at = excluded.ended_at, spent = excluded.spent',
    ).bind(swarm, round.n, round.status, round.message, round.startedAt, round.endedAt, round.spent),
    env.DB.prepare("delete from search where swarm = ? and kind = 'report' and ref = ?").bind(swarm, String(round.n)),
    ...(round.message
      ? [
          env.DB.prepare("insert into search (swarm, kind, ref, title, body) values (?, 'report', ?, '', ?)").bind(
            swarm,
            String(round.n),
            round.message,
          ),
        ]
      : []),
  ]
}
