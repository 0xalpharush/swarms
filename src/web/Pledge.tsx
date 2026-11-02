import { useState } from 'react'
import type { Config, Currency } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { mach, short, symbols } from './format.ts'
import { message, useWallet } from './hooks.ts'
import * as Wallet from './wallet.ts'

export type Step = 'request' | 'approve' | 'confirm'

export const amounts = ['2', '5', '10'] as const

export function disclosure(token: Currency) {
  const symbol = symbols[token]
  return token === 'mach'
    ? `Tempo Wallet will ask you to approve a spending key that this app holds, capped at your pledge, for 7 days. It can only open, top up and close payment channels with the gateway, so the swarm pays its requests from your wallet as it works, and what its channel did not spend goes back when the swarm finishes.`
    : `Tempo Wallet will ask you to approve a spending key that this app holds, capped at your pledge, for 7 days. It can only move ${symbol} to this swarm's wallet, which the swarm does as its rounds need money, so what it never needs stays in your wallet; what the swarm's wallet does not spend goes back to its contributors in proportion when the swarm finishes.`
}

export function valid(amount: string, config: Config | undefined, least = config?.minPledge) {
  const text = amount.trim()
  if (!/^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(text)) return false
  return units(text) >= units(least ?? '0.000001')
}

export function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

export async function pledge(config: Config, swarm: string, amount: string, note: string, token: Currency, onStep: (step: Step) => void) {
  onStep('request')
  const text = note.trim()
  const requested = await Api.pledge(swarm, { amount: decimal(units(amount)), token, ...(text ? { note: text } : {}) })
  onStep('approve')
  const approved = await Wallet.authorize(config, requested.authorizeAccessKey)
  onStep('confirm')
  return await Api.confirm(swarm, requested.pledge, approved.keyAuthorization).finally(() => void Wallet.refresh(config).catch(() => {}))
}

export const steps = { approve: 'Approve the key in Tempo Wallet…', confirm: 'Recording the pledge…', request: 'Preparing the pledge…' } as const satisfies Record<Step, string>

export function Amount(props: { config: Config | undefined; hint?: string; label?: string; least?: string; onChange: (value: string) => void; suffix: string; value: string }) {
  const least = props.least ?? props.config?.minPledge
  return (
    <div className="field">
      <label className="field-label" htmlFor="amount">
        {props.label ?? 'Amount'}
      </label>
      <div className="field-input">
        <input id="amount" inputMode="decimal" onChange={(event) => props.onChange(event.target.value.replace(',', '.'))} placeholder="2" value={props.value} />
        <span className="field-suffix">{props.suffix}</span>
      </div>
      <div className="chips">
        {amounts.map((value) => (
          <button className={props.value === value ? 'chip chip-on' : 'chip'} key={value} onClick={() => props.onChange(value)} type="button">
            {value}
          </button>
        ))}
        {least && <span className="chips-hint">{props.hint ?? `min ${mach(least)}`}</span>}
      </div>
    </div>
  )
}

export function Tokens(props: { config: Config | undefined; onChange: (token: Currency) => void; only?: 'pool'; value: Currency }) {
  const tokens = (props.config?.tokens ?? []).filter((token) => !props.only || token.pool)
  return (
    <div className="field">
      <span className="field-label">Token</span>
      <div className="chips" role="radiogroup">
        {tokens.map((token) => (
          <button aria-checked={props.value === token.id} className={props.value === token.id ? 'chip chip-on' : 'chip'} key={token.id} onClick={() => props.onChange(token.id)} role="radio" type="button">
            {token.symbol}
          </button>
        ))}
      </div>
    </div>
  )
}

export function NoteField(props: { hint: string; onChange: (value: string) => void; value: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor="note">
        Note
      </label>
      <div className="field-input">
        <textarea id="note" maxLength={maxNote} onChange={(event) => props.onChange(event.target.value)} placeholder="Optional" rows={2} value={props.value} />
      </div>
      <p className="field-hint">
        <span>{props.hint}</span>
        <span>
          {props.value.length}/{maxNote}
        </span>
      </p>
    </div>
  )
}

export function WalletLine(props: { amount: string; config: Config | undefined; token: Currency }) {
  const wallet = useWallet()
  const [error, setError] = useState<string>()
  const needed = /^\d*\.?\d*$/.test(props.amount) && props.amount !== '' ? units(props.amount) : 0n
  const balance = wallet.balances[props.token]
  const low = balance !== undefined && balance < needed

  if (!wallet.address)
    return (
      <p className="wallet-line">
        <span>Tempo Wallet</span>
        <button
          className="btn btn-minimal"
          disabled={!props.config}
          onClick={() => {
            if (props.config) void Wallet.connect(props.config).catch((reason: unknown) => setError(message(reason)))
          }}
          type="button"
        >
          Connect to see your balance
        </button>
        {error && <span className="error">{error}</span>}
      </p>
    )

  return (
    <p className="wallet-line" data-low={low}>
      <span>
        {short(wallet.address)} · {balance === undefined ? '…' : `${mach(decimal(balance))} ${symbols[props.token]}`}
      </span>
      {props.token === 'mach' && (low || balance === 0n) && (
        <button className="btn btn-minimal" onClick={() => void Wallet.fund(low && balance !== undefined ? needed - balance : undefined).then(() => props.config && Wallet.refresh(props.config))} type="button">
          Add MACH
        </button>
      )}
    </p>
  )
}
