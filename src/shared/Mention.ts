export const maxText = 1000

export const smallestSteer = 10_000n

const words = [
  'alder', 'axon', 'basalt', 'birch', 'boson', 'cedar', 'cipher', 'cobalt', 'comet', 'coral', 'delta', 'drift', 'dune', 'ember', 'falcon', 'fern',
  'fjord', 'flint', 'gecko', 'glacier', 'helix', 'heron', 'ion', 'iris', 'jade', 'juniper', 'kelp', 'kestrel', 'krill', 'lichen', 'lumen', 'lynx',
  'magma', 'meteor', 'nebula', 'newt', 'nova', 'onyx', 'opal', 'orbit', 'otter', 'photon', 'pollen', 'prism', 'pulsar', 'quark', 'quartz', 'quasar',
  'raven', 'reef', 'rune', 'sable', 'sorrel', 'thorn', 'tidal', 'tundra', 'umber', 'vapor', 'vector', 'walrus', 'willow', 'xenon', 'yarrow', 'zephyr',
] as const

const swarm = /(^|[^\w@-])@swarm(?![\w-])/gi

const person = /@([a-z]+-[0-9a-f]{4})(?![\w-])/gi

export function handle(address: string) {
  const lower = address.toLowerCase()
  return `${words[Number.parseInt(lower.slice(2, 10), 16) % words.length]}-${lower.slice(-4)}`
}

export function steers(text: string) {
  swarm.lastIndex = 0
  return swarm.test(text)
}

export function idea(text: string) {
  return text.replace(swarm, '$1').replace(/\s+/g, ' ').trim()
}

export function mentioned(text: string) {
  return [...new Set([...text.matchAll(person)].map((match) => (match[1] ?? '').toLowerCase()))]
}

export function pieces(text: string) {
  return text.split(/(@swarm(?![\w-])|@[a-z]+-[0-9a-f]{4}(?![\w-]))/gi).filter(Boolean)
}
