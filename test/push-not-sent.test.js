// "Send my saves" with a nested folder that has no place on the server (DAB/derivatives): everything else is sent, so
// the app says exactly what stayed behind instead of "failed". Anything else that goes wrong stays a failure.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
const run = (command, args) => execFileSync(command, args, { env, stdio: 'ignore' })

const adapterFor = (stdout, stderr = '', extra = {}) => new DataLadAdapter({
  runner: { run: async (command, args) => ({ command, args, exitCode: 1, failed: true, stdout, stderr, durationMs: 1, ...extra }) }
})
const send = (adapter) => adapter.runCommand('push', { projectPath: '/p', remoteName: 'origin' })
const MISSING = "publish(error): derivatives (dataset) [Unknown target sibling 'origin'.]"
const OK = 'publish(ok): . (dataset) [refs/heads/main->origin:refs/heads/main [new branch]]'

test('only a nested folder without that server: sent, and the folder is named', async () => {
  const result = await send(adapterFor(`${MISSING}\r\n${OK}\r\n`))
  assert.equal(result.ok, true)
  assert.deepEqual(result.notSent, ['derivatives'])
  assert.equal(result.userError, null)
  assert.match(result.warnings.at(-1).message, /Not sent: derivatives\./)
})

test('anything else that goes wrong stays a failed send', async () => {
  const cases = [
    adapterFor(`${MISSING}\npublish(error): sub-001 (dataset) [refs/heads/main->origin:refs/heads/main [rejected]]\n`),
    adapterFor("publish(error): . (dataset) [Unknown target sibling 'origin'.]\n"),
    adapterFor(MISSING.replace("'origin'", "'backup'")),
    adapterFor(MISSING, 'fatal: Could not read from remote repository.\n'),
    adapterFor(`${MISSING}\ncopy(impossible): sub-001/a.bin (file) [no key]\n`),
    adapterFor(MISSING, '', { timedOut: true }),
    adapterFor(MISSING, '', { cancelled: true }),
    adapterFor(MISSING, '', { exitCode: 2 }),
    adapterFor(OK)
  ]
  for (const adapter of cases) {
    const result = await send(adapter)
    assert.equal(result.ok, false)
    assert.equal(result.notSent, undefined)
  }
})

test('real DataLad: the project is sent and the folder without a server is reported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'not sent '))
  const top = join(root, 'top')
  run('datalad', ['create', top])
  run('datalad', ['create', '-d', top, join(top, 'derivatives')])
  run('git', ['init', '-q', '--bare', join(root, 'server.git')])
  run('git', ['-C', top, 'remote', 'add', 'origin', join(root, 'server.git')])
  await writeFile(join(top, 'a.txt'), 'a')
  run('datalad', ['-C', top, 'save', '-m', 'a'])

  const result = await new DataLadAdapter().runCommand('push', { projectPath: top, remoteName: 'origin' })
  assert.equal(result.ok, true, result.stdout + result.stderr)
  assert.deepEqual(result.notSent, ['derivatives'])
  const branch = execFileSync('git', ['-C', top, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim().replace(/^adjusted\/|\(.*$/g, '')
  run('git', ['-C', join(root, 'server.git'), 'rev-parse', '--verify', `refs/heads/${branch}`])
})
