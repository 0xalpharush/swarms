import { useEffect, useState } from 'react'
import type { Issued, Lent, Summary } from '../shared/Api.ts'
import * as Api from './api.ts'
import { Code } from './Docs.tsx'
import { message } from './hooks.ts'

type Form = 'cli' | 'library'

export function Connect(props: { swarm: Summary }) {
  const [label, setLabel] = useState('')
  const [issued, setIssued] = useState<Issued>()
  const [form, setForm] = useState<Form>('cli')
  const [lent, setLent] = useState<readonly Lent[]>([])
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({})
  const done = props.swarm.status === 'done'

  useEffect(() => {
    let live = true
    const load = () =>
      void Api.hands(props.swarm.id)
        .then((found) => live && setLent(found.hands))
        .catch(() => {})
    load()
    const timer = setInterval(load, 10_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [props.swarm.id])

  const issue = async () => {
    setState({ busy: true })
    try {
      const hand = await Api.hand(props.swarm.id, label.trim())
      setIssued(hand)
      setLent((current) => [{ at: Date.now(), charged: null, connected: false, earned: null, label: hand.label, name: hand.name, price: null, requests: 0 }, ...current])
      setState({})
    } catch (error) {
      setState({ error: message(error) })
    }
  }

  return (
    <div className="pledge connect" id="connect">
      <h3 className="label">Connect your machine</h3>
      <p className="fine">
        Lend this swarm your computer and what is on it as a nanocode hand. Its lead agent and explorers run commands and read and write files there, and are told the machine and its data are yours and to ask before anything destructive. Your hand can set its own prices, such as a price per file; the swarm pays them through the gateway from its money, and caps what each hand may charge in a round at a fifth of what the round may spend. Stop the command to take it back.
      </p>
      {done && <p className="fine">This swarm is done and takes no more hands.</p>}
      {!done && !issued && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="hand-label">
              Machine
            </label>
            <div className="field-input">
              <input id="hand-label" maxLength={32} onChange={(event) => setLabel(event.target.value)} placeholder="Optional, such as my-laptop" value={label} />
            </div>
          </div>
          <button className="btn btn-high btn-wide" disabled={state.busy} onClick={() => void issue()} type="button">
            {state.busy ? 'Issuing a hand…' : 'Get a hand'}
          </button>
        </>
      )}
      {issued && (
        <div className="connect-issued">
          <p className="notice">
            Hand <code>{issued.name}</code> is ready. Run one of these on the machine you lend; the token is shown only once.
          </p>
          <div className="chips">
            {(['cli', 'library'] as const).map((value) => (
              <button className={form === value ? 'chip chip-on' : 'chip'} key={value} onClick={() => setForm(value)} type="button">
                {value === 'cli' ? 'nanocode CLI' : 'nanocode-ts'}
              </button>
            ))}
          </div>
          {form === 'cli' ? (
            <>
              <Code>{issued.cli}</Code>
              <p className="fine">Start it in a folder you are happy to share, or add -C &lt;folder&gt;. To charge for what it holds, add --pricing prices.json with your payee address, a description and price rules, such as {'{'}"payee":"0x…","describe":"Q3 data, $0.01 a file","rules":[{'{'}"paths":["data/**"],"ops":["read"],"usd":0.01{'}'}]{'}'}. Without nanocode, this installs it and runs the same hand:</p>
              <Code>{issued.command}</Code>
            </>
          ) : (
            <>
              <Code>{issued.npm}</Code>
              <Code label="hand.mjs">{issued.library}</Code>
              <p className="fine">This hand runs nanocode's in-memory shell. Pass your own workspace to Hand.connect to serve something else, and pricing ({'{'} payee, describe, price(operation) {'}'}) to charge for it.</p>
            </>
          )}
        </div>
      )}
      {state.error && <p className="error">{state.error}</p>}
      {lent.length > 0 && (
        <ul className="connect-hands">
          {lent.slice(0, 8).map((hand) => (
            <li data-connected={hand.connected} key={hand.name}>
              <span>{hand.name}</span>
              <span>{[hand.price ?? 'free', `${hand.requests} request${hand.requests === 1 ? '' : 's'}`, hand.charged && `${hand.charged} charged`, hand.earned && `${hand.earned} earned`].filter(Boolean).join(' · ')}</span>
              <span>{hand.connected ? 'Connected' : 'Offline'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
