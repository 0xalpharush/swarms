import type { Entry, Kind } from './Api.ts'

export type Step = { detail: string | null; kind: Kind; text: string }

export type Buffers = { add(who: string | null, text: string): void; take(who: string | null): string }

const quiet = new Set(['write_stdin', 'wait', 'wait_agent', 'list_agents', 'spawn_agent'])

export function clip(text: string, length: number) {
  return text.length > length ? text.slice(0, length - 1) + '…' : text
}

export function redact(text: string) {
  return text.replace(/(https?:\/\/)[^\s/@:'"]+:[^\s/@'"]+@/g, '$1***@').replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[redacted]')
}

export function tool(payload: Record<string, unknown>) {
  return String(payload['tool'] ?? 'a tool').replace(/^mcp__gateway__/, '')
}

export function call(payload: Record<string, unknown>): Step | undefined {
  const name = tool(payload)
  const raw = typeof payload['arguments'] === 'string' ? payload['arguments'] : JSON.stringify(payload['arguments'] ?? {})
  const input =
    typeof payload['arguments'] === 'object' && payload['arguments'] !== null
      ? (payload['arguments'] as Record<string, unknown>)
      : {}
  const on = typeof input['hand'] === 'string' ? ` on ${input['hand']}` : ''

  if (name === 'exec') return { detail: clip(raw, 4000), kind: 'tool', text: `Ran a script: ${clip(raw.split('\n')[0] ?? '', 120)}` }
  if (name === 'spawn_agent')
    return { detail: clip(String(input['task'] ?? ''), 2000), kind: 'tool', text: `Spawned an explorer: ${clip(String(input['role'] ?? 'worker'), 80)}` }
  if (name === 'wait_agent') return { detail: null, kind: 'tool', text: 'Waiting on explorers' }
  if (name === 'compute_create')
    return {
      detail: raw,
      kind: 'machine',
      text: `Starting machine ${String(input['attach'] ?? '')} (${String(input['image'] ?? 'default image')}${input['gpu'] ? ', ' + String(input['gpu']) : ''})`,
    }
  if (name === 'compute_terminate') return { detail: raw, kind: 'machine', text: 'Shutting down a machine' }
  if (name === 'exec_command') return { detail: raw, kind: 'tool', text: `$ ${clip(String(input['cmd'] ?? ''), 140)}${on}` }
  if (name === 'write_stdin' || name === 'wait') return undefined
  return { detail: clip(raw, 2000), kind: 'tool', text: `Called ${name}${on}` }
}

export function output(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value))
    return value
      .map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  return value === undefined || value === null ? '' : JSON.stringify(value)
}

export function result(name: string, text: string) {
  const exited = /^Process exited with code (-?\d+)$/m.exec(text)?.[1]
  const running = /^Process running with session ID/m.test(text) || /^Script running with cell ID/m.test(text)
  const marker = /^Output:$/m.exec(text)
  const body = (/^(Chunk ID|Script (completed|running|failed)|Wall time|Process (exited|running)|Original token count)/.test(text) && marker ? text.slice(marker.index + 'Output:'.length) : text).trim()
  const label = name === 'exec' ? 'Script' : name === 'exec_command' ? 'Command' : name
  const status = exited === undefined ? (running ? ' · still running' : '') : exited === '0' ? '' : ` · exit ${exited}`
  return { body, text: `${label} output${status}` }
}

export function step(type: string | undefined, payload: Record<string, unknown>): Step | undefined {
  if (type === 'tool.call') return call(payload)
  if (type === 'tool.result') {
    const name = tool(payload)
    const text = output(payload['result']).trim()
    if (payload['status'] !== 'completed') return { detail: clip(text || JSON.stringify(payload['result'] ?? ''), 2000), kind: 'error', text: `${name} failed` }
    if (quiet.has(name) || !text) return undefined
    const shown = result(name, text)
    if (!shown.body) return undefined
    return { detail: clip(shown.body, 2000), kind: 'output', text: shown.text }
  }
  if (type === 'assistant.message') return { detail: null, kind: 'message', text: clip(String(payload['text'] ?? ''), 4000) }
  if (type === 'run.failed') return { detail: clip(JSON.stringify(payload), 2000), kind: 'error', text: 'The run failed.' }
  if (type === 'model.call.failed') return { detail: clip(JSON.stringify(payload), 2000), kind: 'error', text: 'A model call failed.' }
  return undefined
}

export function narrate(buffers: Buffers, who: string | null, type: string | undefined, payload: Record<string, unknown>): Step[] {
  if (type === 'reasoning.summary.delta') {
    buffers.add(who, String(payload['text'] ?? ''))
    return []
  }
  const steps: Step[] = []
  if (type === 'assistant.message' || type === 'model.call.completed') {
    const thinking = buffers.take(who).trim()
    if (thinking) steps.push({ detail: null, kind: 'thinking', text: clip(thinking, 1500) })
  }
  const found = step(type, payload)
  if (found) steps.push(found)
  return steps
}

export function memory(): Buffers {
  const texts = new Map<string, string>()
  return {
    add: (who, text) => texts.set(who ?? '', (texts.get(who ?? '') ?? '') + text),
    take: (who) => {
      const text = texts.get(who ?? '') ?? ''
      texts.delete(who ?? '')
      return text
    },
  }
}

export function key(entry: Pick<Entry, 'event' | 'kind' | 'seq'>) {
  return typeof entry.event === 'number' ? `e${entry.event}${entry.kind}` : `s${entry.seq}`
}

export function merge(previous: readonly Entry[], next: readonly Entry[], cap = 5000) {
  if (next.length === 0) return previous
  const byKey = new Map(previous.map((entry) => [key(entry), entry]))
  let changed = false
  for (const entry of next) {
    const known = byKey.get(key(entry))
    if (known && (known.seq !== 0 || entry.seq === 0)) continue
    byKey.set(key(entry), known ? { ...entry, at: Math.min(known.at, entry.at) } : entry)
    changed = true
  }
  if (!changed) return previous
  return [...byKey.values()].sort((a, b) => a.at - b.at || (a.event ?? 0) - (b.event ?? 0) || a.seq - b.seq).slice(-cap)
}
