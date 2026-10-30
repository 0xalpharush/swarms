import { Mach, Provider, tempoWallet } from 'accounts'
import type { Address } from 'viem'
import { Actions, createClient, http } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import type { Config } from '../shared/Api.ts'
import { fixture } from './api.ts'
import * as Fixtures from './fixtures.ts'

export type State = { address: Address | undefined; balance: bigint | undefined }

let provider: ReturnType<typeof Provider.create> | undefined

let state: State = { address: undefined, balance: undefined }

const listeners = new Set<() => void>()

function wallet() {
  provider ??= Provider.create({ adapter: tempoWallet(), mpp: false })
  return provider
}

const remembered = 'swarms.wallet'

function set(next: Partial<State>) {
  state = { ...state, ...next }
  if (next.address && !fixture) localStorage.setItem(remembered, next.address)
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function snapshot() {
  return state
}

export async function restore(config: Config) {
  if (fixture || state.address || !localStorage.getItem(remembered)) return
  const accounts = await wallet()
    .request({ method: 'eth_accounts' })
    .catch(() => [] as readonly Address[])
  const address = accounts[0]
  if (!address) return
  set({ address })
  await refresh(config)
}

export async function connect(config: Config) {
  if (state.address) return state.address
  const address = fixture ? Fixtures.visitor : (await wallet().request({ method: 'eth_requestAccounts' }))[0]
  if (!address) throw new Error('Tempo Wallet returned no account.')
  set({ address })
  void refresh(config).catch(() => {})
  return address
}

export async function authorize(config: Config, authorizeAccessKey: unknown) {
  if (fixture) {
    await new Promise((resolve) => setTimeout(resolve, 1400))
    set({ address: Fixtures.visitor })
    return { address: Fixtures.visitor, keyAuthorization: {} as unknown }
  }
  const result = (await wallet().request({ method: 'wallet_connect', params: [{ capabilities: { authorizeAccessKey }, chainId: config.chainId }] } as never)) as {
    accounts: readonly { address: Address; capabilities?: { keyAuthorization?: unknown } }[]
  }
  const account = result.accounts[0]
  const keyAuthorization = account?.capabilities?.keyAuthorization
  if (!account || !keyAuthorization) throw new Error('Tempo Wallet returned no approval.')
  set({ address: account.address })
  return { address: account.address, keyAuthorization }
}

export async function refresh(config: Config) {
  const address = state.address
  if (!address) return undefined
  const balance = fixture ? Fixtures.balance : (await Actions.token.getBalance(createClient({ chain: tempo, transport: http(config.rpc) }), { account: address, token: config.mach })).amount
  if (state.address === address) set({ balance })
  return balance
}

export function fund(shortfall?: bigint) {
  const address = state.address
  if (fixture || !address) return Promise.resolve()
  const cents = shortfall === undefined ? 0n : (shortfall + 9_999n) / 10_000n
  const amount = cents > 0n ? `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` : undefined
  return Mach.fund(wallet(), { address, displayName: 'Swarms', ...(amount ? { amount } : {}) })
}
