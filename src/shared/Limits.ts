export const About = {
  retryMs: 10 * 60_000,
  most: 700,
} as const

export const Artifacts = {
  fresh: 15,
  wrappedMost: 2_000_000,
  staleSeconds: 600,
  pages: 3,
} as const

export const Board = {
  findMs: 100,
  findTries: 60,
  pace: 0.2,
  scrollMs: 300,
  settleMs: 150,
  stepMs: 80,
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

export const Cli = {
  fundPollMs: 2000,
  fundTimeoutSeconds: 900,
  pollFloorMs: 250,
  reconnectMs: 1000,
  keyTimeoutMs: 10_000,
  dirMode: 0o700,
  fileMode: 0o600,
  providerPad: 10,
  fundLeast: 10_000n,
  subjectArg: 3,
  planCodeArg: 3,
  minuteTimeChars: 16,
  daySeconds: 86_400,
  isoClockFrom: 11,
  isoClockTo: 19,
  detailChars: 200,
  kindPad: 8,
  treeTitleChars: 80,
  eventPad: 9,
  eventTitleChars: 100,
  okBelow: 300,
  fineDigits: 4,
  lineChars: 160,
  mcpLongestMs: 330_000,
} as const

export const OwnAiFlow = {
  popupWidth: 520,
  popupHeight: 720,
  pollMs: 5000,
  pollBackoff: 1.5,
  pollCeilingMs: 30_000,
  signInMs: 900_000,
} as const

export const Client = {
  codeReadMs: 20_000,
  configRetryMs: 3000,
  copiedMs: 1500,
  eventsRetryMs: 3000,
  eventsSteadyMs: 30_000,
  flushMs: 250,
  generalPollMs: 20_000,
  idleMs: 1500,
  idleSoonMs: 1,
  pingMs: 30_000,
  pongMs: 10_000,
  roomBackoffMostMs: 30_000,
  roomBackoffMs: 2000,
  roomClosedMs: 15_000,
  roomOpenMs: 60_000,
  rosterMs: 60_000,
  sharedCopiedMs: 2000,
  socketRetryMs: 3000,
  walletApproveMs: 1200,
  walletDenyMs: 900,
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
  staleFactor: 3,
  fnvOffset: 0x811c9dc5,
  fnvPrime: 0x01000193,
  tagRadix: 36,
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

export const Fixture = {
  codexApproveMs: 4000,
  askMs: 600,
  beatMs: 4000,
  chatterJitterMs: 9000,
  chatterMs: 14_000,
  checkingMs: 2000,
  createMs: 400,
  fundMs: 500,
  lobbyMs: 10_000,
  moveMs: 300,
  openMs: 200,
  postMs: 250,
  provenMs: 4500,
  pulseMs: 5000,
  reactMs: 150,
  readMs: 160,
  repliesMs: 200,
  typingMs: 2400,
} as const

export const Follow = {
  streamFails: 2,
  fallbackMs: 5 * 60_000,
  cueMs: 5_000,
  spacingMs: 30_000,
  lendingMs: 3_600_000,
  unpaidMost: 8,
  eventPages: 5,
  messageChars: 600,
  unpaidChars: 400,
} as const

export const Gateway = {
  operatorSeconds: 86_400,
  credentialedSeconds: 300,
  credentialedStaleSeconds: 86_400,
  operatorStaleSeconds: 30 * 86_400,
  pricingMs: 10 * 60_000,
  pricesFreshSeconds: 600,
  pricesWaitMs: 3_000,
  pricesStaleSeconds: 86_400,
  detailChars: 300,
  keyBytes: 8,
  listPage: 100,
} as const

export const Hands = {
  nameTries: 3,
  limit: 32,
  unseenMs: 86_400_000,
  freshMs: 3_600_000,
  suffixBytes: 3,
  share: 5n,
  payeeHead: 6,
  payeeTail: 4,
} as const

export const Land = { attempts: 3 } as const

export const Lobby = {
  socketsMost: 10_000,
  quietMs: 30_000,
  noStatusClose: 1005,
  abnormalClose: 1006,
} as const

export const Machines = {
  keptSeconds: 30 * 86_400,
  exportPage: 200,
  pool: 6,
  swarmIdMost: 64,
  nameMost: 160,
  logLinesMost: 5_000,
  sandboxMost: 64,
  nsPerMs: 1e6,
  eventSpan: 128,
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
  confirmMost: 200,
  hashShown: 10,
  feedMost: 200,
  feedDefault: 50,
  watchDefault: 120,
  watchPage: 100,
  goalChars: 200,
} as const

export const JsonRpc = {
  internal: -32603,
  method: -32601,
  params: -32602,
  parse: -32700,
  request: -32600,
  unauthorized: -32001,
} as const

export const Money = {
  cent: 0.01,
  unbackedMs: 10 * 60_000,
} as const

export const Nodes = {
  depthMost: 256,
  claimPollMs: 50,
  claimTries: 200,
  stuckRuns: 3,
  lockMs: 60_000,
  heldMs: 10_000,
  retry: { backoffMs: 15_000, maxAttempts: 3 },
  quietRuns: 12,
  slots: 16,
  triageShare: 0.05,
  verifyShaChars: 12,
  nidChars: 10,
  statementBytes: 8,
  weightMost: 10,
  childrenMost: 20,
  fundersShown: 5,
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
  idChars: 64,
  titleChars: 80,
  leanChars: 8000,
  allowanceMostUsd: 1_000_000,
  transferLeastUnits: 10_000n,
  steerMostUnits: 100_000_000n,
  goalLeastChars: 10,
  goalChars: 12_000,
  modelChars: 200,
  seedKeyChars: 64,
  seedNeeds: 20,
  seedNodes: 2000,
  specChars: 8000,
  nodeTitleLeastChars: 3,
  nodeTitleChars: 200,
  messageLeastChars: 3,
  steerLeastChars: 3,
  suggestionLeastChars: 3,
  suggestionChars: 2000,
  handLabelChars: 32,
  whoChars: 160,
  nameChars: 64,
  queryChars: 500,
  whyChars: 500,
  ownCodeChars: 2048,
  ownKeyChars: 512,
  pageMost: 200,
  feedPage: 200,
  messagesPage: 100,
  updatesPage: 50,
  repliesPage: 200,
  searchMost: 50,
  searchPage: 10,
  treeDepthMost: 64,
  treeDepth: 3,
  deltasMost: 500,
  deltasPage: 200,
  waitSeconds: 45,
  identifierChars: 12,
  treeReadMs: 800,
  errorChars: 300,
  resultChars: 4000,
  taskChars: 2000,
  quotedChars: 140,
  clippedChars: 200,
  excerptChars: 240,
  excerptLeadShare: 3,
  pictureChunk: 0x8000,
  riderTreeDepth: 64,
  riderTreeMs: 2500,
} as const

export const Page = {
  firstChat: 30,
  quickMs: 1500,
  slowMs: 2500,
  handleMost: 40,
  nameChars: 40,
  emailMost: 254,
  firstUpdates: 30,
} as const

export const Pay = {
  countRetries: 3,
  countRetryMs: 1500,
  resumeMs: 1000,
  retryMs: [2_000, 5_000, 15_000, 30_000],
} as const

export const Phase = {
  rereadMs: 10 * 60_000,
  maxPatienceMs: 60 * 60_000,
} as const

export const Posters = {
  fresh: 300_000,
  keptBytes: 12_000_000,
  keptMost: 48,
} as const

export const Provider = {
  repeats: 3,
  firstMs: 15 * 60_000,
  mostMs: 4 * 60 * 60_000,
  messageMost: 400,
  probeSeconds: 60,
  probeCpu: 0.125,
  probeMemory: 128,
  e2bCpu: 1,
  e2bMemory: 512,
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
  slugChars: 48,
  historyMost: 50,
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
  lateMostMs: 6 * 60 * 60_000,
  chargeAfterMs: 2_000,
  payingAttempts: 8,
  timing: {
    checkMs: 60 * 60_000,
    doingMs: 2_000,
    idleMs: 60_000,
    leaseMs: 30 * 60_000,
    listMs: 2_000,
    pollMs: 2_000,
    spawnMs: 120_000,
    streamDownMs: 20_000,
    streamUpMs: 120_000,
    verifyMs: 60_000,
  },
  textMost: 4000,
  summaryChars: 200,
  titleChars: 200,
  needsMost: 20,
  commitChars: 64,
  theoremChars: 200,
  whyChars: 200,
  siblingsShown: 30,
  doingChars: 120,
  steerLogChars: 2000,
  failedLogChars: 4096,
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
  pageMost: 500,
  pageStandard: 100,
  errorChars: 300,
} as const

export const Search = {
  recent: 40,
  termsMost: 12,
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

export const Telegram = {
  sendMessageChars: 4096,
} as const

export const Share = {
  look: 3,
  card: { height: 630, width: 1200 },
  poster: { height: 675, width: 1200 },
  video: { height: 720, width: 1280 },
  player: { height: 450, width: 800 },
  listed: 12,
  fillSteps: 20,
  fnvOffset: 0x811c9dc5,
  fnvPrime: 0x01000193,
  hashRadix: 36,
  named: 3,
  descriptionChars: 300,
  textChars: 240,
} as const

export const SharedAnswer = {
  centsShownFrom: 0.1,
  briefChars: 220,
  lineLeast: 20,
  freshChars: 240,
} as const

export const SharedArtifact = {
  unwrapDepth: 5,
  keyProbe: 600,
  pathChars: 300,
  pathParts: 4,
  summaryChars: 300,
  titleChars: 120,
} as const

export const SharedBrief = {
  most: 3,
  lineChars: 220,
} as const

export const SharedBtw = {
  maxQuestion: 4_000,
  maxAnswer: 20_000,
  maxThread: 20,
  perHour: 20,
  perSwarmHour: 120,
  maxThreadBytes: 32_768,
  maxMessageBytes: 48_000,
  idBytes: 16,
  hexRadix: 16,
} as const

export const SharedCredit = {
  chainId: 4217,
  tagBytes: 16,
} as const

export const SharedCrew = {
  wholeFrom: 100,
  tenthsFrom: 10,
} as const

export const SharedFleet = {
  gbTenths: 10,
  reasonChars: 300,
  shellParts: 3,
  lookahead: 6,
  clippedFrom: 1990,
  pendingLeft: 5,
  unwrapDepth: 4,
} as const

export const SharedMemo = {
  maxNote: 280,
  unit: 1_000_000n,
  decimals: 6,
} as const

export const SharedMention = {
  maxText: 1000,
  maxName: 24,
  smallestSteer: 10_000n,
  wordHexEnd: 10,
  hexRadix: 16,
  headChars: 6,
  tailChars: 4,
} as const

export const SharedNickname = {
  least: 3,
  most: 40,
} as const

export const SharedFuzzy = {
  exactBase: 100,
  exactPerChar: 6,
  exactBoundary: 40,
  exactStart: 20,
  exactLeadMost: 60,
  exactLeadCost: 0.2,
  fuzzyLeast: 3,
  fuzzyPerChar: 8,
  fuzzyJoined: 6,
  fuzzyBoundary: 10,
  gapMost: 10,
  gapCost: 0.8,
  leadMost: 20,
  leadCost: 0.3,
  spreadPerChar: 4,
  spreadSlack: 6,
} as const

export const SharedPicture = {
  most: 65_536,
  side: 128,
  emojiChars: 32,
  versionRadix: 36,
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46, 0x38],
  riff: [0x52, 0x49, 0x46, 0x46],
  webpAt: 8,
  webp: [0x57, 0x45, 0x42, 0x50],
} as const

export const SharedProgress = {
  stateChars: 40,
  rowsMost: 2000,
  chainMost: 500,
  lineChars: 400,
  betterChars: 10,
  exploresChars: 300,
  titleChars: 200,
  branchesMost: 200,
} as const

export const SharedProse = {
  breakFrom: 0.6,
  markupLeast: 3,
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
  least: 50_000n,
  microsPerDollar: 1_000_000,
  fineBelow: 10_000,
  fineDigits: 4,
  coarseDigits: 3,
} as const

export const SharedStatus = {
  fuel: 0.05,
} as const

export const SharedSurface = {
  most: 12,
  askText: 160,
  askAmount: 16,
  askWhy: 240,
  idChars: 40,
  titleChars: 80,
  asks: 4,
  stats: 6,
  statLabel: 32,
  statValue: 20,
  checks: 16,
  checkText: 120,
  points: 200,
  goalLabel: 40,
  unitChars: 8,
  bars: 10,
  barLabel: 48,
  rows: 10,
  rowText: 240,
  rowState: 20,
  rowNote: 80,
  meterLabel: 40,
  rangeNote: 120,
  rangeUnit: 12,
  tiles: 120,
  tileLabel: 32,
  tileState: 16,
  noteText: 1200,
  statuses: 3,
  statusText: 220,
} as const

export const SharedTrace = {
  detailChars: 20_000,
} as const

export const SharedTrail = {
  thought: 1500,
  headline: 120,
  detail: 4000,
  brief: 2000,
  result: 20_000,
  role: 80,
  command: 140,
  reason: 240,
  target: 40,
  program: 30,
  query: 50,
  nsPerMs: 1_000_000,
  centsShownFrom: 0.1,
  entries: 5000,
} as const

export const SharedTree = {
  graceMs: 2_000,
  shortSha: 7,
} as const

export const SharedWishlist = {
  most: 50,
  wantChars: 280,
  whyChars: 400,
} as const

export const SharedResearchBrief = {
  titleChars: 80,
} as const

export const Store = {
  absentMs: 30_000,
  recency: 30_000,
  reserve: 50_000n,
  shareBasis: 10_000,
  idBytes: 8,
} as const

export const Swarm = {
  healMs: 5 * 60_000,
  coverMs: 6 * 60 * 60_000,
  rowMs: 10_000,
  stillMs: 2_000,
  maxWaitMs: 60_000,
  coalesceMs: 2_000,
  version: 7,
  instructedFormat: 3,
  settledFormat: 4,
  progressedFormat: 5,
  workTablesFormat: 6,
  boardFormat: 7,
  bootChars: 8,
  feedDefault: 200,
  feedSlack: 10,
  steerChars: 120,
  sealedKept: 200,
  deltasPage: 500,
  tokenChars: 200,
  closeNoStatus: 1005,
  closeAbnormal: 1006,
} as const

export const Team = {
  period: 30 * 86_400_000,
  freshMs: 30_000,
  nameMost: 64,
} as const

export const Triage = {
  everyMs: 30 * 60_000,
  listed: 50,
  wordMost: 4000,
  idChars: 64,
  titleChars: 200,
  whyChars: 500,
  amountChars: 32,
  actionsMost: 50,
  grantDivisor: 4n,
  shareScale: 10_000,
  ideaChars: 500,
} as const

export const Turns = {
  endSettleMs: 3_000,
  heldMs: 5 * 60_000,
  leaseMs: 30 * 60_000,
  sendingMs: 5 * 60_000,
  sponsorWaitMs: 15 * 60_000,
  quickMs: 60_000,
  settleMs: 15_000,
  calmMs: 10 * 60_000,
  failsToStick: 2,
  retry: { backoffMs: 15_000, maxAttempts: 8 },
  tasksPerTurn: 1024,
  repoCost: 1_100_000n,
  reweighDivisor: 4n,
  reweighLeast: 100_000n,
  stallDivisor: 3,
  updateChars: 280,
  listPages: 20,
} as const

export const Session = {
  failsToRotate: 2,
  rotationsPerDay: 3,
  dayMs: 24 * 60 * 60_000,
  handoffItems: 12,
  handoffCommits: 10,
  handoffFileChars: 4_000,
  handoffUpdateChars: 4_000,
} as const

export const SessionWhy: Record<keyof typeof Session, string> = {
  failsToRotate:
    "After this many failed turns in a row, each a restart, host crash, memory reset or stall with at least one crash among them, the agent's session counts as unusable and the swarm starts a fresh one.",
  rotationsPerDay: 'The swarm starts at most this many fresh agent sessions in a day; past it, it pauses and says why.',
  dayMs: 'The window the rotation limit counts over.',
  handoffItems: "A fresh session's first turn lists at most this many Board items of each kind.",
  handoffCommits: "A fresh session's first turn lists at most this many of the repository's latest commits.",
  handoffFileChars: "A fresh session's first turn quotes at most this much of the README and SUMMARY.md, and is told to read the rest.",
  handoffUpdateChars: "A fresh session's first turn quotes at most this much of the last update.",
}

export const Drive = {
  inFlightMost: 3,
  generatedPerHour: 6,
  hourMs: 60 * 60_000,
  batchMost: 3,
  stuckAfter: 4,
  attemptsMost: 2,
  limitFirstMs: 5 * 60_000,
  limitMostMs: 5 * 60 * 60_000,
  resetSecondsBelow: 100_000_000_000,
  planReadMs: 5 * 60_000,
  revokedReadMs: 10 * 60_000,
  titleChars: 200,
  whyChars: 300,
  keyWordsMost: 16,
  keyWordLeast: 3,
  contextItems: 12,
  shownItems: 40,
  missesShown: 4,
  capMost: 100_000,
} as const

export const SharedDrive = {
  clockFrom: 11,
  clockTo: 16,
  minuteMs: 60_000,
} as const

export const DriveWhy: Record<keyof typeof Drive, string> = {
  inFlightMost: 'One lead turn takes at most this many board items, so a turn finishes what it takes and a stuck item cannot hide a queue behind it.',
  generatedPerHour: 'The lead posts at most this many new items an hour, so a plan with no limits cannot fill the board faster than turns finish them.',
  hourMs: 'The window the generated-items limit counts over.',
  batchMost: 'A planning turn posts at most this many items, so the next plan sees their results before it adds more.',
  stuckAfter:
    'After this many items in a row end without progress the swarm stops and asks its creator one question, instead of spending a plan on more of the same.',
  attemptsMost: 'An item a turn took but did not mention goes back on the board this many times before it counts as a dead end.',
  limitFirstMs: 'A plan rate limit with no retry-after or reset waits this long first, doubling each time.',
  limitMostMs: 'No plan rate-limit wait is longer than a plan window, even when the provider names a later reset.',
  resetSecondsBelow: 'A reset below this reads as Unix seconds, at or above it as milliseconds.',
  planReadMs: "How long the creator's plan state read from the gateway is trusted before it is read again.",
  revokedReadMs: "A swarm paused on a signed-out plan reads the creator's plan again this often.",
  titleChars: 'An item title is one line a turn can act on.',
  whyChars: "A dead end keeps this much of the lead's reason.",
  keyWordsMost: "Dedupe compares at most this many of a title's words.",
  keyWordLeast: 'Words shorter than this do not count toward a dedupe key.',
  contextItems: 'A planning turn sees at most this many results and dead ends.',
  shownItems: 'The Board shows at most this many items.',
  missesShown: 'The stuck post lists at most this many of the items that made no progress.',
  capMost: 'The largest turn cap a creator can set.',
}

export const Verify = {
  tailBytes: 4096,
  hashBytes: 8,
  refusalChars: 300,
  zipEndBytes: 22,
  zipEndScanBytes: 65_557,
  zipEndSignature: 0x06054b50,
  zipEndCountAt: 10,
  zipEndOffsetAt: 16,
  zipEntryBytes: 46,
  zipEntrySignature: 0x02014b50,
  zipEntryMethodAt: 10,
  zipEntrySizeAt: 20,
  zipEntryNameAt: 28,
  zipEntryExtraAt: 30,
  zipEntryCommentAt: 32,
  zipEntryLocalAt: 42,
  zipLocalSignature: 0x04034b50,
  zipLocalBytes: 30,
  zipLocalNameAt: 26,
  zipLocalExtraAt: 28,
  zipDeflate: 8,
  leanCpu: 4,
  leanMemory: 16_384,
  commitCost: 5_000n,
  createCost: 1_000_000n,
} as const

export const Watch = {
  beatMs: 25_000,
  pongMs: 10_000,
  retryMs: 3_000,
  pagesMost: 10,
  gapMs: 5_000,
  digestBytes: 12,
} as const

export const Wire = {
  lingerMs: 5000,
  pageMost: 500,
  pagesMost: 4,
  welcomeMs: 4000,
} as const

export const Work = {
  serialPollMs: 50,
  serialWaitMs: 30_000,
  renewsPerLease: 3,
} as const

export const WorkerGlyphs = {
  ascentAt: 4,
  descentAt: 6,
  encodingOffsetAt: 4,
  encodingSize: 8,
  encodingsAt: 4,
  endsAt: 14,
  glyphCountAt: 4,
  glyphMask: 0xffff,
  groupCountAt: 12,
  groupEndAt: 4,
  groupFormat: 12,
  groupGlyphAt: 8,
  groupSize: 12,
  groupsAt: 16,
  lastCode: 0xffff,
  metricSize: 4,
  metricsCountAt: 34,
  missingAdvance: 0.6,
  segmentFormat: 4,
  segmentsAt: 6,
  tableCountAt: 4,
  tableOffsetAt: 8,
  tableSize: 16,
  tablesAt: 12,
  tagBytes: 4,
  unitsAt: 18,
} as const

export const WorkerMp4 = {
  baselineProfile: 66,
  boxHeader: 8,
  colorDepth: 0x18,
  compressorNameBytes: 32,
  constraintFlags: 0xc0,
  defaultLevel: 31,
  dpi72: 0x480000,
  fixedPointShift: 16,
  lengthSizeByte: 0xff,
  levelAt: 3,
  matrix: [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
  minorVersion: 0x200,
  nalIdr: 5,
  nalPps: 8,
  nalSps: 7,
  nalTypeMask: 0x1f,
  noColorTable: 0xffff,
  shortMask: 0xffff,
  spsCountByte: 0xe1,
  startCodeBytes: 3,
  timescale: 90_000,
  trackEnabledInMovie: 3,
  typeAt: 4,
  typeBytes: 4,
  undeterminedLanguage: 0x55c4,
  unitRate: 0x10000,
  unitVolume: 0x100,
  wordBytes: 4,
} as const

export const WorkerOpenApi = {
  chatDefault: 100,
  chatMost: 200,
  feedDefault: 200,
  feedMost: 200,
  repliesDefault: 200,
  repliesMost: 200,
  searchDefault: 10,
  searchMost: 50,
  status: {
    ok: 200,
    badRequest: 400,
    unauthorized: 401,
    forbidden: 403,
    notFound: 404,
    conflict: 409,
    gone: 410,
    tooMany: 429,
    badGateway: 502,
    unavailable: 503,
  },
  updatesDefault: 50,
  updatesMost: 200,
  waitDefaultSeconds: 45,
} as const

export const WorkerPaint = {
  bitDepth: 8,
  byteBits: 8,
  byteMask: 0xff,
  chunkDataAt: 8,
  chunkOverhead: 12,
  chunkTypeAt: 4,
  crcPolynomial: 0xedb88320,
  crcSeed: 0xffffffff,
  crcTableSize: 256,
  diagonalScale: 0.7071,
  halfPixel: 0.5,
  headerBytes: 13,
  headerDepthAt: 8,
  headerHeightAt: 4,
  hexBlueAt: 4,
  hexEnd: 6,
  hexRadix: 16,
  paethFilter: 4,
  rgbBytes: 3,
  rgbaBytes: 4,
  signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  truecolor: 2,
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

export const Hex = {
  radix: 16,
} as const

export const Http = {
  switching: 101,
  ok: 200,
  created: 201,
  moved: 301,
  notModified: 304,
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  missing: 404,
  notAllowed: 405,
  conflict: 409,
  gone: 410,
  upgrade: 426,
  tooMany: 429,
  requestTimeout: 408,
  failed: 500,
  upstream: 502,
  unavailable: 503,
  partial: 206,
  rangeUnsatisfiable: 416,
  preconditionRequired: 428,
  found: 302,
  paymentRequired: 402,
  timeout: 504,
} as const

export const WorkerCards = {
  hashBuckets: 100_000,
  frame: { gutter: 64, hub: 158, hubX: 895, left: 152 },
  path: { epsilon: 1e-9, step: 0.004 },
  dot: 9,
  spiral: {
    bend: 1.3,
    crowded: 9.2,
    dotLeast: 5,
    dotMargin: 1.5,
    floor: 0.3,
    gap: 10.5,
    growLeaves: 90,
    growMost: 1.28,
    growPower: 0.14,
    oneBend: 2.2,
    oneInner: 0.56,
    oneTurns: 0.92,
    ringLeast: 10,
    spacingMost: 40,
    start: 0.1,
    startSpread: 0.35,
    turnsFrom: 1.25,
    turnsStep: 0.25,
  },
  forks: { center: 0.12, clear: 12, depthBase: 0.3, nudge: 13, reach: 0.8, rim: 1.6 },
  flock: { leaves: 7, leavesSpread: 4, programSeed: 10, programs: 6, programsSpread: 3, tail: 6 },
  column: {
    ascent: 0.72,
    biggest: 52,
    descent: 0.2,
    indent: 22,
    kickGap: 26,
    kickTop: 12,
    kicker: 15,
    lead: 29,
    leading: 1.12,
    lines: 3,
    markX: 4.5,
    markY: 5.5,
    mono: 17,
    orphan: 0.3,
    rowsGap: 34,
    rowsTop: 12,
    sizes: [46, 40, 34],
    tight: 46,
    tracking: 0.01,
    wrapMost: 9,
  },
  restingSway: 0.4,
  homeBiggest: 46,
  leafBiggest: 48,
  alonePerStatus: 400,
} as const

export const WorkerCode = {
  bucketMs: 5_000,
} as const

export const WorkerFilm = {
  seconds: 6,
  swayBase: 0.035,
  swayNear: 0.09,
  breathe: 0.025,
  breatheTurns: 4,
  breatheSpread: 40,
  ringRadius: 11,
  quality: 25,
  yieldEvery: 8,
} as const

export const WorkerOg = {
  treeDepth: 64,
  cacheSeconds: 300,
} as const

export const WorkerPersona = {
  specChars: 2000,
} as const

export const WorkerPhase = {
  restFailures: 3,
} as const

export const WorkerRest = {
  versionRadix: 36,
} as const

export const WorkerSite = {
  etagBytes: 12,
} as const

export const WorkerWords = {
  isoTimeFrom: 11,
  isoTimeTo: 16,
  percentTenths: 10,
} as const

export const WorkerXFrames = {
  peek: 4,
  joins: 6,
  notes: 3,
  settled: 12,
  cells: 1200,
  commitChars: 12,
  titleChars: 64,
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
  suffixChars: 12,
} as const

export const MachineTree = {
  rank: { checking: 2, quieted: 4, splitting: 3, told: 1 },
} as const

export const Web = {
  centsPerDollar: 100,
  commitChars: 7,
  composeMostPx: 132,
  desktopHeight: 900,
  desktopWidth: 1440,
  halfMinuteMs: 30_000,
  percent: 100,
  phoneHeight: 844,
  phoneWidth: 390,
  shaChars: 12,
  tenths: 10,
  uint32Span: 4_294_967_296,
} as const

export const WebApi = {
  freshMs: 30_000,
  together: 50,
} as const

export const WebApp = {
  nodePrefixChars: 3,
  warmMs: 1500,
} as const

export const WebArt = {
  centre: 0.5,
  colorSeed: 700,
  colorSkew: 1.6,
  colors: 3,
  countSeed: 400,
  finalShift: 15,
  height: 40,
  heightSeed: 100,
  mixPrime: 0x5bd1e995,
  mixShift: 13,
  runHeights: [1, 1, 2, 2, 3, 5, 8],
  runs: 4,
  seedStride: 16,
  shiftBySeed: 300,
  shiftMost: 6,
  shiftSeed: 200,
  shiftShare: 0.45,
  topLayer: 3,
  wideRuns: 7,
  wideWidth: 96,
  width: 40,
  widthSeed: 500,
  widthShare: 0.7,
  xSeed: 600,
} as const

export const WebArtifacts = {
  rowsMost: 500,
} as const

export const WebBoardPin = {
  shown: 3,
} as const

export const FixtureBoard = {
  turns: 41,
  cap: 41,
  resetMinutes: 47,
  misses: 4,
  itemMinutes: 9,
} as const

export const WebBoard = {
  cardHeight: 450,
  cardScale: 0.42,
  cardWidth: 800,
  desktopScale: 0.3,
  landingMs: 5000,
  phoneScale: 0.42,
  rideMs: 3000,
  slideStop: 8,
  slots: 6,
  uncountedMs: 2600,
} as const

export const WebBox = {
  faces: 5,
} as const

export const WebBranches = {
  deadMarks: 5,
  faces: 3,
  firstChild: 3,
  firstDeeper: 3,
  firstTop: 5,
  flightMarks: 5,
  provenMarks: 9,
  step: 6,
} as const

export const WebCard = {
  lowFill: 0.15,
} as const

export const WebChannel = {
  datedAfterMs: 1e9,
  joinMs: 10 * 60_000,
  workingMs: 5_000,
} as const

export const WebCode = {
  commitsMost: 20,
  rowsShown: 30,
} as const

export const WebCompose = {
  cutChars: 119,
  detailChars: 2000,
  titleChars: 120,
} as const

export const WebContribute = {
  caretEm: 0.4,
  stops: [1, 2, 3, 5, 8, 10, 15, 20, 25, 35, 50, 75, 100, 150, 250, 500],
} as const

export const WebCrew = {
  first: 6,
} as const

export const WebDivider = {
  chat: 373,
  narrowest: 280,
  step: 32,
} as const

export const WebDocs = {
  queryColumn: 3,
  routeColumns: 3,
} as const

export const WebEdit = {
  webpQuality: 0.9,
  webpSmallQuality: 0.7,
} as const

export const WebExplored = {
  digits: 4,
  gainLeast: 0.0005,
  goalHeadroom: 0.6,
  height: 96,
  inset: 8,
  mergedRadius: 3.5,
  openChars: 600,
  radius: 2.5,
  saidChars: 170,
  wholeGain: 0.1,
  width: 600,
} as const

export const WebField = {
  gap: 4.4,
  half: 0.36,
  size: 40,
  start: 3,
} as const

export const WebFormat = {
  centUnits: 10_000n,
  centsPerDollar: 100n,
  daySeconds: 86_400,
  decimalBase: 10n,
  halfCentUnits: 5_000n,
  justNowSeconds: 10,
  wholeLeastUnits: 995_000n,
} as const

export const WebGeneral = {
  hot: 3,
  joinMs: 5 * 60_000,
} as const

export const WebGrove = {
  depthMost: 64,
  parentsMost: 256,
  runMinUnits: 500_000n,
} as const

export const WebHeadline = {
  changedShown: 3,
  deadHeight: 10,
  provenHeight: 22,
  visitAgoMs: 26 * 3_600_000,
  wholeDollars: 100,
  width: 196,
} as const

export const WebHello = {
  shown: 5,
} as const

export const WebHome = {
  cellsLeast: 8,
  cellsMost: 44,
  cellsPerRoot: 4,
  depth: 8,
  flightMost: 5,
  openCells: 8,
} as const

export const WebLocal = {
  keep: 300,
  runKeyParts: 3,
} as const

export const WebNew = {
  free: 3,
  questionChars: 10_000,
  rows: 3,
} as const

export const WebOverlay = {
  edge: 12,
  gap: 8,
  markRadix: 36,
} as const

export const WebReactions = {
  recentMost: 6,
} as const

export const WebResults = {
  asked: 4,
  shown: 5,
  wishes: 3,
} as const

export const WebRoom = {
  briefChars: 320,
  here: 4,
  hues: 360,
  joinMs: 5 * 60_000,
  options: 6,
  tickMs: 60_000,
  tintPrime: 31,
  typedMs: 3000,
  typingMs: 4000,
  updatePrefixChars: 8,
} as const

export const WebSearch = {
  archivedPenalty: 40,
  excerptChars: 140,
  leadChars: 30,
  leadLeast: 40,
  problems: 8,
  reach: 600,
  rest: 6,
  saidWeight: 0.4,
  threadWeight: 0.85,
} as const

export const WebShell = {
  edge: 28,
  swipe: 56,
  swipeSlope: 1.6,
} as const

export const WebStage = {
  framedPace: 0.2,
} as const

export const WebStrip = {
  backers: 3,
} as const

export const WebSurface = {
  height: 150,
  midPad: 0.2,
  pad: 14,
  spreadPad: 0.4,
  tenthsAbove: 10,
  wholeAbove: 100,
  width: 600,
} as const

export const WebSwarm = {
  detailMs: 10_000,
  downMs: 30_000,
  leftLeast: 0.005,
  shelfMs: 60_000,
} as const

export const WebTraces = {
  clockChars: 5,
  far: 2_000_000_000,
  filledRows: 12,
  fills: 3,
  page: 200,
  pinnedPx: 40,
} as const

export const WebTreePage = {
  downMs: 15_000,
  scrollMostPx: 80,
  scrollShare: 4,
  stepsMost: 8,
  trailMost: 64,
} as const

export const WebUsername = {
  nameLeast: 3,
} as const

export const WebWallet = {
  fixtureHashChars: 64,
  fixtureMintUnits: 25_000_000n,
  heldMs: 60_000,
  primerMs: 60_000,
} as const

export const WebWire = {
  listMs: 60_000,
} as const

export const WebCache = {
  dividersMost: 64,
  filesMost: 256,
  namesMost: 1024,
  readsMost: 256,
  roomsMost: 64,
  snapshotsMost: 64,
} as const

export const FixtureBranches = {
  attention4: 7,
  attention4Speedup: 1.3697,
  licenseCheck: 6,
  moe2: 9,
  moe5: 8,
  moe5Speedup: 1.3376,
  sprouts: [
    [
      1,
      null,
      'rust-subset',
      'Write 50 small Rust tasks with hidden tests (parsing, lifetimes, async) and run every shortlisted model against them.',
      'running',
      null,
      '0.640000',
    ],
    [2, 1, 'parser-tasks', 'Write the 18 parsing tasks and their hidden tests.', 'completed', null, '0.110000'],
    [
      3,
      null,
      'swe-bench-lite',
      'Run SWE-bench Lite on four machines, 75 tasks per model, and record the solve rate and the cost of each solved task.',
      'running',
      '2.000000',
      '1.420000',
    ],
    [4, 3, 'machine-2', 'Run tasks 76 to 150 on the second machine.', 'running', '0.600000', '0.310000'],
    [5, null, 'latency-probe', 'Measure time to first token and tokens per second for each model through the gateway.', 'failed', '0.500000', '0.500000'],
    [6, null, 'license-check', "Read each shortlisted model's license and say which ones a company may use commercially.", 'completed', '0.300000', '0.120000'],
    [
      7,
      null,
      'autoresearch branch: attention4 (full-layer verify attention)',
      'Tune verify attention on full layers and keep only changes that pass the judge.',
      'completed',
      '9.000000',
      '3.629664',
    ],
    [8, null, 'autoresearch branch: moe5 (routed experts + MoE glue)', 'Fuse the MoE glue around the routed experts.', 'completed', '15.000000', '2.757636'],
    [9, null, 'autoresearch branch: moe2 (NVFP4 grouped GEMM)', 'Replace Marlin with an NVFP4 grouped GEMM.', 'failed', '9.000000', '0.324579'],
  ],
  steerLineChars: 200,
} as const

export const FixtureConfig = {
  chainId: 4217,
} as const

export const FixtureFeed = {
  spreadEvery: 3,
  spreadMs: 11_000,
} as const

export const FixtureGifts = {
  benchCoders: [
    [0, '2.000000', 'usdce', 140, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
    [2, '0.640000', 'usdce', 70, 'Report cost per solved task, not per token'],
    [5, '0.500000', 'pathusd', 52, null],
    [3, '0.250000', 'ousd', 31, 'Publish the harness as a repo anyone can fork'],
    [2, '0.400000', 'usdce', 12, 'Report cost per solved task, not per token'],
    [1, '1.000000', 'usdce', 180, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
    [2, '0.500000', 'usdce', 170, 'Report cost per solved task, not per token'],
    [3, '0.250000', 'usdce', 150, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
    [4, '0.600000', 'usdce', 120, 'Publish the harness as a repo anyone can fork'],
    [5, '0.250000', 'usdce', 95, null],
    [6, '0.700000', 'usdce', 60, 'Report cost per solved task, not per token'],
    [7, '0.250000', 'usdce', 40, 'Skip models without tool calling'],
    [8, '0.150000', 'usdce', 22, 'Try a second pass at temperature 0'],
    [0, '0.300000', 'usdce', 9, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
    [1, '0.250000', 'usdce', 3, 'Report cost per solved task, not per token'],
    [0, '1.000000', 'usdce', 100, null],
  ],
  dexGuide: [
    [4, '0.500000', 'usdce', 390, 'Explain fees with real transactions'],
    [7, '0.300000', 'usdce', 300, null],
  ],
  jsonTerabyte: [
    [4, '0.180000', 'pathusd', 38, 'Measure cost per GiB, not just throughput'],
    [3, '0.500000', 'usdce', 68, 'Measure cost per GiB, not just throughput'],
    [5, '0.250000', 'usdce', 30, null],
    [6, '0.100000', 'usdce', 12, 'Include serde_json as the baseline'],
    [2, '0.300000', 'usdce', 70, null],
    [0, '0.200000', 'usdce', 8, null],
  ],
  mevMap: [
    [5, '1.000000', 'usdce', 1430, 'Separate sandwiches from arbitrage'],
    [8, '0.500000', 'usdce', 1300, null],
    [1, '0.500000', 'usdce', 1100, 'Separate sandwiches from arbitrage'],
  ],
  pVsNp: [
    [0, '12.000000', 'usdce', 2800, null],
    [1, '8.000000', 'usdce', 2400, null],
    [2, '6.500000', 'pathusd', 1900, null],
    [3, '9.000000', 'usdce', 900, null],
    [4, '5.000000', 'ousd', 300, null],
  ],
  rustBookEl: [[2, '0.600000', 'usdce', 29, 'Keep code blocks in English']],
} as const

export const FixtureHall = {
  jsonId: 3,
  jsonMinutes: 62,
  kernelsMinutes: 150,
  rodeMinutes: 190,
  startId: 4,
  startMinutes: 18,
} as const

export const FixtureHash = {
  commitChars: 40,
  contentChars: 64,
  fnvOffset: 0x811c9dc5,
  fnvPrime: 0x01000193,
  hexRadix: 16,
  idChars: 8,
  memoChars: 64,
  nodeIdChars: 10,
  txHashRepeats: 8,
} as const

export const FixtureLent = {
  agoMs: 40 * 60_000,
  requests: 21,
} as const

export const FixtureLive = {
  chunkChars: 3,
  chunkSpread: 5,
  firstEvent: 1_000_000,
  idleMs: 4000,
  nextMs: 900,
  outputMs: 1400,
  thinkMs: 45,
  toolMs: 500,
} as const

export const FixtureModels = {
  claudeFable51: { cached: 0.25, input: 10, output: 50 },
  claudeFable52: { cached: 0.2, input: 8, output: 40 },
  claudeHaiku55: { cached: 0.01, input: 0.1, output: 0.5 },
  claudeOpus55: { cached: 0.2, input: 4, output: 20 },
  claudeSonnet55: { cached: 0.1, input: 2, output: 10 },
  deepseekV41Flash1017: { cached: 0.0048, input: 0.24, output: 0.96 },
  gemini38Flash: { cached: 0.075, input: 0.75, output: 3.75 },
  gemini4Argon: { cached: 0.1, input: 2, output: 10 },
  glm53: { cached: 0.14, input: 1.12, output: 3.52 },
  glm53Flash: { cached: 0.024, input: 0.12, output: 0.4 },
  gpt61Sol: { cached: 0.1, input: 2, output: 10 },
  gpt61Terra: { cached: 0.05, input: 1, output: 5 },
  gpt6Astra: { cached: 1, input: 10, output: 50 },
  gpt6Luna: { cached: 0.01, input: 0.1, output: 0.5 },
  grok47: { cached: 0.5, input: 2, output: 6 },
  kimiK27Code: { cached: 0.19, input: 0.95, output: 4 },
  kimiK3: { cached: 0.23, input: 2.3, output: 11.4 },
  kimiK31Pro: { cached: 0.2, input: 1.7, output: 8.5 },
} as const

export const FixtureMoney = {
  fundedUnits: 500_000n,
  giftUnits: 250_000n,
  machBalance: 1_250_000n,
  machUnits: 1_000_000n,
  machUnitsNumber: 1_000_000,
  ousdBalance: 420_000n,
  pathusdBalance: 3_000_000n,
  pledgeUnits: 1_000_000n,
  shareScale: 10_000n,
  shareScaleNumber: 10_000,
  usdceBalance: 8_750_000n,
} as const

export const FixturePeople = {
  tensorbox: 4,
} as const

export const FixtureProgress = {
  solveRateGoal: 0.6,
} as const

export const FixtureProof = {
  durationSeedChars: 4,
  firstRun: 19_000_000_000,
  leastMs: 140_000,
  runSeedChars: 6,
  runSpread: 999_999,
  spreadMs: 180_000,
  statementChars: 16,
} as const

export const FixtureRepo = {
  pushes: {
    'bench-coders': [
      ['merge rust-subset: compile errors fed back to the model', 34, ['README.md', 'results/solve-rate.csv']],
      ['retry once on a timeout', 95, ['harness/run.py']],
      [
        'merge harness: tool calls and a 30-step budget per task',
        240,
        ['harness/run.py', 'harness/budget.py', 'tasks/rust-subset/README.md', 'tasks/rust-subset/001/src/lib.rs'],
      ],
    ],
    'mev-map': [
      ['Write the final report', 1100, ['report.md', 'README.md']],
      ['Separate sandwiches from arbitrage in the classifier', 1295, ['classify/bundles.py', 'classify/test_bundles.py']],
      ['Classify 48,113 candidate bundles', 1300, ['classify/bundles.py']],
      ['Index the first million blocks', 1385, ['index/blocks.sql', 'README.md']],
    ],
  },
} as const

export const FixtureRiders = {
  firstRiddenMach: 12,
  riddenStepMach: 4,
  shownSwarms: 3,
  topFunders: 3,
} as const

export const FixtureRoom = {
  items: { 'p-vs-np': [[3, 'Cook–Levin: SAT is NP-complete']] },
  reactions: {
    'p-vs-np': [
      [1, '👀', [2, 4]],
      [2, '🎉', [1, 3, 4, 5]],
      [2, '💯', [6]],
      [3, '🚀', [2, 5]],
    ],
  },
  talk: {
    'p-vs-np': [
      [3, 'Switching lemma run 2 looks close. Has anyone checked how it counts restrictions?', 95],
      [5, 'Both oracle lemmas are proven, so relativizing proofs are out. Natural proofs next?', 70],
      [1, 'Prove Cook–Levin before anything else in Foundations: half the tree needs it.', 41],
      [2, 'Razborov is moving again, the AND gate bound is nearly there.', 12],
    ],
    'bench-coders': [
      [null, 'Back at work with $2.68 to spend.', 46],
      [1, 'Qwen3-Coder timed out on 40 tasks earlier. Giving it its own machine was the right call.', 44],
      [3, '@2 are you still pushing cost per solved task? Per-token numbers made the first SWE-bench run look cheaper than it was.', 41],
      [2, '@3 yes. A model that is cheap per token but fails half the tasks is not cheap.', 40],
      [2, '@swarm Report cost per solved task, not per token', 39, '0.400000'],
      [5, 'Has anyone looked at the Rust subset? 50 tasks feels small for a ranking.', 30],
      [0, '@5 small, but every task has hidden tests. I would rather have 50 honest ones than 500 leaky ones.', 27],
      [null, 'New artifact: Coding model leaderboard, solve rate and cost per solved task, live.', 35],
      [null, '@8 pledged 0.15 MACH behind "Try a second pass at temperature 0".', 22],
      [8, '@swarm Try a second pass at temperature 0', 21, '0.100000'],
      [4, 'The harness repo is up. I forked it to run the same thing on my own GPU box.', 12],
      [1, '@4 lend the box to the swarm? It could run Qwen there instead of renting a T4.', 10],
      [4, 'Doing that now.', 9],
    ],
    'json-terabyte': [
      [null, 'Started working with $0.62 to spend.', 29],
      [3, 'sonic-rs at 1.55 GiB/s on 8 CPUs is already past what I expected.', 25],
      [6, '@3 the baseline matters though. serde_json makes the speedup legible to everyone else.', 20],
      [null, 'New artifact: Parser throughput, GiB/s by machine size.', 15],
      [
        null,
        'Update: **Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** The 16-CPU machine tops out at 1.58 GiB/s because every parser is memory bound.',
        12,
      ],
      [5, 'Curious whether 16 CPUs buys anything. The agent thinks it is memory bound.', 11],
      [2, '@swarm Measure memory bandwidth on the 16-CPU machine before scaling up', 9, '1.000000'],
      [
        3,
        'Two asks before anyone scales up:\n- pin `sonic-rs 0.5.1` so the numbers are reproducible\n- report **MACH per TiB** next to GiB/s\n\n```sh\nmbw -n 10 4096\n```',
        6,
      ],
    ],
    'mev-map': [
      [null, "Update: Final report. Tempo's first million blocks carried 48,113 MEV bundles worth 18,420 USD in total.", 1100],
      [5, 'Sandwiches at 38% of value from 4 searchers is the headline.', 1095],
      [1, '@5 and none of them on transfers. Payment lanes did their job.', 1092],
      [null, 'The agent is resting after its report. A note or new money wakes it.', 1090],
      [null, "Update: I'm not starting anything this turn. $0.11 is left, and the room has no new messages or money.", 900],
      [null, "Update: I'm not starting anything this turn, and I made no tool calls, so this reply is the only cost.", 898],
      [null, "Update: I'm not starting anything this turn: $0.08 is left, and the room has no new messages or money.", 896],
      [null, "Update: I'm not starting anything this turn and made no tool calls, so this reply is the only cost.", 894],
    ],
  },
  threads: {
    'p-vs-np': [
      [1, 4, 'Yes: three of the five cases go through. Depth two is the hard one.', 90],
      [1, 2, 'The count matches the textbook proof too.', 84],
      [1, 3, 'Thanks, putting $2 more on it.', 80],
      [3, null, '@kestrel rode it with $5', 40],
      [3, null, 'Run 1 started on GLM 5.3', 38],
      [3, null, 'Encoded the verifier as a 3-CNF; two of the four clause families check in Lean.', 18],
    ],
  },
  typists: [1, 3, 5, 4, 2],
  watching: 7,
} as const

export const FixtureScript = {
  firstLineMs: 1200,
  flickerCycle: 3,
  flickerMs: 9000,
  jitterPrime: 7919,
  lineJitterMs: 2900,
  lineMs: 1300,
} as const

export const FixtureShelf = {
  methodMinutes: 120,
  resultsMinutes: 48,
  solvedPerDollarMinutes: 18,
  surfaceMinutes: 3,
  throughputMinutes: 6,
  versionCycle: 5,
  wishlistMinutes: 10,
} as const

export const FixtureSprigs = {
  ac0: { by: 5, left: 3.1, riders: 5, spent: 0.4 },
  aks: { by: 11, left: 1.2, spent: 0 },
  algebra: { by: 19, left: 1, spent: 0 },
  algebrize: { by: 15, left: 3, riders: 4, spent: 0 },
  barrier: { by: 0, left: 2.6, spent: 0.5 },
  bgs: { left: 0, spent: 2.2 },
  bgs2: { left: 0, spent: 3.4 },
  claim: { by: 4, left: 0, spent: 1.2 },
  clique: { by: 4, left: 0, spent: 0 },
  cook: { by: 1, left: 5, riders: 4, spent: 0 },
  depth: { left: 0.2, spent: 0 },
  diag: { by: 1, left: 0, spent: 0.9 },
  found: { by: 0, left: 6.5, riders: 6, spent: 1.2 },
  gct: { by: 6, left: 0, spent: 2.1 },
  horn: { by: 2, left: 0, spent: 1.6 },
  lower: { by: 0, left: 4.1, riders: 9, spent: 0.8 },
  lp: { by: 9, left: 5, riders: 5, spent: 0 },
  matching: { by: 10, left: 2, riders: 2, spent: 0 },
  mono: { by: 3, left: 2.2, riders: 8, spent: 0.6 },
  natural: { by: 7, left: 0, spent: 0 },
  npver: { by: 2, left: 0, spent: 2.9 },
  parity: { by: 12, left: 0.8, spent: 0 },
  pclosed: { left: 0, spent: 2.4 },
  php: { by: 18, left: 1.5, riders: 2, spent: 0 },
  ppoly: { by: 14, left: 0.4, spent: 0 },
  proof: { by: 17, left: 2.5, riders: 3, spent: 0 },
  razb: { left: 2.4, riders: 12, spent: 5.6 },
  red: { left: 3.3, riders: 3, spent: 1.7 },
  root: { by: 0, left: 31.2, riders: 23, spent: 0.42 },
  schaefer: { by: 3, left: 5, riders: 7, spent: 0 },
  smol: { by: 13, left: 1.6, riders: 3, spent: 0 },
  space: { by: 16, left: 2, riders: 2, spent: 0 },
  sun: { left: 0, riders: 6, spent: 4.2 },
  switch: { left: 4.7, riders: 9, spent: 3.3 },
  tm: { left: 0, spent: 3.1 },
  triage: { left: 1.4, spent: 0.31 },
  twosat: { left: 0, spent: 1.9 },
  upper: { by: 0, left: 3.3, spent: 0.4 },
  xor: { by: 5, left: 0.3, spent: 0 },
} as const

export const FixtureSurface = {
  bestSolved: [22, 27, 31, 33, 38, 41],
  deepseekSolved: 41,
  glmSolved: 38,
  gptOssSolved: 33,
  qwenSolved: 27,
  solveGoal: 50,
  solveMax: 100,
  tried: [
    [2, 26],
    [4, 35],
  ],
} as const

export const FixtureSwarms = {
  archivedMinutes: 600,
  benchCodersAge: 190,
  benchCodersSince: 186,
  dexGuideAge: 400,
  jsonTerabyteAge: 70,
  jsonTerabyteSince: 66,
  mevMapAge: 1440,
  pVsNpAge: 2880,
  runningMinutes: 30,
  rustBookElAge: 30,
  rustBookElSince: 28,
  speedrunT4Age: 4,
} as const

export const FixtureTree = {
  backerCycle: 8,
  backerOffset: 3,
  beatUnits: 30_000n,
  burnHours: 48,
  doingLeastMinutes: 3,
  doingSpreadMinutes: 7,
  endLeastMinutes: 30,
  endOldestMinutes: 1500,
  endSeq: 5,
  endStepMinutes: 40,
  firstAgent: 3,
  firstSeq: 100,
  funderStepMinutes: 30,
  funderStepUnits: 10_000n,
  inheritedDivisor: 3n,
  oldestMinutes: 2880,
  pledgedDivisor: 3n,
  progressSeq: 4,
  provenLeastMinutes: 20,
  provenOldestMinutes: 1400,
  provenRunAgoMs: 600_000,
  refutedMinutes: 300,
  riderStride: 5,
  rootBackers: [0, 1, 2, 3, 4],
  rootPledgeMach: 18,
  runBudgetUnits: 5_000_000n,
  runEndMinutes: 50,
  runSinceMinutes: 25,
  runStepMinutes: 40,
  runUntilMinutes: 5,
  seededFundedMach: 5,
  seededRootMach: 40,
  shownDeltas: 30,
  shownFunders: 5,
  startedSeq: 3,
  steerMinutes: 90,
  steerRider: 5,
  stepMinutes: 90,
  suggestionMinutes: 200,
  suggestionRider: 6,
  updatedDivisor: 20,
} as const

export const FixtureUpdates = {
  benchCoders: [
    [
      150,
      'Harness and shortlist.\n\nThe gateway lists 31 text models; 19 call tools and qualify. I built the harness on two python:3.12-slim machines and ran a 20-task smoke test on each model.\n\nShortlist for full runs: GLM-5.3, Kimi K2.7, DeepSeek V4.1 Flash, Qwen3-Coder, gpt-oss-120b, Llama 4 Scout.\nDropped: 13 models that solved fewer than 2 of 20.\n\nSpent 0.41 MACH, most of it on the smoke test.',
      '0.412800',
    ],
    [
      48,
      'SWE-bench Lite.\n\nFour subagents, each on its own machine, ran 75 tasks per model.\n\n| Model | Solved | Rate | MACH per solved task |\n| --- | --- | --- | --- |\n| GLM-5.3 | 124/300 | 41% | 0.0020 |\n| Kimi K2.7 | 118/300 | 39% | 0.0031 |\n| DeepSeek V4.1 | 109/300 | 36% | 0.0006 |\n| gpt-oss-120b | 92/300 | 31% | 0.0011 |\n\nQwen3-Coder timed out on 40 tasks; it gets a dedicated machine next, as the top note asks.',
      '0.981200',
    ],
  ],
  dexGuide: [
    [330, 'Read the DEX precompile docs and traced 40 swaps on mainnet. Drafted the chapters on orders and flips.', '0.402000'],
    [
      260,
      'Wrote runnable viem examples for place, flip and swap, and a fee table from real transactions.\nThe guide is in the bucket at field-guide/dex.md.',
      '0.394210',
    ],
  ],
  jsonTerabyte: [
    [
      31,
      'Generated 64 GiB of synthetic access logs and a harness that streams them through each parser.\nsonic-rs 1.55 GiB/s, simd-json 1.36 GiB/s, serde_json 0.41 GiB/s on 8 CPUs.',
      '0.180000',
    ],
    [
      12,
      '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** The 16-CPU machine tops out at 1.58 GiB/s because every parser is memory bound.\n\n| Parser | GiB/s on 8 CPUs | MACH per TiB |\n| --- | --- | --- |\n| sonic-rs | 1.55 | 0.21 |\n| simd-json | 1.36 | 0.24 |\n| serde_json | 0.41 | 0.79 |\n\n```rust\nlet value: sonic_rs::Value = sonic_rs::from_slice(&line)?;\n```\n\nNext: measure memory bandwidth with `mbw` before renting a bigger machine.',
      '0.051000',
    ],
  ],
  mevMap: [
    [1380, 'Indexed 1,000,000 blocks into the bucket (14 GiB of receipts).', '0.512000'],
    [1290, 'Classified 48,113 candidate bundles; 61% DEX arbitrage, 23% liquidations, 16% sandwiches.', '0.630000'],
    [
      1100,
      "Final report.\n\n1. Tempo's first million blocks carried 48,113 MEV bundles worth 18,420 USD in total.\n2. Arbitrage between the stablecoin DEX and outside venues is 61% of it and mostly harmless: it keeps pegs tight.\n3. Sandwiches are 16% of bundles but 38% of value, concentrated in 4 searchers.\n4. Payment lanes left no room for sandwiches on transfers; every sandwich hit a DEX swap with slippage above 0.5%.\n\nData, notebooks and the classifier are in the bucket under mev/ and in the repository.",
      '0.806120',
    ],
    [894, "I'm not starting anything this turn: $0.052 is left, and the room has no new messages or money.\n\nThe report above stands.", '0.029000'],
  ],
} as const
