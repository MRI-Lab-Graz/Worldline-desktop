import test from 'node:test'
import assert from 'node:assert/strict'
import { describeDeletionRisk, describeFolderSize, withoutProject } from '../src/gui/renderer/delete-project-view.js'

const safe = { hasRemote: true, unsavedChanges: 0, unsentSaves: 0, onlyHereCount: 0 }

test('nothing at risk: no warning lines', () => {
  assert.deepEqual(describeDeletionRisk(safe), [])
})

test('each thing that would be lost gets a plain-words line, with singular and plural', () => {
  assert.deepEqual(describeDeletionRisk({ hasRemote: true, unsavedChanges: 7, unsentSaves: 3, onlyHereCount: 212 }), [
    '7 changes are not saved yet.',
    '3 saves have not been sent to the remote.',
    '212 data files exist only on this computer.'
  ])
  assert.deepEqual(describeDeletionRisk({ hasRemote: true, unsavedChanges: 1, unsentSaves: 1, onlyHereCount: 1 }), [
    '1 change is not saved yet.',
    '1 save has not been sent to the remote.',
    '1 data file exists only on this computer.'
  ])
})

test('no remote at all: everything exists only here, and that is said first', () => {
  const lines = describeDeletionRisk({ ...safe, hasRemote: false, unsentSaves: null })
  assert.match(lines[0], /no remote/i)
})

test('a check that could not run is reported as unknown, never as "nothing at risk"', () => {
  const lines = describeDeletionRisk({ hasRemote: true, unsavedChanges: null, unsentSaves: null, onlyHereCount: null })
  assert.equal(lines.length, 3)
  for (const line of lines) assert.match(line, /could not check/i)
})

test('a missing preview is a warning too (fails closed)', () => {
  assert.equal(describeDeletionRisk(undefined).length, 1)
})

test('folder size is shown in plain units', () => {
  assert.equal(describeFolderSize({ bytes: 4_200_000_000, files: 1230 }), '4.2 GB, 1230 files')
  assert.equal(describeFolderSize({ bytes: 1500, files: 1 }), '1.5 KB, 1 file')
  assert.equal(describeFolderSize({ bytes: 0, files: 0 }), '0 B, 0 files')
})

test('withoutProject drops the path, its emoji and its title, and leaves the rest alone', () => {
  const out = withoutProject(
    { recentProjects: ['/a', '/b'], emojiByPath: { '/a': '🧠', '/b': '🧪' }, titleByPath: { '/a': 'A', '/b': 'B' } },
    '/a'
  )
  assert.deepEqual(out, { recentProjects: ['/b'], emojiByPath: { '/b': '🧪' }, titleByPath: { '/b': 'B' } })
})
