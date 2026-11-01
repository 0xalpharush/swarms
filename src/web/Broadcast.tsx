import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Detail, Entry, Researcher, Round } from '../shared/Api.ts'
import * as Api from './api.ts'
import { ago, clock, duration, usd } from './format.ts'
import { type Broadcast as Live, type Stream, speaker, useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

const labels = { pending: 'Joining', running: 'Exploring', completed: 'Reported', failed: 'Failed', interrupted: 'Paused', closing: 'Stopping', closed: 'Stopped' } as const

const palette = ['#3f7d4e', '#8a5a2b', '#3d6a8f', '#8c3f5e', '#6b6a1f', '#5b4b8a', '#a0522d', '#2f7f7a']

type Member = Researcher & { depth: number }

export function hue(id: string) {
  if (id === 'lead') return '#161616'
  let value = 0
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return palette[value % palette.length] ?? palette[0]
}

function asked() {
  const query = new URLSearchParams(location.search)
  const round = Number(query.get('round'))
  return { round: Number.isInteger(round) && round > 0 ? round : undefined, who: query.get('who') ?? 'lead' }
}

function remember(round: number | undefined, who: string) {
  const url = new URL(location.href)
  if (round === undefined) url.searchParams.delete('round')
  else url.searchParams.set('round', String(round))
  if (who === 'lead') url.searchParams.delete('who')
  else url.searchParams.set('who', who)
  history.replaceState(null, '', url)
}

function line(text: string) {
  return text.split('\n').find((part) => part.trim())?.trim() ?? ''
}

function tree(members: readonly Researcher[]): Member[] {
  const ids = new Set(members.map((member) => member.id))
  const children = new Map<string | null, Researcher[]>()
  for (const member of members) {
    const parent = member.parent && ids.has(member.parent) ? member.parent : null
    children.set(parent, [...(children.get(parent) ?? []), member])
  }
  const ordered: Member[] = []
  const visit = (parent: string | null, depth: number) => {
    for (const member of (children.get(parent) ?? []).sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))) {
      ordered.push({ ...member, depth })
      visit(member.id, depth + 1)
    }
  }
  visit(null, 1)
  return ordered
}

function pretty(output: string) {
  try {
    const value: unknown = JSON.parse(output)
    if (typeof value !== 'object' || value === null) return undefined
    return Object.entries(value as Record<string, unknown>)
  } catch {
    return undefined
  }
}

function lead(swarm: Detail, round: Round | undefined, entries: readonly Entry[]): Member {
  const active = round?.status === 'running' && swarm.status === 'running'
  const latest = entries.findLast((entry) => entry.who === null && (entry.kind === 'tool' || entry.kind === 'message' || entry.kind === 'thinking'))
  return {
    action: active ? latest?.text ?? 'Planning the round' : round?.status === 'completed' ? 'Round report delivered' : 'Waiting for the next round',
    depth: 0,
    events: 0,
    id: 'lead',
    lastSequence: 0,
    name: 'Lead researcher',
    output: null,
    parent: null,
    round: round?.n ?? 1,
    state: round?.status === 'completed' ? 'completed' : round?.status === 'failed' ? 'failed' : active ? 'running' : swarm.status === 'paused' ? 'interrupted' : 'pending',
    task: 'Coordinates the expedition: plans each round, sends explorers down their own directions and brings their findings together.',
    toolsCompleted: entries.filter((entry) => entry.who === null && entry.kind === 'output').length,
    updatedAt: round?.endedAt ?? latest?.at ?? swarm.updatedAt,
  }
}

function now(stream: Stream | undefined, member: Member, live: boolean) {
  if (live && stream?.input) return { label: 'Writing code', text: stream.input.slice(-90) }
  if (live && stream?.text) return { label: 'Writing', text: stream.text.slice(-90) }
  if (live && stream?.thinking) return { label: 'Thinking', text: stream.thinking.slice(-90) }
  return { label: member.state === 'running' ? 'Now' : 'Last', text: member.action ?? 'Waiting for an update' }
}

