export const About = {
  retryMs: 10 * 60_000,
  most: 700,
} as const

export const Artifacts = {
  fresh: 15,
  wrappedMost: 2_000_000,
} as const

export const Branching = {
  keptBytes: 1_000_000,
  keptMs: 10 * 60_000,
  listingMs: 2_000,
  patienceMs: 1_500,
  budgetLeaseMs: 60_000,
  settleLeaseMs: 60_000,
} as const

export const Chat = {
  helloMs: 10_000,
  holderMs: 300_000,
  typingMs: 2_000,
  socketsMost: 500,
  streamsMost: 1000,
  postsPerMinute: 10,
  repliersShown: 3,
} as const

export const Clock = {
  quietMs: 600_000,
  hourMs: 3_600_000,
  restMs: 10 * 60_000,
  retryMs: 30_000,
  minuteMs: 60_000,
  dayMs: 86_400_000,
  refreshMs: 10_000,
  followMs: 2_000,
  gatewayMs: 120_000,
  shelfMs: 30_000,
} as const

export const Device = {
  lifeSeconds: 600,
  interval: 2,
  codeMost: 32,
  userLetters: 8,
  deviceBytes: 32,
} as const

export const Edge = {
  pageFresh: 5_000,
  pageStale: 600_000,
} as const

export const Feed = {
  searched: 5_000,
  indexChunk: 1_000,
  indexMs: 1_000,
} as const

export const Feedback = {
  contextMost: 8000,
  messageLeast: 3,
  messageMost: 4000,
  swarmMost: 64,
} as const

export const Follow = {
  streamFails: 2,
  fallbackMs: 5 * 60_000,
  cueMs: 5_000,
  spacingMs: 30_000,
  lendingMs: 3_600_000,
  unpaidMost: 8,
} as const

export const Gateway = {
  operatorSeconds: 86_400,
  credentialedSeconds: 300,
  credentialedStaleSeconds: 86_400,
} as const

export const Hands = {
  nameTries: 3,
  limit: 32,
  unseenMs: 86_400_000,
  freshMs: 3_600_000,
} as const

export const Land = { attempts: 3 } as const

export const Lobby = {
  socketsMost: 10_000,
  quietMs: 30_000,
} as const

export const Machines = {
  keptSeconds: 30 * 86_400,
  exportPage: 200,
  pool: 6,
} as const

export const Mcp = {
  watchMost: 300,
  bodyBytes: 1_000_000,
  lineBytes: 4_000_000,
  batchMost: 64,
  nameMost: 128,
  accepted: 202,
  malformed: 400,
  tooLarge: 413,
} as const

export const JsonRpc = {
  internal: -32603,
  method: -32601,
  params: -32602,
  parse: -32700,
  request: -32600,
} as const

export const Money = {
  unbackedMs: 10 * 60_000,
} as const

export const Nodes = {
  depthMost: 256,
  claimPollMs: 50,
  claimTries: 200,
  stuckRuns: 3,
  lockMs: 60_000,
  heldMs: 10_000,
} as const

export const OAuth = {
  accessSeconds: 3600,
  refreshMs: 30 * 86_400_000,
  codeMs: 10 * 60_000,
  clientMs: 365 * 86_400_000,
  clientNameMost: 100,
  redirectMost: 2000,
  redirectsMost: 10,
  clientBytes: 16,
  secretBytes: 32,
  challengeLeast: 43,
  challengeMost: 128,
  addressDigits: 40,
} as const

export const Operations = {
  maxWait: 55,
  unconditionalMs: 5 * 60_000,
  firstFeed: 80,
  listSeconds: 3,
  idleSeconds: 3600,
  progressSeconds: 30,
  shownSeconds: 5,
  shownStale: 600,
  shownPatience: 1500,
  lendingMs: 10_000,
  ideasPerDay: 5,
  ledgerSeconds: 10,
} as const

export const Page = {
  firstChat: 30,
} as const

export const Phase = {
  rereadMs: 10 * 60_000,
  maxPatienceMs: 60 * 60_000,
} as const

export const Posters = {
  fresh: 300_000,
} as const

export const Relay = {
  ringBytes: 2_000_000,
  backlogSize: 500,
  followForMs: 15 * 60_000,
  beatMs: 25_000,
} as const

export const Storage = {
  unpaid: 503,
}

export const Repo = {
  snapshotMs: 60_000,
  snapshotFiles: 2_000,
  snapshotText: 64_000,
  lookMs: 30 * 60_000,
  graphMs: 60_000,
  graphBranches: 40,
  trunkCommits: 100,
  branchCommits: 50,
  trunkText: 2_000,
  branchText: 600,
} as const

