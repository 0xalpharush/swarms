import assert from 'node:assert/strict'
import test from 'node:test'
import * as Answer from '../src/shared/Answer.ts'

test('updates lose the round numbers the agent used to give them', () => {
  assert.equal(Answer.unround('## Round 49 update — P vs NP\n\nNothing spent.'), '## P vs NP\n\nNothing spent.')
  assert.equal(Answer.unround('**Round 1 report — P vs NP**  I spent little.'), '**P vs NP**  I spent little.')
  assert.equal(Answer.unround('Round 51 update\nTwo corrections.'), 'Two corrections.')
  assert.equal(Answer.unround('Rounding errors dominate.'), 'Rounding errors dominate.')
  assert.equal(Answer.excerpt('## Round 45 update — P vs NP\nI made no tool calls.'), 'P vs NP I made no tool calls.')
})
