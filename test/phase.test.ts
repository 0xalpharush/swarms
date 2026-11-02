import assert from 'node:assert/strict'
import test from 'node:test'
import * as Phase from '../src/worker/Phase.ts'

const keys = (values: Record<string, unknown>) => ({ get: <T>(key: string) => values[key] as T | undefined })

test('a swarm phase is read from one place and only moves forward', () => {
  assert.equal(Phase.of(keys({}), false), 'idle')
  assert.equal(Phase.of(keys({ turn: 'r1' }), false), 'working')
  assert.equal(Phase.of(keys({ turn: 'r1' }), true), 'settling')
  assert.equal(Phase.of(keys({ refundAt: 1 }), false), 'settling')
  assert.equal(Phase.of(keys({ refundAt: 1, refunded: true }), true), 'settled')
  assert.ok(Phase.can('idle', 'working'))
  assert.ok(Phase.can('working', 'idle'))
  assert.ok(Phase.can('working', 'settling'))
  assert.ok(!Phase.can('settling', 'working'))
  assert.ok(!Phase.can('settled', 'idle'))
  assert.throws(() => Phase.check('settling', 'working'), /cannot go from settling to working/)
})
