import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Config, Entry, Live, Researcher } from '../shared/Api.ts'
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

export type Draft = { items: { id: string; text: string }[]; round: number; thinking: string }

function apply(draft: Draft | undefined, event: Live): Draft | undefined {
  if (event.type === 'round') return draft?.round === event.round ? draft : { items: [], round: event.round, thinking: '' }
  if (!draft) return draft
  if (event.type === 'thinking') return { ...draft, thinking: (draft.thinking + event.delta).slice(-2000) }
  if (event.type !== 'text' && event.type !== 'message') return draft

  const found = draft.items.find((item) => item.id === event.item)
  const before = found?.text ?? ''
  const text =
    event.type === 'message' ? event.text : event.offset === null ? before + event.delta : before.slice(0, event.offset) + event.delta
  const items = found
    ? draft.items.map((item) => (item === found ? { id: item.id, text } : item))
    : [...draft.items, { id: event.item, text }]
  return { ...draft, items, thinking: event.type === 'text' ? '' : draft.thinking }
}

export type Stream = { input: string; inputItem: string; text: string; textItem: string; thinking: string; thinkingItem: string; at: number }

export type Broadcast = { connected: boolean; draft: Draft | undefined; researchers: ReadonlyMap<string, Researcher>; streams: Readonly<Record<string, Stream>> }

const blank: Stream = { at: 0, input: '', inputItem: '', text: '', textItem: '', thinking: '', thinkingItem: '' }

function write(stream: Stream, channel: 'input' | 'text' | 'thinking', item: string, delta: string, offset: number | null): Stream {
  const before = stream[`${channel}Item`] === item ? stream[channel] : ''
  const text = offset === null ? before + delta : before.slice(0, offset) + delta
  return { ...stream, at: Date.now(), [channel]: text.slice(-6000), [`${channel}Item`]: item }
}

function settle(stream: Stream, entry: Entry): Stream {
  if (entry.kind === 'thinking') return { ...stream, thinking: '', thinkingItem: '' }
  if (entry.kind === 'message') return { ...stream, text: '', textItem: '' }
  if (entry.kind === 'tool' || entry.kind === 'machine') return { ...stream, input: '', inputItem: '' }
  return stream
}

export function speaker(who: string | null) {
  return who ?? 'lead'
}

export function useBroadcast(id: string, active: boolean, onEntry: (entry: Entry) => void): Broadcast {
  const [draft, setDraft] = useState<Draft>()
  const [connected, setConnected] = useState(false)
  const [researchers, setResearchers] = useState<ReadonlyMap<string, Researcher>>(new Map())
  const [streams, setStreams] = useState<Readonly<Record<string, Stream>>>({})
  const handler = useRef(onEntry)

  useEffect(() => {
    handler.current = onEntry
  })

  useEffect(() => {
    setDraft(undefined)
    setResearchers(new Map())
    setStreams({})
  }, [id])

  useEffect(() => {
    if (!active) return
    const stream = (who: string, change: (stream: Stream) => Stream) => setStreams((previous) => ({ ...previous, [who]: change(previous[who] ?? blank) }))
    return Api.live(id, (event) => {
      if (event.type === 'end' || event.type === 'idle') {
        setConnected(false)
        return
      }
      setConnected(true)
      if (event.type === 'round' || event.type === 'text' || event.type === 'thinking' || event.type === 'message') setDraft((previous) => apply(previous, event))
      if (event.type === 'text' || event.type === 'thinking') stream('lead', (current) => write(current, event.type, event.item, event.delta, event.offset))
      if (event.type === 'delta') stream(speaker(event.who), (current) => write(current, event.channel, event.item, event.delta, event.offset))
      if (event.type === 'researcher') setResearchers((previous) => new Map(previous).set(event.researcher.id, event.researcher))
      if (event.type === 'entry') {
        stream(speaker(event.entry.who), (current) => settle(current, event.entry))
        handler.current(event.entry)
      }
    })
  }, [active, id])

  return { connected: active && connected, draft, researchers, streams }
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
