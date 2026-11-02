import { keccak256, stringToHex } from 'viem'

export function memo(swarm: string, note?: string | null) {
  const text = note?.trim()
  return keccak256(stringToHex(text ? `note:${swarm}:${text}` : `swarm:${swarm}`))
}
