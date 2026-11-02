import assert from 'node:assert/strict'
import test from 'node:test'
import type { Entry } from '../src/shared/Api.ts'
import { crew, memory, merge, narrate, redact, step, subagent } from '../src/shared/Trail.ts'

function entry(input: Partial<Entry>): Entry {
  return { at: 1000, detail: null, event: null, kind: 'tool', seq: 0, text: '', who: null, ...input }
}

test('a subagent is named by its role, speaks under that name and reports its result once', () => {
  const buffers = memory()
  const known = crew()
  const added = subagent(buffers, known, 's', { agent: { id: 3, parent: 0, role: 'zstd tuner', task: 'Tune zstd levels.' }, type: 'added' })
  assert.deepEqual(added, { steps: [{ detail: 'Tune zstd levels.', kind: 'status', text: 'Started a subagent: zstd tuner' }], who: 'zstd tuner' })
  assert.equal(subagent(buffers, known, 's', { agent: { id: 4, role: 'zstd tuner' }, type: 'added' })?.who, 'zstd tuner #4')
  assert.deepEqual(subagent(buffers, known, 's', { event: { payload: { arguments: { cmd: 'zstd -19 a' }, tool: 'exec_command' }, type: 'tool.call' }, id: 3, type: 'event' })?.steps, [{ detail: '{"cmd":"zstd -19 a"}', kind: 'tool', text: '$ zstd -19 a' }])
  assert.deepEqual(subagent(buffers, known, 's', { id: 3, status: { state: 'completed' }, type: 'status' })?.steps, [])
  assert.deepEqual(subagent(buffers, known, 's', { id: 3, status: { output: 'level 19 wins', state: 'completed' }, type: 'completion' })?.steps, [{ detail: 'level 19 wins', kind: 'output', text: 'zstd tuner finished' }])
  assert.deepEqual(subagent(buffers, known, 's', { id: 3, status: { output: 'again', state: 'completed' }, type: 'completion' })?.steps, [])
  assert.equal(subagent(buffers, known, 's', { id: 9, status: { error: 'No capacity', state: 'failed' }, type: 'status' })?.steps[0]?.text, 'subagent 9 failed')
  assert.equal(subagent(buffers, known, 's', 'nonsense'), undefined)
})

test('a subagent keeps its own thinking until its model call completes', () => {
  const buffers = memory()
  assert.deepEqual(narrate(buffers, 'a:1', 'reasoning.summary.delta', { text: 'Compare ' }), [])
  assert.deepEqual(narrate(buffers, null, 'reasoning.summary.delta', { text: 'Plan the next step' }), [])
  narrate(buffers, 'a:1', 'reasoning.summary.delta', { text: 'the two codecs.' })
  const steps = narrate(buffers, 'a:1', 'model.call.completed', {})
  assert.deepEqual(steps, [{ detail: null, kind: 'thinking', text: 'Compare the two codecs.' }])
  assert.equal(narrate(buffers, null, 'assistant.message', { text: 'Done.' })[0]?.text, 'Plan the next step')
})

test('tool results become outputs, and failures errors', () => {
  const ok = step('tool.result', { result: [{ type: 'input_text', text: 'Script completed\nWall time 0.3 seconds\nOutput:\n' }, { type: 'input_text', text: '42' }], status: 'completed', tool: 'exec' })
  assert.deepEqual(ok, { detail: '42', kind: 'output', text: 'Script output' })
  const failed = step('tool.result', { result: 'Chunk ID: 1\nWall time: 0.2 seconds\nProcess exited with code 127\nOriginal token count: 5\nOutput:\nbash: python3: command not found', status: 'completed', tool: 'exec_command' })
  assert.deepEqual(failed, { detail: 'bash: python3: command not found', kind: 'output', text: 'Command output · exit 127' })
  assert.equal(step('tool.result', { result: 'Script running with cell ID 4\nWall time 11.0 seconds\nOutput:\n', status: 'completed', tool: 'exec' }), undefined)
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
