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
const lf = (text) => text.replace(/\r\n/g, '\n') // DataLad writes CRLF on Windows; git reads both the same way

// What a person would look at to see why a nested subject differs from a DataLad-made one.
function describe(dir) {
  const sub = join(dir, 'sub-01')
  const out = (cwd, ...args) => { try { return git(cwd, ...args).trim() } catch (e) { return `ERR ${e.message.slice(0, 200)}` } }
  return [
    ['parent status', out(dir, 'status', '--porcelain')], ['submodule status', out(dir, 'submodule', 'status')],
    ['parent ls-files -s', out(dir, 'ls-files', '-s')], ['sub status', out(sub, 'status', '--porcelain', '--untracked-files=all')],
    ['sub branches', out(sub, 'branch', '-a', '-vv')], ['sub log', out(sub, 'log', '--all', '--oneline', '--decorate', '-n', '8')],
    ['sub config', out(sub, 'config', '--local', '--list')], ['sub diff', out(sub, 'diff', '--stat')],
    ['sub ls-files -s', out(sub, 'ls-files', '-s')]
  ].map(([k, v]) => `--- ${k}\n${v}`).join('\n')
}
const withoutId = (text) => text.replace(/id = [0-9a-f-]{36}/, 'id = <id>').replace(/datalad-id = [0-9a-f-]{36}/, 'datalad-id = <id>')

test('nestSubdataset leaves what DataLad leaves', { skip }, async () => {
  const viaDatalad = await project()
  await adapter().runCommand('createSubdataset', { projectPath: viaDatalad, relativePath: 'sub-01', procedure: 'text2git', force: true })
  await adapter().runCommand('save', { projectPath: join(viaDatalad, 'sub-01'), message: 'Add existing sub-01 content' })
  const viaGit = await project()
  const result = await adapter().runCommand('nestSubdataset', { projectPath: viaGit, relativePath: 'sub-01', procedure: 'text2git' })
  assert.equal(result.ok, true, result.stderr)

  for (const file of ['.gitattributes', '.datalad/config', '.datalad/.gitattributes']) {
    assert.equal(lf(withoutId(await read(viaGit, `sub-01/${file}`))), lf(withoutId(await read(viaDatalad, `sub-01/${file}`))), file)
  }
  const tracked = (dir) => git(join(dir, 'sub-01'), 'ls-files').split('\n').sort()
  assert.deepEqual(tracked(viaGit), tracked(viaDatalad))
  const annexed = (dir) => git(join(dir, 'sub-01'), 'annex', 'find', '--include=*').split('\n').sort()
  assert.deepEqual(annexed(viaGit), annexed(viaDatalad))
  assert.equal(git(join(viaGit, 'sub-01'), 'status', '--porcelain'), '')
  // The parent records the subject the way DataLad does.
  assert.equal(lf(withoutId(await read(viaGit, '.gitmodules'))), lf(withoutId(await read(viaDatalad, '.gitmodules'))))
})

