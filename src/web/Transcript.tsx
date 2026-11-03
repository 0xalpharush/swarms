import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Config, Detail, Entry, Me, Said } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Mention from '../shared/Mention.ts'
import { decimal, units } from '../shared/Memo.ts'
import { Alert, explain } from './Alert.tsx'
import { choose, recorded } from './Contribute.tsx'
import { pledge } from './Pledge.tsx'
import { memo } from '../shared/Transfer.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { clock, usd } from './format.ts'
import { agent, type Live, message, speaker, type Stream, useNow, useWallet } from './hooks.ts'
import * as Wallet from './wallet.ts'
import { Markdown } from './Markdown.tsx'

const palette = ['#3f7d4e', '#8a5a2b', '#3d6a8f', '#8c3f5e', '#6b6a1f', '#5b4b8a', '#a0522d', '#2f7f7a']

export function hue(who: string) {
  if (who === agent) return '#161616'
  let value = 0
  for (const char of who) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return palette[value % palette.length] ?? palette[0]
}

function asked() {
  return here().searchParams.get('who') ?? 'all'
}

function now(stream: Stream | undefined) {
  if (stream?.input) return { kind: 'input', label: 'Writing code', text: stream.input }
  if (stream?.text) return { kind: 'text', label: 'Writing', text: stream.text }
  if (stream?.thinking) return { kind: 'thinking', label: 'Thinking', text: stream.thinking }
  return undefined
}

function Beat(props: { entry: Entry; head: boolean; times?: number | undefined }) {
  const [open, setOpen] = useState(false)
  const entry = props.entry
  const who = speaker(entry.who)
  const detail = entry.detail && entry.detail !== entry.text ? entry.detail : null
  const quiet = entry.kind === 'tool' || entry.kind === 'output'
  const aside = entry.kind === 'status' || entry.kind === 'funds' || entry.kind === 'machine' || entry.kind === 'steer'
  const long = entry.kind === 'message' ? entry.text.length > 700 || entry.text.split('\n').length > 10 : entry.kind === 'thinking' ? entry.text.length > 180 : !!detail
  const toggle = long ? () => setOpen(!open) : undefined
  return (
    <li className="beat" data-fresh={entry.seq === 0} data-kind={entry.kind} data-open={open} data-more={long} onClick={toggle} title={clock(entry.at)}>
      {props.head && !aside && (
        <span className="beat-who" style={{ color: hue(who) }}>{who === agent ? 'Agent' : entry.who}</span>
      )}
      {entry.kind === 'message' ? (
        <div className="beat-say"><Markdown text={Answer.unround(entry.text)} /></div>
      ) : (
        <p className="beat-text">{quiet && <span aria-hidden="true" className="beat-mark">›</span>}{entry.text}{props.times && <span className="beat-times"> ×{props.times}</span>}</p>
      )}
      {(quiet || entry.kind === 'error') && open && detail && <pre className="beat-detail">{detail}</pre>}
    </li>
  )
}

function Voice(props: { item: Said; name: string; onBack: ((note: string) => void) | undefined }) {
  return (
    <li className="beat beat-voice" title={clock(props.item.at)}>
      <span className="beat-who">@{props.name}{props.item.steer && <button className="said-backed" disabled={!props.onBack} onClick={() => props.onBack?.(props.item.steer?.note ?? '')} title="Back this idea too" type="button">{usd(props.item.steer.amount)}{props.onBack && <b aria-hidden="true">+</b>}</button>}</span>
      <p className="beat-say"><span className="mention" data-swarm="true">@swarm</span> {Mention.idea(props.item.text)}</p>
    </li>
  )
}

type Backed = { amount: string; at: number; id: string; monthly: boolean; note: string | null; who: string }

function backings(swarm: Detail): Backed[] {
  return [
    ...swarm.pledges.map((item) => ({ amount: item.amount, at: item.at, id: `p${item.id}`, monthly: false, note: item.note, who: item.contributor })),
    ...swarm.contributions.filter((item) => item.kind === 'transfer').map((item) => ({ amount: item.amount, at: item.at, id: `c${item.hash}`, monthly: false, note: item.note, who: item.contributor })),
    ...swarm.budgets.filter((item) => item.contributor).map((item) => ({ amount: item.amount, at: item.at, id: `b${item.id}`, monthly: true, note: item.note, who: item.contributor ?? '' })),
  ]
}

