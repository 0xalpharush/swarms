import { AsyncLocalStorage } from 'node:async_hooks'
import { render } from '#ssr'
import type { Boot, Face } from '../shared/Boot.ts'
import * as Operations from './Operations.ts'

const store = new AsyncLocalStorage<Boot>()

globalThis.__swarmsServer = { boot: () => store.getStore() }

const listed = new Set(['/', '/join', '/new', '/about', '/docs'])

export function rendered(path: string) {
  return listed.has(path) || /^\/s\/[^/]+\/?$/.test(path)
}

let template: Promise<string> | undefined

function shell(env: Cloudflare.Env, origin: string) {
  const loaded = env.ASSETS.fetch(new Request(`${origin}/index.html`)).then(async (response) => {
    if (!response.ok) throw new Error(`index.html answered ${response.status}`)
    return response.text()
  })
  if (!import.meta.env?.DEV) template ??= loaded.catch((error: unknown) => {
    template = undefined
    throw error
  })
  return template ?? loaded
}

function escape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function json(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function face(cookie: string | null): Face | undefined {
  const raw = /(?:^|;\s*)swarms_face=([^;]+)/.exec(cookie ?? '')?.[1]
  if (!raw) return undefined
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Face
    if (!/^0x[0-9a-fA-F]{40}$/.test(value.address)) return undefined
    const handle = value.account?.handle
    return {
      address: value.address,
      ...(value.account && typeof handle === 'string' && handle.length <= 40 ? { account: { address: value.address, handle, name: typeof value.account.name === 'string' ? value.account.name.slice(0, 40) : null } } : {}),
      ...(typeof value.balance === 'string' && /^\d{1,30}$/.test(value.balance) ? { balance: value.balance } : {}),
    }
  } catch {
    return undefined
  }
}

function zone(cookie: string | null) {
  const raw = /(?:^|;\s*)swarms_tz=([^;]+)/.exec(cookie ?? '')?.[1]
  if (!raw) return undefined
  try {
    const value = decodeURIComponent(raw)
    new Intl.DateTimeFormat('en-GB', { timeZone: value })
    return value
  } catch {
    return undefined
  }
}

function within<T>(work: Promise<T>, ms: number) {
  return Promise.race([work, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]).catch(() => undefined)
}

type Head = { description: string; image: string; player?: string; title: string }

async function gather(env: Cloudflare.Env, url: URL): Promise<{ data: Record<string, unknown>; head: Head; status: number }> {
  const path = url.pathname.replace(/\/$/, '') || '/'
  const head: Head = { description: 'Fund research breakthroughs. Start or back AI research swarms, watch them work live and steer them together.', image: `${url.origin}/xframe-card.jpg`, title: 'Swarms · Fund breakthroughs' }
  const data: Record<string, unknown> = {}
  if (path === '/' || path === '/join' || path === '/new') {
    const list = await within(Operations.list(env, {}), 1500)
    if (list?.ok) data['swarms'] = list.value
    if (path === '/join') head.title = 'Be part of the future · Swarms'
    if (path === '/new') head.title = 'Start a breakthrough · Swarms'
    return { data, head, status: 200 }
  }
  if (path === '/about') return { data, head: { ...head, title: 'About · Swarms' }, status: 200 }
  if (path === '/docs') return { data, head: { ...head, title: 'API and MCP · Swarms' }, status: 200 }
  const id = decodeURIComponent(/^\/s\/([^/]+)$/.exec(path)?.[1] ?? '')
  const detail = await within(Operations.detail(env, { swarm: id }), 2500)
  if (!detail) return { data, head, status: 200 }
  if (!detail.ok) {
    data[`!${id}`] = detail.detail
    return { data, head: { ...head, title: 'Not found · Swarms' }, status: detail.status === 404 ? 404 : 200 }
  }
  data[id] = detail.value
  const room = await within(Operations.room(env, { swarm: id }), 800)
  if (room?.ok) data[`room:${id}`] = room.value
  const latest = detail.value.updates.at(-1)?.text
  return {
    data,
    head: { description: (latest ?? detail.value.goal).replace(/\s+/g, ' ').slice(0, 200), image: head.image, player: `${url.origin}/x/s/${encodeURIComponent(id)}`, title: `${detail.value.title} · Swarms` },
    status: 200,
  }
}

function meta(head: Head, url: URL) {
  const tags = [
    `<meta property="og:title" content="${escape(head.title)}">`,
    `<meta property="og:description" content="${escape(head.description)}">`,
    `<meta property="og:image" content="${escape(head.image)}">`,
    `<meta property="og:url" content="${escape(url.origin + url.pathname)}">`,
    `<meta name="twitter:card" content="${head.player ? 'player' : 'summary_large_image'}">`,
    `<meta name="twitter:title" content="${escape(head.title)}">`,
    `<meta name="twitter:description" content="${escape(head.description)}">`,
    `<meta name="twitter:image" content="${escape(head.image)}">`,
    ...(head.player ? [`<meta name="twitter:player" content="${escape(head.player)}">`, '<meta name="twitter:player:width" content="800">', '<meta name="twitter:player:height" content="450">'] : []),
  ]
  return tags.join('')
}

export async function page(request: Request, env: Cloudflare.Env) {
  const url = new URL(request.url)
  const html = await shell(env, url.origin)
  if (url.searchParams.has('fixture') || url.searchParams.has('scene')) return new Response(html.replace('</head>', '<title>Swarms</title></head>'), { headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' } })
  const [before = '', after = ''] = html.split('<div id="root"></div>')
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const gathering = gather(env, url)
  const top = before.replace(/<title>[^<]*<\/title>/, '').replace('</head>', '§HEAD§</head>')
  const [opening = '', closing = ''] = top.split('§HEAD§')
  void writer.write(encoder.encode(opening))

  const work = (async () => {
    const { data, head, status } = await gathering
    const boot: Boot = { config: Operations.config(env), data, face: face(request.headers.get('cookie')), mobile: /Mobi|Android|iPhone|iPad/i.test(request.headers.get('user-agent') ?? ''), now: Date.now(), url: url.href, zone: zone(request.headers.get('cookie')) }
    await writer.write(encoder.encode(`<title>${escape(head.title)}</title><meta name="description" content="${escape(head.description)}">${meta(head, url)}${closing}<div id="root">`))
    try {
      const stream = await store.run(boot, () => render(request.signal))
      const reader = stream.getReader()
      for (;;) {
        const chunk = await store.run(boot, () => reader.read())
        if (chunk.done) break
        await writer.write(chunk.value)
      }
    } catch (error) {
      console.error('Server render failed', error)
    }
    await writer.write(encoder.encode(`</div><script>window.__SWARMS_BOOT__=${json(boot)}</script>${after}`))
    await writer.close()
    return status
  })()
  work.catch(() => writer.abort().catch(() => {}))
  const status = await Promise.race([gathering.then((value) => value.status), new Promise<number>((resolve) => setTimeout(() => resolve(200), 50))])
  return new Response(readable, { headers: { 'cache-control': 'private, no-cache', 'content-type': 'text/html; charset=utf-8', link: '</fonts/ParadigmSerif-BetaRegular.woff2>; rel=preload; as=font; crossorigin' }, status })
}
