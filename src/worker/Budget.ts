import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import type { TxEnvelopeTempo } from 'ox/tempo'
import { encodeFunctionData, erc20Abi, keccak256, stringToHex, toHex } from 'viem'
import type { Address, Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { prepareTransactionRequest, readContract, sendRawTransactionSync, signTransaction } from 'viem/actions'
import { Abis, Account, Actions, Transaction } from 'viem/tempo'
import type { Token } from '../shared/Api.ts'
import * as Chain from './Chain.ts'
import * as Seal from './Seal.ts'
import type * as Store from './Store.ts'

export type Request = {
  address: Address
  chainId: Hex
  expiry: number
  keyType: 'secp256k1'
  limits: { limit: Hex; period: number; token: Address }[]
  publicKey: Hex
  scopes: { address: Address; recipients: Address[]; selector: Hex }[]
}

export type Approved = { contributor: Address; keyAuthorization: KeyAuthorization.Rpc; limit: bigint; published: boolean }

export type State = { balance: bigint; left: bigint; periodEnd: number | null; revoked: boolean }

export type Pulled =
  | { amount: bigint; fee: bigint; hash: Hex; ok: true }
  | { detail: string; ok: false; reason: 'balance' | 'error' | 'expired' | 'limit' | 'revoked' }

const transferWithMemo = '0x95777d59'

export const smallest = 5_000n

export async function request(
  env: Cloudflare.Env,
  input: { amount: bigint; days: number; period: number; recipient: Address; token: Token },
) {
  const key = generatePrivateKey()
  const access = Account.fromSecp256k1(key)
  const token = Chain.tokens[input.token].address
  const authorizeAccessKey: Request = {
    address: access.address.toLowerCase() as Address,
    chainId: toHex(Chain.chain.id),
    expiry: Math.floor(Date.now() / 1000) + input.days * 86_400,
    keyType: 'secp256k1',
    limits: [{ limit: toHex(input.amount), period: input.period, token }],
    publicKey: access.publicKey,
    scopes: [{ address: token, recipients: [input.recipient], selector: transferWithMemo }],
  }
  return { authorizeAccessKey, sealed: await Seal.seal(env.SWARMS_SECRET, key) }
}

export async function approve(
  env: Cloudflare.Env,
  expected: Request,
  input: { keyAuthorization?: unknown; transaction?: Hex | undefined },
): Promise<Approved | string> {
  if (input.transaction !== undefined) return install(env, expected, input.transaction)

  const verified = await verify(env, input.keyAuthorization, expected)
  if (typeof verified === 'string') return verified
  if (verified.admin)
    return 'An admin key approved this budget, so its key goes on Tempo in a transaction that admin key signs: send that transaction as transaction.'
  return { ...verified, published: false }
}

async function install(env: Cloudflare.Env, expected: Request, serialized: Hex): Promise<Approved | string> {
  const transaction = (() => {
    try {
      return Transaction.deserialize(serialized) as unknown as TxEnvelopeTempo.TxEnvelopeTempo
    } catch {
      return undefined
    }
  })()
  if (!transaction || transaction.type !== 'tempo' || !transaction.keyAuthorization)
    return 'Send a signed Tempo transaction that carries the key authorization.'

  const verified = await verify(env, KeyAuthorization.toRpc(transaction.keyAuthorization), expected)
  if (typeof verified === 'string') return verified
  if (transaction.from?.toLowerCase() !== verified.contributor.toLowerCase())
    return 'The transaction must come from the wallet the budget is for.'

  const receipt = await sendRawTransactionSync(Chain.client(env), { serializedTransaction: serialized }).catch(
    (error: unknown) => error as Error,
  )
  if (receipt instanceof Error) return `Tempo did not install the key: ${receipt.message.split('\n')[0]?.slice(0, 200)}`
  if (receipt.status !== 'success') return 'The transaction that installs the key reverted.'
  return { ...verified, published: true }
}

async function verify(env: Cloudflare.Env, value: unknown, expected: Request) {
  const checked = (() => {
    try {
      const signed = KeyAuthorization.fromRpc(value as KeyAuthorization.Rpc)
      const payload = KeyAuthorization.getSignPayload(signed)
      const signer = SignatureEnvelope.extractAddress({ payload, signature: signed.signature })
      const limits = signed.limits ?? []
      const limit = expected.limits[0]
      const matches =
        signed.type === 'secp256k1' &&
        !signed.isAdmin &&
        signed.address.toLowerCase() === expected.address.toLowerCase() &&
        Number(signed.chainId) === Number(expected.chainId) &&
        Number(signed.expiry) === expected.expiry &&
        limits.length === 1 &&
        limit !== undefined &&
        limits[0]?.token.toLowerCase() === limit.token.toLowerCase() &&
        BigInt(limits[0].limit) > 0n &&
        BigInt(limits[0].limit) <= BigInt(limit.limit) &&
        Number(limits[0].period ?? 0) === limit.period &&
        JSON.stringify(canonical(signed.scopes)) === JSON.stringify(canonical(expected.scopes)) &&
        SignatureEnvelope.verify(signed.signature, { address: signer, payload })
      if (!matches || !limits[0]) return undefined
      return {
        contributor: (signed.account ?? signer).toLowerCase() as Address,
        keyAuthorization: KeyAuthorization.toRpc(signed),
        limit: BigInt(limits[0].limit),
        signer: signer.toLowerCase() as Address,
      }
    } catch {
      return undefined
    }
  })()
  if (!checked)
    return 'The key authorization does not match the budget request, or its signer may not add keys to the wallet.'

  const admin = checked.signer !== checked.contributor
  if (admin && !(await Actions.accessKey.isAdmin(Chain.client(env), { accessKey: checked.signer, account: checked.contributor })))
    return 'The key authorization does not match the budget request, or its signer may not add keys to the wallet.'
  return { ...checked, admin }
}

function canonical(scopes: readonly { address: string; recipients?: readonly string[] | undefined; selector?: string | undefined }[] | undefined) {
  return (scopes ?? [])
    .map((scope) => ({
      address: scope.address.toLowerCase(),
      recipients: (scope.recipients ?? []).map((recipient) => recipient.toLowerCase()).sort(),
      selector: String(scope.selector ?? '').toLowerCase(),
    }))
    .sort((a, b) => (a.address + a.selector).localeCompare(b.address + b.selector))
}

export async function state(env: Cloudflare.Env, allowance: Store.Allowance): Promise<State> {
  const client = Chain.client(env)
  const account = allowance.contributor as Address
  const token = Chain.tokens[allowance.token].address
  const balance = readContract(client, { abi: erc20Abi, address: token, args: [account], functionName: 'balanceOf' })
  if (!allowance.published) return { balance: await balance, left: BigInt(allowance.amount), periodEnd: null, revoked: false }

  const [limit, metadata] = await Promise.all([
    Actions.accessKey.getRemainingLimit(client, { accessKey: allowance.access_key, account, token }),
    Actions.accessKey.getMetadata(client, { accessKey: allowance.access_key, account }),
  ])
  return {
    balance: await balance,
    left: limit.remaining,
    periodEnd: limit.periodEnd ? Number(limit.periodEnd) * 1000 : null,
    revoked: metadata.isRevoked,
  }
}

export function memo(swarm: string, budget: string) {
  return keccak256(stringToHex(`budget:${swarm}:${budget}`))
}

export async function pull(
  env: Cloudflare.Env,
  allowance: Store.Allowance,
  input: { amount: bigint; recipient: Address; room: bigint },
): Promise<Pulled> {
  const client = Chain.client(env)
  const key = (await Seal.open(env.SWARMS_SECRET, allowance.sealed_key)) as Hex
  const account = Account.fromSecp256k1(key, { access: allowance.contributor as Address })
  const token = Chain.tokens[allowance.token].address
  const authorization =
    allowance.published || !allowance.key_authorization
      ? undefined
      : KeyAuthorization.fromRpc(JSON.parse(allowance.key_authorization) as KeyAuthorization.Rpc)
  const prepare = (amount: bigint) =>
    prepareTransactionRequest(client, {
      account,
      calls: [
        {
          data: encodeFunctionData({
            abi: Abis.tip20,
            args: [input.recipient, amount, memo(allowance.swarm, allowance.id)],
            functionName: 'transferWithMemo',
          }),
          to: token,
        },
      ],
      feeToken: token,
      nonceKey: 'expiring',
      ...(authorization ? { keyAuthorization: authorization } : {}),
    } as never) as Promise<{ gas: bigint; maxFeePerGas: bigint }>

  try {
    let amount = input.amount < input.room ? input.amount : input.room
    let prepared = await prepare(amount)
    const most = (prepared.gas * prepared.maxFeePerGas + 999_999_999_999n) / 1_000_000_000_000n
    if (amount + most > input.room) {
      amount = input.room - most
      if (amount < smallest) return { detail: 'What is left today does not cover a transfer and its fee.', ok: false, reason: 'limit' }
      prepared = await prepare(amount)
    }
    const receipt = await sendRawTransactionSync(client, {
      serializedTransaction: await signTransaction(client, prepared as never),
    })
    if (receipt.status !== 'success') return { detail: 'The transfer reverted.', ok: false, reason: 'error' }
    return {
      amount,
      fee: (receipt.gasUsed * receipt.effectiveGasPrice + 999_999_999_999n) / 1_000_000_000_000n,
      hash: receipt.transactionHash,
      ok: true,
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    const detail = text.split('\n')[0]?.slice(0, 240) ?? 'The transfer failed.'
    if (/SpendingLimitExceeded/i.test(text)) return { detail, ok: false, reason: 'limit' }
    if (/KeyExpired|ExpiryInPast/i.test(text)) return { detail, ok: false, reason: 'expired' }
    if (/KeyRevoked|revoked|KeyNotFound|CallNotAllowed/i.test(text)) return { detail, ok: false, reason: 'revoked' }
    if (/InsufficientBalance|insufficient/i.test(text)) return { detail, ok: false, reason: 'balance' }
    return { detail, ok: false, reason: 'error' }
  }
}
