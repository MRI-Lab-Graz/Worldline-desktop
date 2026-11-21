import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseServerOrigin, underFavorite, wantedOrigin, ensureSshArgs, parseEnsureOutput } from '../src/datalad/subject-remotes.js'

const P = { host: 'datalad', path: '/datalad/mri/MRI-Lab_Repository/proj' }
const HOSTILE = ['sub-1;touch x', 'sub-$(id)', '../x', 'sub-a b', '-oProxyCommand=x', 'sub-１', '', 'sub-' + 'a'.repeat(64), "sub-a'b", 'sub-a\nb', 'sub-a\\b', 'sub-', 'sub-.x', 'sub-`id`']

test('parseServerOrigin accepts only ssh://host/abs/path', () => {
  assert.deepEqual(parseServerOrigin('ssh://datalad/a/b'), { host: 'datalad', path: '/a/b' })
  assert.deepEqual(parseServerOrigin('ssh://me@h.example/a/b/'), { host: 'me@h.example', path: '/a/b' })
  for (const bad of ['datalad:a/b', 'https://x/a', '/local/path', 'C:\\x', 'ssh://-oProxyCommand=x/a', "ssh://h/a'b", 'ssh://h/a/../b', 'ssh://h/a;b', '', null, undefined])
    assert.equal(parseServerOrigin(bad), null, String(bad))
})

test('underFavorite', () => {
  const favs = ['ssh://datalad/datalad/mri/MRI-Lab_Repository/', 'garbage', 'ssh://-x/a']
  assert.equal(underFavorite(P, favs), true)
  assert.equal(underFavorite({ host: 'DATALAD', path: '/datalad/mri/MRI-Lab_Repository' }, favs), true)
  assert.equal(underFavorite({ host: 'other', path: P.path }, favs), false)
  assert.equal(underFavorite({ host: 'datalad', path: '/datalad/mri/MRI-Lab_Repository2/x' }, favs), false)
  assert.equal(underFavorite({ host: 'datalad', path: '/datalad/mri' }, favs), false)
  assert.equal(underFavorite(P, ['ssh://datalad/datalad/mri/MRI-Lab_Repository']), true)
  assert.equal(underFavorite(P, ['ssh://datalad/']), true)
  assert.equal(underFavorite(P, ['ssh://other/']), false)
  assert.equal(underFavorite(P, []), false)
  assert.equal(underFavorite(P, ['ssh://datalad/datalad/mri/MRI-Lab_Repository/proj/sub']), false)
})

test('wantedOrigin', () => {
  assert.equal(wantedOrigin(P, 'sub-01'), 'ssh://datalad/datalad/mri/MRI-Lab_Repository/proj/sub-01')
  assert.equal(wantedOrigin({ host: 'h', path: '/' }, 'sub-01'), 'ssh://h/sub-01')
  for (const bad of HOSTILE) assert.equal(wantedOrigin(P, bad), null, bad)
})

test('ensureSshArgs', () => {
  assert.deepEqual(ensureSshArgs(P, ['sub-01', 'sub-02', 'sub-01', 'sub-A.b_c+d-e']), [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30', '--', 'datalad',
    "worldline-ensure-subjects '/datalad/mri/MRI-Lab_Repository/proj' 'sub-01' 'sub-02' 'sub-A.b_c+d-e'"
  ])
  for (const bad of HOSTILE) assert.throws(() => ensureSshArgs(P, ['sub-01', bad]), Error, bad)
  assert.throws(() => ensureSshArgs(P, []))
  assert.throws(() => ensureSshArgs(P, Array.from({ length: 501 }, (_, i) => `sub-${i}`)))
  assert.equal(ensureSshArgs(P, Array.from({ length: 500 }, (_, i) => `sub-${i}`)).length, 7)
  for (const path of ["/a'b", '/a/../b', '/a;b', '/a\\b', 'rel/x', '/a\nb', '/a$(id)', '/a//b'])
    assert.throws(() => ensureSshArgs({ host: 'datalad', path }, ['sub-01']), Error, path)
  for (const host of ['-oProxyCommand=x', 'h;x', "h'x", 'h x', '', 'h\nx'])
    assert.throws(() => ensureSshArgs({ host, path: '/a' }, ['sub-01']), Error, host)
  assert.throws(() => ensureSshArgs(null, ['sub-01']))
  assert.throws(() => ensureSshArgs(P, 'sub-01'))
})

test('parseEnsureOutput', () => {
  const out = 'created sub-01\nexists sub-02\nrefused sub-x bad thing here\nrefused (empty) empty name\nnoise\nerror boom\ncreated sub-1;x\nexists ../x\nrefused sub-１ nope\ncreated  sub-03\r\ncreated sub-04\r\n'
  assert.deepEqual(parseEnsureOutput(out), {
    created: ['sub-01', 'sub-04'], exists: ['sub-02'],
    refused: [{ name: 'sub-x', reason: 'bad thing here' }, { name: '(empty)', reason: 'empty name' }]
  })
  for (const g of [undefined, null, '', 42, '\0\0', 'a'.repeat(10000)])
    assert.deepEqual(parseEnsureOutput(g), { created: [], exists: [], refused: [] })
})
