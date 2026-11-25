import { type Context, Failure } from '../context.ts'
import { aliases, usage } from '../run.ts'

const subcommands: Record<string, string[]> = { byok: ['set', 'rm', 'on', 'off'], completion: ['bash', 'zsh', 'fish'], hands: ['ls', 'add', 'rm'], ideas: ['add'] }

const flags = ['--json', '--yes', '--host', '--help', '--no-browser', '--goal', '--title', '--amount', '--form', '--template', '--status', '--all', '--limit', '--timeout', '--kind', '--who', '--follow', '--depth', '--root', '--parent', '--note', '--node', '--token', '--hash', '--label', '--key']

const named = ['open', 'status', 'watch', 'logs', 'tree', 'fund', 'back', 'ride', 'machines', 'edit', 'archive']

const nested = ['hands', 'ideas', 'byok', 'env']

function names() {
  return [...Object.keys(usage), ...Object.keys(aliases)]
}

function bash() {
  return `_swarms() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" cmd="\${COMP_WORDS[1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${names().join(' ')}" -- "$cur")); return; fi
  case "$cur" in -*) COMPREPLY=($(compgen -W "${flags.join(' ')}" -- "$cur")); return;; esac
  if [ "$COMP_CWORD" -eq 2 ]; then
    case "$cmd" in
${Object.entries(subcommands).map(([command, words]) => `      ${command === 'byok' ? 'byok|env' : command}) COMPREPLY=($(compgen -W "${words.join(' ')}" -- "$cur")); return;;`).join('\n')}
    esac
  fi
  case "$cmd" in
    ${named.join('|')}) [ "$COMP_CWORD" -eq 2 ] && COMPREPLY=($(compgen -W "$(swarms __names 2>/dev/null)" -- "$cur"));;
    ${nested.join('|')}) [ "$COMP_CWORD" -eq 3 ] && COMPREPLY=($(compgen -W "$(swarms __names 2>/dev/null)" -- "$cur"));;
  esac
}
complete -F _swarms swarms
`
}

function zsh() {
  const described = Object.entries(usage).map(([command, [, description]]) => `    '${command}:${description.replace(/'/g, "'\\''").replace(/:/g, '\\:')}'`)
  return `#compdef swarms
_swarms() {
  local -a commands
  commands=(
${described.join('\n')}
  )
  if (( CURRENT == 2 )); then _describe 'command' commands; return; fi
  if [[ $PREFIX == -* ]]; then compadd -- ${flags.join(' ')}; return; fi
  if (( CURRENT == 3 )); then
    case $words[2] in
${Object.entries(subcommands).map(([command, words]) => `      ${command === 'byok' ? 'byok|env' : command}) compadd -- ${words.join(' ')}; return;;`).join('\n')}
    esac
  fi
  case $words[2] in
    ${named.join('|')}) (( CURRENT == 3 )) && compadd -- \${(f)"$(swarms __names 2>/dev/null)"};;
    ${nested.join('|')}) (( CURRENT == 4 )) && compadd -- \${(f)"$(swarms __names 2>/dev/null)"};;
  esac
}
if (( $+functions[compdef] )); then compdef _swarms swarms; else _swarms "$@"; fi
`
}

function fish() {
  return [
    'complete -c swarms -f',
    ...Object.entries(usage).map(([command, [, description]]) => `complete -c swarms -n __fish_use_subcommand -a ${command} -d '${description.replace(/'/g, "\\'")}'`),
    ...Object.entries(subcommands).map(([command, words]) => `complete -c swarms -n '__fish_seen_subcommand_from ${command === 'byok' ? 'byok env' : command}; and test (count (commandline -opc)) -eq 2' -a '${words.join(' ')}'`),
    `complete -c swarms -n '__fish_seen_subcommand_from ${named.join(' ')}; and test (count (commandline -opc)) -eq 2' -a '(swarms __names 2>/dev/null)'`,
    `complete -c swarms -n '__fish_seen_subcommand_from ${nested.join(' ')}; and test (count (commandline -opc)) -eq 3' -a '(swarms __names 2>/dev/null)'`,
    ...flags.map((flag) => `complete -c swarms -l ${flag.slice(2)}${['--host', '--goal', '--title', '--amount', '--form', '--template', '--status', '--limit', '--timeout', '--kind', '--who', '--depth', '--root', '--parent', '--note', '--node', '--token', '--hash', '--label', '--key'].includes(flag) ? ' -r' : ''}`),
    '',
  ].join('\n')
}

const scripts: Record<string, () => string> = { bash, fish, zsh }

export async function completion(ctx: Context) {
  const shell = ctx.args[1] ?? ''
  const make = scripts[shell]
  if (!make) throw new Failure(shell ? `No completions for ${shell}.` : 'Missing the shell.', { code: 'usage', exit: 2, next: 'Run swarms completion bash|zsh|fish, such as: swarms completion zsh > "${fpath[1]}/_swarms"' })
  const script = make()
  if (ctx.json) return ctx.out({ script, shell }, script)
  process.stdout.write(script)
}
