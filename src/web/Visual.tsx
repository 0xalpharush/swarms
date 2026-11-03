import { useEffect, useRef, useState } from 'react'
import type { Detail, Status as Kind, Summary } from '../shared/Api.ts'
import { duration, ratio, usd } from './format.ts'
import { useNow } from './hooks.ts'

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

function cents(value: string) {
  return '$' + (Math.floor(Number(value) * 100) / 100).toFixed(2)
}

export function progress(swarm: Pick<Detail, 'reason' | 'status' | 'why' | 'working'>, now: number) {
  if (swarm.status === 'done') return 'Finished'
  if (swarm.status === 'running') return swarm.working ? `Working for ${duration(now - swarm.working.since)}` : 'Starting'
  if (swarm.status === 'funding') return swarm.why === 'repo' ? 'Charging up to start' : 'Waiting for its first funds'
  if (swarm.why === 'idle') return 'Resting: nothing worth spending on'
  if (swarm.why === 'rest') return 'Resting after errors'
  if (swarm.why === 'costly') return 'Its next step needs a bigger top-up'
  if (swarm.why === 'repo') return 'Charging up to open its repository'
  return 'Out of energy'
}

export function Energy(props: { onFund?: (() => void) | undefined; swarm: Pick<Detail, 'raised' | 'reason' | 'remaining' | 'status' | 'why' | 'working'> }) {
  const now = useNow(1000, props.swarm.status === 'running' && !!props.swarm.working)
  const left = Number(props.swarm.remaining)
  const raised = Number(props.swarm.raised)
  const fill = raised > 0 ? Math.min(1, Math.max(0, left / raised)) : 0
  const before = useRef(left)
  const [charging, setCharging] = useState(false)
  useEffect(() => {
    if (left > before.current + 1e-6) {
      setCharging(true)
      const timer = setTimeout(() => setCharging(false), 1600)
      before.current = left
      return () => clearTimeout(timer)
    }
    before.current = left
  }, [left])
  const state = progress(props.swarm, now)
  const body = (
    <>
      <span className="energy-state">{state}</span>
      <span className="energy-row">
        <span className="energy-bar">
          <i style={{ width: `${fill * 100}%` }} />
          <b>{cents(props.swarm.remaining)}</b>
        </span>
        <span className="energy-total">{cents(props.swarm.raised)}</span>
        {props.onFund && <span aria-hidden="true" className="energy-plus">+</span>}
      </span>
    </>
  )
  const label = `${state}. ${usd(props.swarm.remaining)} left to spend of ${usd(props.swarm.raised)} raised.`
  return props.onFund ? (
    <button aria-label={`${label} Add energy.`} className="energy" data-charging={charging} data-low={fill < 0.15} data-status={props.swarm.status} onClick={props.onFund} title={props.swarm.reason ?? state} type="button">
      {body}
    </button>
  ) : (
    <span aria-label={label} className="energy" data-low={fill < 0.15} data-status={props.swarm.status} role="img" title={props.swarm.reason ?? state}>
      {body}
    </span>
  )
}
