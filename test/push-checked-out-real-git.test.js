import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mapCommandError } from '../src/datalad/errors.js'

// Real git, no fake text: a server copy that is a normal folder with master open (what a DataLad server
// created by "datalad create" is) refuses pushes. This is the case the app showed as "could not finish".
const ident = ['-c', 'user.email=a@example.org', '-c', 'user.name=A']
async function serverAndClone() {
  const root = await mkdtemp(join(tmpdir(), 'dlad-push-'))
  const run = (cwd, args) => spawnSync('git', [...ident, ...args], { cwd, encoding: 'utf8' })
  const server = join(root, 'server')
  const clone = join(root, 'clone')
  execFileSync('git', ['init', '-q', '-b', 'master', server])
  run(server, ['commit', '--allow-empty', '-q', '-m', 'one'])
  execFileSync('git', ['clone', '-q', server, clone])
  run(clone, ['commit', '--allow-empty', '-q', '-m', 'two'])
  return { server, clone, run }
}

test('a real push to a server copy with the branch open is explained in plain words', async () => {
  const { clone, run } = await serverAndClone()
  const push = run(clone, ['push', 'origin', 'master'])
  assert.notEqual(push.status, 0)
  const mapped = mapCommandError('push', { stdout: push.stdout, stderr: push.stderr })
  assert.equal(mapped.code, 'REMOTE_BRANCH_CHECKED_OUT')
})

test('the advice in that message works: with receive.denyCurrentBranch updateInstead the same push succeeds', async () => {
  const { server, clone, run } = await serverAndClone()
  run(server, ['config', 'receive.denyCurrentBranch', 'updateInstead'])
  assert.equal(run(clone, ['push', 'origin', 'master']).status, 0)
})
