import type { Status as Kind, Summary } from '../shared/Api.ts'
import { ratio, usd } from './format.ts'

const labels = { done: 'Done', funding: 'Funding', paused: 'Paused', running: 'Running' } as const satisfies Record<Kind, string>

export function Status(props: { status: Kind }) {
  return (
    <span className="status" data-status={props.status}>
      <i />
      {labels[props.status]}
    </span>
  )
}

export function Bar(props: { swarm: Pick<Summary, 'raised' | 'remaining' | 'spent' | 'status'> }) {
  const spent = ratio(props.swarm.spent, props.swarm.raised)
  return (
    <div className="bar" data-status={props.swarm.status}>
      <div className="bar-track">
        <div className="bar-spent" style={{ width: `${spent * 100}%` }} />
      </div>
      <div className="bar-legend">
        <span>{usd(props.swarm.spent)} spent</span>
        <span>
          {usd(props.swarm.remaining)} left of {usd(props.swarm.raised)}
        </span>
      </div>
    </div>
  )
}

function Plus(props: { active: boolean; x: number; y: number }) {
  return (
    <g className={props.active ? 'node node-active' : 'node'}>
      <line x1={props.x - 7} x2={props.x + 7} y1={props.y} y2={props.y} />
      {props.active && <line x1={props.x} x2={props.x} y1={props.y - 7} y2={props.y + 7} />}
    </g>
  )
}

export function Constellation(props: { machines: readonly string[]; swarm: Pick<Summary, 'parallel' | 'status' | 'workers'>; wide?: boolean }) {
  const status = props.swarm.status
  const live = status === 'running'
  const slots = Math.max(1, Math.min(4, Math.max(props.swarm.parallel, props.swarm.workers)))
  const active = status === 'done' ? slots : live ? Math.min(slots, Math.max(props.swarm.workers, 1)) : 0
  const width = props.wide ? 900 : 600
  const reach = props.wide ? 230 : 200
  const step = props.wide ? 120 : 56
  const lead = props.wide ? 80 : 60
  const rows = Array.from({ length: slots }, (_, index) => 150 + (index - (slots - 1) / 2) * (props.wide ? 62 : 56))
  const per = Math.max(active, 1)
  const columns = Math.ceil(Math.min(props.machines.length, 12) / per)
  const root = (width - reach - (columns > 0 ? lead + (columns - 1) * step : 0)) / 2
  const fork = root + reach
  const placed = props.machines.slice(0, 12).map((name, index) => ({ column: Math.floor(index / per), name, row: index % per }))

  return (
    <svg aria-hidden className="constellation" data-status={status} preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${width} 300`}>
      {rows.map((y, index) => {
        const d = `M ${root + 12} 150 C ${root + reach / 2} 150, ${root + reach / 2} ${y}, ${fork - 12} ${y}`
        return (
          <g key={index}>
            <path className={index < active ? 'edge edge-active' : 'edge'} d={d} />
            {live && index < active && <path className="pulse" d={d} pathLength={100} style={{ animationDelay: `${index * -0.55}s` }} />}
          </g>
        )
      })}
      <Plus active x={root} y={150} />
      {rows.map((y, index) => (
        <Plus active={index < active} key={index} x={fork} y={y} />
      ))}
      {placed.map((machine) => {
        const y = rows[machine.row] ?? 150
        const x = fork + lead + machine.column * step
        return (
          <g className="machine" key={machine.name} style={{ animationDelay: `${(machine.row * 3 + machine.column) * -0.4}s` }}>
            <line className="edge edge-machine" x1={machine.column === 0 ? fork + 12 : x - step + 6} x2={x - 6} y1={y} y2={y} />
            <rect height={12} width={12} x={x - 6} y={y - 6} />
            {props.wide && (
              <text textAnchor="middle" x={x} y={y + 24}>
                {machine.name}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
