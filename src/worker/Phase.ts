export type Phase = 'idle' | 'working' | 'settling' | 'settled'

export type Keys = { get<T>(key: string): T | undefined }

const next: Record<Phase, readonly Phase[]> = {
  idle: ['idle', 'working', 'settling'],
  settled: ['settled'],
  settling: ['settling', 'settled'],
  working: ['working', 'idle', 'settling'],
}

export function of(kv: Keys, done: boolean): Phase {
  if (kv.get<boolean>('refunded')) return 'settled'
  if (done || kv.get<number>('refundAt') !== undefined) return 'settling'
  if (kv.get<string>('turn')) return 'working'
  return 'idle'
}

export function can(from: Phase, to: Phase) {
  return next[from].includes(to)
}

export function check(from: Phase, to: Phase) {
  if (!can(from, to)) throw new Error(`A swarm cannot go from ${from} to ${to}.`)
}
