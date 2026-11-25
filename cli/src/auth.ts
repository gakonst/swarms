import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type Saved = { address?: string; token: string }

export type Where = 'env' | 'file' | 'keychain'

type Filed = Record<string, { address?: string; keychain?: boolean; token?: string }>

const service = 'swarms'

const plain = /^[A-Za-z0-9._~+/=-]{8,512}$/

export function dir(env: NodeJS.ProcessEnv = process.env) {
  return env['SWARMS_CONFIG_DIR'] || path.join(env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config'), 'swarms')
}

export function file(env: NodeJS.ProcessEnv = process.env) {
  return path.join(dir(env), 'auth.json')
}

function found(name: string) {
  return (process.env['PATH'] ?? '').split(path.delimiter).some((at) => at && fs.existsSync(path.join(at, name)))
}

export function keychain(env: NodeJS.ProcessEnv = process.env): 'macos' | 'linux' | undefined {
  if (env['SWARMS_KEYCHAIN'] === '0') return undefined
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/security')) return 'macos'
  if (process.platform === 'linux' && env['DBUS_SESSION_BUS_ADDRESS'] && found('secret-tool')) return 'linux'
  return undefined
}

function run(command: string, args: string[], input?: string) {
  const done = spawnSync(command, args, { encoding: 'utf8', input: input ?? '', stdio: ['pipe', 'pipe', 'ignore'], timeout: 10_000 })
  return done.status === 0 ? done.stdout : undefined
}

function read(kind: 'macos' | 'linux', host: string) {
  const value = kind === 'macos' ? run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', host, '-w']) : run('secret-tool', ['lookup', 'service', service, 'host', host])
  const token = value?.trim()
  return token && plain.test(token) ? token : undefined
}

function write(kind: 'macos' | 'linux', host: string, token: string) {
  if (!plain.test(token) || /["\s]/.test(host)) return false
  if (kind === 'macos') return run('/usr/bin/security', ['-i'], `add-generic-password -U -s ${service} -a "${host}" -l "Swarms CLI" -w "${token}"\n`) !== undefined && read(kind, host) === token
  return run('secret-tool', ['store', '--label', `Swarms CLI (${host})`, 'service', service, 'host', host], token) !== undefined && read(kind, host) === token
}

function forget(kind: 'macos' | 'linux', host: string) {
  return (kind === 'macos' ? run('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', host]) : run('secret-tool', ['clear', 'service', service, 'host', host])) !== undefined
}

function filed(): Filed {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Filed) : {}
  } catch {
    return {}
  }
}

function keep(all: Filed) {
  fs.mkdirSync(dir(), { mode: 0o700, recursive: true })
  const target = file()
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(temporary, 0o600)
  fs.renameSync(temporary, target)
}

export async function load(host: string): Promise<(Saved & { where: Where }) | undefined> {
  const given = process.env['SWARMS_TOKEN']
  if (given) return { token: given, where: 'env' }
  const entry = filed()[host]
  const kind = keychain()
  const kept = kind && (entry?.keychain || !entry) ? read(kind, host) : undefined
  if (kept) return { ...(entry?.address ? { address: entry.address } : {}), token: kept, where: 'keychain' }
  return entry?.token ? { ...(entry.address ? { address: entry.address } : {}), token: entry.token, where: 'file' } : undefined
}

export async function save(host: string, saved: Saved): Promise<Exclude<Where, 'env'>> {
  const all = filed()
  const kind = keychain()
  const address = saved.address ? { address: saved.address } : {}
  if (kind && write(kind, host, saved.token)) {
    keep({ ...all, [host]: { ...address, keychain: true } })
    return 'keychain'
  }
  keep({ ...all, [host]: { ...address, token: saved.token } })
  return 'file'
}

export async function remove(host: string) {
  const all = filed()
  const entry = all[host]
  const kind = keychain()
  const dropped = kind && entry?.keychain ? forget(kind, host) : false
  if (!entry) return dropped
  delete all[host]
  keep(all)
  return true
}
