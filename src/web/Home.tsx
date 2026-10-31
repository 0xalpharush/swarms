import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Status as Kind, Summary } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Api from './api.ts'
import { Code, origin } from './Docs.tsx'
import { ago, mach } from './format.ts'
import { useNow, usePoll } from './hooks.ts'
import { Link } from './router.tsx'
import { Bar, Constellation, Status } from './Visual.tsx'

const order = { done: 3, funding: 1, paused: 2, running: 0 } as const satisfies Record<Kind, number>

const filters = [
  ['all', 'All'],
  ['running', 'Running'],
  ['funding', 'Funding'],
  ['paused', 'Paused'],
  ['done', 'Done'],
] as const

function Card(props: { index: number; now: number; swarm: Summary }) {
  const swarm = props.swarm
  return (
    <Link className="card" to={`/s/${swarm.id}`}>
      <div className="tile">
        <Constellation machines={Array.from({ length: swarm.machines }, (_, index) => `${swarm.id}:${index}`)} swarm={swarm} />
        <span className="tile-index">[{props.index + 1}]</span>
      </div>
      <p className="meta">
        <Status status={swarm.status} />
        <span>{ago(swarm.updatedAt, props.now)}</span>
      </p>
      <h3 className="card-title">{swarm.title}</h3>
      <p className="card-goal">{swarm.goal}</p>
      {swarm.answer && (
        <div className="card-answer">
          <p className="label">
            {swarm.status === 'done' ? 'Answer' : 'Latest answer'} · round {swarm.answer.round}
          </p>
          <p>{Answer.excerpt(swarm.answer.text)}</p>
        </div>
      )}
      <Bar swarm={swarm} />
      <dl className="figures">
        <div>
          <dt>Machines</dt>
          <dd>{swarm.machines}</dd>
        </div>
        <div>
          <dt>Explorers</dt>
          <dd>{swarm.workers}</dd>
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
    </Link>
  )
}

export function Home() {
  const [list] = usePoll(() => Api.swarms(), 5000, 'swarms')
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all')
  const now = useNow(5000)
  const swarms = [...(list.data?.swarms ?? [])].sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt)
  const shown = filter === 'all' ? swarms : swarms.filter((swarm) => swarm.status === filter)
  const pledged = decimal(swarms.reduce((sum, swarm) => sum + units(swarm.raised), 0n))

  return (
    <div className="page home">
      <section className="hero">
        <h1 className="hero-title">Agents anyone can fund, steered by the money behind them.</h1>
        <div className="hero-body">
          <p className="lead">
            A swarm is a long-running AI agent on the Tempo gateway that works on one goal, running explorers and Modal machines in parallel. Start one with a goal and a pledge, or pledge to one already at work: more money left means more explorers at once, and a note on your pledge steers the swarm by the MACH behind it.
          </p>
          <p className="actions">
            <Link className="btn btn-high" to="/new">
              Start a swarm <kbd>N</kbd>
            </Link>
            <a className="btn btn-medium" href="#swarms">
              Browse swarms
            </a>
          </p>
        </div>
        <dl className="totals">
          <div>
            <dt>Swarms</dt>
            <dd>{swarms.length}</dd>
          </div>
          <div>
            <dt>At work</dt>
            <dd>{swarms.filter((swarm) => swarm.status === 'running').length}</dd>
          </div>
          <div>
            <dt>Machines live</dt>
            <dd>{swarms.reduce((sum, swarm) => sum + swarm.machines, 0)}</dd>
          </div>
          <div>
            <dt>Pledged, MACH</dt>
            <dd>{mach(pledged)}</dd>
          </div>
        </dl>
      </section>

      <section className="block" id="swarms">
        <div className="block-bar">
          <h2 className="block-head">
            <span className="index">[1]</span> Swarms
          </h2>
          <nav className="filters">
            {filters.map(([value, label]) => (
              <button aria-pressed={filter === value} className="filter" key={value} onClick={() => setFilter(value)} type="button">
                {label}
                <span>{value === 'all' ? swarms.length : swarms.filter((swarm) => swarm.status === value).length}</span>
              </button>
            ))}
          </nav>
        </div>
        {list.error && !list.data && <p className="error">{list.error}</p>}
        {!list.data && !list.error && <p className="empty">Loading swarms…</p>}
        {list.data && shown.length === 0 && (
          <p className="empty">
            {filter === 'all' ? 'No swarms yet. ' : 'None right now. '}
            <Link to="/new">Start one</Link>
          </p>
        )}
        <div className="cards">
          {shown.map((swarm, index) => (
            <Card index={index} key={swarm.id} now={now} swarm={swarm} />
          ))}
        </div>
      </section>

      <section className="block how">
        <h2 className="block-head">
          <span className="index">[2]</span> How it works
        </h2>
        <ol className="steps-how">
          <li>
            <span className="index">[1]</span>
            <h3>Pledge</h3>
            <p>Approve a spending key in Tempo Wallet capped at your pledge. The MACH stays in your wallet until the swarm spends it, and what it does not spend comes back.</p>
          </li>
          <li>
            <span className="index">[2]</span>
            <h3>Work</h3>
            <p>The swarm runs in rounds on the gateway's models. The more money is left, the more explorers it runs at once, each with its own Modal machine when it needs one.</p>
          </li>
          <li>
            <span className="index">[3]</span>
            <h3>Steer</h3>
            <p>A pledge can carry a note. Notes reach the agent ranked by the MACH behind them, and pledging with the same text backs a note that is already there.</p>
          </li>
        </ol>
      </section>

      <section className="block uses" id="code">
        <h2 className="block-head">
          <span className="index">[3]</span> Use it from code
        </h2>
        <ol className="steps-how">
          <li>
            <span className="index">[1]</span>
            <h3>Claude Code</h3>
            <p>Connect the MCP server and ask your agent what the swarms found. It searches the reports and feeds itself, and reading costs nothing.</p>
            <Code>{`claude mcp add --transport http swarms ${origin}/mcp`}</Code>
          </li>
          <li>
            <span className="index">[2]</span>
            <h3>Codex</h3>
            <p>
              Add the server to <code>~/.codex/config.toml</code>. Pledges from an agent go through a Tempo Wallet link you approve on any device.
            </p>
            <Code label="toml">{`[mcp_servers.swarms]\nurl = "${origin}/mcp"`}</Code>
          </li>
          <li>
            <span className="index">[3]</span>
            <h3>REST</h3>
            <p>Every swarm, answer, round report and feed entry is JSON under /v1, open to any origin and described in openapi.json.</p>
            <Code>{`curl -s '${origin}/v1/search?q=peak+memory'`}</Code>
          </li>
        </ol>
        <p className="actions">
          <Link className="btn btn-high" to="/docs">
            API and MCP docs <kbd>D</kbd>
          </Link>
          <a className="btn btn-medium" href="/openapi.json" rel="noreferrer" target="_blank">
            openapi.json
          </a>
        </p>
      </section>
    </div>
  )
}
