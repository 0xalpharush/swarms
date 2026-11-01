import assert from 'node:assert/strict'
import test from 'node:test'
import type { Overview } from '../src/shared/Api.ts'
import * as XFrames from '../src/worker/XFrames.ts'

const overview: Overview = {
  answer: null,
  budgets: [],
  code: null,
  contributions: [],
  contributors: 3,
  createdAt: 1,
  daily: '0.000000',
  goal: 'Test <script> without placing markup in the player page.',
  hands: [],
  history: [],
  id: 'abc123',
  machines: 0,
  notes: [],
  parallel: 2,
  pledges: [],
  pool: '0.000000',
  raised: '1.250000',
  remaining: '0.750000',
  rounds: 2,
  running: null,
  spent: '0.500000',
  status: 'running',
  title: 'Safer <signatures>',
  updatedAt: 2,
  wallet: null,
  workers: 3,
}

test('start frame publishes an X player card and device pledge flow', async () => {
  const response = XFrames.start('https://swarms.example')
  const html = await response.text()

  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(html, /name="twitter:card" content="player"/)
  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x"/)
  assert.match(html, /device:true/)
  assert.match(html, /Launch swarm/)
  assert.match(html, /Quantum-safe signatures/)
})

test('swarm frame escapes research text and points the player at its own route', async () => {
  const response = XFrames.swarm('https://swarms.example', overview)
  const html = await response.text()

  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123"/)
  assert.match(html, /Safer &lt;signatures&gt;/)
  assert.match(html, /Test &lt;script&gt;/)
  assert.doesNotMatch(html, /<script> without placing/)
  assert.match(html, /Back this quest/)
})

test('a running swarm frame streams the live round and lists its explorers', async () => {
  const running: Overview = {
    ...overview,
    history: [{ base: null, commits: [], endedAt: null, excerpt: null, n: 3, spent: '0', startedAt: 10, status: 'running' }],
    researchers: [
      { action: 'Using exec_command', events: 2, id: 's:1', lastSequence: 2, name: 'zstd <tuner>', output: null, parent: null, round: 3, state: 'running', task: '', toolsCompleted: 1, updatedAt: 1 },
      { action: null, events: 1, id: 's:0', lastSequence: 1, name: 'old', output: null, parent: null, round: 2, state: 'completed', task: '', toolsCompleted: 0, updatedAt: 1 },
    ],
    running: { n: 3, startedAt: 10 },
  }
  const html = await XFrames.swarm('https://swarms.example', running).text()

  assert.match(html, /<title>Live: Safer &lt;signatures&gt;<\/title>/)
  assert.match(html, /\/live'\)/)
  assert.match(html, /href="https:\/\/swarms\.example\/s\/abc123" id="watch"/)
  assert.match(html, /"crew":\[\{"action":"Using exec_command","id":"s:1","name":"zstd \\u003ctuner>","state":"running"\}\]/)
  assert.doesNotMatch(html, /"name":"old"/)
  assert.match(html, /Back this quest/)
})

test('a swarm frame without a running round shows the latest finding', async () => {
  const html = await XFrames.swarm('https://swarms.example', { ...overview, history: [{ base: null, commits: [], endedAt: 9, excerpt: 'zstd wins on cost', n: 2, spent: '0.1', startedAt: 1, status: 'completed' }], status: 'paused' }).text()

  assert.match(html, /<title>Fund Safer/)
  assert.match(html, /zstd wins on cost/)
  assert.match(html, /"live":null/)
})

test('card image escapes its title', async () => {
  const response = XFrames.card('Explore <science>')
  const svg = await response.text()

  assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
  assert.match(svg, /Explore &lt;science&gt;/)
  assert.doesNotMatch(svg, /Explore <science>/)
})
