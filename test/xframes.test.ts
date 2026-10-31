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

test('card image escapes its title', async () => {
  const response = XFrames.card('Explore <science>')
  const svg = await response.text()

  assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
  assert.match(svg, /Explore &lt;science&gt;/)
  assert.doesNotMatch(svg, /Explore <science>/)
})
