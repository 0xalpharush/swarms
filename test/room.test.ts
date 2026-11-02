import assert from 'node:assert/strict'
import test from 'node:test'
import * as Mention from '../src/shared/Mention.ts'

const address = '0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A'

test('a handle is a word and the address tail, whatever the case of the address', () => {
  const handle = Mention.handle(address)
  assert.match(handle, /^[a-z]+-ff2a$/)
  assert.equal(Mention.handle(address.toLowerCase()), handle)
  assert.notEqual(Mention.handle('0x1563915e194d8cfba1943570603f7606a3115508'), handle)
})

test('only a standalone @swarm steers', () => {
  assert.equal(Mention.steers('@swarm try simd-json next'), true)
  assert.equal(Mention.steers('agreed. @SWARM: measure cost per GiB'), true)
  assert.equal(Mention.steers('mail me at me@swarm.dev'), false)
  assert.equal(Mention.steers('@swarmy is not the swarm'), false)
  assert.equal(Mention.steers('no mention at all'), false)
})

test('the idea is the message without @swarm', () => {
  assert.equal(Mention.idea('@swarm   try simd-json\nnext'), 'try simd-json next')
  assert.equal(Mention.idea('@quark-1a2b is right, @swarm drop Qwen'), '@quark-1a2b is right, drop Qwen')
})

test('mentions are lowercased handles, each once', () => {
  assert.deepEqual(Mention.mentioned('@Quark-1A2B and @quark-1a2b, @fern-0000 and @swarm'), ['quark-1a2b', 'fern-0000'])
  assert.deepEqual(Mention.mentioned('@quark-1a2bc is not a handle'), [])
})

test('pieces keep the text and split out every mention', () => {
  assert.deepEqual(Mention.pieces('hi @quark-1a2b, @swarm go'), ['hi ', '@quark-1a2b', ', ', '@swarm', ' go'])
  assert.equal(Mention.pieces('plain').join(''), 'plain')
})
