import type { Entry, Hand, Lent } from './Api.ts'

export type Run = { at: number; failed: boolean; output: string | null; seq: number; text: string; who: string | null }

export type Machine = {
  by: string | null
  charged: string | null
  commands: Run[]
  config: [string, string][]
  connected: boolean
  ended: number | null
  kind: 'browser' | 'hand' | 'sandbox'
  label: string | null
  name: string
  price: string | null
  requests: number | null
  started: number | null
}

const shown: Record<string, string> = { apt: 'Packages', cpu: 'CPU', gpu: 'GPU', image: 'Image', lease: 'Lease', memory: 'Memory', minutes: 'Minutes', pip: 'Python packages', region: 'Region', timeout: 'Timeout' }

function json(text: string | null) {
  if (!text) return undefined
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function value(key: string, raw: unknown) {
  if (Array.isArray(raw)) return raw.map(String).join(', ')
  if (key === 'memory' && typeof raw === 'number') return raw >= 1024 ? `${raw / 1024} GB` : `${raw} MB`
  if ((key === 'lease' || key === 'timeout') && typeof raw === 'number') return raw >= 60 ? `${Math.round(raw / 60)} min` : `${raw} s`
  return String(raw)
}

function settings(input: Record<string, unknown>) {
  return Object.entries(input)
    .filter(([key, raw]) => key !== 'attach' && key !== 'name' && raw !== null && raw !== undefined && raw !== '')
    .map(([key, raw]): [string, string] => [shown[key] ?? key, value(key, raw)])
}

export function fleet(entries: readonly Entry[], hands: readonly Hand[], lent: readonly Lent[]): Machine[] {
  const found = new Map<string, Machine>()
  const get = (name: string, kind: Machine['kind'], at: number, by: string | null) => {
    let machine = found.get(name)
    if (!machine) {
      machine = { by, charged: null, commands: [], config: [], connected: false, ended: null, kind, label: null, name, price: null, requests: null, started: at }
      found.set(name, machine)
    }
    return machine
  }
  const sorted = [...entries].sort((a, b) => a.at - b.at || a.seq - b.seq)
  let browsers = 0

  for (const [index, entry] of sorted.entries()) {
    const starting = /^Starting machine (\S+)/.exec(entry.text)
    if (entry.kind === 'machine' && starting?.[1]) {
      const input = json(entry.detail) ?? {}
      const machine = get(starting[1], 'sandbox', entry.at, entry.who)
      machine.config = settings(input)
      machine.started = entry.at
      continue
    }
    if (entry.kind === 'tool' && entry.text === 'Called browser_create') {
      const input = json(entry.detail) ?? {}
      browsers += 1
      const machine = get(String(input['name'] ?? `browser ${browsers}`), 'browser', entry.at, entry.who)
      machine.config = settings(input)
      continue
    }
    const joined = /^A contributor's machine joined the swarm as hand (\S+?)(?: \((.+)\))?\.$/.exec(entry.text)
    if (entry.kind === 'machine' && joined?.[1]) {
      const machine = get(joined[1], 'hand', entry.at, null)
      machine.label = joined[2] ?? machine.label
      continue
    }
    const left = /^Machine (\S+) left\.$/.exec(entry.text)
    if (entry.kind === 'machine' && left?.[1]) {
      const machine = found.get(left[1])
      if (machine) machine.ended = entry.at
      continue
    }
    if (entry.kind === 'machine' && entry.text === 'Shutting down a machine') {
      for (const machine of found.values()) if (entry.detail?.includes(machine.name)) machine.ended = entry.at
      continue
    }
    if (entry.kind !== 'tool' || !/^(\$ |Called |Ran a script)/.test(entry.text)) continue
    const on = / on (\S+)$/.exec(entry.text)?.[1] ?? /"hand"\s*:\s*"([^"]+)"|hand:\s*["']([^"']+)["']/.exec(entry.detail ?? '')?.slice(1).find(Boolean)
    if (!on) continue
    const machine = found.get(on) ?? get(on, on.startsWith('sb-') ? 'sandbox' : 'hand', entry.at, entry.who)
    const args = json(entry.detail)
    let output = args ? null : entry.detail
    let failed = false
    for (const next of sorted.slice(index + 1, index + 6)) {
      if ((next.who ?? null) !== (entry.who ?? null)) continue
      if (next.kind === 'tool') break
      if (next.kind === 'output' || next.kind === 'error') {
        output = [output, next.detail ?? next.text].filter(Boolean).join('\n')
        failed = next.kind === 'error' || /exit [1-9]/.test(next.text)
        break
      }
    }
    machine.commands.push({ at: entry.at, failed, output, seq: entry.seq, text: entry.text.replace(/ on \S+$/, ''), who: entry.who })
  }

  for (const hand of hands) {
    const machine = found.get(hand.name) ?? get(hand.name, hand.name.startsWith('sb-') ? 'sandbox' : 'hand', 0, null)
    machine.connected = hand.connected
  }
  for (const hand of lent) {
    const machine = found.get(hand.name) ?? get(hand.name, 'hand', hand.at, null)
    machine.kind = 'hand'
    machine.label = hand.label || machine.label
    machine.connected = machine.connected || hand.connected
    machine.charged = hand.charged
    machine.price = hand.price
    machine.requests = hand.requests
    machine.started ??= hand.at
  }
  return [...found.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || (b.started ?? 0) - (a.started ?? 0))
}
