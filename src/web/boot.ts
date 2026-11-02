import type { Boot } from '../shared/Boot.ts'

export type { Boot, Face } from '../shared/Boot.ts'

export const server = typeof window === 'undefined'

export function boot(): Boot | undefined {
  return server ? globalThis.__swarmsServer?.boot() : globalThis.__SWARMS_BOOT__
}

export function here(): URL {
  return server ? new URL(boot()?.url ?? 'http://localhost/') : new URL(location.href)
}

export function seeded<T>(key: string): T | undefined {
  return boot()?.data[key] as T | undefined
}

export const faceCookie = 'swarms_face'
