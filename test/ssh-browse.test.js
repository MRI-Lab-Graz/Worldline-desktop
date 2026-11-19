import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSshAddress, parseFolderListing, sshBrowseArgs, listSshFolders, parentOf } from '../src/gui/ssh-browse.js'

test('parseSshAddress takes ssh://host/absolute/path, with an optional user@', () => {
  assert.deepEqual(parseSshAddress('ssh://mri/datalad/mri/MRI-Lab_Repository/'), { host: 'mri', path: '/datalad/mri/MRI-Lab_Repository' })
  assert.deepEqual(parseSshAddress(' ssh://bob@10.0.0.5/data '), { host: 'bob@10.0.0.5', path: '/data' })
  assert.deepEqual(parseSshAddress('ssh://mri'), { host: 'mri', path: '/' })
  assert.deepEqual(parseSshAddress('ssh://mri/my%20study'), { host: 'mri', path: '/my study' })
})

test('parseSshAddress refuses anything that could reach the shell or ssh options', () => {
  for (const bad of [
    'https://x/y', 'mri:/data', '/local/path', '', null, undefined,
    'ssh://-oProxyCommand=evil/data', 'ssh://mri/data/../etc', 'ssh://mri/a%27b', "ssh://mri/a'b",
    'ssh://mri/a;rm', 'ssh://mri/a$(x)', 'ssh://mri/a`x`', 'ssh://mri/a%0Ab', 'ssh://mri/a\\b', 'ssh://mri/a|b',
    'ssh://a b/data', 'ssh://-x@host/data', 'ssh://host:22/data', 'ssh://@host/data'
  ]) {
    assert.equal(parseSshAddress(bad), null, String(bad))
  }
})

test('the ssh command never asks for a password, times out, and ends options before the host', () => {
  const args = sshBrowseArgs({ host: 'mri', path: '/my study' })
  assert.deepEqual(args.slice(0, 5), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--'])
  assert.equal(args[5], 'mri')
  assert.equal(args[6], "cd -- '/my study' && ls -1Ap")
  assert.equal(args.length, 7)
})

test('parseFolderListing keeps folders only, drops odd names, and is capped', () => {
  const out = 'a.txt\nsub1/\n.hidden/\nsub two/\nbad\x1bname/\n\nlink@\n'
  assert.deepEqual(parseFolderListing(out), ['sub1', 'sub two'])
  const many = Array.from({ length: 2500 }, (_, i) => `d${i}/`).join('\n')
  assert.equal(parseFolderListing(many).length, 1000)
})

test('parentOf goes one level up and stops at the root', () => {
  assert.equal(parentOf('/datalad/mri'), '/datalad')
  assert.equal(parentOf('/datalad'), '/')
  assert.equal(parentOf('/'), null)
})

test('listSshFolders returns the folders and the way up', async () => {
  const run = async () => ({ code: 0, stdout: 'a/\nb/\nf.txt\n', stderr: '' })
  assert.deepEqual(await listSshFolders('ssh://mri/data/x', { run }), {
    address: 'ssh://mri/data/x', host: 'mri', path: '/data/x', parent: 'ssh://mri/data', folders: ['a', 'b']
  })
})

test('listSshFolders gives plain-words errors', async () => {
  const fail = (stderr, extra = {}) => async () => ({ code: 255, stdout: '', stderr, ...extra })
  await assert.rejects(listSshFolders('https://x', { run: fail('') }), /ssh:\/\//)
  await assert.rejects(listSshFolders('ssh://mri/d', { run: fail('Permission denied (publickey).') }), /key|password/i)
  await assert.rejects(listSshFolders('ssh://mri/d', { run: fail('Host key verification failed.') }), /terminal/i)
  await assert.rejects(listSshFolders('ssh://mri/d', { run: fail('ssh: Could not resolve hostname mri: nodename nor servname provided, or not known') }), /does not know a server called "mri"[\s\S]*Host mri/)
  await assert.rejects(listSshFolders('ssh://mri/d', { run: fail('ssh: connect to host mri port 22: Connection timed out') }), /network or VPN/)
  await assert.rejects(listSshFolders('ssh://mri/d', { run: fail('', { code: 1, stderr: 'sh: cd: /d: No such file or directory' }) }), /does not exist|not found/i)
  await assert.rejects(listSshFolders('ssh://mri/d', { run: fail('', { timedOut: true }) }), /did not answer/i)
  await assert.rejects(listSshFolders('ssh://mri/d', { run: async () => { throw Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' }) } }), /OpenSSH/i)
})

test('the server text is never echoed back into the message', async () => {
  const run = async () => ({ code: 255, stdout: '', stderr: '<img src=x onerror=alert(1)>' })
  await assert.rejects(listSshFolders('ssh://mri/d', { run }), (e) => !/img/.test(e.message))
})

// Folder names with umlauts, accents, other scripts and brackets must be listed AND openable; the same rule
// decides both, so nothing is shown that the address check would then refuse. Quotes and shell characters stay out.
test('letters and digits of any language, combining marks and brackets are allowed in a path', () => {
  assert.deepEqual(parseSshAddress('ssh://mri/data/M%C3%BCller/%E5%AD%A6%E7%94%9F/data%20(2)'), { host: 'mri', path: '/data/Müller/学生/data (2)' })
  assert.deepEqual(parseSshAddress('ssh://mri/u%CC%88'), { host: 'mri', path: '/u\u0308' }) // kept as typed (u + combining diaeresis, as macOS names them), so it matches the server
})

test('look-alike and invisible characters are still refused', () => {
  for (const bad of ['ssh://mri/a%E2%80%AEb', 'ssh://mri/a%E2%80%8Bb', 'ssh://mri/a%C2%A0b', 'ssh://mri/a%EF%BC%8Fb']) {
    assert.equal(parseSshAddress(bad), null, bad) // right-to-left override, zero-width space, no-break space, full-width slash
  }
})

test('the listing shows only names that can be opened', () => {
  assert.deepEqual(parseFolderListing('Müller/\ndata (2)/\nit\'s/\na;b/\n学生/\n'), ['Müller', 'data (2)', '学生'])
})
