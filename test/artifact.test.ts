import assert from 'node:assert/strict'
import test from 'node:test'
import * as Shelf from '../src/shared/Artifact.ts'

test('a manifest becomes an artifact with its entry, form and url', () => {
  const artifact = Shelf.read('artifacts/leaderboard', { entry: 'index.html', kind: 'dashboard', summary: ' Solve rate by model. ', title: 'Leaderboard', updated: '2026-11-02T00:00:00Z' }, 3, '/a/abc')
  assert.deepEqual(artifact, {
    entry: 'index.html',
    form: 'page',
    kind: 'dashboard',
    slug: 'leaderboard',
    summary: 'Solve rate by model.',
    title: 'Leaderboard',
    updatedAt: Date.parse('2026-11-02T00:00:00Z'),
    url: '/a/abc/leaderboard/index.html',
    version: 3,
  })
})

test('a bare manifest falls back to index.html and the slug', () => {
  const artifact = Shelf.read('artifacts/notes', 'not an object', 1, '/a/abc')
  assert.equal(artifact?.entry, 'index.html')
  assert.equal(artifact?.title, 'notes')
  assert.equal(artifact?.form, 'page')
})

test('keys outside artifacts/ and bad slugs are not artifacts', () => {
  assert.equal(Shelf.read('git/x/issues/1', {}, 1, '/a/abc'), undefined)
  assert.equal(Shelf.read('artifacts/Bad Slug', {}, 1, '/a/abc'), undefined)
  assert.equal(Shelf.read('artifacts/a/b', {}, 1, '/a/abc'), undefined)
})

test('entries cannot climb out of their folder', () => {
  assert.equal(Shelf.path('../../secret.html'), undefined)
  assert.equal(Shelf.path('a/../b.html'), undefined)
  assert.equal(Shelf.path('/etc/passwd'), undefined)
  assert.equal(Shelf.path('a/b/c/d/e.html'), undefined)
  assert.equal(Shelf.path('./charts/cost.svg'), 'charts/cost.svg')
  assert.equal(Shelf.read('artifacts/evil', { entry: '../../x.html' }, 1, '/a/abc')?.entry, 'index.html')
})

test('the form follows the entry extension', () => {
  assert.equal(Shelf.form('README.md'), 'markdown')
  assert.equal(Shelf.form('results.CSV'), 'table')
  assert.equal(Shelf.form('chart.svg'), 'image')
  assert.equal(Shelf.form('data.json'), 'json')
  assert.equal(Shelf.form('log.txt'), 'text')
})
