import type { BudgetRequested, Budgeted, Chatter, Config, Contributed, Currency, Detail, Entry, Issued, Lent, Live, Pledged, Posted, Problem, Requested, Room, Summary, Token } from '../shared/Api.ts'
import * as Fixtures from './fixtures.ts'

export const fixture = new URLSearchParams(location.search).has('fixture')

export class Failure extends Error {
  readonly code: string
  readonly status: number
  constructor(problem: Partial<Problem>, status: number) {
    super(problem.detail ?? `The server answered ${status}.`)
    this.code = problem.code ?? 'unknown'
    this.status = status
  }
}

let loaded: Promise<Config> | undefined

let bearer: string | undefined

export function authorize(token: string | undefined) {
  bearer = token
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : {}
  const response = await fetch(path, body === undefined ? { headers } : { body: JSON.stringify(body), headers: { ...headers, 'content-type': 'application/json' }, method: 'POST' })
  const data: unknown = await response.json().catch(() => undefined)
  if (response.ok) return data as T
  throw new Failure((data ?? {}) as Partial<Problem>, response.status)
}

function path(id: string) {
  return `/api/swarms/${encodeURIComponent(id)}`
}

export function config() {
  loaded ??= fixture ? Fixtures.config() : request<Config>('/api/config')
  loaded.catch(() => {
    loaded = undefined
  })
  return loaded
}

export function swarms() {
  return fixture ? Fixtures.swarms() : request<{ swarms: Summary[] }>('/api/swarms')
}

export function swarm(id: string) {
  return fixture ? Fixtures.swarm(id) : request<Detail>(path(id))
}

export function feed(id: string, after: number, filter: { round?: number; who?: string } = {}) {
  const query = new URLSearchParams({ after: String(after) })
  if (filter.round !== undefined) query.set('round', String(filter.round))
  if (filter.who !== undefined) query.set('who', filter.who)
  return fixture ? Fixtures.feed(id, after, filter) : request<{ entries: Entry[]; next: number }>(`${path(id)}/feed?${query}`)
}

export function live(id: string, listener: (event: Live) => void) {
  if (fixture) return Fixtures.live(id, listener)
  let alive = true
  let source: EventSource | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const again = (ms: number) => {
    source?.close()
    if (alive) timer = setTimeout(open, ms)
  }
  const open = () => {
    source = new EventSource(`${path(id)}/live`)
    source.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as Live
      listener(event)
      if (event.type === 'end' || event.type === 'idle') again(event.type === 'end' ? 1500 : 4000)
    }
    source.onerror = () => {
      listener({ type: 'idle' })
      again(3000)
    }
  }
  open()
  return () => {
    alive = false
    source?.close()
    clearTimeout(timer)
  }
}

export function create(input: { goal: string; title: string }) {
  return fixture ? Fixtures.create(input) : request<Summary>('/api/swarms', input)
}

export function pledge(id: string, input: { amount: string; note?: string; token: Currency }) {
  return fixture ? Fixtures.pledge(id, input) : request<Requested>(`${path(id)}/pledges`, input)
}

export function contribute(id: string, input: { hash: string; note?: string }) {
  return fixture ? Fixtures.contribute(id, input) : request<Contributed>(`${path(id)}/contributions`, input)
}

export function budget(id: string, input: { amount: string; note?: string; token: Token }) {
  return fixture ? Fixtures.budget(id, input) : request<BudgetRequested>(`${path(id)}/budgets`, input)
}

export function allow(id: string, budget: string, keyAuthorization: unknown) {
  return fixture ? Fixtures.allow(id, budget) : request<Budgeted>(`${path(id)}/budgets/${encodeURIComponent(budget)}`, { keyAuthorization })
}

export function hands(id: string) {
  return fixture ? Promise.resolve({ hands: [] as Lent[] }) : request<{ hands: Lent[] }>(`${path(id)}/hands`)
}

export function hand(id: string, label: string) {
  return fixture
    ? Promise.reject(new Failure({ detail: 'Hands need the live site.' }, 503))
    : request<Issued>(`${path(id)}/hands`, label ? { label } : {})
}

export function room(id: string, query: { after?: number; before?: number } = {}) {
  const search = new URLSearchParams()
  if (query.after) search.set('after', String(query.after))
  if (query.before) search.set('before', String(query.before))
  return fixture ? Fixtures.room(id, query, bearer ? Fixtures.visitor : undefined) : request<Room>(`${path(id)}/chat?${search}`)
}

export function say(id: string, input: { steer?: string; text: string }) {
  return fixture ? Fixtures.say(id, input, bearer ? Fixtures.visitor : undefined) : request<Posted>(`${path(id)}/chat`, input)
}

export type Line = { close: () => void; hello: () => void; typing: () => void }

export function chatter(id: string, listener: (event: Chatter | { type: 'open' | 'closed' }) => void): Line {
  if (fixture) return Fixtures.chatter(id, listener)
  let alive = true
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  const send = (data: string) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(data)
  }
  const hello = () => send(JSON.stringify({ token: bearer ?? '', type: 'hello' }))
  const open = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path(id)}/chat/live`)
    socket.onopen = () => {
      if (bearer) hello()
      listener({ type: 'open' })
      ping = setInterval(() => send('ping'), 30_000)
    }
    socket.onmessage = (message) => {
      if (message.data !== 'pong') listener(JSON.parse(String(message.data)) as Chatter)
    }
    socket.onclose = () => {
      clearInterval(ping)
      listener({ type: 'closed' })
      if (alive) timer = setTimeout(open, 3000)
    }
  }
  open()
  return {
    close: () => {
      alive = false
      clearTimeout(timer)
      clearInterval(ping)
      socket?.close()
    },
    hello,
    typing: () => send('{"type":"typing"}'),
  }
}

export function confirm(id: string, pledge: string, keyAuthorization: unknown) {
  return fixture ? Fixtures.confirm(id, pledge) : request<Pledged>(`${path(id)}/pledges/${encodeURIComponent(pledge)}`, { keyAuthorization })
}
