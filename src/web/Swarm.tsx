import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import type { Config, Detail, Entry, Me, Member, Note, Said } from '../shared/Api.ts'
import { merge } from '../shared/Trail.ts'
import * as Api from './api.ts'
import { here, seeded } from './boot.ts'
import { Connect } from './Connect.tsx'
import { asked, Fund } from './Contribute.tsx'
import { ago, duration, mach, percent, short, usd } from './format.ts'
import { remembered, useLive, useMedia, usePoll, useStable, useVisible } from './hooks.ts'
import { Lost } from './Lost.tsx'
import { Presence } from './Ideas.tsx'
import { Machines } from './Machines.tsx'
import { Markdown } from './Markdown.tsx'
import { Room } from './Room.tsx'
import { Link } from './router.tsx'
import { Transcript } from './Transcript.tsx'
import { Bar, Energy, Status } from './Visual.tsx'

let loaded: typeof import('./Code.tsx') | undefined

function load() {
  return import('./Code.tsx').then((module) => (loaded = module))
}

function roomy() {
  const connection = (navigator as { connection?: { effectiveType?: string; saveData?: boolean } }).connection
  return !connection?.saveData && (connection?.effectiveType ?? '4g') === '4g'
}

function idle(run: () => void) {
  const schedule = (window as { requestIdleCallback?: (run: () => void, options: { timeout: number }) => number }).requestIdleCallback
  if (schedule) return schedule(run, { timeout: 3000 })
  return setTimeout(run, 1500)
}

const Code = lazy(() => load().then((module) => ({ default: module.Code })))

const trails = new Map<string, { entries: readonly Entry[]; seq: number }>()

const tabs = ['transcript', 'room', 'code', 'machines', 'about'] as const

type Tab = (typeof tabs)[number]


function subscribe(listener: () => void) {
  addEventListener('hashchange', listener)
  addEventListener('popstate', listener)
  return () => {
    removeEventListener('hashchange', listener)
    removeEventListener('popstate', listener)
  }
}

