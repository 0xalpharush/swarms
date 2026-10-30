export type Status = 'funding' | 'running' | 'paused' | 'done'

export type Answer = { at: number; done: boolean; next: string | null; round: number; text: string }

export type Summary = {
  answer: Answer | null
  contributors: number
  createdAt: number
  goal: string
  id: string
  machines: number
  parallel: number
  raised: string
  remaining: string
  rounds: number
  spent: string
  status: Status
  title: string
  updatedAt: number
  workers: number
}

export type Pledge = {
  amount: string
  at: number
  contributor: `0x${string}`
  id: string
  note: string | null
  spent: string
  status: 'active' | 'spent' | 'ended'
}

export type Note = {
  backers: number
  id: string
  note: string
  share: number
  steered: boolean
  weight: string
}

export type Round = {
  endedAt: number | null
  message: string | null
  n: number
  spent: string
  startedAt: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}

export type Kind = 'tool' | 'message' | 'thinking' | 'steer' | 'funds' | 'status' | 'machine' | 'error'

export type Entry = {
  at: number
  detail: string | null
  kind: Kind
  round: number
  seq: number
  text: string
}

export type Hand = { connected: boolean; name: string }

export type Live =
  | { round: number; type: 'round' }
  | { delta: string; item: string; offset: number | null; type: 'text' | 'thinking' }
  | { item: string; text: string; type: 'message' }
  | { type: 'end' | 'idle' }

export type Detail = Summary & {
  feed: Entry[]
  hands: Hand[]
  history: Round[]
  notes: Note[]
  pledges: Pledge[]
}

export type Config = {
  chainId: number
  explorer: string
  gateway: string
  mach: `0x${string}`
  minPledge: string
  perWorker: string
  reserve: string
  rpc: string
}

export type Requested = { authorizeAccessKey: unknown; pledge: string }

export type Pledged = { pledge: Pledge; swarm: Summary }

export type Problem = { code: string; detail: string; status: number }