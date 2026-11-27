import { type Context, context, Failure, type Flags } from './context.ts'
import { version } from './version.ts'

export type Command = (ctx: Context) => Promise<number | void>

const swarms = () => import('./commands/swarms.ts')

const account = () => import('./commands/account.ts')

export const commands: Record<string, () => Promise<Command>> = {
  login: () => account().then((module) => module.login),
  logout: () => account().then((module) => module.logout),
  whoami: () => account().then((module) => module.whoami),
  ls: () => swarms().then((module) => module.ls),
  new: () => swarms().then((module) => module.create),
  open: () => swarms().then((module) => module.open),
  status: () => swarms().then((module) => module.status),
  watch: () => import('./commands/watch.ts').then((module) => module.watch),
  logs: () => swarms().then((module) => module.logs),
  ideas: () => swarms().then((module) => module.ideas),
  tree: () => swarms().then((module) => module.tree),
  fund: () => import('./commands/fund.ts').then((module) => module.fund),
  hands: () => import('./commands/hands.ts').then((module) => module.hands),
  machines: () => swarms().then((module) => module.machines),
  edit: () => swarms().then((module) => module.edit),
  archive: () => swarms().then((module) => module.archive),
  byok: () => import('./commands/ai.ts').then((module) => module.byok),
  completion: () => import('./commands/completion.ts').then((module) => module.completion),
  mcp: async () => async (ctx: Context) => (await import('./mcp.ts')).main({ token: await ctx.token(), url: ctx.host }),
  help: async () => help,
  __names: () => swarms().then((module) => module.names),
  version: async () => async (ctx: Context) => ctx.out({ version }, version),
}

export const aliases: Record<string, string> = { back: 'fund', ride: 'fund', env: 'byok', list: 'ls', create: 'new', log: 'logs' }

export const usage: Record<string, [string, string]> = {
  login: ['swarms login [--no-browser] [--token <token>]', 'Sign in with Tempo ID in the browser; the token is kept in the OS keychain.'],
  logout: ['swarms logout', 'End the session and forget its token.'],
  whoami: ['swarms whoami', 'Who you are signed in as.'],
  ls: ['swarms ls [--status <status>] [--all]', 'Swarms, most recently active first.'],
  new: ['swarms new <name> [--goal <text>] [--title <text>] [--amount <usd>] [--form tree|agent] [--template <name>]', 'Start a swarm at /<name>, and ride it.'],
  open: ['swarms open [swarm]', 'Open a swarm, or the site, in the browser.'],
  status: ['swarms status <swarm>', 'Where a swarm stands: money, work and its latest update.'],
  watch: ['swarms watch <swarm> [--limit <n>] [--timeout <s>]', 'Follow a swarm live.'],
  logs: ['swarms logs <swarm> [--limit <n>] [--kind <kind>] [--who <who>] [--follow]', "The swarm's newest transcript entries."],
  ideas: ['swarms ideas add <swarm> <text> [--parent <node>]', 'Suggest an idea to a tree swarm, free.'],
  tree: ['swarms tree <swarm> [--depth <n>] [--root <node>] [--status <status>]', "A tree swarm's nodes."],
  fund: ['swarms fund <swarm> <usd> [--note <text>] [--node <id>] [--token <token>] [--hash <0x…>] [--yes]', 'Ride a swarm with real money through Tempo Wallet (alias: back).'],
  hands: ['swarms hands ls|add|rm <swarm> [hand] [--label <name>]', 'Machines lent to a swarm.'],
  machines: ['swarms machines <swarm>', "The swarm's machines: sandboxes, browsers and hands."],
  edit: ['swarms edit <swarm> title|slug|pfp <value>', "Change a swarm's title, its address (slug) or its picture (a file, or none)."],
  archive: ['swarms archive <swarm> [--yes]', 'Archive a swarm you admin: it stops and takes no more rides.'],
  byok: ['swarms byok [set|rm <provider>] [connect|finish|signout <plan>] [on|off <swarm>]', 'Run swarms on your own AI keys or subscriptions (alias: env).'],
  completion: ['swarms completion bash|zsh|fish', 'Print a shell completion script.'],
  mcp: ['swarms mcp', 'Serve the Swarms MCP tools over stdio, signed in as you: claude mcp add swarms -- swarms mcp.'],
  help: ['swarms help [command]', 'This help.'],
  version: ['swarms --version', 'The version.'],
}

