import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Entry, Kind } from '../shared/Api.ts'
import { ago, clock } from './format.ts'
import { useNow } from './hooks.ts'

const kinds = { error: 'error', funds: 'funds', machine: 'machine', message: 'agent', status: 'status', steer: 'steer', thinking: 'thinking', tool: 'tool' } as const satisfies Record<Kind, string>

function Row(props: { entry: Entry; fresh: boolean }) {
  const [open, setOpen] = useState(false)
  const entry = props.entry
  return (
    <li className={props.fresh ? 'entry entry-fresh' : 'entry'} data-kind={entry.kind}>
      <time dateTime={new Date(entry.at).toISOString()}>{clock(entry.at)}</time>
      <span className="entry-kind">{kinds[entry.kind]}</span>
      <div className="entry-body">
        <p className="entry-text">{entry.text}</p>
        {entry.detail && (
          <>
            <button aria-expanded={open} className="entry-toggle" onClick={() => setOpen(!open)} type="button">
              {open ? '[−] detail' : '[+] detail'}
            </button>
            {open && <pre className="entry-detail">{entry.detail}</pre>}
          </>
        )}
      </div>
    </li>
  )
}

export function Feed(props: { entries: readonly Entry[]; live: boolean }) {
  const box = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
  const seen = useRef<number | undefined>(undefined)
  const [below, setBelow] = useState(0)
  const now = useNow(1000)
  const last = props.entries.at(-1)
  const first = seen.current

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    if (stick.current) element.scrollTop = element.scrollHeight
    else setBelow((count) => count + 1)
  }, [last?.seq])

  useEffect(() => {
    if (seen.current === undefined && last) seen.current = last.seq
  }, [last])

  return (
    <div className="feed" data-live={props.live}>
      <div className="feed-head">
        <span className="feed-live">
          <i />
          {props.live ? 'Live' : 'Idle'}
        </span>
        <span>{props.entries.length} entries</span>
        <span>{last ? `last ${ago(last.at, now)}` : 'nothing yet'}</span>
      </div>
      <ol
        className="feed-list"
        onScroll={(event) => {
          const element = event.currentTarget
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          if (stick.current) setBelow(0)
        }}
        ref={box}
      >
        {props.entries.length === 0 && <li className="feed-empty">The feed fills in once the swarm starts working.</li>}
        {props.entries.map((entry) => (
          <Row entry={entry} fresh={first !== undefined && entry.seq > first} key={entry.seq} />
        ))}
        {props.live && (
          <li aria-hidden className="feed-cursor">
            <span />
          </li>
        )}
      </ol>
      {below > 0 && (
        <button
          className="btn btn-medium feed-jump"
          onClick={() => {
            const element = box.current
            if (element) element.scrollTo({ behavior: 'smooth', top: element.scrollHeight })
            stick.current = true
            setBelow(0)
          }}
          type="button"
        >
          New entries ↓
        </button>
      )}
    </div>
  )
}
