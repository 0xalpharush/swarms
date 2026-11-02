import assert from 'node:assert/strict'
import test from 'node:test'
import { open, problems } from '../src/shared/ResearchBrief.ts'

test('the idea bank hides problems that have an open swarm on them until it finishes', () => {
  const first = problems[0]!
  const second = problems[1]!
  const free = open([
    { problem: first.id, status: 'running' },
    { problem: second.id, status: 'done' },
    { problem: null, status: 'running' },
  ])
  assert.equal(free.includes(first), false)
  assert.equal(free.includes(second), true)
  assert.equal(free.length, problems.length - 1)
  assert.equal(new Set(problems.map((problem) => problem.id)).size, problems.length)
})
