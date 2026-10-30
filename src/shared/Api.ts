export type Status = 'funding' | 'running' | 'paused' | 'done'

export type Token = 'ousd' | 'pathusd' | 'usdce'

export type Answer = { at: number; done: boolean; next: string | null; round: number; text: string }

export type Summary = {
  answer: Answer | null
  contributors: number
  createdAt: number
  daily: string
  goal: string
  id: string
  machines: number
  parallel: number
  pool: string
  raised: string
  remaining: string
  rounds: number
  spent: string
  status: Status
  title: string
  updatedAt: number
  wallet: `0x${string}` | null
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

export type Contribution = {
  amount: string
  at: number
  budget: string | null
  contributor: `0x${string}`
  hash: `0x${string}`
  kind: 'transfer' | 'pull'
  note: string | null
  token: Token
}

export type Budget = {
  amount: string
  at: number
  contributor: `0x${string}` | null
  detail: string | null
  expiresAt: number
  id: string
  left: string | null
  nextAt: number | null
  note: string | null
  period: number
  pulled: string
  status: 'active' | 'waiting' | 'revoked' | 'expired' | 'ended'
  token: Token
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
  budgets: Budget[]
  contributions: Contribution[]
  feed: Entry[]
  hands: Hand[]
  history: Round[]
  notes: Note[]
  pledges: Pledge[]
}

export type Config = {
  budget: { days: number; max: string; min: string; period: number }
  chainId: number
  explorer: string
  gateway: string
  mach: `0x${string}`
  minPledge: string
  perWorker: string
  reserve: string
  rpc: string
  tokens: { address: `0x${string}`; id: Token; symbol: string }[]
}

export type Requested = { authorizeAccessKey: unknown; pledge: string }

export type Pledged = { pledge: Pledge; swarm: Summary }

export type BudgetRequested = { authorizeAccessKey: unknown; budget: string }

export type Budgeted = { budget: Budget; swarm: Summary }

export type Contributed = { contribution: Contribution; swarm: Summary }

export type Problem = { code: string; detail: string; status: number }
