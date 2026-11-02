import { Handler, Kv } from 'accounts/server'
import type { Address } from 'viem'
import { http } from 'viem'

export const path = '/v1/auth'

export const days = 30

type Stored = { expires_at: number | null; value: string }

function live<value>(row: Stored | null): value | undefined {
  return row && (row.expires_at === null || row.expires_at > Date.now()) ? (JSON.parse(row.value) as value) : undefined
}

export function store(env: Cloudflare.Env) {
  return Kv.from({
    delete: async (key: string) => {
      await env.DB.prepare('delete from sessions where key = ?').bind(key).run()
    },
    get: async <value>(key: string) =>
      live<value>(await env.DB.prepare('select value, expires_at from sessions where key = ?').bind(key).first<Stored>()),
    set: async (key: string, value: unknown, options?: { ttl?: number | undefined }) => {
      const now = Date.now()
      await env.DB.batch([
        env.DB.prepare('delete from sessions where expires_at < ?').bind(now),
        env.DB.prepare('insert or replace into sessions (key, value, expires_at) values (?, ?, ?)').bind(
          key,
          JSON.stringify(value),
          options?.ttl ? now + options.ttl * 1000 : null,
        ),
      ])
    },
    take: async <value>(key: string) =>
      live<value>(await env.DB.prepare('delete from sessions where key = ? returning value, expires_at').bind(key).first<Stored>()),
  })
}

export function auth(env: Cloudflare.Env) {
  return Handler.auth({
    cookie: false,
    origin: env.SWARMS_URL,
    path,
    statement: 'Sign in to Swarms to chat in the rooms of the swarms you back.',
    store: store(env),
    transport: http(env.TEMPO_RPC),
    ttl: { session: days * 86_400 },
  })
}

export async function who(env: Cloudflare.Env, request: Request): Promise<Address | undefined> {
  if (!request.headers.get('authorization')) return undefined
  const session = await auth(env).getSession(request)
  return session ? (session.address.toLowerCase() as Address) : undefined
}

export function holder(env: Cloudflare.Env, token: string) {
  return who(env, new Request(env.SWARMS_URL, { headers: { authorization: `Bearer ${token}` } }))
}
