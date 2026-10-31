import type { Summary } from '../shared/Api.ts'

export { brief, questions } from '../shared/ResearchBrief.ts'

export const areas = [
  { id: 'cryptography', label: 'Cryptography', match: /\b(cryptograph\w*|post.quantum|signature\w*|lattice\w*|encryption|zero.knowledge|zkp)\b/i },
  { id: 'mathematics', label: 'Mathematics', match: /\b(mathemat\w*|theorem\w*|conjecture\w*|p\s*[=≠]\s*np|p\s+vs\.?\s+np|proof\w*|polynomial\w*)\b/i },
  { id: 'life', label: 'Life sciences', match: /\b(biolog\w*|protein\w*|genom\w*|molecul\w*|drug\w*|cell\w*|disease\w*)\b/i },
  { id: 'energy', label: 'Matter & energy', match: /\b(energy|material\w*|batter\w*|catalys\w*|climate|ocean\w*|fusion|physics|geothermal)\b/i },
  { id: 'computing', label: 'Computing', match: /\b(model\w*|coding|code\w*|algorithm\w*|compress\w*|codec\w*|parser\w*|machine\w*|memory|inference|benchmark\w*|python|http\w*)\b/i },
  { id: 'open', label: 'Open exploration', match: /./ },
] as const

export type Area = (typeof areas)[number]['id']

export function area(swarm: Pick<Summary, 'title' | 'goal'>) {
  return areas.find((item) => item.id !== 'open' && item.match.test(swarm.title)) ?? areas.find((item) => item.id !== 'open' && item.match.test(swarm.goal)) ?? areas[5]
}

