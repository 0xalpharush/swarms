import { useState } from 'react'
import type { Summary } from '../shared/Api.ts'
import * as Api from './api.ts'
import { usd } from './format.ts'
import { usePoll } from './hooks.ts'
import { area, questions } from './research.ts'
import { Link } from './router.tsx'
import { Status } from './Visual.tsx'

const order = { running: 0, paused: 1, funding: 2, done: 3 } as const

function Tile(props: { swarm: Summary }) {
  const swarm = props.swarm
  return (
    <li>
      <Link className="tile-swarm" to={`/s/${swarm.id}`}>
        <span className="tile-top">
          <Status status={swarm.status} />
          <span>{swarm.status === 'done' ? `${swarm.rounds} rounds` : swarm.rounds ? `Round ${swarm.rounds}` : 'Round 1 next'}</span>
        </span>
        <span className="tile-title">{swarm.title}</span>
        <span className="tile-meta">
          <span>{area(swarm).label}</span>
          <span>
            {usd(swarm.raised)} · {swarm.contributors} backer{swarm.contributors === 1 ? '' : 's'}
          </span>
        </span>
        <span aria-hidden className="tile-enter">
          {swarm.status === 'running' ? 'Watch and join →' : swarm.status === 'done' ? 'Read →' : 'Join →'}
        </span>
      </Link>
    </li>
  )
}

export function Home() {
  const [list] = usePoll(() => Api.swarms(), 5000, 'swarms')
  const [finished, setFinished] = useState(false)
  const swarms = [...(list.data?.swarms ?? [])].sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt)
  const open = swarms.filter((swarm) => swarm.status !== 'done')
  const done = swarms.filter((swarm) => swarm.status === 'done')
  const shown = finished ? done : open
  const running = open.filter((swarm) => swarm.status === 'running').length

  return (
    <div className="page start">
      <nav aria-label="Getting started" className="quest-steps start-steps">
        <span aria-current="step" className="quest-step" data-reached="true"><span>01</span>Path</span>
        <span className="quest-step"><span>02</span>Question or swarm</span>
        <span className="quest-step"><span>03</span>Back it</span>
        <span className="quest-step"><span>04</span>Watch and steer</span>
      </nav>
      <header className="start-head">
        <p className="label">Open research, funded together</p>
        <h1>Where do you want to start?</h1>
        <p>Start a research swarm of your own, or join one already at work. Either way you watch its transcript live and steer it with the other backers.</p>
      </header>
      <div className="paths">
        <section aria-labelledby="path-new" className="path path-new">
          <p className="path-kicker"><span>A</span>New swarm</p>
          <h2 id="path-new">Ask a new question</h2>
          <p className="path-copy">Pick a starter or write your own. Set a budget and launch: a lead AI and its explorers start working in the open.</p>
          <ol className="path-track"><li>Question</li><li>Budget</li><li>Launch</li></ol>
          <ul className="path-starters">
            {questions.map((item, index) => (
              <li key={item.title}>
                <Link to={`/new?q=${index}`}>
                  <b>{item.label}</b>
                  <span>{item.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link className="btn btn-high path-go" to="/new">Start a swarm <span aria-hidden="true">→</span></Link>
        </section>
        <section aria-labelledby="path-join" className="path path-join" id="join">
          <p className="path-kicker"><span>B</span>Join</p>
          <h2 id="path-join">Back a swarm at work</h2>
          <p className="path-copy">Put any amount behind one and you are in its room: talk with the other backers and steer it with <span className="mention" data-swarm="true">@swarm</span>.</p>
          <ol className="path-track"><li>Pick</li><li>Back it</li><li>Talk and steer</li></ol>
          <div className="path-bar">
            <p className="label">
              {list.error && !list.data ? 'Reconnecting…' : !list.data ? 'Finding swarms…' : finished ? `${done.length} finished` : `${open.length} open · ${running} running now`}
            </p>
            {done.length > 0 && (
              <button className="filter" aria-pressed={finished} onClick={() => setFinished(!finished)} type="button">
                {finished ? 'Show open' : `Finished ${done.length}`}
              </button>
            )}
          </div>
          {list.data && shown.length === 0 ? (
            <p className="path-empty">No swarm is at work yet. Start the first one.</p>
          ) : (
            <ol className="tiles-swarm" data-loading={!list.data}>
              {shown.map((swarm) => <Tile key={swarm.id} swarm={swarm} />)}
              {!list.data && Array.from({ length: 4 }, (_, index) => <li className="tile-ghost" key={index} />)}
            </ol>
          )}
        </section>
      </div>
      <p className="start-fine">
        Every swarm works in rounds paid from its backers' money, and gives back what it does not spend. {Api.fixture ? 'These swarms are demo data.' : <Link to="/docs">Use it from code</Link>}
      </p>
    </div>
  )
}
