import { type RefObject, useState } from 'react'
import type { Config, Summary } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { mach, short } from './format.ts'
import { message, useWallet } from './hooks.ts'
import * as Wallet from './wallet.ts'

export type Step = 'request' | 'approve' | 'confirm'

export const amounts = ['0.10', '0.25', '1', '5'] as const

export const disclosure = "Tempo Wallet will ask you to approve a spending key for this app. Its wallet cap is at least 1 MACH, but the swarm can spend at most your pledge: the key's channel opens with exactly the pledged amount and never tops up. Unspent money goes back when the swarm finishes."

export function valid(amount: string, config: Config | undefined) {
  const text = amount.trim()
  if (!/^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(text)) return false
  return units(text) >= units(config?.minPledge ?? '0.000001')
}

export function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

export async function pledge(config: Config, swarm: string, amount: string, note: string, onStep: (step: Step) => void) {
  onStep('request')
  const text = note.trim()
  const requested = await Api.pledge(swarm, text ? { amount: decimal(units(amount)), note: text } : { amount: decimal(units(amount)) })
  onStep('approve')
  const approved = await Wallet.authorize(config, requested.authorizeAccessKey)
  onStep('confirm')
  return await Api.confirm(swarm, requested.pledge, approved.keyAuthorization).finally(() => void Wallet.refresh(config).catch(() => {}))
}

export const steps = { approve: 'Approve the key in Tempo Wallet…', confirm: 'Recording the pledge…', request: 'Preparing the pledge…' } as const satisfies Record<Step, string>

export function Amount(props: { config: Config | undefined; onChange: (value: string) => void; value: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor="amount">
        Amount
      </label>
      <div className="field-input">
        <input id="amount" inputMode="decimal" onChange={(event) => props.onChange(event.target.value.replace(',', '.'))} placeholder="0.10" value={props.value} />
        <span className="field-suffix">MACH</span>
      </div>
      <div className="chips">
        {amounts.map((value) => (
          <button className={props.value === value ? 'chip chip-on' : 'chip'} key={value} onClick={() => props.onChange(value)} type="button">
            {value}
          </button>
        ))}
        {props.config && <span className="chips-hint">min {mach(props.config.minPledge)}</span>}
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

export function WalletLine(props: { amount: string; config: Config | undefined }) {
  const wallet = useWallet()
  const [error, setError] = useState<string>()
  const needed = /^\d*\.?\d*$/.test(props.amount) && props.amount !== '' ? units(props.amount) : 0n
  const low = wallet.balance !== undefined && wallet.balance < needed

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
        {short(wallet.address)} · {wallet.balance === undefined ? '…' : `${mach(decimal(wallet.balance))} MACH`}
      </span>
      {(low || wallet.balance === 0n) && (
        <button className="btn btn-minimal" onClick={() => void Wallet.fund(low && wallet.balance !== undefined ? needed - wallet.balance : undefined).then(() => props.config && Wallet.refresh(props.config))} type="button">
          Add MACH
        </button>
      )}
    </p>
  )
}

export function Box(props: { config: Config | undefined; note: string; noteRef: RefObject<HTMLDivElement | null>; onDone: () => void; onNote: (note: string) => void; swarm: Summary }) {
  const [amount, setAmount] = useState('0.10')
  const [state, setState] = useState<{ done?: string; error?: string; short?: boolean; step?: Step }>({})
  const busy = state.step !== undefined
  const ready = valid(amount, props.config) && props.note.length <= maxNote && !!props.config && !busy

  const submit = async () => {
    if (!props.config) return
    try {
      const pledged = await pledge(props.config, props.swarm.id, amount, props.note, (step) => setState({ step }))
      setState({ done: pledged.pledge.amount })
      props.onNote('')
      props.onDone()
    } catch (error) {
      setState({ error: message(error), short: code(error) === 'insufficient_balance' })
    }
  }

  return (
    <div className="pledge" id="pledge" ref={props.noteRef}>
      <h3 className="label">{props.swarm.status === 'paused' ? 'Pledge to resume it' : props.swarm.status === 'funding' ? 'Fund the first round' : props.swarm.status === 'done' ? 'This swarm is done' : 'Pledge'}</h3>
      {props.swarm.status === 'done' && <p className="fine">It takes no more pledges. What it did not spend goes back to each backer when the gateway closes their key's channel.</p>}
      {props.swarm.status !== 'done' && (
        <>
          <Amount config={props.config} onChange={setAmount} value={amount} />
          <NoteField hint="Steers the swarm in proportion to the MACH behind it. The same text backs an existing note." onChange={props.onNote} value={props.note} />
          <WalletLine amount={amount} config={props.config} />
          <button className="btn btn-high btn-wide" disabled={!ready} onClick={() => void submit()} type="button">
            {state.step ? steps[state.step] : state.short ? 'Try the pledge again' : `Pledge ${valid(amount, props.config) ? mach(decimal(units(amount))) : ''} MACH`}
          </button>
          {state.done && <p className="notice">Pledged {mach(state.done)} MACH. The swarm spends it as it works; what it does not spend goes back to you.</p>}
          {state.error && (
            <p className="error">
              {state.error}
              {state.short && (
                <>
                  {' '}
                  <button className="btn btn-minimal" onClick={() => void Wallet.fund(units(amount) - (Wallet.snapshot().balance ?? 0n))} type="button">
                    Add MACH
                  </button>
                </>
              )}
            </p>
          )}
          <p className="fine">{disclosure}</p>
        </>
      )}
    </div>
  )
}
