import assert from 'node:assert/strict'
import test from 'node:test'
import type { Entry } from '../src/shared/Api.ts'
import { memory, merge, narrate, redact, step } from '../src/shared/Trail.ts'

function entry(input: Partial<Entry>): Entry {
  return { at: 1000, detail: null, event: null, kind: 'tool', round: 1, seq: 0, text: '', who: null, ...input }
}

test('a researcher keeps its own thinking until its model call completes', () => {
  const buffers = memory()
  assert.deepEqual(narrate(buffers, 'a:1', 'reasoning.summary.delta', { text: 'Compare ' }), [])
  assert.deepEqual(narrate(buffers, null, 'reasoning.summary.delta', { text: 'Plan the round' }), [])
  narrate(buffers, 'a:1', 'reasoning.summary.delta', { text: 'the two codecs.' })
  const steps = narrate(buffers, 'a:1', 'model.call.completed', {})
  assert.deepEqual(steps, [{ detail: null, kind: 'thinking', text: 'Compare the two codecs.' }])
  assert.equal(narrate(buffers, null, 'assistant.message', { text: 'Done.' })[0]?.text, 'Plan the round')
})

test('tool results become outputs, and failures errors', () => {
  const ok = step('tool.result', { result: [{ type: 'input_text', text: 'Script completed' }, { type: 'input_text', text: '42' }], status: 'completed', tool: 'exec' })
  assert.deepEqual(ok, { detail: 'Script completed\n42', kind: 'output', text: 'Script output' })
  assert.equal(step('tool.result', { result: 'boom', status: 'failed', tool: 'exec_command' })?.kind, 'error')
  assert.equal(step('tool.result', { result: 'x', status: 'completed', tool: 'wait_agent' }), undefined)
  assert.equal(step('tool.call', { arguments: { cmd: 'ls -la' }, tool: 'exec_command' })?.text, '$ ls -la')
})

test('a stored entry replaces the live one it shares an event with', () => {
  const live = entry({ at: 1000, event: 7, text: '$ ls' })
  const stored = entry({ at: 1500, event: 7, seq: 12, text: '$ ls' })
  const merged = merge(merge([], [live]), [stored])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.seq, 12)
  assert.equal(merged[0]?.at, 1000)
  assert.equal(merge(merged, [live]), merged)
  const status = entry({ event: 7, kind: 'status', seq: 0 })
  assert.equal(merge(merged, [status]).length, 2)
})

test('secrets in clone URLs and JWTs are redacted', () => {
  assert.equal(redact('git clone https://user:token@code.storage/repo'), 'git clone https://***@code.storage/repo')
  assert.equal(redact('eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4'), '[redacted]')
})
