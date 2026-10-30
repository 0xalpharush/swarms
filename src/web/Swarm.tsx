import { useEffect, useRef, useState } from 'react'
import type { Config, Detail, Entry, Note, Pledge, Round } from '../shared/Api.ts'
import * as Api from './api.ts'
import { Feed } from './Feed.tsx'
import { ago, duration, mach, percent, short } from './format.ts'
import { useMedia, useNow, usePoll, useWallet } from './hooks.ts'
import { Machines } from './Machines.tsx'
import { Box } from './Pledge.tsx'
import { Link } from './router.tsx'
import { Bar, Constellation, Status } from './Visual.tsx'

function merge(previous: Entry[], next: readonly Entry[]) {
  const known = new Set(previous.map((entry) => entry.seq))
  const fresh = next.filter((entry) => !known.has(entry.seq))
  if (fresh.length === 0) return previous
  return [...previous, ...fresh].sort((a, b) => a.seq - b.seq).slice(-500)
}

const banners = {
  done: 'Done. The last report below is what the swarm found.',
  funding: 'No money behind it yet. The first pledge starts round 1.',
  paused: 'Out of money, so the swarm is paused. A pledge resumes it.',
} as const

const rounds = { cancelled: 'Cancelled', completed: 'Completed', failed: 'Failed', running: 'Running' } as const satisfies Record<Round['status'], string>

const pledges = { active: 'Active', ended: 'Ended', spent: 'Spent' } as const satisfies Record<Pledge['status'], string>

export function Swarm(props: { config: Config | undefined; id: string; onTitle: (title: string | undefined) => void }) {
  const [detail, reload] = usePoll(() => Api.swarm(props.id), 5000, props.id)
  const [entries, setEntries] = useState<Entry[]>([])
  const [note, setNote] = useState('')
  const last = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const wide = useMedia('(min-width: 600px)')
  const loaded = detail.data !== undefined
  const onTitle = props.onTitle

  useEffect(() => {
    setEntries([])
    last.current = 0
  }, [props.id])

  useEffect(() => {
    if (detail.data) setEntries((previous) => merge(previous, detail.data?.feed ?? []))
  }, [detail.data])

  useEffect(() => {
    last.current = entries.at(-1)?.seq ?? 0
  }, [entries])

  useEffect(() => {
    onTitle(detail.data?.title)
    if (detail.data) document.title = `${detail.data.title} · Swarms`
  }, [detail.data?.title, onTitle])

  useEffect(() => () => onTitle(undefined), [onTitle])

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
  const back = (text: string) => {
    setNote(text)
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => document.getElementById('amount')?.focus({ preventScroll: true }), 400)
  }

  return (
    <article className="page swarm" data-status={swarm.status}>
      <section className="grid swarm-top">
        <div className="swarm-intro">
          <Meta swarm={swarm} />
          <h1 className="display">{swarm.title}</h1>
          <p className="goal">{swarm.goal}</p>
          {swarm.status !== 'running' && <p className="banner">{banners[swarm.status]}</p>}
          <div className="tile tile-wide">
            <Constellation machines={swarm.hands.filter((hand) => hand.connected).map((hand) => hand.name)} swarm={swarm} wide={wide} />
            <p className="tile-caption">
              <span>+ lead agent</span>
              <span>+ explorer at work</span>
              <span>− room for another</span>
              <span>■ machine</span>
            </p>
          </div>
        </div>
        <aside className="swarm-side">
          <Ledger config={props.config} swarm={swarm} />
          <Box config={props.config} note={note} noteRef={box} onDone={reload} onNote={setNote} swarm={swarm} />
        </aside>
      </section>

      <section className="block">
        <h2 className="block-head">
          <span className="index">[1]</span> Machines
          <span className="block-count">{swarm.hands.filter((hand) => hand.connected).length} connected</span>
        </h2>
        <Machines hands={swarm.hands} live={live} />
      </section>

      <section className="grid block">
        <div className="col-main">
          <h2 className="block-head">
            <span className="index">[2]</span> Live feed
          </h2>
          <Feed entries={entries} live={live} />
        </div>
        <div className="col-side">
          <h2 className="block-head">
            <span className="index">[3]</span> Notes
          </h2>
          <Notes notes={swarm.notes} onBack={back} done={swarm.status === 'done'} />
        </div>
      </section>

      <section className="grid block">
        <div className="col-main">
          <h2 className="block-head">
            <span className="index">[4]</span> Rounds
          </h2>
          <History history={swarm.history} />
        </div>
        <div className="col-side">
          <h2 className="block-head">
            <span className="index">[5]</span> Pledges
          </h2>
          <Pledges config={props.config} pledges={swarm.pledges} />
        </div>
      </section>
    </article>
  )
}