function Funded(props: { item: Backed; name: string; onBack: ((note: string) => void) | undefined }) {
  return (
    <li className="beat beat-funded" data-go={!!(props.onBack && props.item.note)} onClick={() => props.item.note && props.onBack?.(props.item.note)} title={props.onBack && props.item.note ? 'Back this idea too' : clock(props.item.at)}>
      <span className="beat-coin" aria-hidden="true">$</span>
      <span><b>@{props.name}</b> funded {usd(props.item.amount)}{props.item.monthly ? ' a month' : ''}{props.item.note ? <> behind <i>“{props.item.note}”</i></> : null}</span>
    </li>
  )
}

const stakes = ['0.5', '1', '5'] as const

function Composer(props: { config: Config | undefined; draft: { at: number; text: string }; me: Me | null; onFund: (note?: string) => void; onSaid: (said: Said) => void; swarm: string; wallet: `0x${string}` | null }) {
  const wallet = useWallet()
  const [text, setText] = useState('')
  const [stake, setStake] = useState<string>('0.5')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!props.draft.at) return
    setText(props.draft.text)
    setError(undefined)
    requestAnimationFrame(() => area.current?.focus())
  }, [props.draft])

  const ok = /^\d*\.?\d{0,6}$/.test(stake) && stake !== '' && stake !== '.' && units(stake) >= 10_000n

  const send = async () => {
    const config = props.config
    const idea = text.trim()
    if (!config || busy || idea.length < 3 || !ok) return
    setError(undefined)
    try {
      const need = units(stake)
      if (!props.wallet) throw new Error('This swarm has no wallet yet.')
      setBusy('Approve in Tempo Wallet…')
      await Wallet.refresh(config).catch(() => {})
      const token = choose('send', decimal(need), Wallet.snapshot().balances)
      if (token === 'mach') await pledge(config, props.swarm, decimal(need), '', 'mach', (step) => setBusy(step === 'approve' ? 'Approve in Tempo Wallet…' : 'Sending…'))
      else {
        const hash = await Wallet.send(config, { amount: need, memo: memo(props.swarm, ''), to: props.wallet, token })
        setBusy('Sending…')
        await recorded(props.swarm, hash, '')
      }
      setBusy('Sending…')
      const posted = await Api.say(props.swarm, { steer: decimal(need), text: `@swarm ${idea}` })
      props.onSaid(posted.message)
      setText('')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(undefined)
    }
  }

  if (!wallet.session && wallet.pending)
    return (
      <div className="say">
        <div aria-busy="true" className="say-box say-wait"><span className="mention" data-swarm="true">@swarm</span><span className="say-hold">Steer the agent</span><span className="say-send" aria-hidden="true">↑</span></div>
      </div>
    )

  if (!wallet.session)
    return (
      <div className="say say-gate">
        <button
          className="say-cta"
          disabled={!!busy || !props.config}
          onClick={() => {
            if (!props.config) return
            setBusy('Approve in Tempo Wallet…')
            void Wallet.signIn(props.config).catch((reason: unknown) => setError(message(reason))).finally(() => setBusy(undefined))
          }}
          type="button"
        >
          <span>Steer the agent</span>
          <b>{busy ?? 'Sign in →'}</b>
        </button>
        {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
      </div>
    )

  return (
    <div className="say">
      {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
      {text.trim() && (
        <div className="say-stake" role="radiogroup" aria-label="How much behind it">
          {stakes.map((value) => (
            <button aria-checked={stake === value} disabled={!!busy} key={value} onClick={() => setStake(value)} role="radio" type="button">${value === '0.5' ? '0.50' : value}</button>
          ))}
          <label className="say-own">$<input aria-label="Your amount" disabled={!!busy} inputMode="decimal" onChange={(event) => setStake(event.target.value.replace(',', '.').replace('$', ''))} onFocus={(event) => event.target.select()} value={(stakes as readonly string[]).includes(stake) ? '' : stake} placeholder="…" /></label>
          {busy && <span className="say-note">{busy}</span>}
        </div>
      )}
      <form className="say-box" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <span className="mention" data-swarm="true">@swarm</span>
        <textarea
          disabled={!!busy}
          onChange={(event) => setText(event.target.value.replace(/^@swarm\s*/i, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder="Steer the agent"
          ref={area}
          rows={1}
          value={text}
        />
        <button aria-label="Send" className="say-send" disabled={!!busy || text.trim().length < 3 || !ok} type="submit">↑</button>
      </form>
    </div>
  )
}

export function Transcript(props: {
  config: Config | undefined
  entries: readonly Entry[]
  handles: ReadonlyMap<string, string>
  live: Live
  me: Me | null
  draft: { at: number; text: string }
  onClose: () => void
  onEmpty?: (() => void) | undefined
  onFund: (note: string) => void
  onEntries: (entries: readonly Entry[]) => void
  onPeople: () => void
  people: boolean
  onSaid: (said: Said) => void
  said: readonly Said[]
  swarm: Detail
  tray?: ReactNode
}) {
  const swarm = props.swarm
  const tick = useNow(1000)
  const [who, setWho] = useState(asked)
  const [loading, setLoading] = useState(false)
  const [start, setStart] = useState(false)
  const box = useRef<HTMLOListElement>(null)
  const follow = useRef<'live' | 'reading'>('live')
  const pinned = useRef(0)
  const [below, setBelow] = useState(false)
  const working = swarm.working
  const since = props.live.since ?? working?.since
  const onAir = !!working
  const streamed = onAir && props.live.connected

  const speakers = useMemo(() => {
    const seen: string[] = []
    for (const entry of props.entries) if (entry.who && !seen.includes(entry.who)) seen.push(entry.who)
    return seen
  }, [props.entries])
  const [shown, repeats] = useMemo(() => {
    const kept: Entry[] = []
    const counts = new Map<Entry, number>()
    let burst = new Map<string, Entry>()
    for (const entry of props.entries) {
      if (entry.kind === 'funds' || (entry.kind === 'status' && /^Round \d+ /.test(entry.text)) || (who !== 'all' && speaker(entry.who) !== who)) continue
      if (entry.kind !== 'error') burst = new Map()
      const first = entry.kind === 'error' ? burst.get(entry.text) : undefined
      if (first) {
        counts.set(first, (counts.get(first) ?? 1) + 1)
        continue
      }
      if (entry.kind === 'error') burst.set(entry.text, entry)
      kept.push(entry)
    }
    return [kept, counts] as const
  }, [props.entries, who])
  const streaming = Object.entries(props.live.streams)
    .map(([name, stream]) => ({ name, now: now(stream), stream }))
    .filter((item) => item.now && streamed && (who === 'all' || who === item.name))
    .sort((a, b) => (a.name === agent ? -1 : b.name === agent ? 1 : b.stream.at - a.stream.at))
  const voices = useMemo(() => (who === 'all' ? props.said.filter((item) => item.author && Mention.steers(item.text)) : []), [props.said, who])
  const funded = useMemo(() => (who === 'all' ? backings(swarm) : []), [swarm, who])
  const rows = useMemo(() => [...shown.map((entry) => ({ at: entry.at, entry })), ...voices.map((said) => ({ at: said.at, said })), ...funded.map((backed) => ({ at: backed.at, backed }))].sort((a, b) => a.at - b.at), [shown, voices, funded])
  const last = shown.at(-1)
  const first = shown.find((entry) => entry.seq > 0)

  useEffect(() => {
    const url = new URL(location.href)
    if (who === 'all') url.searchParams.delete('who')
    else url.searchParams.set('who', who)
    history.replaceState(null, '', url)
    setStart(false)
  }, [who])

  const bottom = (element: HTMLElement) => {
    element.scrollTop = element.scrollHeight
    pinned.current = element.scrollTop
  }

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    if (follow.current === 'live') bottom(element)
    else setBelow(true)
  }, [last?.seq, last?.event, shown.length, streaming.length, voices.length, funded.length])

  useEffect(() => {
    const element = box.current
    if (!element) return
    const stick = () => {
      if (follow.current === 'live') bottom(element)
    }
    const resized = new ResizeObserver(stick)
    resized.observe(element)
    const changed = new MutationObserver(stick)
    changed.observe(element, { characterData: true, childList: true, subtree: true })
    return () => {
      resized.disconnect()
      changed.disconnect()
    }
  }, [props.entries.length > 0 || !!working])

  const older = async () => {
    const element = box.current
    if (!element || !first || loading) return
    setLoading(true)
    const height = element.scrollHeight
    const read = await Api.feed(swarm.id, 0, { before: first.seq, ...(who === 'all' ? {} : { who }) }).catch(() => undefined)
    setLoading(false)
    if (!read) return
    if (read.entries.length < 200) setStart(true)
    follow.current = 'reading'
    props.onEntries(read.entries)
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - height
      pinned.current = element.scrollTop
    })
  }

  if (!props.entries.length && !working)
    return (
      <section aria-label="Transcript" className="transcript transcript-empty">
        <button className="transcript-start" disabled={!props.onEmpty} onClick={props.onEmpty} type="button">
          <h2>Nothing yet.</h2>
          {props.onEmpty && <b>Fund →</b>}
        </button>
      </section>
    )

  return (
    <section aria-label="Transcript" className="transcript" data-live={onAir}>
      <header className="transcript-bar">
        {speakers.length > 0 && (
          <nav aria-label="Who to show" className="transcript-who">
            {['all', agent, ...speakers].map((name) => (
              <button aria-pressed={who === name} key={name} onClick={() => setWho(name)} type="button">
                {name !== 'all' && <i data-live={streamed && !!now(props.live.streams[name])} style={{ background: hue(name) }} />}
                {name === 'all' ? 'All' : name === agent ? 'Agent' : name}
              </button>
            ))}
          </nav>
        )}
        {props.people && <button className="transcript-people" onClick={props.onPeople} type="button">People →</button>}
      </header>
      <div className="timeline-box">
        <ol
          className="timeline"
          onScroll={(event) => {
            const element = event.currentTarget
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 48) {
              follow.current = 'live'
              setBelow(false)
            } else if (Math.abs(element.scrollTop - pinned.current) > 2) follow.current = 'reading'
          }}
          ref={box}
        >
          {!start && first && first.seq > 1 && (
            <li className="timeline-earlier">
              <button className="btn btn-minimal" disabled={loading} onClick={() => void older()} type="button">{loading ? 'Loading…' : 'Earlier'}</button>
            </li>
          )}
          {shown.length === 0 && !streaming.length && <li className="timeline-empty">{onAir ? 'Tuning in…' : 'Nothing here yet.'}</li>}
          {rows.map((row, index) => {
            const before = rows[index - 1]
            if ('backed' in row) return <Funded item={row.backed} onBack={swarm.status === 'done' ? undefined : props.onFund} key={row.backed.id} name={props.handles.get(row.backed.who) ?? Mention.handle(row.backed.who)} />
            if ('said' in row) return <Voice item={row.said} onBack={swarm.status === 'done' ? undefined : props.onFund} key={`m${row.said.id}`} name={props.handles.get(row.said.author ?? '') ?? Mention.handle(row.said.author ?? '')} />
            const entry = row.entry
            const head = !before || !('entry' in before) || speaker(before.entry.who) !== speaker(entry.who) || ['status', 'funds', 'machine', 'steer'].includes(before.entry.kind)
            return <Beat entry={entry} head={head} times={repeats.get(entry)} key={entry.event === null ? `s${entry.seq}` : `e${entry.event}${entry.kind}`} />
          })}
          {streaming.map((item) => (
            <li className="beat beat-now" data-kind={item.now?.kind === 'text' ? 'message' : item.now?.kind === 'input' ? 'tool' : 'thinking'} key={item.name}>
              <span className="beat-who" style={{ color: hue(item.name) }}>{item.name === agent ? 'Agent' : item.name}</span>
              {item.now?.kind === 'text' ? (
                <div className="beat-say"><Markdown streaming text={Answer.unround(item.now.text)} /><span className="caret" /></div>
              ) : (
                <p className="beat-text">{item.now?.kind === 'input' && <span aria-hidden="true" className="beat-mark">›</span>}{item.now?.text}<span className="caret" /></p>
              )}
            </li>
          ))}
        </ol>
        {below && (
          <button
            className="btn btn-medium feed-jump"
            onClick={() => {
              follow.current = 'live'
              if (box.current) bottom(box.current)
              setBelow(false)
            }}
            type="button"
          >
            ↓
          </button>
        )}
      </div>
      {props.tray ? (
        <div className="tray" role="dialog" aria-label="Fund">
          <button aria-label="Close" className="tray-x" onClick={props.onClose} type="button">×</button>
          {props.tray}
        </div>
      ) : (
        swarm.status !== 'done' && <Composer config={props.config} draft={props.draft} me={props.me} wallet={swarm.wallet} onFund={(note) => props.onFund(note ?? '')} onSaid={props.onSaid} swarm={swarm.id} />
      )}
    </section>
  )
}
