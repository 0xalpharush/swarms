import { createClient, http } from 'viem'
import type { Address } from 'viem'
import { tempo } from 'viem/tempo/chains'
import type { Token } from '../shared/Api.ts'

export const mach: Address = '0x20c000000000000000000000f37de3740ADec032'

export const chain = tempo

export const tokens = {
  ousd: { address: '0x20c0000000000000000000006a37DA5C996874BE', symbol: 'OUSD' },
  pathusd: { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD' },
  usdce: { address: '0x20C000000000000000000000b9537d11c60E8b50', symbol: 'USDC.e' },
} as const satisfies Record<Token, { address: Address; symbol: string }>

export const ids = Object.keys(tokens) as Token[]

export function token(address: string): Token | undefined {
  return ids.find((id) => tokens[id].address.toLowerCase() === address.toLowerCase())
}

export function client(env: Cloudflare.Env) {
  return createClient({ chain: tempo, transport: http(env.TEMPO_RPC) })
}
