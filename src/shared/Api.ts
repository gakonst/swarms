export type Status = 'funding' | 'running' | 'paused' | 'done'

export type Token = 'ousd' | 'pathusd' | 'usdce'

export type Currency = 'mach' | Token

export type Answer = { at: number; done: boolean; text: string }

export type Summary = {
  answer: Answer | null
  contributors: number
  createdAt: number
  goal: string
  id: string
  machines: number
  pool: string
  problem: string | null
  raised: string
  remaining: string
  spent: string
  status: Status
  steering: Steering
  title: string
  updatedAt: number
  wallet: `0x${string}` | null
  why: Why | null
}

export type Steering = 'open' | 'team'

export type Seat = { address: `0x${string}`; handle: string; left: string | null; limit: string | null; role: 'admin' | 'member'; spent: string }

export type Roster = { admins: `0x${string}`[]; memberBudget: string | null; seats: Seat[]; steering: Steering; team: `0x${string}` | null }

export type BranchState = 'pending' | 'running' | 'completed' | 'interrupted' | 'failed' | 'closing' | 'closed'

export type Funder = { address: `0x${string}`; amount: string; handle: string }

export type Branch = {
  budget: string | null
  error: string | null
  funded: string
  funders: Funder[]
  id: number
  left: string | null
  parent: number | null
  result: string | null
  role: string
  spent: string | null
  starved: boolean
  state: BranchState
  task: string
  who: string
}

export type Branches = { branches: Branch[]; steering: Steering }

export type Contribution = {
  amount: string
  at: number
  contributor: `0x${string}`
  hash: `0x${string}` | null
  note: string | null
  token: Currency
}

export type Note = {
  backers: number
  id: string
  note: string
  share: number
  steered: boolean
  weight: string
}

export type Update = { at: number; base: string | null; commits: string[]; done: boolean; spent: string; text: string }

export type Pushed = Omit<Update, 'text'>

export type Working = { since: number }

export type Kind = 'tool' | 'output' | 'message' | 'thinking' | 'steer' | 'funds' | 'status' | 'machine' | 'error'

export type Entry = {
  at: number
  detail: string | null
  event: number | null
  kind: Kind
  seq: number
  text: string
  who: string | null
}

export type Hand = { connected: boolean; name: string }

export type Code = { app: string; clone: string; name: string; owner: string }

export type Snapshot = {
  at: number
  commits: { author?: { email: string | null; name: string | null }; date: string | null; message: string; parents?: string[]; sha: string }[]
  diff: { additions: number; deletions: number; oldPath: string | null; patch: string; path: string; state: string | null }[] | null
  files: string[]
  name: string
  readme: { path: string; text: string } | null
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

export type Terms = { channels: string | null; charged: string | null; earned: string | null; price: string | null; requests: number }

export type Lent = { at: number; connected: boolean; label: string; name: string } & Terms

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
  | { at: number; type: 'start' }
  | { channel: 'input' | 'text' | 'thinking'; delta: string; item: string; offset: number | null; type: 'delta'; who: string | null }
  | { entry: Entry; type: 'entry' }
  | { type: 'end' | 'idle' }

export type Detail = Summary & {
  code: Code | null
  contributions: Contribution[]
  feed: Entry[]
  hands: Hand[]
  notes: Note[]
  reason: string | null
  updates: Pushed[]
  why: Why | null
  working: Working | null
}

export type Config = {
  auth: string
  chainId: number
  explorer: string
  gateway: string
  reserve: string
  rpc: string
  tokens: { address: `0x${string}`; id: Token; symbol: string }[]
}

export type Brief = Omit<Update, 'text'> & { excerpt: string }

export type Why = 'unfunded' | 'money' | 'costly' | 'rest' | 'idle'

export type Overview = Summary & {
  code: Code | null
  contributions: Contribution[]
  hands: Hand[]
  notes: Note[]
  reason: string | null
  updates: Brief[]
  why: Why | null
  working: Working | null
}

export type Answered = { answer: Answer | null; status: Status; swarm: string; title: string; working: Working | null }

export type Page = { entries: Entry[]; next: number }

export type Hit = {
  at: number | null
  entry: Pick<Entry, 'kind' | 'seq'> | null
  kind: 'swarm' | 'update' | 'note' | 'feed'
  snippet: string
  swarm: { id: string; status: Status; title: string }
}

export type Found = { hits: Hit[]; terms: string[] }

export type Waited = {
  changed: boolean
  reason: 'updated' | 'idle' | 'timeout'
  swarm: Summary
  update: Update | null
  waited: number
  working: Working | null
}

export type Contributed = { contribution: Contribution; swarm: Summary }

export type Problem = { code: string; detail: string; status: number }

export type Way = 'transfer' | 'machine'

export type Member = {
  address: `0x${string}`
  available: string
  backed: string
  handle: string
  since: number
  steered: string
  ways: Way[]
}

export type Me = Member & { member: boolean }

export type Account = { address: `0x${string}`; handle: string; name: string | null }

export type Steer = { amount: string; backers: number; live: boolean; note: string; noteId: string; share: number; weight: string }

export type Form = 'page' | 'image' | 'markdown' | 'table' | 'json' | 'text'

export type Artifact = {
  entry: string
  form: Form
  kind: string
  slug: string
  summary: string | null
  title: string
  updatedAt: number | null
  url: string
  version: number
}

export type Shown = { slug: string; title: string }

export type Said = {
  artifact: Shown | null
  at: number
  author: `0x${string}` | null
  id: number
  mentions: `0x${string}`[]
  steer: Steer | null
  text: string
}

export type Room = { me: Me | null; members: Member[]; messages: Said[]; next: number }

export type Posted = { me: Me; message: Said }

export type Chatter =
  | { message: Said; type: 'said' }
  | { online: `0x${string}`[]; type: 'presence'; watching: number }
  | { address: `0x${string}`; type: 'typing' }
