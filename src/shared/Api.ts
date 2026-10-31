export type Status = 'funding' | 'running' | 'paused' | 'done'

export type Token = 'ousd' | 'pathusd' | 'usdce'

export type Currency = 'mach' | Token

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
  token: Currency
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

export type Researcher = {
  id: string
  parent: string | null
  round: number
  name: string
  task: string
  state: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'closing' | 'closed'
  action: string | null
  output: string | null
  updatedAt: number
  events: number
  toolsCompleted: number
  lastSequence: number
}

export type Prepared = {
  amount: string | null
  call: { data: `0x${string}`; to: `0x${string}` } | null
  link: string
  memo: `0x${string}`
  memoText: string
  note: string | null
  swarm: string
  symbol: string
  token: Token
  tokenAddress: `0x${string}`
  wallet: `0x${string}`
}

export type Linked = {
  amount: string
  days: number
  link: string
  note: string | null
  swarm: string
  symbol: string
  token: Token
  wallet: `0x${string}`
}

export type Lent = { at: number; connected: boolean; label: string; name: string }

export type Issued = {
  cli: string
  command: string
  label: string
  library: string
  name: string
  npm: string
  swarm: string
  tab: string | null
  token: string
  url: string
}

export type Live =
  | { round: number; type: 'round' }
  | { delta: string; item: string; offset: number | null; type: 'text' | 'thinking' }
  | { item: string; text: string; type: 'message' }
  | { type: 'end' | 'idle' }

export type Detail = Summary & {
  researchers?: Researcher[]
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
  tokens: { address: `0x${string}`; id: Currency; pool: boolean; symbol: string }[]
}

export type Device = {
  expiresAt: number
  interval: number
  userCode: string
  verificationUri: string
  verificationUriFull: string
}

export type Requested = { authorizeAccessKey: unknown; device?: Device; pledge: string }

export type Pledged = { pledge: Pledge; status: Pledge['status']; swarm: Summary }

export type Pending = { amount: string; device: Device | null; note: string | null; pledge: string; status: 'pending' }

export type Running = { n: number; startedAt: number }

export type Brief = Omit<Round, 'message'> & { excerpt: string | null }

export type Overview = Summary & {
  researchers?: Researcher[]
  budgets: Budget[]
  contributions: Contribution[]
  hands: Hand[]
  history: Brief[]
  notes: Note[]
  pledges: Pledge[]
  running: Running | null
}

export type Answered = { answer: Answer | null; running: Running | null; status: Status; swarm: string; title: string }

export type Page = { entries: Entry[]; next: number }

export type Hit = {
  at: number | null
  entry: Pick<Entry, 'kind' | 'seq'> | null
  kind: 'swarm' | 'report' | 'note' | 'feed'
  round: number | null
  snippet: string
  swarm: { id: string; status: Status; title: string }
}

export type Found = { hits: Hit[]; terms: string[] }

export type Waited = {
  changed: boolean
  reason: 'ended' | 'idle' | 'timeout'
  round: Round | null
  running: Running | null
  swarm: Summary
  waited: number
}

export type BudgetRequested = { authorizeAccessKey: unknown; budget: string }

export type Budgeted = { budget: Budget; swarm: Summary }

export type Contributed = { contribution: Contribution; swarm: Summary }

export type Problem = { code: string; detail: string; status: number }

