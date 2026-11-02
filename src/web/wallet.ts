import { Mach, Provider, tempoWallet } from 'accounts'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { Abis, Actions, createClient, http } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import type { Account, Config, Currency } from '../shared/Api.ts'
import * as Api from './api.ts'
import { fixture } from './api.ts'
import * as Fixtures from './fixtures.ts'

export type Session = { address: Address; token: string }

export type State = {
  account: Account | undefined
  address: Address | undefined
  balance: bigint | undefined
  balances: Partial<Record<Currency, bigint>>
  session: Session | undefined
}

let provider: ReturnType<typeof Provider.create> | undefined

const kept = 'swarms.session'

function stored(): Session | undefined {
  if (fixture) return undefined
  try {
    const value = JSON.parse(localStorage.getItem(kept) ?? 'null') as Session | null
    return value?.address && value.token ? value : undefined
  } catch {
    return undefined
  }
}

let state: State = { account: undefined, address: undefined, balance: undefined, balances: {}, session: stored() }

Api.authorize(state.session?.token)

const listeners = new Set<() => void>()

function wallet() {
  provider ??= Provider.create({ adapter: tempoWallet(), mpp: false })
  return provider
}

const remembered = 'swarms.wallet'

function set(next: Partial<State>) {
  state = { ...state, ...next }
  if (next.address && !fixture) localStorage.setItem(remembered, next.address)
  if ('session' in next) {
    Api.authorize(next.session?.token)
    if (!fixture) {
      if (next.session) localStorage.setItem(kept, JSON.stringify(next.session))
      else localStorage.removeItem(kept)
    }
  }
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

export async function signIn(config: Config) {
  if (fixture) {
    await new Promise((resolve) => setTimeout(resolve, 900))
    const session = { address: Fixtures.visitor, token: 'fixture' } satisfies Session
    set({ address: session.address, session })
    void identify()
    return session
  }
  const result = (await wallet().request({
    method: 'wallet_connect',
    params: [{ capabilities: { auth: { returnToken: true, url: config.auth } }, chainId: config.chainId }],
  } as never)) as { accounts: readonly { address: Address; capabilities?: { auth?: { token?: string } } }[] }
  const account = result.accounts[0]
  const token = account?.capabilities?.auth?.token
  if (!account || !token) throw new Error('Tempo Wallet returned no session.')
  const session = { address: account.address.toLowerCase() as Address, token }
  set({ account: undefined, address: account.address, session })
  void refresh(config).catch(() => {})
  void identify()
  return session
}

export async function identify() {
  const token = state.session?.token
  if (!token) return undefined
  try {
    const account = await Api.account()
    if (state.session?.token === token) set({ account })
    return account
  } catch (error) {
    if (error instanceof Api.Failure && error.status === 401 && state.session?.token === token) signOut()
    return undefined
  }
}

export async function rename(name: string | null) {
  const account = await Api.rename(name)
  set({ account })
  return account
}

export function signOut() {
  const token = state.session?.token
  set({ account: undefined, session: undefined })
  if (token && !fixture) void fetch('/v1/auth/logout', { headers: { authorization: `Bearer ${token}` }, method: 'POST' }).catch(() => {})
}

export async function send(config: Config, input: { amount: bigint; memo: Hex; to: Address; token: Currency }) {
  if (fixture) {
    await new Promise((resolve) => setTimeout(resolve, 1400))
    return `0x${'5a'.repeat(32)}` as Hex
  }
  const address = await connect(config)
  const token = config.tokens.find((item) => item.id === input.token)
  if (!token) throw new Error('That token is not offered.')
  const receipt = (await wallet().request({
    method: 'eth_sendTransactionSync',
    params: [
      {
        calls: [{ data: encodeFunctionData({ abi: Abis.tip20, args: [input.to, input.amount, input.memo], functionName: 'transferWithMemo' }), to: token.address }],
        feeToken: token.address,
        from: address,
      },
    ],
  } as never)) as { status?: string; transactionHash?: Hex }
  if (!receipt.transactionHash) throw new Error('Tempo Wallet returned no transaction.')
  if (receipt.status && receipt.status !== 'success' && receipt.status !== '0x1') throw new Error('The transfer reverted.')
  void refresh(config).catch(() => {})
  return receipt.transactionHash
}

export async function refresh(config: Config) {
  const address = state.address
  if (!address) return undefined
  const client = createClient({ chain: tempo, transport: http(config.rpc) })
  const read = (token: Config['tokens'][number]) =>
    fixture
      ? Promise.resolve(Fixtures.balances[token.id])
      : Actions.token.getBalance(client, { account: address, token: token.address }).then((balance) => balance.amount)
  const entries = await Promise.all(config.tokens.map(async (token) => [token.id, await read(token).catch(() => undefined)] as const))
  const balances = Object.fromEntries(entries.filter((entry): entry is readonly [Currency, bigint] => entry[1] !== undefined)) as Partial<Record<Currency, bigint>>
  if (state.address === address) set({ balance: balances.mach, balances })
  return balances.mach
}

export function fund(shortfall?: bigint) {
  const address = state.address
  if (fixture || !address) return Promise.resolve()
  const cents = shortfall === undefined ? 0n : (shortfall + 9_999n) / 10_000n
  const amount = cents > 0n ? `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` : undefined
  return Mach.fund(wallet(), { address, displayName: 'Swarms', ...(amount ? { amount } : {}) })
}
