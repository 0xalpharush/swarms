import type { Device } from '../shared/Api.ts'

type Row = {
  expires_at: number
  interval: number
  user_code: string
  verification_uri: string
  verification_uri_full: string
}

export async function save(env: Cloudflare.Env, pledge: string, device: Device) {
  await env.DB.prepare(
    'insert into pledge_devices (pledge, user_code, verification_uri, verification_uri_full, interval, expires_at) values (?, ?, ?, ?, ?, ?)',
  )
    .bind(pledge, device.userCode, device.verificationUri, device.verificationUriFull, device.interval, device.expiresAt)
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
