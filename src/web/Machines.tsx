import type { Hand } from '../shared/Api.ts'
import { usePresence } from './hooks.ts'

function name(hand: Hand) {
  return hand.name
}

export function Machines(props: { hands: readonly Hand[]; live: boolean }) {
  const tiles = usePresence(
    props.hands.filter((hand) => hand.connected),
    name,
  )

  if (tiles.length === 0)
    return <p className="empty">{props.live ? 'No machines attached right now. The agent starts Modal machines when the work needs one, and they show up here.' : 'No machines attached.'}</p>

  return (
    <ul className="machines">
      {tiles.map((tile, index) => (
        <li className={tile.leaving ? 'machine-tile machine-leaving' : 'machine-tile'} key={tile.item.name}>
          <div aria-hidden className="machine-screen" style={{ animationDelay: `${index * -1.3}s` }}>
            {Array.from({ length: 12 }, (_, bar) => (
              <span key={bar} style={{ animationDelay: `${-((bar * 7919 + index * 104_729) % 1700)}ms`, animationDuration: `${1100 + ((bar * 613 + index * 211) % 900)}ms` }} />
            ))}
          </div>
          <p className="machine-name">{tile.item.name}</p>
          <p className="machine-state">
            <i />
            {tile.leaving ? 'Left' : 'Connected'}
          </p>
        </li>
      ))}
    </ul>
  )
}
