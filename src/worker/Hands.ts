import type { Lent } from '../shared/Api.ts'

export type Row = { created_at: number; label: string; name: string; swarm: string }

export const limit = 32

export function slug(label: string) {
  const cleaned = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return cleaned || 'hand'
}

function suffix() {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function issue(env: Cloudflare.Env, swarm: string, label: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const name = `${slug(label)}-${suffix()}`
    const result = await env.DB.prepare('insert or ignore into hands (swarm, name, label, created_at) values (?, ?, ?, ?)')
      .bind(swarm, name, label, Date.now())
      .run()
    if (result.meta.changes > 0) return name
  }
  return undefined
}

export async function list(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare('select * from hands where swarm = ? order by created_at desc')
    .bind(swarm)
    .all<Row>()
  return results
}

export async function count(env: Cloudflare.Env, swarm: string) {
  const row = await env.DB.prepare('select count(*) as n from hands where swarm = ?').bind(swarm).first<{ n: number }>()
  return row?.n ?? 0
}

export async function forget(env: Cloudflare.Env, swarm: string, name: string) {
  await env.DB.prepare('delete from hands where swarm = ? and name = ?').bind(swarm, name).run()
}

export function lent(rows: readonly Row[], connected: ReadonlySet<string>): Lent[] {
  return rows.map((row) => ({ at: row.created_at, connected: connected.has(row.name), label: row.label, name: row.name }))
}