function Meta(props: { swarm: Detail }) {
  const now = useNow()
  const running = props.swarm.history.findLast((round) => round.status === 'running')
  return (
    <p className="meta">
      <Status status={props.swarm.status} />
      {running ? (
        <span>
          Round {running.n} · {duration(now - running.startedAt)}
        </span>
      ) : (
        props.swarm.rounds > 0 && <span>{props.swarm.rounds === 1 ? '1 round' : `${props.swarm.rounds} rounds`}</span>
      )}
      <span>Started {ago(props.swarm.createdAt, now)}</span>
    </p>
  )
}

function Ledger(props: { config: Config | undefined; swarm: Detail }) {
  const swarm = props.swarm
  const slots = Math.max(swarm.parallel, swarm.workers, 1)
  return (
    <div className="ledger">
      <p className="label">{swarm.status === 'done' ? 'Spent' : 'Left to spend'}</p>
      <p className="figure">
        {mach(swarm.status === 'done' ? swarm.spent : swarm.remaining)} <span>MACH</span>
      </p>
      <Bar swarm={swarm} />
      <div className="slots" data-live={swarm.status === 'running'}>
        <span className="slots-row" aria-hidden>
          {Array.from({ length: slots }, (_, index) => (
            <i className={index < swarm.workers ? 'slot slot-on' : 'slot'} key={index} style={{ animationDelay: `${index * -0.35}s` }} />
          ))}
        </span>
        <span>
          {swarm.status === 'running' ? `${swarm.workers} of ${swarm.parallel} explorers at work` : `Room for ${swarm.parallel} explorer${swarm.parallel === 1 ? '' : 's'}`}
        </span>
      </div>
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
          <dt>Rounds</dt>
          <dd>{swarm.rounds}</dd>
        </div>
      </dl>
      {props.config && <p className="fine">Each explorer beyond the first needs {mach(props.config.perWorker)} MACH left to spend. The swarm pauses below {mach(props.config.reserve)} MACH.</p>}
    </div>
  )
}

function Notes(props: { done: boolean; notes: readonly Note[]; onBack: (note: string) => void }) {
  if (props.notes.length === 0) return <p className="empty">No notes yet. A pledge can carry one, and the swarm weighs it by the MACH behind it.</p>
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
              <span>{mach(note.weight)} MACH</span>
              <span>{percent(note.share)} of all pledged</span>
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

function History(props: { history: readonly Round[] }) {
  const now = useNow()
  if (props.history.length === 0) return <p className="empty">No rounds yet. Each round ends with a report, and it shows up here.</p>
  const ordered = [...props.history].sort((a, b) => b.n - a.n)
  const latest = ordered.find((round) => round.message)?.n
  return (
    <ol className="rounds">
      {ordered.map((round) => (
        <li className="round" data-status={round.status} key={round.n}>
          <details open={round.status === 'running' || round.n === latest}>
            <summary>
              <span className="round-n">Round {round.n}</span>
              <span className="round-status">
                <i />
                {rounds[round.status]}
              </span>
              <span>{duration((round.endedAt ?? now) - round.startedAt)}</span>
              <span>{mach(round.spent)} MACH</span>
            </summary>
            {round.message ? <Report text={round.message} /> : <p className="empty">{round.status === 'running' ? 'Working. The report appears here when the round ends.' : 'No report.'}</p>}
          </details>
        </li>
      ))}
    </ol>
  )
}

function Report(props: { text: string }) {
  return (
    <p className="report">
      {props.text.split('\n').map((line, index) => (
        <span className={/\S {2,}\S/.test(line) ? 'report-table' : undefined} key={index}>
          {line}
          {'\n'}
        </span>
      ))}
    </p>
  )
}

function Pledges(props: { config: Config | undefined; pledges: readonly Pledge[] }) {
  const wallet = useWallet()
  const [all, setAll] = useState(false)
  if (props.pledges.length === 0) return <p className="empty">No pledges yet.</p>
  const ordered = [...props.pledges].sort((a, b) => b.at - a.at)
  const shown = all ? ordered : ordered.slice(0, 8)
  return (
    <>
      <ol className="pledges">
        {shown.map((pledge) => (
          <li className="pledge-row" data-status={pledge.status} key={pledge.id}>
            <p className="pledge-head">
              {props.config ? (
                <a href={`${props.config.explorer}/address/${pledge.contributor}`} rel="noreferrer" target="_blank">
                  {short(pledge.contributor)}
                </a>
              ) : (
                <span>{short(pledge.contributor)}</span>
              )}
              {wallet.address?.toLowerCase() === pledge.contributor.toLowerCase() && <span className="tag tag-on">You</span>}
              <span className="pledge-ago">{ago(pledge.at)}</span>
            </p>
            <p className="pledge-figures">
              <span>{mach(pledge.amount)} MACH</span>
              <span>{mach(pledge.spent)} spent</span>
              <span className="tag">{pledges[pledge.status]}</span>
            </p>
            {pledge.note && <p className="pledge-note">{pledge.note}</p>}
          </li>
        ))}
      </ol>
      {ordered.length > shown.length && (
        <button className="btn btn-minimal" onClick={() => setAll(true)} type="button">
          Show all {ordered.length}
        </button>
      )}
    </>
  )
}
