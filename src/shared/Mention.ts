export const maxText = 1000

export const maxName = 24

export const smallestSteer = 10_000n

const words = [
  'alder', 'axon', 'basalt', 'birch', 'boson', 'cedar', 'cipher', 'cobalt', 'comet', 'coral', 'delta', 'drift', 'dune', 'ember', 'falcon', 'fern',
  'fjord', 'flint', 'gecko', 'glacier', 'helix', 'heron', 'ion', 'iris', 'jade', 'juniper', 'kelp', 'kestrel', 'krill', 'lichen', 'lumen', 'lynx',
  'magma', 'meteor', 'nebula', 'newt', 'nova', 'onyx', 'opal', 'orbit', 'otter', 'photon', 'pollen', 'prism', 'pulsar', 'quark', 'quartz', 'quasar',
  'raven', 'reef', 'rune', 'sable', 'sorrel', 'thorn', 'tidal', 'tundra', 'umber', 'vapor', 'vector', 'walrus', 'willow', 'xenon', 'yarrow', 'zephyr',
] as const

const reserved = new Set(['admin', 'all', 'everyone', 'here', 'lead', 'swarm', 'swarms', 'system', 'you'])

const shape = /^[a-z][a-z0-9_-]{1,22}[a-z0-9]$/

const made = /^[a-z]+-[0-9a-f]{4}$/

const swarm = /(^|[^\w@-])@swarm(?![\w-])/gi

const person = /(?<![\w@-])@([a-z][a-z0-9_-]{1,22}[a-z0-9])(?![\w-])/gi

export function handle(address: string) {
  const lower = address.toLowerCase()
  return `${words[Number.parseInt(lower.slice(2, 10), 16) % words.length]}-${lower.slice(-4)}`
}

export function short(address: string) {
  const lower = address.toLowerCase()
  return `${lower.slice(0, 6)}…${lower.slice(-4)}`
}

export function claimed(text: string) {
  return text.replace(/\[([^\]\n]*\bbehind\b[^\]\n]*)\]/gi, '(a claim in the text: $1)')
}

export function quoted(text: string, most: number) {
  const flat = text.replace(/[\s"“”]+/g, ' ').trim()
  return `“${flat.length > most ? flat.slice(0, most - 1).trimEnd() + '…' : flat}”`
}

export function at(handle: string) {
  return handle.startsWith('0x') ? handle : `@${handle}`
}

export function invalid(name: string) {
  const lower = name.toLowerCase()
  if (!shape.test(lower)) return 'A username is 3 to 24 letters, digits, hyphens or underscores, starting with a letter and ending with a letter or digit.'
  if (reserved.has(lower)) return `@${lower} is reserved.`
  if (made.test(lower)) return `@${lower} looks like a name made from an address, such as @quark-1a2b. Pick another.`
  return undefined
}

export function steers(text: string) {
  swarm.lastIndex = 0
  return swarm.test(text)
}

export function idea(text: string) {
  return text.replace(swarm, '$1').replace(/\s+/g, ' ').trim()
}

export function mentioned(text: string) {
  return [...new Set([...text.matchAll(person)].map((match) => (match[1] ?? '').toLowerCase()))].filter((name) => name !== 'swarm')
}

export function pieces(text: string) {
  return text.split(/((?<![\w@-])@[a-z][a-z0-9_-]{1,22}[a-z0-9](?![\w-]))/gi).filter(Boolean)
}