test('DataLad accepts a subject nested with git-annex', { skip }, async () => {
  const dir = await project()
  const a = adapter()
  assert.equal((await a.runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-01', procedure: 'text2git' })).ok, true)
  const saved = await a.runCommand('save', { projectPath: dir, message: 'Nest BIDS dataset structure' })
  assert.equal(saved.ok, true, saved.stderr)

  const listed = execFileSync('datalad', ['-C', dir, 'subdatasets'], { encoding: 'utf8' })
  assert.match(listed, /sub-01/)
  const dirty = git(dir, 'status', '--porcelain')
  // On Windows git-annex works on an adjusted branch and DataLad itself leaves the parent showing the subject as modified.
  if (!git(join(dir, 'sub-01'), 'branch', '--show-current').startsWith('adjusted/')) assert.equal(dirty, '', `\n${describe(dir)}`)
  const status = execFileSync('datalad', ['-C', dir, 'status', '-r'], { encoding: 'utf8' })
  assert.doesNotMatch(status, /modified|untracked/)
  // A later change inside the subject is saved by DataLad into the subject and recorded in the parent.
  await writeFile(join(dir, 'sub-01', 'func', 'events.tsv'), 'onset\tduration\n3\t4\n')
  const again = await a.runCommand('save', { projectPath: dir, message: 'Change events' })
  assert.equal(again.ok, true, again.stderr)
  if (!git(join(dir, 'sub-01'), 'branch', '--show-current').startsWith('adjusted/')) assert.equal(git(dir, 'status', '--porcelain'), '')
  assert.ok(git(join(dir, 'sub-01'), 'log', '--all', '--format=%s').split('\n').includes('Change events'))
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

// ---- review fixes: nothing the folder ships may redirect or survive our writes ----
const noLinks = skip || process.platform === 'win32' && 'symlinks need rights on Windows'

test('nestSubdataset refuses a .datalad link and leaves the file it points to alone', { skip: noLinks }, async () => {
  const dir = await project()
  const elsewhere = await mkdtemp(join(tmpdir(), 'dlad-nest-elsewhere-'))
  await writeFile(join(elsewhere, 'config'), 'PRECIOUS')
  await symlink(elsewhere, join(dir, 'sub-01', '.datalad'))
  await refused(dir, 'sub-01')
  assert.equal(await readFile(join(elsewhere, 'config'), 'utf8'), 'PRECIOUS')
  await assert.rejects(lstat(join(dir, 'sub-01', '.git')))
})

test('nestSubdataset refuses a .gitattributes link and leaves the file it points to alone', { skip: noLinks }, async () => {
  const dir = await project()
  const elsewhere = await mkdtemp(join(tmpdir(), 'dlad-nest-elsewhere-'))
  await writeFile(join(elsewhere, 'bashrc'), 'PRECIOUS')
  await symlink(join(elsewhere, 'bashrc'), join(dir, 'sub-01', '.gitattributes'))
  await refused(dir, 'sub-01')
  assert.equal(await readFile(join(elsewhere, 'bashrc'), 'utf8'), 'PRECIOUS')
})

test('nestSubdataset refuses a folder that already has its own .gitattributes and keeps it', { skip }, async () => {
  const dir = await project()
  await writeFile(join(dir, 'sub-01', '.gitattributes'), '*.nii annex.largefiles=anything\n')
  await refused(dir, 'sub-01')
  assert.equal(await readFile(join(dir, 'sub-01', '.gitattributes'), 'utf8'), '*.nii annex.largefiles=anything\n')
})

test('nestSubdataset accepts one plain folder name only: never .git, .datalad, a nested or backslashed path', { skip }, async () => {
  const dir = await project()
  const before = git(dir, 'rev-parse', 'HEAD')
  for (const name of ['.git', '.GIT', '.git.', '.datalad', 'git~1', 'sub-01/anat', 'sub-01\\anat']) {
    await refused(dir, name)
  }
  assert.equal(git(dir, 'rev-parse', 'HEAD'), before)
  assert.equal(git(dir, 'fsck', '--no-progress').includes('error'), false)
  await assert.rejects(lstat(join(dir, '.gitmodules')))
})

// A runner that fails one chosen git call, to leave a run half done.
const failing = (failWhen) => {
  const real = new ProcessRunner()
  return { run: async (command, args, options) => (failWhen(args) ? { command, args, exitCode: 1, stdout: '', stderr: 'boom', failed: true } : real.run(command, args, options)) }
}

test('a failure before any content is added removes what nestSubdataset created, so a retry works', { skip }, async () => {
  const dir = await project()
  const broken = new DataLadAdapter({ runner: failing((args) => args.includes('annex') && args.includes('init')) })
  assert.equal((await broken.runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-01' })).ok, false)
  for (const name of ['.git', '.datalad', '.gitattributes']) await assert.rejects(lstat(join(dir, 'sub-01', name)), name)
  assert.equal((await adapter().runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-01' })).ok, true)
})

test('a failure after content was moved into the annex keeps the repository, so no file is lost', { skip }, async () => {
  const dir = await project()
  let added = false
  const broken = new DataLadAdapter({
    runner: failing((args) => { if (args.includes('add') && args.includes('annex')) added = true; return added && args.includes('commit') })
  })
  assert.equal((await broken.runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-01' })).ok, false)
  await lstat(join(dir, 'sub-01', '.git'))
  assert.equal(await readFile(join(dir, 'sub-01', 'func', 'events.tsv'), 'utf8'), 'onset\tduration\n1\t2\n')
})

test('on an adjusted branch (Windows, crippled filesystem) the content reaches the branch the parent records', { skip }, async () => {
  const dir = await project()
  const saved = { ...process.env }
  Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'annex.crippledfilesystem', GIT_CONFIG_VALUE_0: 'true' })
  try {
    const result = await adapter().runCommand('nestSubdataset', { projectPath: dir, relativePath: 'sub-01', procedure: 'text2git' })
    assert.equal(result.ok, true, result.stderr)
  } finally {
    for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) delete process.env[key]
    Object.assign(process.env, saved)
  }
  const sub = join(dir, 'sub-01')
  assert.match(git(sub, 'branch', '--show-current'), /^adjusted\//, 'the test must really be on an adjusted branch')
  const files = git(sub, 'ls-tree', '-r', '--name-only', 'main').split('\n')
  assert.ok(files.includes('anat/T1w.nii') && files.includes('.gitattributes'), `main lacks the content:\n${describe(dir)}`)
  assert.equal((await adapter().runCommand('save', { projectPath: dir, message: 'Nest' })).ok, true)
  assert.equal(git(dir, 'ls-files', '-s', 'sub-01').split(/\s+/)[1], git(sub, 'rev-parse', 'main').trim(), 'the parent records main')
})