const booleans = new Set(['json', 'yes', 'help', 'no-browser', 'follow', 'all'])

const short: Record<string, string> = { h: 'help', j: 'json', y: 'yes' }

export function parse(argv: string[]) {
  const args: string[] = []
  const flags: Flags = {}
  for (let at = 0; at < argv.length; at++) {
    const given = argv[at]!
    if (given === '--') {
      args.push(...argv.slice(at + 1))
      break
    }
    const long = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(given)
    if (long) {
      const [, name = '', value] = long
      if (value !== undefined) flags[name] = value
      else if (booleans.has(name)) flags[name] = true
      else if (argv[at + 1] !== undefined && !/^--?[a-z]/.test(argv[at + 1]!)) flags[name] = argv[++at]!
      else flags[name] = true
      continue
    }
    const letters = /^-([a-z]+)$/.exec(given)?.[1]
    if (letters && [...letters].every((letter) => short[letter])) {
      for (const letter of letters) flags[short[letter]!] = true
      continue
    }
    args.push(given)
  }
  return { args, flags }
}

function nearest(name: string) {
  const names = [...Object.keys(usage), ...Object.keys(aliases)]
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, at) => at)
    for (let i = 1; i <= a.length; i++) {
      let last = row[0]!
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const kept = row[j]!
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1))
        last = kept
      }
    }
    return row[b.length]!
  }
  return names.map((each) => [each, distance(name, each)] as const).sort((a, b) => a[1] - b[1]).find(([, far]) => far <= 2)?.[0]
}

export async function help(ctx: Context) {
  const asked = ctx.args[1]
  const name = asked ? (aliases[asked] ?? asked) : undefined
  const one = name ? usage[name] : undefined
  if (name && !one) throw new Failure(`No command is called ${asked}.`, { code: 'usage', exit: 2, next: 'Run swarms help.' })
  if (one) return ctx.out({ command: name, description: one[1], usage: one[0] }, `${one[1]}\n\n  ${one[0]}`)
  const width = Math.max(...Object.keys(usage).map((each) => each.length))
  ctx.out(
    { commands: Object.entries(usage).map(([command, [line, description]]) => ({ command, description, usage: line })), host: ctx.host, version },
    [
      `swarms ${version}: start, ride and watch swarms on ${ctx.host}`,
      '',
      ...Object.entries(usage).map(([command, [, description]]) => `  ${command.padEnd(width)}  ${description}`),
      '',
      'Every command takes --json, --host <url> (or SWARMS_HOST) and --yes. swarms help <command> shows its options.',
    ].join('\n'),
  )
}

export function fail(error: unknown, json: boolean) {
  const failure = error instanceof Failure ? error : new Failure(error instanceof Error ? error.message : String(error), { code: 'internal' })
  if (json) process.stdout.write(JSON.stringify({ error: { code: failure.code, message: failure.message, next: failure.next ?? null, status: failure.status ?? null } }, null, 2) + '\n')
  else process.stderr.write(`error: ${failure.message}${failure.next ? `\n  ${failure.next}` : ''}\n`)
  return failure.exit
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parse(argv)
  const json = parsed.flags['json'] === true
  try {
    const ctx = context(parsed)
    const asked = parsed.args[0] ?? 'help'
    const name = aliases[asked] ?? asked
    const load = commands[name]
    if (!load) {
      const near = nearest(asked)
      throw new Failure(`No command is called ${asked}.`, { code: 'usage', exit: 2, next: near ? `Did you mean swarms ${near}? Run swarms help for the rest.` : 'Run swarms help.' })
    }
    if (parsed.flags['help'] === true && name !== 'help') return (await help({ ...ctx, args: ['help', name] })) ?? 0
    if (name !== asked) ctx.args[0] = name
    return (await (await load())(ctx)) ?? 0
  } catch (error) {
    return fail(error, json)
  }
}
