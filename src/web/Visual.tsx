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
