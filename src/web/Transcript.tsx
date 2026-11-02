import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Detail, Entry } from '../shared/Api.ts'
import * as Api from './api.ts'
import { clock, duration, usd } from './format.ts'
import { agent, type Live, speaker, type Stream, useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

const palette = ['#3f7d4e', '#8a5a2b', '#3d6a8f', '#8c3f5e', '#6b6a1f', '#5b4b8a', '#a0522d', '#2f7f7a']

const kinds = { error: 'Error', funds: 'Money', machine: 'Machine', message: 'Said', output: 'Output', status: 'Swarm', steer: 'Steer', thinking: 'Thought', tool: 'Did' } as const

const idle = { done: 'DONE', funding: 'NOT STARTED', paused: 'PAUSED', running: 'STARTING' } as const

export function hue(who: string) {
  if (who === agent) return '#161616'
  let value = 0
  for (const char of who) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return palette[value % palette.length] ?? palette[0]
}

function asked() {
  return new URLSearchParams(location.search).get('who') ?? 'all'
}

function now(stream: Stream | undefined) {
  if (stream?.input) return { kind: 'input', label: 'Writing code', text: stream.input }
  if (stream?.text) return { kind: 'text', label: 'Writing', text: stream.text }
  if (stream?.thinking) return { kind: 'thinking', label: 'Thinking', text: stream.thinking }
  return undefined
}

function Pulse(props: { entries: readonly Entry[]; end: number }) {
  const buckets = 30
  const span = 60_000
  const counts = Array.from({ length: buckets }, () => 0)
  for (const entry of props.entries) {
    const index = buckets - 1 - Math.floor((props.end - entry.at) / span)
    if (index >= 0 && index < buckets) counts[index] = (counts[index] ?? 0) + 1
  }
  const most = Math.max(1, ...counts)
  return (
    <span aria-label="Activity over the last 30 minutes" className="pulse" role="img">
      {counts.map((count, index) => <i key={index} style={{ height: `${Math.max(8, (count / most) * 100)}%` }} />)}
    </span>
  )
}

function Moment(props: { entry: Entry; tagged: boolean }) {
  const [open, setOpen] = useState(false)
  const entry = props.entry
  const who = speaker(entry.who)
  const detail = entry.detail && entry.detail !== entry.text ? entry.detail : null
  const long = (entry.kind === 'output' && (detail ?? '').split('\n').length > 6) || (entry.kind === 'message' && (entry.text.length > 700 || entry.text.split('\n').length > 10))
  return (
    <li className="moment" data-fresh={entry.seq === 0} data-kind={entry.kind}>
      <time dateTime={new Date(entry.at).toISOString()}>{clock(entry.at)}</time>
      <span className="moment-kind">{kinds[entry.kind]}</span>
      <div className="moment-body">
        {props.tagged && entry.who && (
          <span className="moment-who" style={{ color: hue(who) }}>
            <i style={{ background: hue(who) }} />
            {entry.who}
          </span>
        )}
        {entry.kind === 'message' ? (
          <div className="moment-message" data-open={open || !long}>
            <Markdown text={entry.text} />
          </div>
        ) : entry.kind === 'output' ? (
          <>
            <p className="moment-text">{entry.text}</p>
            {detail && <pre className="moment-output" data-open={open}>{detail}</pre>}
          </>
        ) : (
          <p className={entry.kind === 'thinking' ? 'moment-thought' : 'moment-text'}>{entry.text}</p>
        )}
        {long && <button className="entry-toggle" onClick={() => setOpen(!open)} type="button">{open ? '[−] less' : '[+] all of it'}</button>}
        {entry.kind !== 'output' && entry.kind !== 'message' && detail && (
          <>
            <button aria-expanded={open} className="entry-toggle" onClick={() => setOpen(!open)} type="button">{open ? '[−] detail' : entry.kind === 'tool' ? '[+] code' : '[+] detail'}</button>
            {open && <pre className="entry-detail">{detail}</pre>}
          </>
        )}
      </div>
    </li>
  )
}

export function Transcript(props: { empty?: ReactNode; entries: readonly Entry[]; live: Live; onEntries: (entries: readonly Entry[]) => void; swarm: Detail }) {
  const swarm = props.swarm
  const tick = useNow(1000)
  const [who, setWho] = useState(asked)
  const [loading, setLoading] = useState(false)
  const [start, setStart] = useState(false)
  const box = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
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
  const shown = useMemo(() => (who === 'all' ? props.entries : props.entries.filter((entry) => speaker(entry.who) === who)), [props.entries, who])
  const streaming = Object.entries(props.live.streams)
    .map(([name, stream]) => ({ name, now: now(stream), stream }))
    .filter((item) => item.now && streamed && (who === 'all' || who === item.name))
    .sort((a, b) => (a.name === agent ? -1 : b.name === agent ? 1 : b.stream.at - a.stream.at))
  const last = shown.at(-1)
  const first = shown.find((entry) => entry.seq > 0)

  useEffect(() => {
    const url = new URL(location.href)
    if (who === 'all') url.searchParams.delete('who')
    else url.searchParams.set('who', who)
    history.replaceState(null, '', url)
    setStart(false)
  }, [who])

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    if (stick.current) element.scrollTop = element.scrollHeight
    else setBelow(true)
  }, [last?.seq, last?.event, shown.length, streaming.length])

  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const older = async () => {
    const element = box.current
    if (!element || !first || loading) return
    setLoading(true)
    const height = element.scrollHeight
    const read = await Api.feed(swarm.id, 0, { before: first.seq, ...(who === 'all' ? {} : { who }) }).catch(() => undefined)
    setLoading(false)
    if (!read) return
    if (read.entries.length < 200) setStart(true)
    stick.current = false
    props.onEntries(read.entries)
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - height
    })
  }

  if (!props.entries.length && !working)
    return (
      <section aria-label="Transcript" className="transcript transcript-empty">
        <p className="broadcast-badge" data-live="false"><i />{idle[swarm.status]}</p>
        <h2>The transcript starts when the agent does</h2>
        <p>Once money is in, the swarm's agent works here in the open, in one long thread: every thought, command and result as it happens, and every subagent it spawns.</p>
        {props.empty}
      </section>
    )

  return (
    <section aria-label="Transcript" className="transcript" data-live={onAir}>
      <header className="transcript-bar">
        <span className="broadcast-badge" data-live={onAir}><i />{onAir ? 'LIVE' : idle[swarm.status]}</span>
        <span className="transcript-clock">{working && since ? `working for ${duration(tick - since)}` : swarm.status === 'done' ? 'goal reported met' : swarm.status === 'paused' ? 'waiting for money' : swarm.status === 'funding' ? 'waiting for its first backer' : 'about to start'}</span>
        <Pulse end={tick} entries={props.entries} />
        <span className="transcript-fuel">{usd(swarm.remaining)} left</span>
      </header>
      {speakers.length > 0 && (
        <nav aria-label="Who to show" className="transcript-who">
          {['all', agent, ...speakers].map((name) => (
            <button aria-pressed={who === name} className="chip" key={name} onClick={() => setWho(name)} type="button">
              {name !== 'all' && <i style={{ background: hue(name) }} data-live={streamed && !!now(props.live.streams[name])} />}
              {name === 'all' ? 'Everyone' : name === agent ? 'Agent' : name}
            </button>
          ))}
        </nav>
      )}
      <div className="timeline-box">
        <ol
          className="timeline"
          onScroll={(event) => {
            const element = event.currentTarget
            stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
            if (stick.current) setBelow(false)
          }}
          ref={box}
        >
          {!start && first && first.seq > 1 && (
            <li className="timeline-earlier">
              <button className="btn btn-minimal" disabled={loading} onClick={() => void older()} type="button">{loading ? 'Loading…' : 'Earlier'}</button>
            </li>
          )}
          {shown.length === 0 && <li className="timeline-empty">{onAir ? 'Tuning in. Moments appear here as they happen.' : 'Nothing here yet.'}</li>}
          {shown.map((entry) => <Moment entry={entry} key={entry.event === null ? `s${entry.seq}` : `e${entry.event}${entry.kind}`} tagged={who === 'all'} />)}
          {streaming.map((item) => (
            <li className="now" data-kind={item.now?.kind} key={item.name}>
              <p className="label">
                <i />
                {item.name === agent ? '' : <b style={{ color: hue(item.name) }}>{item.name} · </b>}
                {item.now?.label}
              </p>
              {item.now?.kind === 'input' ? (
                <pre>{item.now.text}<span className="caret" /></pre>
              ) : item.now?.kind === 'text' ? (
                <Markdown streaming text={item.now.text} />
              ) : (
                <p className="now-thought">{item.now?.text.slice(-700)}<span className="caret" /></p>
              )}
            </li>
          ))}
        </ol>
        {below && (
          <button
            className="btn btn-medium feed-jump"
            onClick={() => {
              box.current?.scrollTo({ behavior: 'smooth', top: box.current.scrollHeight })
              stick.current = true
              setBelow(false)
            }}
            type="button"
          >
            {onAir ? 'Back to live ↓' : 'Newest ↓'}
          </button>
        )}
      </div>
    </section>
  )
}
