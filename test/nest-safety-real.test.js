// Real git. Only never-saved subject folders may be nested on their own, and a send that would empty a folder on the
// server (a saved folder turned into a nested dataset that has no place there) is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { emptiedFolderRefusal } from '../src/datalad/nest-guard.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=x', '-c', 'user.email=x@x.io', '-c', 'protocol.file.allow=always', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const file = async (root, path, text = 'a\n') => {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), text)
}
async function repo() {
  const root = await mkdtemp(join(tmpdir(), 'nest safety '))
  git(root, 'init', '-q', '-b', 'main')
  return root
}
const commit = (root, message) => { git(root, 'add', '-A'); git(root, 'commit', '-qm', message) }

test('onlyNew lists never-saved folders with files, and nothing that is saved, empty, ignored or already a repository', async () => {
  const root = await repo()
  await file(root, 'sub-001/a.tsv')
  await file(root, '.gitignore', 'sub-005/\n')
  commit(root, 'saved')
  await file(root, 'sub-001/later.tsv') // a new file in a saved folder does not make the folder new
  await file(root, 'sub-002/a.tsv')
  await mkdir(join(root, 'sub-003'))
  await file(root, 'sub-004/a.tsv')
  git(join(root, 'sub-004'), 'init', '-q')
  await file(root, 'sub-005/a.tsv')

  const adapter = new DataLadAdapter()
  assert.deepEqual(await adapter.findUnnestedBidsCandidates(root, { onlyNew: true }), ['sub-002'])
  assert.ok((await adapter.findUnnestedBidsCandidates(root)).includes('sub-001'), 'without onlyNew nothing changes')
})

// A project already sent with sub-053 as an ordinary folder, then turned into a nested dataset.
async function converted() {
  const root = await repo()
  await file(root, 'sub-053/a.tsv')
  commit(root, 'flat')
  const server = await mkdtemp(join(tmpdir(), 'nest server '))
  git(server, 'init', '-q', '--bare', '-b', 'main')
  git(root, 'remote', 'add', 'origin', server)
  git(root, 'push', '-q', '-u', 'origin', 'main')
  git(root, 'rm', '-r', '-q', '--cached', 'sub-053')
  git(join(root, 'sub-053'), 'init', '-q', '-b', 'main')
  commit(join(root, 'sub-053'), 'subject')
  git(root, 'submodule', 'add', './sub-053', 'sub-053')
  commit(root, 'nested')
  return { root, server }
}
const refusal = (projectPath, remoteName = 'origin') => emptiedFolderRefusal({ runner: new ProcessRunner(), projectPath, remoteName })

test('a send that would empty a saved folder on the server is refused, with or without a named remote', async () => {
  const { root } = await converted()
  assert.match(await refusal(root), /would empty sub-053/)
  assert.match(await refusal(root, undefined), /would empty sub-053/)
  git(join(root, 'sub-053'), 'remote', 'add', 'origin', join(root, 'nowhere')) // an address with nothing behind it
  assert.match(await refusal(root), /would empty sub-053/)
})

test('it may be sent when the folder has a place there, when it was never there, or to a new server', async () => {
  const { root } = await converted()
  const place = await mkdtemp(join(tmpdir(), 'nest place '))
  git(place, 'init', '-q', '--bare')
  git(join(root, 'sub-053'), 'remote', 'add', 'origin', place)
  assert.equal(await refusal(root), null)

  await rm(join(place, 'HEAD'))
  git(root, 'remote', 'add', 'fresh', place)
  assert.equal(await refusal(root, 'fresh'), null)

  const other = await converted()
  git(other.root, 'push', '-q', other.server, 'main') // the server has the nested form now
  git(other.root, 'fetch', '-q', 'origin')
  assert.equal(await refusal(other.root), null)
})

test('a name that could be read as an option, or a git failure, refuses', async () => {
  assert.match(await refusal((await converted()).root, '--force'), /nothing was sent/)
  assert.match(await refusal(await mkdtemp(join(tmpdir(), 'no repo '))), /nothing was sent/)
})

test('trust is asked before any nested server is contacted, and only when one would be', async () => {
  const calls = []
  const runner = new ProcessRunner()
  const logged = { run: (command, args) => { if (args.includes('ls-remote')) calls.push('contact'); return runner.run(command, args) } }
  const { root } = await converted()
  await emptiedFolderRefusal({ runner: logged, projectPath: root, remoteName: 'origin', beforeContact: async () => calls.push('trust') })
  assert.deepEqual(calls, ['trust', 'contact'])

  calls.length = 0
  const plain = await repo()
  await file(plain, 'a.txt')
  commit(plain, 'a')
  assert.equal(await emptiedFolderRefusal({ runner: logged, projectPath: plain, remoteName: 'origin', beforeContact: async () => calls.push('trust') }), null)
  assert.deepEqual(calls, [])
})

test('a folder without its own repository has no place there: the main project must not answer for it', async () => {
  const { root } = await converted()
  await rm(join(root, 'sub-053'), { recursive: true, force: true })
  await mkdir(join(root, 'sub-053'))
  assert.match(await refusal(root), /would empty sub-053/)
})

test('a server name from the config that git would read as an option is refused before it is used', async () => {
  const { root } = await converted()
  git(root, 'config', 'branch.main.remote', '--upload-pack=x')
  git(root, 'update-ref', 'refs/remotes/--upload-pack=x/main', 'refs/remotes/origin/main')
  const runner = new ProcessRunner()
  const used = []
  const logged = { run: (command, args, options) => { if (args.includes('ls-remote')) used.push(args); return runner.run(command, args, options) } }
  assert.match(await emptiedFolderRefusal({ runner: logged, projectPath: root }), /nothing was sent/)
  assert.deepEqual(used, [])
})

test('a folder that is a link to another repository is never asked (its settings would run)', async () => {
  const { root } = await converted()
  const elsewhere = join(await mkdtemp(join(tmpdir(), 'nest elsewhere ')), 'repo')
  await rename(join(root, 'sub-053'), elsewhere)
  git(elsewhere, 'remote', 'add', 'origin', elsewhere)
  await symlink(elsewhere, join(root, 'sub-053'), 'junction') // a junction needs no special right on Windows
  const runner = new ProcessRunner()
  const asked = []
  const logged = { run: (command, args, options) => { if (args.includes('ls-remote')) asked.push(args); return runner.run(command, args, options) } }
  assert.notEqual(await emptiedFolderRefusal({ runner: logged, projectPath: root, remoteName: 'origin' }), null)
  assert.deepEqual(asked, [])
})
