import { waitUntil } from 'cloudflare:workers'

export async function cached<T>(env: Cloudflare.Env, key: string, seconds: number, read: () => Promise<T>): Promise<T> {
  const request = new Request(new URL(`/__cache/${key}`, env.SWARMS_URL))
  const hit = await caches.default.match(request).catch(() => undefined)
  if (hit) return hit.json() as Promise<T>
  const value = await read()
  waitUntil(caches.default.put(request, Response.json(value, { headers: { 'cache-control': `public, max-age=${seconds}` } })).catch(() => undefined))
  return value
}
