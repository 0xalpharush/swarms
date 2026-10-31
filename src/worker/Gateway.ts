export type Result<value> = { ok: true; value: value } | { detail: string; ok: false; status: number }

export type Report = {
  error?: { message?: string } | string
  ok?: { message?: string }
  request_id: string
  status: string
}

export type Event = {
  event?: {
    event?: { payload?: Record<string, unknown>; type?: string }
    source?: string
    type?: string
    root_session_id?: string
    update?: unknown
  }
  request_id?: string
  seq: number
}

export type Page = { events: Event[]; has_more: boolean; next_cursor: number }

export type Listed = { connected: boolean; name: string } & Record<string, unknown>

export type Hands = { hands: Listed[] }

export type Minted = { command: string; short: string; tab?: string; token: string; url: string }

export type Commit = { date?: string | null; message: string; parents?: string[]; sha: string }

type Init = { app?: string; body?: unknown; key?: string; method?: string }

export function app(swarm: string) {
  return `swarm-${swarm}`
}

async function send<value>(env: Cloudflare.Env, path: string, init: Init = {}): Promise<Result<value>> {
  const headers = new Headers({ accept: 'application/json', authorization: 'Bearer ' + (init.key ?? env.SWARMS_GATEWAY_KEY) })
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.app) headers.set('gateway-app', init.app)

  const response = await fetch(env.GATEWAY_URL + path, {
    body: init.body === undefined ? null : JSON.stringify(init.body),
    headers,
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
  })
  const text = await response.text()
  const parsed = (() => {
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return undefined
    }
  })()
  if (!response.ok)
    return {
      detail: String(parsed?.['detail'] ?? parsed?.['error'] ?? text.slice(0, 300)),
      ok: false,
      status: response.status,
    }

  return { ok: true, value: parsed as value }
}

export function me(env: Cloudflare.Env) {
  return send<{ wallet: `0x${string}` }>(env, '/api/keys/me')
}

export function revoke(env: Cloudflare.Env, key: string) {
  return send<unknown>(env, '/api/keys/revoke', { body: {}, key })
}

export function agent(env: Cloudflare.Env, swarm: string, input: { name: string; payer: { secret: string; url: string } }) {
  return send<{ id: string }>(env, '/v1/agents', {
    app: app(swarm),
    body: { harness: 'codex', name: input.name, payer: input.payer, thinking: 'low' },
  })
}

export function repay(env: Cloudflare.Env, swarm: string, agent: string, payer: { secret: string; url: string }) {
  return send<unknown>(env, `/v1/agents/${agent}`, { app: app(swarm), body: { payer }, method: 'PATCH' })
}

export function prompt(env: Cloudflare.Env, swarm: string, agent: string, input: { prompt: string; steer: boolean }) {
  return send<{ request_id: string; status: string }>(env, `/v1/agents/${agent}/turns`, { app: app(swarm), body: input })
}

export function turn(env: Cloudflare.Env, swarm: string, agent: string, turn: string) {
  return send<Report>(env, `/v1/agents/${agent}/turns/${turn}`, { app: app(swarm) })
}

export function events(env: Cloudflare.Env, swarm: string, agent: string, after: number) {
  return send<Page>(env, `/v1/agents/${agent}/events?after=${after}&limit=128`, { app: app(swarm) })
}

export function sandboxes(env: Cloudflare.Env, swarm: string) {
  return send<{ sandboxes: { hand?: string | null; sandboxId: string; status: string }[] }>(env, '/v1/compute/list', {
    app: app(swarm),
    body: {},
  })
}

export function terminate(env: Cloudflare.Env, swarm: string, sandboxId: string) {
  return send<unknown>(env, '/v1/compute/terminate', { app: app(swarm), body: { sandboxId } })
}

export function stream(env: Cloudflare.Env, swarm: string, agent: string, after: number, signal: AbortSignal) {
  return fetch(`${env.GATEWAY_URL}/v1/agents/${agent}/events?after=${after}&live=1`, {
    headers: { accept: 'text/event-stream', authorization: 'Bearer ' + env.SWARMS_GATEWAY_KEY, 'gateway-app': app(swarm) },
    signal,
  })
}

export function hands(env: Cloudflare.Env, swarm: string) {
  return send<Hands>(env, '/v1/hands', { app: app(swarm) })
}

export function hand(env: Cloudflare.Env, swarm: string, name: string) {
  return send<Minted>(env, `/v1/hands?name=${encodeURIComponent(name)}`, { app: app(swarm), method: 'POST' })
}

export function cap(env: Cloudflare.Env, swarm: string, name: string, usd: string) {
  return send<unknown>(env, `/v1/hands/${encodeURIComponent(name)}`, { app: app(swarm), body: { cap: usd }, method: 'PATCH' })
}

export function detach(env: Cloudflare.Env, swarm: string, name: string) {
  return send<{ disconnected: boolean }>(env, `/v1/hands/${encodeURIComponent(name)}`, { app: app(swarm), method: 'DELETE' })
}

export async function code<value>(env: Cloudflare.Env, owner: string, swarm: string, path: string) {
  const response = await fetch(`${env.GATEWAY_URL}/p/${owner}/${app(swarm)}/git${path}`, { headers: { accept: 'application/json' } })
  return response.ok ? ((await response.json()) as value) : undefined
}
