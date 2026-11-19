import test from 'node:test'
import assert from 'node:assert/strict'
import { addFavorite, removeFavorite, cleanFavorites, favoriteTarget, FAVORITES_LIMIT } from '../src/gui/renderer/favorites.js'

const srv = { name: 'Datalad-server', address: 'ssh://datalad/datalad/mri/MRI-Lab_Repository/' }

test('addFavorite trims, keeps order and does not change the old list', () => {
  const before = [srv]
  const { list } = addFavorite(before, { name: '  OpenNeuro ', address: ' https://github.com/OpenNeuroDatasets/ ' })
  assert.deepEqual(list, [srv, { name: 'OpenNeuro', address: 'https://github.com/OpenNeuroDatasets/' }])
  assert.deepEqual(before, [srv])
})

test('addFavorite refuses bad input with a plain sentence', () => {
  const bad = (entry, list = [srv]) => addFavorite(list, entry).error
  assert.match(bad({ name: '', address: 'ssh://x/y' }), /name/i)
  assert.match(bad({ name: 'x'.repeat(41), address: 'ssh://x/y' }), /40/)
  assert.match(bad({ name: 'Ok', address: '' }), /address/i)
  assert.match(bad({ name: 'Ok', address: 'a'.repeat(501) }), /500/)
  assert.match(bad({ name: 'Ok', address: 'ssh://x/y\nrm' }), /address/i)
  assert.match(bad({ name: 'Ok\u0007', address: 'ssh://x/y' }), /name/i)
  assert.match(bad({ name: ' datalad-SERVER ', address: 'ssh://x/y' }), /already/i)
  assert.match(bad({ name: 'New', address: 'ssh://x/y' }, Array.from({ length: FAVORITES_LIMIT }, (_, i) => ({ name: `n${i}`, address: 'a' }))), /50/)
  assert.match(bad(null), /name/i)
})

test('removeFavorite removes by name and ignores unknown names', () => {
  assert.deepEqual(removeFavorite([srv], 'Datalad-server'), [])
  assert.deepEqual(removeFavorite([srv], 'nope'), [srv])
})

test('cleanFavorites keeps valid entries and drops everything else without throwing', () => {
  assert.deepEqual(cleanFavorites(null), [])
  assert.deepEqual(cleanFavorites('x'), [])
  assert.deepEqual(cleanFavorites([srv, null, 5, { name: 1, address: 2 }, { name: '', address: 'a' }, { ...srv, name: 'datalad-server' }, { name: 'Ctl', address: 'a\u0000b' }]), [srv])
  assert.equal(cleanFavorites(Array.from({ length: 80 }, (_, i) => ({ name: `n${i}`, address: 'a' }))).length, FAVORITES_LIMIT)
})

test('favoriteTarget sends web addresses to Remote URL and everything else to Network Folder', () => {
  for (const url of ['https://github.com/x', 'HTTPS://x', 'gin:lab/data', 'http://x']) assert.equal(favoriteTarget(url), 'url', url)
  for (const net of ['ssh://datalad/data', '\\\\srv\\share\\d', '/mnt/data', 'smb://srv/s', 'C:\\data']) assert.equal(favoriteTarget(net), 'network', net)
})
