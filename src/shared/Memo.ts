export const maxNote = 280

export function units(amount: string) {
  const [whole = '0', fraction = ''] = amount.trim().split('.')
  return BigInt(whole || '0') * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
}

export function decimal(atomics: bigint) {
  const sign = atomics < 0n ? '-' : ''
  const value = atomics < 0n ? -atomics : atomics
  return `${sign}${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`
}