export const Riding = {
  hourMs: 3_600_000,
  burnHours: 24 * 90,
  steersShown: 50,
  suggestionsShown: 50,
  summaryChars: 200,
  tolerance: 50_000n,
} as const

export const Runner = {
  followBackoffMs: 1_000,
  followBackoffMostMs: 60_000,
  followBackoffDoublings: 6,
  rotateAfter: 200,
  verifiers: 4,
  lateMs: 10 * 60_000,
} as const

export const Runs = {
  chunk: 2_000,
  pages: 10,
  lines: 1_000,
  logMs: 30_000,
  jobMs: 15_000,
  listenMs: 8_000,
  graceMs: 10 * 60_000,
  lifeMs: 24 * 60 * 60_000,
  jobBytes: 4 * 1024 * 1024,
  tracking: 2,
} as const

export const Search = {
  recent: 40,
} as const

export const Sessions = {
  days: 30,
  tokenMost: 128,
} as const

export const Signin = {
  addressDigits: 40,
  idMost: 128,
  messageMost: 4096,
} as const

export const Share = {
  look: 3,
} as const

export const SharedBrief = {
  most: 3,
} as const

export const SharedBtw = {
  maxQuestion: 4_000,
  maxAnswer: 20_000,
  maxThread: 20,
  perHour: 20,
  perSwarmHour: 120,
  maxThreadBytes: 32_768,
  maxMessageBytes: 48_000,
} as const

export const SharedMemo = {
  maxNote: 280,
} as const

export const SharedMention = {
  maxText: 1000,
  maxName: 24,
} as const

export const SharedNickname = {
  least: 3,
  most: 40,
} as const

export const SharedPicture = {
  most: 65_536,
  side: 128,
} as const

export const SharedReaction = {
  perMinute: 30,
} as const

export const SharedSetup = {
  context: 50_000,
  fresh: 2_000,
  written: 1_000,
  longest: 1_024,
  budgetCalls: 20,
} as const

export const SharedSurface = {
  most: 12,
} as const

export const SharedTrail = {
  thought: 1500,
} as const

export const SharedWishlist = {
  most: 50,
} as const

export const Store = {
  absentMs: 30_000,
  recency: 30_000,
} as const

export const Swarm = {
  healMs: 5 * 60_000,
  coverMs: 6 * 60 * 60_000,
  rowMs: 10_000,
  stillMs: 2_000,
  maxWaitMs: 60_000,
  coalesceMs: 2_000,
} as const

export const Team = {
  period: 30 * 86_400_000,
  freshMs: 30_000,
  nameMost: 64,
} as const

export const Triage = {
  everyMs: 30 * 60_000,
  listed: 50,
} as const

export const Turns = {
  endSettleMs: 3_000,
  heldMs: 5 * 60_000,
  leaseMs: 30 * 60_000,
  sendingMs: 5 * 60_000,
  sponsorWaitMs: 15 * 60_000,
  resetsToRenew: 2,
  quickMs: 60_000,
  settleMs: 15_000,
  calmMs: 10 * 60_000,
  failsToStick: 2,
} as const

export const Verify = {
  tailBytes: 4096,
} as const

export const Watch = {
  beatMs: 25_000,
  pongMs: 10_000,
  retryMs: 3_000,
  pagesMost: 10,
} as const

export const Work = {
  serialWaitMs: 30_000,
} as const

export const Telemetry = {
  failedStatus: 500,
  flagsRadix: 16,
  idTries: 4,
  okStatus: 200,
  slowMs: 500,
  spanBytes: 8,
  spans: 64,
  traceBytes: 16,
} as const

export const Held = {
  absent: { entries: 1024, ms: Store.absentMs },
  draws: { entries: 64, ms: 60_000 },
  edge: { entries: 512, ms: 31 * 86_400_000 },
  fleets: { entries: 512, ms: Operations.lendingMs },
  known: { entries: 8192, ms: 3_600_000 },
  lending: { entries: 512, ms: Operations.lendingMs },
  origins: { entries: 8, ms: 86_400_000 },
  pages: { entries: 48, ms: Edge.pageStale },
  recent: { entries: 2000, ms: Store.recency },
  refreshes: { entries: 512, ms: 60_000 },
  repos: { entries: 1024, ms: 60_000 },
  rosters: { entries: 512, ms: Team.freshMs },
  unconditional: { entries: 1024, ms: Operations.unconditionalMs },
  writes: { entries: 8192, ms: 3_600_000 },
} as const

export const MachinePayment = {
  payingMs: 30_000,
} as const
