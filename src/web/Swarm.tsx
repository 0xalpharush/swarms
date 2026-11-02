import { lazy, type ReactNode, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import type { Config, Detail, Entry, Note, Update } from '../shared/Api.ts'
import { merge } from '../shared/Trail.ts'
import * as Api from './api.ts'
import { Budgets, Contributions, Pledges } from './Backing.tsx'
import { Connect } from './Connect.tsx'
import { Artifacts } from './Artifacts.tsx'
import { Box } from './Contribute.tsx'
import { ago, duration, mach, percent, short, usd } from './format.ts'
import { agent, type Live, useLive, useMedia, useNow, usePoll } from './hooks.ts'
import { Machines } from './Machines.tsx'
import { Markdown } from './Markdown.tsx'
import { Room } from './Room.tsx'
import { Link } from './router.tsx'
import { Transcript } from './Transcript.tsx'
import { Bar, Status } from './Visual.tsx'

const Code = lazy(() => import('./Code.tsx').then((module) => ({ default: module.Code })))

const tabs = ['transcript', 'room', 'artifacts', 'answer', 'fund', 'code', 'machines', 'brief'] as const

type Tab = (typeof tabs)[number]

const docked = ['transcript', 'room', 'artifacts', 'answer'] as const satisfies readonly Tab[]

const icons: Record<(typeof docked)[number] | 'more', ReactNode> = {
  answer: <path d="M5 4h10l4 4v12H5zM14 4v5h5M8 13l3 3 5-6" />,
  artifacts: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  room: <path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5" />,
  transcript: <path d="M4 6h16M4 10h11M4 14h16M4 18h8" />,
}

function chosen() {
  return new URLSearchParams(location.search).get('artifact') ?? undefined
}

function subscribe(listener: () => void) {
  addEventListener('hashchange', listener)
  addEventListener('popstate', listener)
  return () => {
    removeEventListener('hashchange', listener)
    removeEventListener('popstate', listener)
  }
}

function useTab() {
  const hash = useSyncExternalStore(subscribe, () => location.hash.slice(1))
  const tab: Tab = (tabs as readonly string[]).includes(hash) ? (hash as Tab) : new URLSearchParams(location.search).has('fund') ? 'fund' : 'transcript'
  const choose = (next: Tab) => {
    history.replaceState(null, '', `${location.pathname}${location.search}${next === 'transcript' ? '' : `#${next}`}`)
    dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return [tab, choose] as const
}

export function Swarm(props: { config: Config | undefined; id: string }) {
  const [detail, reload] = usePoll(() => Api.swarm(props.id), 5000, props.id)
  const [entries, setEntries] = useState<readonly Entry[]>([])
  const [note, setNote] = useState('')
  const [tab, setTab] = useTab()
  const [artifact, setArtifact] = useState(chosen)
  const [unread, setUnread] = useState(0)
  const [more, setMore] = useState(false)
  const wide = useMedia('(min-width: 1100px)')
  const phone = useMedia('(max-width: 799px)')
  const running = detail.data?.status === 'running'
  const [shelf] = usePoll(() => Api.artifacts(props.id), running ? 30_000 : 60_000, props.id)
  const last = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const loaded = detail.data !== undefined
  const stream = useLive(props.id, running, (entry) => setEntries((previous) => merge(previous, [entry])))

  useEffect(() => {
    setEntries([])
    last.current = 0
  }, [props.id])

  useEffect(() => {
    if (detail.data) setEntries((previous) => merge(previous, detail.data?.feed ?? []))
  }, [detail.data])

  useEffect(() => {
    last.current = entries.reduce((most, entry) => Math.max(most, entry.seq), 0)
  }, [entries])

  useEffect(() => {
    if (detail.data) document.title = `${detail.data.title} · Swarms`
  }, [detail.data?.title])

  useEffect(() => {
    const url = new URL(location.href)
    if (artifact) url.searchParams.set('artifact', artifact)
    else url.searchParams.delete('artifact')
    history.replaceState(null, '', url)
  }, [artifact])

  useEffect(() => {
    if (!loaded) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const { entries: next } = await Api.feed(props.id, last.current)
        if (alive) setEntries((previous) => merge(previous, next))
      } catch {}
      if (alive) timer = setTimeout(() => void run(), 2000)
    }
    timer = setTimeout(() => void run(), 2000)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [loaded, props.id])

  if (!detail.data)
    return (
      <section className="page missing">
        <p className="label">{detail.error ? 'Could not load the swarm' : 'Loading…'}</p>
        {detail.error && (
          <p className="lead">
            {detail.error} <Link to="/">Back to all swarms</Link>
          </p>
        )}
      </section>
    )

  const swarm = detail.data
  const live = swarm.status === 'running'
  const shown: Tab = wide && tab === 'room' ? 'transcript' : tab
  const connected = swarm.hands.filter((hand) => hand.connected).length
  const back = (text: string) => {
    setNote(text)
    setTab('fund')
    setTimeout(() => document.getElementById('amount')?.focus({ preventScroll: true }), 120)
  }
  const open = (slug: string) => {
    setArtifact(slug)
    setTab('artifacts')
  }
  const choose = (next: Tab) => {
    setMore(false)
    setTab(next)
  }
  const room = <Room config={props.config} onArtifact={open} onBack={back} onSteered={reload} onUnread={setUnread} swarm={swarm} visible={wide || shown === 'room'} />
  const count = shelf.data?.artifacts.length ?? 0
  const labels: Record<Tab, ReactNode> = {
    answer: swarm.updates.length ? `Updates · ${swarm.updates.length}` : 'Updates',
    artifacts: count ? `Artifacts · ${count}` : 'Artifacts',
    brief: 'Brief',
    code: swarm.code ? `Code · ${swarm.code.name}` : 'Code',
    fund: swarm.status === 'done' ? 'Backers' : 'Back it',
    machines: connected ? `Machines · ${connected}` : 'Machines',
    room: unread ? <>Room<span className="tab-count">{unread}</span></> : 'Room',
    transcript: live ? <><i className="tab-live" />Transcript</> : 'Transcript',
  }
  const short: Record<(typeof docked)[number], string> = { answer: 'Updates', artifacts: 'Artifacts', room: 'Room', transcript: 'Live' }

  return (
    <article className="page swarm room-page" data-status={swarm.status}>
      <header className="swarm-head">
        <div className="swarm-name">
          <Meta swarm={swarm} />
          <h1>{swarm.title}</h1>
        </div>
        <dl className="swarm-figures">
          <div><dt>Raised</dt><dd>{usd(swarm.raised)}</dd></div>
          <div><dt>Spent</dt><dd>{usd(swarm.spent)}</dd></div>
          {returned(swarm) > 0 && <div title="Pledges that ended before they were used up: the unspent part never left the backer's wallet."><dt>Back to backers</dt><dd>{usd(Memo.decimal(returned(swarm)))}</dd></div>}
          {swarm.status !== 'done' && <div><dt>Left</dt><dd>{usd(swarm.remaining)}</dd></div>}
          <div><dt>Backers</dt><dd>{swarm.contributors}</dd></div>
        </dl>
        {swarm.status !== 'done' && <button className="btn btn-high swarm-back" onClick={() => back(note)} type="button">Back it</button>}
      </header>
      {swarm.status !== 'running' && <p className="banner">{swarm.status === 'done' ? 'Done. The latest update is what the swarm found; the transcript keeps everything it did.' : swarm.reason ?? (swarm.status === 'paused' ? 'Waiting for money: a contribution, budget or pledge keeps it going.' : 'No money behind it yet. The first contribution starts its agent.')}</p>}
      <div className="room-layout">
        <section className="room-main">
          {!phone && (
            <nav aria-label="Swarm" className="room-tabs" role="tablist">
              {tabs.filter((item) => item !== 'room' || !wide).map((item) => (
                <button aria-controls={`panel-${item}`} aria-selected={shown === item} key={item} onClick={() => setTab(item)} role="tab" type="button">
                  {labels[item]}
                </button>
              ))}
            </nav>
          )}
          <div className="room-panel" data-tab={shown} hidden={shown !== 'transcript'} id="panel-transcript" role="tabpanel">
            <Transcript
              empty={swarm.status !== 'done' && <button className="btn btn-high" onClick={() => back(note)} type="button">Back it to start the agent</button>}
              entries={entries}
              live={stream}
              onEntries={(next) => setEntries((previous) => merge(previous, next))}
              swarm={swarm}
            />
          </div>
          {!wide && (
            <div className="room-panel" data-tab="room" hidden={shown !== 'room'} id="panel-room" role="tabpanel">
              {room}
            </div>
          )}
          {shown !== 'transcript' && shown !== 'room' && (
            <div className="room-panel room-page-panel" data-tab={shown} id={`panel-${shown}`} role="tabpanel">
              {shown === 'artifacts' && <Artifacts artifacts={shelf.data?.artifacts} error={shelf.error} onSelect={setArtifact} selected={artifact} working={live} />}
              {shown === 'answer' && (
                <>
                  <section className="quest-findings">
                    <h2 className="answer-head">{swarm.status === 'done' ? 'What it found' : 'Latest update'}</h2>
                    <Latest live={stream} swarm={swarm} />
                  </section>
                  {swarm.updates.length > 1 && (
                    <section className="panel-section">
                      <h2 className="panel-head">Earlier updates</h2>
                      <Updates updates={swarm.updates.slice(0, -1)} />
                    </section>
                  )}
                </>
              )}
              {shown === 'fund' && (
                <div className="fund-panel">
                  {swarm.status !== 'done' && (
                    <section className="quest-funding">
                      <Box config={props.config} note={note} noteRef={box} onDone={reload} onNote={setNote} swarm={swarm} />
                    </section>
                  )}
                  <div className="fund-record">
                    <Ledger config={props.config} swarm={swarm} />
                    <section className="panel-section">
                      <h2 className="panel-head">Notes, by the money behind them</h2>
                      <Notes notes={swarm.notes} onBack={back} done={swarm.status === 'done'} />
                    </section>
                    <details className="game-details"><summary>Funding record</summary><Budgets budgets={swarm.budgets} config={props.config} /><Contributions config={props.config} contributions={swarm.contributions} /><Pledges config={props.config} pledges={swarm.pledges} /></details>
                  </div>
                </div>
              )}
              {shown === 'code' && <Repository config={props.config} swarm={swarm} />}
              {shown === 'machines' && (
                <>
                  <Machines hands={swarm.hands} live={live} />
                  <Connect swarm={swarm} />
                </>
              )}
              {shown === 'brief' && (
                <>
                  <section className="panel-section">
                    <h2 className="panel-head">The question</h2>
                    <p className="brief-goal">{swarm.goal}</p>
                  </section>
                  <section className="panel-section">
                    <h2 className="panel-head">How it works</h2>
                    <p className="brief-how">One agent works on this in a single thread for as long as its money lasts, and spawns subagents when it wants help. Backers steer it with @swarm in the room or with a note on their money; the agent posts an update when it has something to report and keeps going until it says the goal is met.</p>
                  </section>
                </>
              )}
            </div>
          )}
        </section>
        {wide && <aside className="room-side">{room}</aside>}
      </div>
      {phone && (
        <>
          {more && <button aria-label="Close the menu" className="dock-scrim" onClick={() => setMore(false)} type="button" />}
          {more && (
            <div className="dock-sheet" role="menu">
              {(['fund', 'code', 'machines', 'brief'] as const).map((item) => (
                <button aria-current={shown === item} key={item} onClick={() => choose(item)} role="menuitem" type="button">
                  {labels[item]}
                </button>
              ))}
            </div>
          )}
          <nav aria-label="Swarm" className="dock">
            {docked.map((item) => (
              <button aria-current={shown === item && !more} className="dock-item" key={item} onClick={() => choose(item)} type="button">
                <svg aria-hidden viewBox="0 0 24 24">{icons[item]}</svg>
                <span>{short[item]}</span>
                {item === 'transcript' && live && <i className="dock-live" />}
                {item === 'room' && unread > 0 && <b className="dock-count">{unread > 99 ? '99+' : unread}</b>}
                {item === 'artifacts' && count > 0 && <b className="dock-count dock-quiet">{count}</b>}
              </button>
            ))}
            <button aria-current={more || (['fund', 'code', 'machines', 'brief'] as readonly Tab[]).includes(shown)} aria-expanded={more} className="dock-item" onClick={() => setMore(!more)} type="button">
              <svg aria-hidden viewBox="0 0 24 24">{icons.more}</svg>
              <span>More</span>
            </button>
          </nav>
        </>
      )}
    </article>
  )
}

function Meta(props: { swarm: Detail }) {
  const now = useNow()
  const working = props.swarm.working
  const latest = props.swarm.updates.at(-1)
  return (
    <p className="meta">
      <Status status={props.swarm.status} />
      {working ? <span>Working for {duration(now - working.since)}</span> : latest && <span>Updated {ago(latest.at, now)}</span>}
      <span>Started {ago(props.swarm.createdAt, now)}</span>
    </p>
  )
}

function Repository(props: { config: Config | undefined; swarm: Detail }) {
  const code = props.swarm.code
  if (!code || !props.config)
    return (
      <p className="empty">
        The swarm's agent creates its public repository first thing once one funder can pay {usd(props.config?.repoAt ?? '1.04')} at once: the repository costs $1 of its money, once, and every commit then shows up here as it lands. It holds {usd(props.swarm.remaining)} now.
      </p>
    )
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

function Ledger(props: { config: Config | undefined; swarm: Detail }) {
  const swarm = props.swarm
  return (
    <div className="ledger">
      <p className="label">{swarm.status === 'done' ? 'Spent' : 'Left to spend'}</p>
      <p className="figure">
        {mach(swarm.status === 'done' ? swarm.spent : swarm.remaining)} <span>USD</span>
      </p>
      <Bar swarm={swarm} />
      <dl className="figures">
        <div>
          <dt>Machines</dt>
          <dd>{swarm.machines}</dd>
        </div>
        <div>
          <dt>Backers</dt>
          <dd>{swarm.contributors}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd>{swarm.updates.length}</dd>
        </div>
      </dl>
      {swarm.wallet && (
        <p className="address">
          <span>Swarm wallet</span>
          {props.config ? (
            <a href={`${props.config.explorer}/address/${swarm.wallet}`} rel="noreferrer" target="_blank" title={swarm.wallet}>
              {short(swarm.wallet)} ↗
            </a>
          ) : (
            <span>{short(swarm.wallet)}</span>
          )}
          <span>{usd(swarm.pool)} pooled</span>
        </p>
      )}
      {props.config && (
        <p className="fine">
          Stablecoins count one to one. The agent waits whenever less than {usd(props.config.reserve)} is payable, and carries on when money comes in.
        </p>
      )}
    </div>
  )
}

function Notes(props: { done: boolean; notes: readonly Note[]; onBack: (note: string) => void }) {
  if (props.notes.length === 0) return <p className="empty">No notes yet. A transfer, a budget or a pledge can carry one, and the swarm weighs it by the money behind it.</p>
  return (
    <ol className="notes">
      {props.notes.map((note, index) => (
        <li className="note" key={note.id}>
          <span className="index">[{index + 1}]</span>
          <div>
            <p className="note-text">{note.note}</p>
            <div className="share">
              <div style={{ width: `${Math.max(1, note.share * 100)}%` }} />
            </div>
            <p className="note-meta">
              <span>{usd(note.weight)}</span>
              <span>{percent(note.share)} of everything in</span>
              <span>{note.backers === 1 ? '1 backer' : `${note.backers} backers`}</span>
              <span className={note.steered ? 'tag tag-on' : 'tag'}>{note.steered ? 'Sent to the swarm' : 'Not sent yet'}</span>
            </p>
            {!props.done && (
              <button className="btn btn-low" onClick={() => props.onBack(note.note)} type="button">
                Back this note
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

const waiting = {
  done: 'The swarm ended without an update.',
  funding: 'No update yet. The first transfer, budget or pledge starts its agent, and what it reports lands here.',
  paused: 'No update yet. The agent is waiting for more money.',
  running: '',
} as const

function Latest(props: { live: Live; swarm: Detail }) {
  const now = useNow()
  const answer = props.swarm.answer
  const working = props.swarm.working
  const stream = props.live.streams[agent]
  const text = stream?.text ? Answer.parse(stream.text, 0).text : ''
  return (
    <div className="answer">
      {working && (
        <div className="answer-live">
          <p className="answer-meta">
            <i className="answer-dot" />
            {text ? 'Writing its next update' : 'Working'} · for {duration(now - working.since)}
          </p>
          {text ? (
            <Markdown streaming text={text} />
          ) : (
            <p className="answer-thinking">{stream?.thinking ? `Thinking: …${stream.thinking.slice(-280)}` : 'Its next update streams in here as it writes it.'}</p>
          )}
        </div>
      )}
      {answer ? (
        <div className="answer-final">
          <p className="answer-meta">
            <span>{ago(answer.at, now)}</span>
            {answer.done && <span className="tag tag-on">Reported complete</span>}
          </p>
          <Markdown text={answer.text} />
        </div>
      ) : (
        !working && <p className="empty">{waiting[props.swarm.status]}</p>
      )}
    </div>
  )
}

function Updates(props: { updates: readonly Update[] }) {
  const now = useNow(30_000)
  return (
    <ol className="rounds">
      {[...props.updates].reverse().map((update) => (
        <li className="round" data-status="completed" key={update.at}>
          <details>
            <summary>
              <span className="round-n">{ago(update.at, now)}</span>
              <span className="round-excerpt">{Answer.excerpt(update.text, 90)}</span>
              <span>{usd(update.spent)}</span>
            </summary>
            <Markdown text={update.text} />
            {update.commits.length > 0 && <p className="fine">Pushed {update.commits.length} commit{update.commits.length === 1 ? '' : 's'}.</p>}
          </details>
        </li>
      ))}
    </ol>
  )
}