export function Broadcast(props: { live: Live; onEntries: (entries: readonly Entry[]) => void; swarm: Detail; entries: readonly Entry[] }) {
  const swarm = props.swarm
  const initial = useMemo(asked, [])
  const [chosen, setChosen] = useState<number | undefined>(initial.round)
  const [focus, setFocus] = useState(initial.who)
  const [directing, setDirecting] = useState(initial.who === 'lead')
  const cut = useRef(0)
  const tick = useNow(1000)
  const round = swarm.history.find((item) => item.n === chosen) ?? swarm.history.at(-1)
  const number = round?.n ?? 1
  const airing = round?.status === 'running' && swarm.status === 'running'
  const onAir = airing && props.live.connected
  const entries = useMemo(() => props.entries.filter((entry) => entry.round === number), [props.entries, number])

  const members = useMemo(() => {
    const byKey = new Map<string, Researcher>()
    for (const member of [...swarm.researchers, ...props.live.researchers.values()]) {
      if (member.round !== number) continue
      const known = byKey.get(member.id)
      if (!known || member.lastSequence >= known.lastSequence) byKey.set(member.id, member)
    }
    return tree([...byKey.values()])
  }, [swarm.researchers, props.live.researchers, number])

  const leader = lead(swarm, round, entries)
  const party = [leader, ...members]
  const member = party.find((item) => item.id === focus) ?? leader
  const names = new Map(party.map((item) => [item.id, item.name]))
  const path = [] as Member[]
  for (let at: Member | undefined = member; at && at.id !== 'lead'; at = party.find((item) => item.id === at?.parent)) path.unshift(at)
  const working = members.filter((item) => item.state === 'running' || item.state === 'pending').length

  useEffect(() => {
    remember(chosen, member.id)
  }, [chosen, member.id])

  useEffect(() => {
    if (initial.round === undefined && initial.who === 'lead') return
    requestAnimationFrame(() => document.getElementById('broadcast')?.scrollIntoView({ block: 'start' }))
  }, [initial])

  useEffect(() => {
    if (focus === 'lead' || party.some((item) => item.id === focus)) return
    const elsewhere = swarm.researchers.find((item) => item.id === focus)
    if (elsewhere && elsewhere.round !== number) setChosen(elsewhere.round)
  }, [focus, number, party, swarm.researchers])

  const loaded = useRef(new Set<string>())
  const onEntries = useRef(props.onEntries)
  useEffect(() => {
    onEntries.current = props.onEntries
  })
  const started = round !== undefined
  useEffect(() => {
    if (!started) return
    const key = `${swarm.id}:${number}:${member.id}`
    if (loaded.current.has(key)) return
    loaded.current.add(key)
    let alive = true
    void (async () => {
      let after = 0
      for (let page = 0; page < 10 && alive; page++) {
        const read = await Api.feed(swarm.id, after, { round: number, who: member.id }).catch(() => undefined)
        if (!read || !alive) return
        onEntries.current(read.entries)
        if (read.entries.length < 200) return
        after = read.entries.at(-1)?.seq ?? after
      }
    })()
    return () => {
      alive = false
      loaded.current.delete(key)
    }
  }, [swarm.id, number, member.id, started])

  const latest = useMemo(() => {
    let best = { at: 0, who: 'lead' }
    for (const [who, stream] of Object.entries(props.live.streams)) if (stream.at > best.at) best = { at: stream.at, who }
    const last = entries.at(-1)
    if (last && last.seq === 0 && last.at > best.at) best = { at: last.at, who: speaker(last.who) }
    return best.who
  }, [props.live.streams, entries])

  const ids = party.map((item) => item.id).join(' ')
  useEffect(() => {
    if (!directing || !onAir || latest === focus || !ids.split(' ').includes(latest)) return
    const wait = cut.current + 6000 - Date.now()
    const timer = setTimeout(() => {
      cut.current = Date.now()
      setFocus(latest)
    }, Math.max(0, wait))
    return () => clearTimeout(timer)
  }, [directing, onAir, latest, focus, ids])

  const select = (id: string) => {
    setDirecting(false)
    setFocus(id)
    if (matchMedia('(max-width: 799px)').matches) requestAnimationFrame(() => document.getElementById('broadcast-stage')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }))
  }

  if (!round)
    return (
      <section aria-label="Live research" className="broadcast broadcast-empty">
        <p className="broadcast-badge" data-live="false"><i />OFF AIR</p>
        <h2>The broadcast starts with round 1</h2>
        <p>Once money is in, the lead and its explorers work here in the open: every thought, command and result as it happens.</p>
      </section>
    )

  return (
    <section aria-label="Live research" className="broadcast" data-live={onAir} id="broadcast">
      <header className="broadcast-bar">
        <span className="broadcast-badge" data-live={onAir}><i />{onAir ? 'LIVE' : airing ? 'CONNECTING' : 'REPLAY'}</span>
        <h2>Round {number}</h2>
        <span>{duration((round.endedAt ?? tick) - round.startedAt)}</span>
        <span>{airing ? `${working} of ${members.length} explorer${members.length === 1 ? '' : 's'} at work` : `${members.length} explorer${members.length === 1 ? '' : 's'}`}</span>
        <Pulse entries={entries} end={round.endedAt ?? tick} start={round.startedAt} />
        {onAir && <button aria-pressed={directing} className="director" onClick={() => setDirecting(!directing)} title="Cut to whoever is working, as a broadcast director would" type="button">{directing ? 'Following the action' : 'Follow the action'}</button>}
        <span className="broadcast-fuel">{round.status === 'running' ? `${usd(swarm.remaining)} left` : `${usd(round.spent)} spent`}</span>
      </header>
      <Rounds chosen={number} history={swarm.history} onChoose={(n) => { setChosen(n === swarm.history.at(-1)?.n ? undefined : n); setFocus('lead') }} />
      <div className="broadcast-grid">
        <Stage airing={airing} answered={swarm.answer?.round === number} entries={entries.filter((entry) => speaker(entry.who) === member.id)} member={member} members={members} names={names} onFocus={select} path={path} round={round} stream={props.live.streams[member.id]} />
        <aside aria-label="Directions" className="directions">
          <p className="label">Directions this round</p>
          <ol className="direction-list">
            {party.map((item) => {
              const shown = now(props.live.streams[item.id], item, airing)
              return (
                <li key={item.id} style={{ paddingLeft: `${Math.min(item.depth, 4) * 14}px` }}>
                  <button aria-pressed={item.id === member.id} className="direction" data-state={item.state} onClick={() => select(item.id)} type="button">
                    <span className="direction-head"><i style={{ background: hue(item.id) }} /><span className="direction-name">{item.name}</span><span className="direction-state">{labels[item.state]}</span></span>
                    {item.id !== 'lead' && item.task && <span className="direction-task">{line(item.task)}</span>}
                    <span className="direction-now" data-streaming={airing && shown.label !== 'Now' && shown.label !== 'Last'}><b>{shown.label}</b> {shown.text}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          {!members.length && <p className="direction-empty">{airing ? 'No explorers yet. The lead sends them out when a direction is worth a second pair of hands.' : 'No explorers were recorded for this round.'}</p>}
          <Ticker entries={entries} live={airing} names={names} onFocus={select} />
        </aside>
      </div>
    </section>
  )
}

function Rounds(props: { chosen: number; history: readonly Round[]; onChoose: (n: number) => void }) {
  const box = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    box.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [props.chosen, props.history.length])
  return (
    <ol aria-label="Research rounds" className="round-trail broadcast-rounds" ref={box}>
      {props.history.map((item) => <li key={item.n}><button aria-pressed={item.n === props.chosen} data-state={item.status} onClick={() => props.onChoose(item.n)} type="button"><span>{item.status === 'completed' ? '✓' : item.status === 'failed' ? '!' : item.status === 'running' ? '●' : '−'}</span>Round {item.n}</button></li>)}
    </ol>
  )
}

function Pulse(props: { end: number; entries: readonly Entry[]; start: number }) {
  const buckets = 24
  const span = Math.max(1, props.end - props.start) / buckets
  const counts = Array.from({ length: buckets }, () => 0)
  for (const entry of props.entries) {
    const index = Math.min(buckets - 1, Math.max(0, Math.floor((entry.at - props.start) / span)))
    counts[index] = (counts[index] ?? 0) + 1
  }
  const most = Math.max(1, ...counts)
  return (
    <span aria-label={`${props.entries.length} events this round`} className="pulse" role="img">
      {counts.map((count, index) => <i key={index} style={{ height: `${Math.max(8, (count / most) * 100)}%` }} />)}
    </span>
  )
}

function Stage(props: { airing: boolean; answered: boolean; entries: readonly Entry[]; member: Member; members: readonly Member[]; names: ReadonlyMap<string, string>; onFocus: (id: string) => void; path: readonly Member[]; round: Round; stream: Stream | undefined }) {
  const member = props.member
  const time = useNow(5000)
  const children = props.members.filter((item) => (member.id === 'lead' ? item.depth === 1 : item.parent === member.id))
  const result = member.id === 'lead' ? (props.round.status === 'completed' ? props.round.message : null) : member.output
  const fields = result ? pretty(result) : undefined
  const live = props.airing && (member.state === 'running' || member.state === 'pending')
  return (
    <div className="stage" id="broadcast-stage">
      <nav aria-label="Where you are" className="stage-path">
        <button aria-current={member.id === 'lead' ? 'page' : undefined} onClick={() => props.onFocus('lead')} type="button">Lead</button>
        {props.path.map((item) => <span key={item.id}><i>›</i><button aria-current={item.id === member.id ? 'page' : undefined} onClick={() => props.onFocus(item.id)} type="button">{item.name}</button></span>)}
      </nav>
      <div className="stage-head">
        <h3><i style={{ background: hue(member.id) }} />{member.name}</h3>
        <span className="researcher-status" data-state={member.state}>{labels[member.state]}</span>
      </div>
      <p className="stage-meta">{member.id === 'lead' ? `${props.entries.length} moments` : `${member.toolsCompleted} actions finished`} · updated {ago(member.updatedAt, time)}</p>
      {member.task && <Assignment task={member.task} />}
      {children.length > 0 && (
        <div className="stage-children">
          <span className="label">{member.id === 'lead' ? 'Explorers sent out' : 'Sub-directions'}</span>
          {children.map((item) => <button className="chip" data-state={item.state} key={item.id} onClick={() => props.onFocus(item.id)} type="button"><i style={{ background: hue(item.id) }} />{item.name}<span>{labels[item.state]}</span></button>)}
        </div>
      )}
      <Timeline entries={props.entries} live={live} members={props.members} onFocus={props.onFocus} />
      {live && <Now member={member} stream={props.stream} />}
      {result && member.id === 'lead' && props.answered && <p className="stage-answered">This round's report is the answer above. <a href="#answer">Read it ↑</a></p>}
      {result && !(member.id === 'lead' && props.answered) && (
        <details className="stage-result" open={member.id !== 'lead'}>
          <summary className="label">{member.id === 'lead' ? 'Round report' : 'Result'}</summary>
          {fields ? <dl className="result-fields">{fields.map(([name, value]) => <div key={name}><dt>{name.replace(/_/g, ' ')}</dt><dd>{typeof value === 'string' ? <Markdown text={value} /> : <pre>{JSON.stringify(value, null, 2)}</pre>}</dd></div>)}</dl> : <Markdown text={result} />}
        </details>
      )}
    </div>
  )
}

function Assignment(props: { task: string }) {
  const [open, setOpen] = useState(false)
  const long = props.task.length > 280 || props.task.split('\n').length > 4
  return (
    <div className="stage-task" data-open={open || !long}>
      <span className="label">Assignment</span>
      <p>{props.task}</p>
      {long && <button className="entry-toggle" onClick={() => setOpen(!open)} type="button">{open ? '[−] less' : '[+] the whole assignment'}</button>}
    </div>
  )
}

function Now(props: { member: Member; stream: Stream | undefined }) {
  const stream = props.stream
  if (stream?.input) return <div className="now" data-kind="input"><p className="label"><i />Writing code</p><pre>{stream.input}<span className="caret" /></pre></div>
  if (stream?.text) return <div className="now" data-kind="text"><p className="label"><i />Writing</p><Markdown streaming text={stream.text} /></div>
  if (stream?.thinking) return <div className="now" data-kind="thinking"><p className="label"><i />Thinking</p><p className="now-thought">{stream.thinking.slice(-700)}<span className="caret" /></p></div>
  return <div className="now" data-kind="idle"><p className="label"><i />Working</p><p className="now-thought">{props.member.action ?? 'Between steps'}</p></div>
}

function Timeline(props: { entries: readonly Entry[]; live: boolean; members: readonly Member[]; onFocus: (id: string) => void }) {
  const box = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
  const [below, setBelow] = useState(false)
  const last = props.entries.at(-1)

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    if (stick.current) element.scrollTop = element.scrollHeight
    else setBelow(true)
  }, [last?.seq, last?.event, props.entries.length])

  const spawned = (text: string) => {
    const role = text.replace(/^Spawned an explorer: /, '')
    return props.members.find((item) => item.name === role)
  }

  return (
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
        {props.entries.length === 0 && <li className="timeline-empty">{props.live ? 'Tuning in. Moments appear here as they happen.' : 'Nothing recorded for this direction in this round.'}</li>}
        {props.entries.map((entry) => <Moment entry={entry} key={entry.event === null ? `s${entry.seq}` : `e${entry.event}${entry.kind}`} onFocus={props.onFocus} target={entry.kind === 'tool' && entry.text.startsWith('Spawned an explorer: ') ? spawned(entry.text) : undefined} />)}
      </ol>
      {below && (
        <button className="btn btn-medium feed-jump" onClick={() => { box.current?.scrollTo({ behavior: 'smooth', top: box.current.scrollHeight }); stick.current = true; setBelow(false) }} type="button">
          {props.live ? 'Back to live ↓' : 'Newest ↓'}
        </button>
      )}
    </div>
  )
}

const kinds = { error: 'Error', funds: 'Money', machine: 'Machine', message: 'Said', output: 'Output', status: 'Status', steer: 'Steer', thinking: 'Thought', tool: 'Did' } as const

function Moment(props: { entry: Entry; onFocus: (id: string) => void; target: Member | undefined }) {
  const [open, setOpen] = useState(false)
  const entry = props.entry
  const detail = entry.detail && entry.detail !== entry.text ? entry.detail : null
  return (
    <li className="moment" data-fresh={entry.seq === 0} data-kind={entry.kind}>
      <time dateTime={new Date(entry.at).toISOString()}>{clock(entry.at)}</time>
      <span className="moment-kind">{kinds[entry.kind]}</span>
      <div className="moment-body">
        {entry.kind === 'message' ? <div className="moment-message" data-open={open}><Markdown text={entry.text} /></div> : entry.kind === 'output' ? <pre className="moment-output" data-open={open}>{detail ?? entry.text}</pre> : props.target ? <button className="moment-link" onClick={() => props.target && props.onFocus(props.target.id)} type="button">{entry.text} →</button> : <p className={entry.kind === 'thinking' ? 'moment-thought' : 'moment-text'}>{entry.text}</p>}
        {((entry.kind === 'output' && (detail ?? '').split('\n').length > 6) || (entry.kind === 'message' && (entry.text.length > 700 || entry.text.split('\n').length > 10))) && <button className="entry-toggle" onClick={() => setOpen(!open)} type="button">{open ? '[−] less' : '[+] all of it'}</button>}
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

function Ticker(props: { entries: readonly Entry[]; live: boolean; names: ReadonlyMap<string, string>; onFocus: (id: string) => void }) {
  const recent = props.entries.filter((entry) => entry.kind !== 'output').slice(-14)
  if (!recent.length) return null
  return (
    <div className="ticker">
      <p className="label">{props.live ? 'Everyone, as it happens' : 'Everyone, last moments of the round'}</p>
      <ol>
        {recent.map((entry) => {
          const who = speaker(entry.who)
          return (
            <li data-fresh={entry.seq === 0} key={entry.event === null ? `s${entry.seq}` : `e${entry.event}${entry.kind}`}>
              <button onClick={() => props.onFocus(who)} style={{ color: hue(who) }} type="button">{props.names.get(who) ?? 'Explorer'}</button>
              <span>{entry.kind === 'thinking' ? `thought: ${entry.text}` : entry.text}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const verbs = { error: 'hit an error', funds: 'moved money', machine: 'is on a machine', message: 'said', output: 'got back', status: 'changed course', steer: 'was steered', thinking: 'thought', tool: 'ran' } as const

export function OnAir(props: { id: string }) {
  const [heard, setHeard] = useState<{ item: string; label: string; text: string; who: string }>()
  const names = useRef(new Map<string, string>([['lead', 'Lead researcher']]))
  useEffect(() => {
    const hear = (who: string, label: string, item: string, delta: string, replace = false) =>
      setHeard((previous) => ({ item, label, text: (replace || previous?.item !== item || previous.who !== who ? delta : previous.text + delta).slice(-220), who }))
    return Api.live(props.id, (event) => {
      if (event.type === 'thinking') hear('lead', 'is thinking', event.item, event.delta)
      if (event.type === 'text') hear('lead', 'is writing', event.item, event.delta)
      if (event.type === 'delta') hear(speaker(event.who), event.channel === 'thinking' ? 'is thinking' : event.channel === 'input' ? 'is writing code' : 'is writing', `${event.channel}:${event.item}`, event.delta)
      if (event.type === 'researcher') names.current.set(event.researcher.id, event.researcher.name)
      if (event.type === 'entry' && event.entry.kind !== 'thinking') hear(speaker(event.entry.who), verbs[event.entry.kind], `entry:${event.entry.event}`, line(event.entry.kind === 'output' ? event.entry.detail ?? event.entry.text : event.entry.text), true)
    })
  }, [props.id])
  return (
    <div aria-live="off" className="onair">
      <p className="onair-head"><span className="broadcast-badge" data-live="true"><i />LIVE</span>{heard ? <span><b style={{ color: hue(heard.who) }}>{names.current.get(heard.who) ?? 'An explorer'}</b> {heard.label}</span> : <span>Tuning in…</span>}</p>
      <p className="onair-text">{heard?.text ?? 'The team is on the case.'}</p>
    </div>
  )
}
