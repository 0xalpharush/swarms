import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Config } from '../shared/Api.ts'
import * as Api from './api.ts'
import * as Wallet from './wallet.ts'

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useConfig() {
  const [config, setConfig] = useState<Config>()
  useEffect(() => {
    let alive = true
    const load = () => {
      Api.config().then(
        (value) => {
          if (!alive) return
          setConfig(value)
          void Wallet.restore(value).catch(() => {})
        },
        () => {
          if (alive) setTimeout(load, 3000)
        },
      )
    }
    load()
    return () => {
      alive = false
    }
  }, [])
  return config
}

export function usePoll<T>(load: () => Promise<T>, ms: number, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({})
  const [version, setVersion] = useState(0)
  const current = useRef(load)

  useEffect(() => {
    current.current = load
  })

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const data = await current.current()
        if (alive) setState({ data })
      } catch (error) {
        if (alive) setState((previous) => ({ ...previous, error: message(error) }))
      }
      if (alive) timer = setTimeout(() => void run(), ms)
    }
    void run()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [key, ms, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return [state, reload] as const
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

export function useMedia(query: string) {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query)
      list.addEventListener('change', listener)
      return () => list.removeEventListener('change', listener)
    },
    () => matchMedia(query).matches,
  )
}

export function useWallet() {
  return useSyncExternalStore(Wallet.subscribe, Wallet.snapshot, Wallet.snapshot)
}

export function usePresence<T>(items: readonly T[], key: (item: T) => string, ms = 700) {
  const [gone, setGone] = useState<{ at: number; item: T }[]>([])
  const previous = useRef<readonly T[]>(items)

  useEffect(() => {
    const keys = new Set(items.map(key))
    const left = previous.current.filter((item) => !keys.has(key(item)))
    previous.current = items
    if (left.length === 0) return
    const now = Date.now()
    setGone((list) => [...list.filter((entry) => !keys.has(key(entry.item))), ...left.map((item) => ({ at: now, item }))])
  }, [items, key])

  useEffect(() => {
    if (gone.length === 0) return
    const timer = setTimeout(() => setGone((list) => list.filter((entry) => Date.now() - entry.at < ms)), ms)
    return () => clearTimeout(timer)
  }, [gone, ms])

  const keys = new Set(items.map(key))
  return [...items.map((item) => ({ item, leaving: false })), ...gone.filter((entry) => !keys.has(key(entry.item))).map((entry) => ({ item: entry.item, leaving: true }))]
}
