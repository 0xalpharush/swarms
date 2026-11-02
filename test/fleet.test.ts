import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fleet } from '../src/shared/Fleet.ts'

const entry = (seq: number, kind: string, text: string, detail: string | null = null, who: string | null = null) => ({ at: seq * 1000, detail, event: seq, kind, seq, text, who }) as never

test('fleet names machines by the call that made them and collects their commands', () => {
  const machines = fleet(
    [
      entry(1, 'machine', 'Starting machine sb-1 (python:3.12-slim)', '{"attach":"sb-1","image":"python:3.12-slim","cpu":2,"memory":4096,"lease":300}'),
      entry(2, 'tool', '$ ls on sb-1', '{"cmd":"ls","hand":"sb-1"}'),
      entry(3, 'output', 'Command output', 'a\nb'),
      entry(4, 'machine', "A contributor's machine joined the swarm as hand room-1 (data room)."),
      entry(5, 'tool', '$ cat q3.txt on room-1', '{"cmd":"cat q3.txt","hand":"room-1"}'),
      entry(6, 'error', 'exec_command failed', 'denied'),
      entry(7, 'machine', 'Shutting down a machine', '{"sandboxId":"sb-1"}'),
    ],
    [{ connected: true, name: 'room-1' }],
    [{ at: 0, channels: null, charged: '0.010000', connected: true, earned: null, label: 'data room', name: 'room-1', price: '$0.01 a read', requests: 2 }],
  )
  const box = machines.find((item) => item.name === 'sb-1')
  const room = machines.find((item) => item.name === 'room-1')
  assert.equal(box?.kind, 'sandbox')
  assert.deepEqual(box?.config, [['Image', 'python:3.12-slim'], ['CPU', '2'], ['Memory', '4 GB'], ['Lease', '5 min']])
  assert.equal(box?.commands[0]?.output, 'a\nb')
  assert.equal(box?.ended, 7000)
  assert.equal(room?.kind, 'hand')
  assert.equal(room?.label, 'data room')
  assert.equal(room?.charged, '0.010000')
  assert.equal(room?.commands[0]?.failed, true)
  assert.equal(machines[0]?.name, 'room-1')
})
