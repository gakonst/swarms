export type Problem = { goal: string; hint: string; id: string; label: string; title: string }

export const problems: readonly Problem[] = [
  {
    id: 'port-to-rust',
    label: 'Port a C library to Rust',
    hint: 'Memory-safe, same behavior, same speed.',
    title: 'Port a widely used C library to safe Rust',
    goal: 'Pick a widely used C library with a good test suite, such as a compression or parsing library, and port it to safe Rust. Keep its public behavior: run the original test suite against the port, add differential tests that feed both versions the same inputs, and fuzz the boundaries. Track progress module by module in a public dashboard, publish the code as you go, and report speed against the original and every place the port still differs.',
  },
  {
    id: 'pq-signatures',
    label: 'Quantum-safe signatures',
    hint: 'Protect the next generation of cryptography.',
    title: 'Better post-quantum signatures',
    goal: 'Find a defensible size or speed improvement in post-quantum signatures at matched security. Establish the frontier from primary papers and specifications. Propose falsifiable hypotheses, reproduce the strongest relevant baselines on identical hardware, and test the most promising idea. Publish sources, parameters, code, measurements, failed approaches and proof gaps. Distinguish measured improvements from security and novelty claims. A rigorous negative result is a useful outcome.',
  },
  {
    id: 'faster-science',
    label: 'Faster science',
    hint: 'Make a scientific workload run better.',
    title: 'More efficient scientific computing',
    goal: 'Find a reproducible performance improvement for an open-source scientific computing workload. Choose and justify one workload, establish correctness and strong baselines, then test competing optimization hypotheses under identical conditions. Report runtime distributions, memory use, hardware, dependencies and full reproduction commands. Publish code and negative results. Do not trade away numerical accuracy to win a benchmark.',
  },
  {
    id: 'ship-a-tool',
    label: 'Build a tool people need',
    hint: 'From a one-page spec to a release.',
    title: 'Build and ship a small open-source tool',
    goal: 'Write a one-page spec for a small command-line tool that developers keep asking for and nobody maintains well (for example a fast, correct CSV diff, or a tool that explains why a lockfile changed), then build it in the open: a public repository, tests, documentation, binaries for Linux and macOS, and a short demo. Publish the spec first, keep a list of what is done and what is left, and say plainly what it does not do yet.',
  },
  {
    id: 'reproduce',
    label: 'Put a result to the test',
    hint: 'Find out what holds up.',
    title: 'Reproduce a research result',
    goal: 'Independently reproduce a published computational research result. First identify a specific paper with public code and data and state its central testable claim. Record the original conditions, reproduce the baseline, test sensitivity to key assumptions and publish exact commands, dependencies, outputs and discrepancies. Separate successful reproduction, failed reproduction and inconclusive evidence. Do not claim independent validation from the authors’ reported numbers alone.',
  },
  {
    id: 'coding-models',
    label: 'Rank the coding models',
    hint: 'Which open model actually ships code?',
    title: 'Benchmark every open-weight coding model',
    goal: 'Run a fair, reproducible coding benchmark across every tool-calling open-weight model available through the Tempo gateway. Use a public suite such as SWE-bench Lite plus a small held-out task set written for this run. Report solve rate, median latency and cost per solved task, with the exact prompts, harness settings and seeds so anyone can rerun it. Flag contamination risks and publish every failure.',
  },
  {
    id: 'open-dataset',
    label: 'Build an open dataset',
    hint: 'Scattered public data, cleaned and joined.',
    title: 'Build a clean open dataset from scattered public sources',
    goal: 'Choose a useful public dataset that exists today only as scattered files, pages or inconsistent formats (for example every public transit feed in a country, or the prices on public procurement notices), and build one clean, documented, openly licensed version of it. Publish the collection code, the schema, a data dictionary, the known gaps and errors, a sample, and a browsable artifact. Respect each source’s terms and record where every row came from.',
  },
  {
    id: 'json-terabyte',
    label: 'A terabyte for a dollar',
    hint: 'The cheapest way to crunch huge logs.',
    title: 'Parse a terabyte of JSON for under a dollar',
    goal: 'Find the fastest and the cheapest way to parse a terabyte of newline-delimited JSON on rented machines. Generate realistic synthetic logs, compare at least three parsers across machine sizes, and report GiB/s and dollars per TiB with memory use and full reproduction commands. Check that every parser produces identical results.',
  },
  {
    id: 'log-compression',
    label: 'Squeeze the logs',
    hint: 'Smaller files, same speed.',
    title: 'Beat zstd on real-world logs',
    goal: 'Find a compression setup that beats zstd on ratio at equal or better decompression speed for real-world application logs. Use public log corpora, establish zstd, brotli and xz baselines at several levels, then test dictionaries, preprocessing and column-aware schemes. Report ratio, compression and decompression throughput and memory on identical hardware. Verify every round trip is lossless.',
  },
  {
    id: 'missing-guide',
    label: 'Write the missing guide',
    hint: 'Docs for a tool everyone struggles with.',
    title: 'Write the definitive guide to an underdocumented tool',
    goal: 'Pick an open-source tool that many people use and few understand, and write the guide its users keep wishing existed. Read the source and the issue tracker, run every example on a real machine so each one works as written, cover the common tasks and the sharp edges, and publish it as a readable artifact with its code. Note where the tool’s own documentation is wrong, and say what the guide does not cover.',
  },
  {
    id: 'sat-solver',
    label: 'Faster SAT',
    hint: 'Solve hard puzzles quicker.',
    title: 'Speed up an open-source SAT solver',
    goal: 'Find a reproducible speedup for an open-source SAT solver such as CaDiCaL or Kissat on a public benchmark family from the SAT Competition. Establish baseline solve counts and PAR-2 scores, test heuristic or implementation changes one at a time, and report results across seeds with full commands. Check every SAT answer with its model and every UNSAT answer with a proof checker.',
  },
  {
    id: 'protein-stability',
    label: 'Tougher proteins',
    hint: 'Which mutations make proteins sturdier?',
    title: 'Predict protein stability from sequence',
    goal: 'Improve prediction of how single mutations change protein stability, using a public dataset such as the mega-scale cDNA display stability measurements. Establish baselines from published models, hold out whole proteins rather than random mutations, and test one modeling idea at a time. Report Spearman correlation and error on the held-out set, with data splits, code and failed attempts.',
  },
  {
    id: 'solid-electrolytes',
    label: 'Better batteries',
    hint: 'Find a safer solid electrolyte.',
    title: 'Screen solid electrolytes for lithium batteries',
    goal: 'Screen known and hypothetical inorganic materials for promising lithium solid electrolytes using open data such as the Materials Project. Define transparent criteria (stability, band gap, lithium content, predicted conductivity), reproduce a published screening as a baseline, and rank new candidates with uncertainties. Publish the pipeline and say plainly which predictions would need lab confirmation.',
  },
  {
    id: 'benchmark-leaks',
    label: 'Catch leaked benchmarks',
    hint: 'Are models just memorizing the test?',
    title: 'Find benchmark leaks in open LLM training data',
    goal: 'Measure how much of popular LLM evaluation sets appears in open pretraining corpora. Pick benchmarks with public test sets and corpora with public indexes, define exact and near-duplicate matching, validate the matcher on planted examples, and report contamination rates per benchmark with examples. Separate verbatim leaks from paraphrases and publish the tooling.',
  },
  {
    id: 'solar-forecast',
    label: 'Sunny forecasts',
    hint: "Predict tomorrow's solar power.",
    title: 'Forecast solar output from open weather data',
    goal: 'Beat a persistence and a published baseline at day-ahead forecasting of solar power for public plants, using open weather forecasts and open generation data. Hold out whole months, report skill scores against each baseline, and test one feature or model change at a time. Publish data sources, splits, code and the cases where the forecast fails.',
  },
  {
    id: 'math-records',
    label: 'New math records',
    hint: 'Search for record-breaking constructions.',
    title: 'Find better constructions for an open combinatorics problem',
    goal: 'Pick an open combinatorics problem with a published table of best-known constructions, such as cap sets, covering codes or Ramsey lower bounds. Reproduce the current records, then search for improvements with computer search. Verify every claimed construction with an independent checker, publish it in a machine-readable form, and report honestly if no record falls.',
  },
  {
    id: 'small-model-math',
    label: 'Teach a small model math',
    hint: 'Make a 1B model reason better.',
    title: 'Make a small open model better at math',
    goal: 'Improve a small open-weight language model (around 1B parameters) on grade-school and competition math with a reproducible, affordable recipe. Establish baselines on public benchmarks with fixed prompts, test one training or inference-time idea at a time, check for test-set contamination, and report accuracy with confidence intervals, cost and full scripts.',
  },
]

export const ids = problems.map((problem) => problem.id) as [string, ...string[]]

export function open(swarms: readonly { problem: string | null }[]) {
  const busy = new Set(swarms.flatMap((swarm) => (swarm.problem ? [swarm.problem] : [])))
  return problems.filter((problem) => !busy.has(problem.id))
}

export const briefInstruction =
  'Work in the open: say what done looks like, plan the work, and publish what you make as you go (code, data, write-ups and artifacts) with how to check or reproduce it. Say plainly what worked, what did not and what is left, and keep what you checked apart from what you assume.'

export function brief(question: string) {
  const text = question.trim()
  return { title: text.slice(0, 80), goal: `${text}\n\n${briefInstruction}` }
}
