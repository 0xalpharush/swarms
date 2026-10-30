import { decimal, units } from '../shared/Memo.ts'

export function mach(value: string) {
  const atomics = units(value)
  const [whole = '0', fraction = ''] = decimal(atomics).split('.')
  const significant = fraction.replace(/0+$/, '').length
  const digits = atomics > 0n && atomics < 100n ? 6 : Math.min(4, Math.max(2, significant))
  return `${Number(whole).toLocaleString('en-US')}.${fraction.slice(0, digits)}`
}

export function ratio(part: string, whole: string) {
  const total = units(whole)
  if (total <= 0n) return 0
  return Math.min(1, Number((units(part) * 10_000n) / total) / 10_000)
}

export function percent(share: number) {
  const value = share * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

export function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function ago(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86_400)} d ago`
}

export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function clock(at: number) {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
