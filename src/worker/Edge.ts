import { waitUntil } from 'cloudflare:workers'

const memory = new Map<string, { at: number; value: unknown }>()

const refreshing = new Map<string, Promise<unknown>>()

export async function cached<T>(env: Cloudflare.Env, key: string, seconds: number, read: () => Promise<T>, stale = seconds * 3): Promise<T> {
  const now = Date.now()
  const local = memory.get(key)
  if (local && now - local.at < seconds * 1000) return local.value as T
  const request = new Request(new URL(`/__cache/${key}`, env.SWARMS_URL))
  const kept = local ?? (await shared(request))
  if (kept && now - kept.at < seconds * 1000) {
    memory.set(key, kept)
    return kept.value as T
  }
  if (kept && now - kept.at < stale * 1000) {
    memory.set(key, kept)
    waitUntil(refresh(key, request, stale, read).catch(() => undefined))
    return kept.value as T
  }
  return (await refresh(key, request, stale, read)) as T
}

export function tag(kind: string, request: Request, version: string, salt = '') {
  const url = new URL(request.url)
  let hash = 0x811c9dc5
  for (const char of `${url.pathname}${url.search}|${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return `W/"${kind}${(hash >>> 0).toString(36)}.${version}"`
}

export function asked(request: Request, kind: string) {
  return (request.headers.get('if-none-match') ?? '').includes(`W/"${kind}`)
}

export function matches(request: Request, tag: string) {
  return (request.headers.get('if-none-match') ?? '').split(',').some((given) => given.trim() === tag)
}

export function unchanged(tag: string) {
  return new Response(null, { headers: { 'cache-control': 'no-cache', etag: tag }, status: 304 })
}

export function tagged(response: Response, tag: string | undefined) {
  if (!tag || response.status !== 200) return response
  response.headers.set('etag', tag)
  response.headers.set('cache-control', 'no-cache')
  return response
}

export function minute() {
  return String(Math.floor(Date.now() / 60_000))
}

async function shared(request: Request) {
  const hit = await caches.default.match(request).catch(() => undefined)
  if (!hit) return undefined
  return { at: Number(hit.headers.get('x-cached-at') ?? 0), value: await hit.json() }
}

function refresh<T>(key: string, request: Request, stale: number, read: () => Promise<T>) {
  const running = refreshing.get(key)
  if (running) return running as Promise<T>
  const task = read()
    .then((value) => {
      const at = Date.now()
      memory.set(key, { at, value })
      waitUntil(
        caches.default
          .put(request, Response.json(value, { headers: { 'cache-control': `public, max-age=${stale}`, 'x-cached-at': String(at) } }))
          .catch(() => undefined),
      )
      return value
    })
    .finally(() => refreshing.delete(key))
  refreshing.set(key, task)
  return task
}
