import { Base64 } from 'ox'
import type { Device } from '../shared/Api.ts'

type Row = {
  code_verifier: string | null
  device_code: string | null
  expires_at: number
  interval: number
  user_code: string
  verification_uri: string
  verification_uri_full: string
}

export type Registered = Device & { code: string; verifier: string }

export type Polled = { status: 'pending' } | { keyAuthorization: unknown; status: 'approved' } | { detail: string; status: 'denied' | 'expired' | 'failed' }

const endpoint = 'https://wallet.tempo.xyz/api/auth/device'

export async function register(authorizeAccessKey: unknown, chainId: number, origin: string): Promise<Registered | null> {
  const verifier = Base64.fromBytes(crypto.getRandomValues(new Uint8Array(32)), { pad: false, url: true })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const response = await fetch(endpoint + '/register', {
    body: JSON.stringify({
      code_challenge: Base64.fromBytes(new Uint8Array(digest), { pad: false, url: true }),
      code_challenge_method: 'S256',
      message: {
        payload: [{ id: 0, jsonrpc: '2.0', method: 'wallet_connect', params: [{ capabilities: { authorizeAccessKey }, chainId }] }],
        type: 'rpc-requests',
      },
      meta: { name: 'Swarms', website_url: origin },
    }),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) return null
  const body = (await response.json()) as {
    device_code: string
    expires_in: number
    interval: number
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
  }
  return {
    code: body.device_code,
    expiresAt: Date.now() + body.expires_in * 1000,
    interval: body.interval,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriFull: body.verification_uri_complete ?? body.verification_uri,
    verifier,
  }
}

export async function poll(env: Cloudflare.Env, pledge: string): Promise<Polled> {
  const row = await env.DB.prepare('select * from pledge_devices where pledge = ?').bind(pledge).first<Row>()
  if (!row?.device_code || !row.code_verifier) return { detail: 'This pledge has no Tempo Wallet request.', status: 'failed' }
  const response = await fetch(endpoint + '/token', {
    body: JSON.stringify({ code_verifier: row.code_verifier, device_code: row.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: string
    payload?: readonly { error?: { message?: string }; result?: { accounts?: readonly { capabilities?: { keyAuthorization?: unknown } }[] } }[]
  }
  if (response.status === 400 && (body.error === 'authorization_pending' || body.error === 'slow_down')) return { status: 'pending' }
  if (response.status === 400 && body.error === 'access_denied') return { detail: 'The pledge was declined in Tempo Wallet.', status: 'denied' }
  if (response.status === 400 && body.error === 'expired_token') return { detail: 'The Tempo Wallet request expired.', status: 'expired' }
  const answer = body.payload?.[0]
  const keyAuthorization = answer?.result?.accounts?.[0]?.capabilities?.keyAuthorization
  if (response.status !== 200 || !keyAuthorization)
    return { detail: answer?.error?.message ?? 'Tempo Wallet returned no key authorization.', status: 'failed' }
  return { keyAuthorization, status: 'approved' }
}

export async function save(env: Cloudflare.Env, pledge: string, device: Registered) {
  await env.DB.prepare(
    'insert into pledge_devices (pledge, user_code, verification_uri, verification_uri_full, interval, expires_at, device_code, code_verifier) values (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(pledge, device.userCode, device.verificationUri, device.verificationUriFull, device.interval, device.expiresAt, device.code, device.verifier)
    .run()
}

export async function find(env: Cloudflare.Env, pledge: string): Promise<Device | null> {
  const row = await env.DB.prepare('select * from pledge_devices where pledge = ?').bind(pledge).first<Row>()
  return row
    ? {
        expiresAt: row.expires_at,
        interval: row.interval,
        userCode: row.user_code,
        verificationUri: row.verification_uri,
        verificationUriFull: row.verification_uri_full,
      }
    : null
}

export async function forget(env: Cloudflare.Env, pledge: string) {
  await env.DB.prepare('delete from pledge_devices where pledge = ?').bind(pledge).run()
}
