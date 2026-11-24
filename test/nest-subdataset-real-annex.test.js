// Real git, git-annex and DataLad: nesting a subject folder with plain git/git-annex (nestSubdataset) must leave
// what `datalad create -c text2git` + `datalad save` leave, so DataLad keeps working with it afterwards.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const skip = !(has('git', ['annex', 'version']) && has('datalad', ['--version'])) && 'git-annex and datalad are needed'

// New repositories made by the commands under test have no local identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.org', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.org'
})

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
const adapter = () => new DataLadAdapter({ runner: new ProcessRunner() })

async function project(folder = 'sub-01') {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-nest-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'annex', 'init', 'test')
  await mkdir(join(dir, folder, 'anat'), { recursive: true })
  await mkdir(join(dir, folder, 'func'), { recursive: true })
  await writeFile(join(dir, folder, 'anat', 'T1w.nii'), 'brain data ' + folder)
  await writeFile(join(dir, folder, 'func', 'events.tsv'), 'onset\tduration\n1\t2\n')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'start')
  return dir
}

const read = (dir, rel) => readFile(join(dir, rel), 'utf8')
const withoutId = (text) => text.replace(/id = [0-9a-f-]{36}/, 'id = <id>').replace(/datalad-id = [0-9a-f-]{36}/, 'datalad-id = <id>')

test('nestSubdataset leaves what DataLad leaves', { skip }, async () => {
  const viaDatalad = await project()
  await adapter().runCommand('createSubdataset', { projectPath: viaDatalad, relativePath: 'sub-01', procedure: 'text2git', force: true })
  await adapter().runCommand('save', { projectPath: join(viaDatalad, 'sub-01'), message: 'Add existing sub-01 content' })
  const viaGit = await project()
  const result = await adapter().runCommand('nestSubdataset', { projectPath: viaGit, relativePath: 'sub-01', procedure: 'text2git' })
  assert.equal(result.ok, true, result.stderr)

  for (const file of ['.gitattributes', '.datalad/config', '.datalad/.gitattributes']) {
    assert.equal(withoutId(await read(viaGit, `sub-01/${file}`)), withoutId(await read(viaDatalad, `sub-01/${file}`)), file)
  }
  const tracked = (dir) => git(join(dir, 'sub-01'), 'ls-files').split('\n').sort()
  assert.deepEqual(tracked(viaGit), tracked(viaDatalad))
  const annexed = (dir) => git(join(dir, 'sub-01'), 'annex', 'find', '--include=*').split('\n').sort()
  assert.deepEqual(annexed(viaGit), annexed(viaDatalad))
  assert.equal(git(join(viaGit, 'sub-01'), 'status', '--porcelain'), '')
  // The parent records the subject the way DataLad does.
  assert.equal(withoutId(await read(viaGit, '.gitmodules')), withoutId(await read(viaDatalad, '.gitmodules')))
})

test('DataLad accepts a subject nested with git-annex', { skip }, async () => {
  const dir = await project()
  const a = adapter()
  assert.equal((await a.runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-01', procedure: 'text2git' })).ok, true)
  const saved = await a.runCommand('save', { projectPath: dir, message: 'Nest BIDS dataset structure' })
  assert.equal(saved.ok, true, saved.stderr)

  const listed = execFileSync('datalad', ['-C', dir, 'subdatasets'], { encoding: 'utf8' })
  assert.match(listed, /sub-01/)
  assert.equal(git(dir, 'status', '--porcelain'), '')
  const status = execFileSync('datalad', ['-C', dir, 'status', '-r'], { encoding: 'utf8' })
  assert.doesNotMatch(status, /modified|untracked/)
  // A later change inside the subject is saved by DataLad into the subject and recorded in the parent.
  await writeFile(join(dir, 'sub-01', 'func', 'events.tsv'), 'onset\tduration\n3\t4\n')
  const again = await a.runCommand('save', { projectPath: dir, message: 'Change events' })
  assert.equal(again.ok, true, again.stderr)
  assert.equal(git(dir, 'status', '--porcelain'), '')
  assert.equal(git(join(dir, 'sub-01'), 'log', '-1', '--format=%s').trim(), 'Change events')
})

test('nestSubdataset also nests a folder with spaces and non-ASCII characters', { skip }, async () => {
  const dir = await project('sub-Zoë 01')
  const result = await adapter().runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-Zoë 01' })
  assert.equal(result.ok, true, result.stderr)
  assert.equal((await adapter().runCommand('save', { projectPath: dir, message: 'Nest' })).ok, true)
  assert.match(execFileSync('datalad', ['-C', dir, 'subdatasets'], { encoding: 'utf8' }), /sub-Zoë 01/)
})

test('nestSubdataset nests an empty folder', { skip }, async () => {
  const dir = await project()
  await mkdir(join(dir, 'sub-02'))
  const result = await adapter().runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-02' })
  assert.equal(result.ok, true, result.stderr)
})

async function refused(dir, relativePath, extra = {}) {
  const result = await adapter().runCommand('nestSubdataset', { projectPath: dir, relativePath, ...extra })
  assert.equal(result.ok, false)
  assert.equal(result.userError?.code, 'NEST_REFUSED')
  return result
}

test('nestSubdataset refuses a folder that already has .git and writes nothing', { skip }, async () => {
  const dir = await project()
  git(join(dir, 'sub-01'), 'init', '-q')
  await refused(dir, 'sub-01')
  await assert.rejects(lstat(join(dir, 'sub-01', '.gitattributes')))
})

test('nestSubdataset refuses a symlinked folder', { skip: skip || process.platform === 'win32' && 'symlinks need rights on Windows' }, async () => {
  const dir = await project()
  const elsewhere = await mkdtemp(join(tmpdir(), 'dlad-nest-elsewhere-'))
  await symlink(elsewhere, join(dir, 'sub-09'))
  await refused(dir, 'sub-09')
  await assert.rejects(lstat(join(elsewhere, '.git')))
})

test('nestSubdataset refuses a path that leaves the project, a bad procedure and a missing folder', { skip }, async () => {
  const dir = await project()
  await refused(dir, '../outside')
  await refused(dir, 'sub-01', { procedure: '../x' })
  await refused(dir, 'sub-77')
  await assert.rejects(lstat(join(dir, 'sub-01', '.gitattributes')))
})
