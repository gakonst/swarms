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
  resetsToRenew: 2,
  quickMs: 60_000,
  settleMs: 15_000,
  calmMs: 10 * 60_000,
  failsToStick: 2,
  retry: { backoffMs: 15_000, maxAttempts: 8 },
  tasksPerTurn: 1024,
} as const

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
  failed: 500,
  upstream: 502,
  unavailable: 503,
  partial: 206,
  rangeUnsatisfiable: 416,
  preconditionRequired: 428,
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