function useTab() {
  const hash = useSyncExternalStore(subscribe, () => location.hash.slice(1), () => '')
  const tab: Tab = (tabs as readonly string[]).includes(hash) ? (hash as Tab) : 'transcript'
  const choose = (next: Tab) => {
    history.replaceState(null, '', `${location.pathname}${location.search}${next === 'transcript' ? '' : `#${next}`}`)
    dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return [tab, choose] as const
}

export function Swarm(props: { config: Config | undefined; id: string }) {
  const [entries, setEntries] = useState<readonly Entry[]>(() => trails.get(props.id)?.entries ?? remembered<Detail>(props.id)?.feed ?? seeded<Detail>(props.id)?.feed ?? [])
  const first = useRef(entries.length === 0)
  const [detail, reload] = usePoll(() => {
    const full = first.current
    first.current = false
    return Api.swarm(props.id, full)
  }, (data) => (data?.status === 'running' ? 5000 : 10_000), props.id)
  const last = useRef(trails.get(props.id)?.seq ?? highest(entries))
  useEffect(() => {
    if (entries.length) trails.set(props.id, { entries: entries.slice(-400), seq: last.current })
  }, [entries, props.id])
  const [note, setNote] = useState('')
  const [tab, setTab] = useTab()
  const [unread, setUnread] = useState(0)
  const [result, setResult] = useState(false)
  const [prefill] = useState(() => asked())
  const [draft, setDraft] = useState({ at: 0, text: '' })
  const [chat, setChat] = useState<{ handles: ReadonlyMap<string, string>; me: Me | null; members: readonly Member[]; online: readonly string[]; said: readonly Said[]; watching: number }>({ handles: new Map(), me: null, members: [], online: [], said: [], watching: 0 })
  const heard = useCallback((said: readonly Said[], me: Me | null, members: readonly Member[], online: readonly string[], watching: number) => setChat((previous) => ({ handles: new Map(members.map((member) => [member.address, member.handle])), me, members, online, watching, said: [...said, ...previous.said.filter((item) => !said.some((other) => other.id === item.id) && item.id > (said.at(-1)?.id ?? 0))] })), [])
  const [funding, setFunding] = useState(() => here().searchParams.has('fund'))
  const visible = useVisible()
  const wide = useMedia('(min-width: 1100px)')
  const phone = useMedia('(max-width: 799px)')
  const running = detail.data?.status === 'running'
  const loaded = detail.data !== undefined
  const stream = useLive(props.id, running && visible, (entry) => setEntries((previous) => merge(previous, [entry])), () => last.current)
  const coded = !!detail.data?.code
  useEffect(() => {
    if (!coded) return
    let alive = true
    const timer = setTimeout(() => {
      void Api.code(props.id).catch(() => undefined)
      if (!phone && roomy())
        idle(() => {
          if (alive) void load()
        })
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [coded, phone, props.id])
  const warm = (item: Tab) => (item === 'code' && coded ? { onFocus: () => void load(), onPointerEnter: () => void load(), onTouchStart: () => void load() } : {})

  useEffect(() => {
    if (!detail.data) return
    last.current = Math.max(last.current, highest(detail.data.feed))
    setEntries((previous) => merge(previous, detail.data?.feed ?? []))
  }, [detail.data])

  useEffect(() => {
    if (detail.data) document.title = `${detail.data.title} · Swarms`
  }, [detail.data?.title])

  const pace = running ? (stream.pushed ? 15_000 : 2000) : 10_000
  const stamp = `${detail.data?.status}:${detail.data?.updatedAt}`
  const polled = useRef(false)
  useEffect(() => {
    if (!loaded || !visible) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const { entries: next } = await Api.feed(props.id, last.current)
        if (!alive) return
        last.current = Math.max(last.current, highest(next))
        setEntries((previous) => merge(previous, next))
      } catch {}
      if (alive) timer = setTimeout(() => void run(), pace)
    }
    timer = setTimeout(() => void run(), polled.current ? 0 : 2000)
    polled.current = true
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [loaded, props.id, pace, stamp, visible])

  const back = useStable((text: string) => {
    setTab('transcript')
    if (text.trim()) {
      setFunding(false)
      return setDraft({ at: Date.now(), text })
    }
    setNote('')
    setFunding(true)
  })
  const backNote = useStable((text: string) => back(text || note))

  if (!detail.data)
    return detail.error ? (
      <Lost title={/no swarm/i.test(detail.error) ? 'This swarm drifted off.' : "Can't reach Swarms."}>
        {!/no swarm/i.test(detail.error) && <button className="lost-row" onClick={() => location.reload()} type="button">Try again <span aria-hidden="true">↻</span></button>}
        <Link className="lost-row" to="/join">Join one <span aria-hidden="true">→</span></Link>
        <Link className="lost-row" to="/new">Start one <span aria-hidden="true">→</span></Link>
      </Lost>
    ) : (
      <section className="page lost" aria-busy="true"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    )

  const swarm = detail.data
  const live = swarm.status === 'running'
  const shown: Tab = wide && tab === 'room' ? 'transcript' : tab
  const connected = swarm.hands.filter((hand) => hand.connected).length
  const fund = <Fund config={props.config} note={note} onDone={() => { reload(); setFunding(false) }} onNote={setNote} prefill={prefill} target={() => Promise.resolve({ id: swarm.id, wallet: swarm.wallet })} title={swarm.title} />
  const choose = (next: Tab) => {
    setTab(next)
  }
  const room = <Room config={props.config} onBack={back} onMessages={heard} onSteered={reload} onUnread={setUnread} swarm={swarm} visible={wide || shown === 'room'} />
  const labels: Record<Tab, ReactNode> = {
    about: 'About',
    code: swarm.code && !phone ? `Code · ${swarm.code.name}` : 'Code',
    machines: connected ? `Machines · ${connected}` : 'Machines',
    room: <>Room<Presence members={chat.members} online={chat.online} watching={chat.watching} />{unread > 0 && <span className="tab-count">{unread}</span>}</>,
    transcript: 'Transcript',
  }

  return (
    <article className="page swarm room-page" data-status={swarm.status}>
      <header className="swarm-head">
        <div className="swarm-title">
          <Link aria-label="All swarms" className="swarm-home" to="/join">←</Link>
          <i aria-label={swarm.status} className="tile-dot" data-status={swarm.status} title={working(swarm)} />
          <h1 title={swarm.title}>{swarm.title}</h1>
          {swarm.status === 'done' && swarm.answer && <button className="btn btn-high swarm-back" onClick={() => setResult(true)} type="button">Result</button>}
        </div>
        <Energy onFund={swarm.status === 'done' ? undefined : () => back(note)} swarm={swarm} />
        {!phone && (
          <nav aria-label="Swarm" className="room-tabs" role="tablist">
            {tabs.filter((item) => item !== 'room' || !wide).map((item) => (
              <button aria-controls={`panel-${item}`} aria-selected={shown === item} key={item} onClick={() => setTab(item)} role="tab" type="button" {...warm(item)}>
                {labels[item]}
              </button>
            ))}
          </nav>
        )}
      </header>
      {result && <Result onClose={() => setResult(false)} swarm={swarm} />}
      <div className="room-layout">
        <section className="room-main">
          {phone && (
            <nav aria-label="Swarm" className="phone-views" role="tablist">
              {(['transcript', 'room', 'code', 'machines'] as const).map((item) => (
                <button aria-selected={shown === item} key={item} onClick={() => setTab(item)} role="tab" type="button" {...warm(item)}>
                  {labels[item]}
                </button>
              ))}
            </nav>
          )}
          <div className="room-panel" data-tab={shown} hidden={shown !== 'transcript'} id="panel-transcript" role="tabpanel">
            <Transcript
              config={props.config}
              draft={draft}
              entries={entries}
              handles={chat.handles}
              live={stream}
              me={chat.me}
              onClose={() => setFunding(false)}
              onEmpty={swarm.status !== 'done' ? () => back(note) : undefined}
              onFund={backNote}
              onEntries={(next) => setEntries((previous) => merge(previous, next))}
              onPeople={() => {
                if (!wide) return setTab('room')
                document.querySelector<HTMLTextAreaElement>('.room .composer textarea')?.focus()
              }}
              onSaid={(said) => {
                setChat((previous) => ({ ...previous, said: [...previous.said.filter((item) => item.id !== said.id), said] }))
                reload()
              }}
              people={!phone}
              said={chat.said}
              swarm={swarm}
              tray={funding && swarm.status !== 'done' ? fund : undefined}
            />
          </div>
          {!wide && (
            <div className="room-panel" data-tab="room" hidden={shown !== 'room'} id="panel-room" role="tabpanel">
              {room}
            </div>
          )}
          {shown !== 'transcript' && shown !== 'room' && (
            <div className="room-panel room-page-panel" data-tab={shown} id={`panel-${shown}`} role="tabpanel">
              {shown === 'code' && <Repository config={props.config} swarm={swarm} />}
              {shown === 'machines' && (
                <>
                  <Machines entries={entries} hands={swarm.hands} live={live} swarm={swarm.id} />
                  <Connect swarm={swarm} />
                </>
              )}
              {shown === 'about' && (
                <>
                  <section className="panel-section">
                    <h2 className="panel-head">The question</h2>
                    <p className="about-goal">{swarm.goal}</p>
                  </section>
                  <nav className="lost-actions about-more">
                    <Link className="lost-row" to="/about">How swarms work <span aria-hidden="true">→</span></Link>
                  </nav>
                </>
              )}
            </div>
          )}
        </section>
        {wide && <aside className="room-side">{room}</aside>}
      </div>
    </article>
  )
}

function highest(entries: readonly Entry[]) {
  return entries.reduce((most, entry) => Math.max(most, entry.seq), 0)
}

function working(swarm: Detail) {
  return swarm.status === 'running' ? 'Live' : swarm.status === 'done' ? 'Finished' : swarm.status === 'funding' ? 'Not started' : 'Paused'
}

function Result(props: { onClose: () => void; swarm: Detail }) {
  const close = props.onClose
  useEffect(() => {
    const listener = (event: KeyboardEvent) => event.key === 'Escape' && close()
    addEventListener('keydown', listener)
    return () => removeEventListener('keydown', listener)
  }, [close])
  const answer = props.swarm.answer
  return (
    <div className="sheet" role="dialog" aria-label="The result">
      <button aria-label="Close" className="sheet-scrim" onClick={close} type="button" />
      <article className="sheet-card">
        <header className="sheet-head">
          <p className="label">{answer?.done ? 'The result' : 'Latest update'}</p>
          <button className="btn btn-low" onClick={close} type="button">Close</button>
        </header>
        <div className="sheet-body">{answer ? <Markdown text={Answer.unround(answer.text)} /> : <p className="empty">No result yet.</p>}</div>
      </article>
    </div>
  )
}

function Repository(props: { config: Config | undefined; swarm: Detail }) {
  const code = props.swarm.code
  if (!code || !props.config)
    return (
      <p className="machine-none">No code yet. The agent opens its repository once one backer can cover {usd(props.config?.repoAt ?? '1.04')}.</p>
    )
  if (loaded) return <loaded.Code gateway={props.config.gateway} repo={code} swarm={props.swarm.id} updates={props.swarm.updates} />
  return (
    <Suspense fallback={<p className="empty">Loading the code…</p>}>
      <Code gateway={props.config.gateway} repo={code} swarm={props.swarm.id} updates={props.swarm.updates} />
    </Suspense>
  )
}

function returned(swarm: Detail) {
  const rest = BigInt(Memo.units(swarm.raised)) - BigInt(Memo.units(swarm.spent)) - BigInt(Memo.units(swarm.remaining))
  return rest > 0n ? rest : 0n
}

