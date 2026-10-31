import type { BudgetRequested, Budgeted, Config, Contributed, Currency, Detail, Entry, Pledged, Problem, Requested, Summary, Token } from '../shared/Api.ts'
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

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' })
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

export function feed(id: string, after: number) {
  return fixture ? Fixtures.feed(id, after) : request<{ entries: Entry[] }>(`${path(id)}/feed?after=${after}`)
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

export function confirm(id: string, pledge: string, keyAuthorization: unknown) {
  return fixture ? Fixtures.confirm(id, pledge) : request<Pledged>(`${path(id)}/pledges/${encodeURIComponent(pledge)}`, { keyAuthorization })
}
