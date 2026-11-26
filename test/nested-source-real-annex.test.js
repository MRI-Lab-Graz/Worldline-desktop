// Real git, git-annex and DataLad: a subject folder nested into a project that was cloned from a read-only
// source must still be able to download its files from that source (an rsync remote stands in for OpenNeuro's S3).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const hasAnnex = has('git', ['annex', 'version']) && has('datalad', ['--version'])
const hasTools = hasAnnex && has('rsync', ['--version'])

async function projectWithSourceOnlyData() {
  const root = await mkdtemp(join(tmpdir(), 'dlad-nested-source-'))
  const store = join(root, 'store')
  const dir = join(root, 'project')
  await mkdir(store)
  await mkdir(join(dir, 'sub-01', 'anat'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  git('config', 'commit.gpgsign', 'false')
  git('annex', 'init', 'test')
  git('annex', 'initremote', 'store', 'type=rsync', `rsyncurl=${store}`, 'encryption=none')
  await writeFile(join(dir, 'sub-01', 'anat', 'T1w.nii'), 'brain data')
  git('annex', 'add', 'sub-01')
  git('commit', '-qm', 'data')
  git('annex', 'copy', '--to', 'store', 'sub-01')
  git('annex', 'drop', '--force', 'sub-01')
  return { dir }
}

async function nest(adapter, dir) {
  await adapter.untrackPath(dir, 'sub-01')
  await adapter.runCommand('createSubdataset', { projectPath: dir, relativePath: 'sub-01', procedure: 'text2git', force: true })
  await adapter.runCommand('save', { projectPath: join(dir, 'sub-01'), message: 'Add existing sub-01 content' })
}

test('a nested subject can still download from the source its project uses', { skip: !hasTools && 'git-annex, datalad and rsync are needed' }, async () => {
  const { dir } = await projectWithSourceOnlyData()
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  await nest(adapter, dir)
  const sub = join(dir, 'sub-01')

  const before = await adapter.runCommand('get', { projectPath: sub, paths: ['anat/T1w.nii'] })
  assert.equal(before.ok, false, 'nesting alone loses the source (the bug)')

  const result = await adapter.linkSubdatasetSource(dir, 'sub-01')
  assert.deepEqual(result, { linked: ['store'] })

  const after = await adapter.runCommand('get', { projectPath: sub, paths: ['anat/T1w.nii'] })
  assert.equal(after.ok, true, JSON.stringify(after.userError ?? after.stderr))
})

// git-annex asks before it uses remote settings that came from elsewhere. A project that never accepted a source
// must not have that question answered "safe" on its behalf.
test('a source the project itself never verified is not confirmed in the subject', { skip: !hasTools && 'git-annex, datalad and rsync are needed' }, async () => {
  const { dir } = await projectWithSourceOnlyData()
  execFileSync('git', ['config', '--unset', 'remote.store.annex-verified'], { cwd: dir })
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  await nest(adapter, dir)

  assert.deepEqual(await adapter.linkSubdatasetSource(dir, 'sub-01'), { linked: [] })
  const get = await adapter.runCommand('get', { projectPath: join(dir, 'sub-01'), paths: ['anat/T1w.nii'] })
  assert.equal(get.ok, false)
})

test('linking a subject of a project without any download source does nothing', { skip: !hasTools && 'git-annex, datalad and rsync are needed' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-nested-nosource-'))
  const dir = join(root, 'p')
  await mkdir(join(dir, 'sub-01'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(join(dir, 'sub-01', 'a.txt'), 'x')
  git('add', '.')
  git('commit', '-qm', 'a')
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  await nest(adapter, dir)

  assert.deepEqual(await adapter.linkSubdatasetSource(dir, 'sub-01'), { linked: [] })
})

test('linkSubdatasetSource rejects a path that leaves the project', async () => {
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  await assert.rejects(adapter.linkSubdatasetSource('/tmp/proj', '../outside'), /Invalid path/)
})

// A GitLab or GIN git-annex server is an ordinary remote with a URL, not a special remote. A second local repository
// stands in for it here.
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
const skipServer = { skip: !hasAnnex && 'git-annex and datalad are needed' }

async function cloneOfServer({ beforeNest } = {}) {
  // New repositories made by the commands under test have no local identity.
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.org', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.org'
  })
  const root = await mkdtemp(join(tmpdir(), 'dlad-nested-server-'))
  const server = join(root, 'server')
  const dir = join(root, 'project')
  await mkdir(join(server, 'sub-01', 'anat'), { recursive: true })
  git(server, 'init', '-q', '-b', 'main')
  git(server, 'config', 'commit.gpgsign', 'false')
  git(server, 'annex', 'init', 'server')
  await writeFile(join(server, 'sub-01', 'anat', 'T1w.nii'), 'brain data')
  git(server, 'annex', 'add', 'sub-01')
  git(server, 'commit', '-qm', 'data')
  git(root, 'clone', '-q', server, dir)
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'annex', 'init', 'laptop')
  await beforeNest?.(dir, server)

  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const nested = await adapter.runCommand('nestSubdatasets', { projectPath: dir, relativePaths: ['sub-01'], procedure: 'text2git' })
  assert.equal(nested.ok, true, JSON.stringify(nested.subjects ?? nested.stderr))
  const linked = await adapter.linkSubdatasetSource(dir, 'sub-01')
  return { adapter, server, dir, sub: join(dir, 'sub-01'), linked }
}

async function assertDownloads({ adapter, sub }) {
  const get = await adapter.runCommand('get', { projectPath: sub, paths: ['anat/T1w.nii'] })
  assert.equal(get.ok, true, JSON.stringify(get.userError ?? get.stderr))
  assert.equal(await readFile(join(sub, 'anat', 'T1w.nii'), 'utf8'), 'brain data')
}

test('a nested subject can still download from the git-annex server its project was cloned from', skipServer, async () => {
  const project = await cloneOfServer()
  assert.deepEqual(project.linked, { linked: ['origin'] })
  await assertDownloads(project)
})

test('a server address relative to the project still works from inside the subject', skipServer, async () => {
  await assertDownloads(await cloneOfServer({ beforeNest: (dir) => git(dir, 'remote', 'set-url', 'origin', '../server') }))
})

// The server holds the whole project: a subject must never send its own history there.
test('the server is for downloads only: the subject cannot send to it and Update takes nothing from it', skipServer, async () => {
  const { adapter, server, sub } = await cloneOfServer()
  assert.equal(git(sub, 'remote').trim(), 'download-only-origin', 'never "origin": Send pushes nested subjects by that name')
  const refs = () => git(server, 'for-each-ref', '--exclude=refs/heads/git-annex')
  const before = { refs: refs(), head: git(sub, 'rev-parse', 'HEAD') }

  assert.throws(() => git(sub, 'push', 'download-only-origin', 'main:refs/heads/from-subject'))
  await adapter.runCommand('push', { projectPath: sub })
  await adapter.runCommand('push', { projectPath: sub, remoteName: 'download-only-origin' })
  git(sub, 'annex', 'sync')
  assert.equal(refs(), before.refs)

  await adapter.runCommand('update', { projectPath: sub })
  git(sub, 'fetch', '-q', 'download-only-origin')
  assert.equal(git(sub, 'rev-parse', 'HEAD'), before.head)
  assert.equal(git(sub, 'for-each-ref', '--format=%(refname)', 'refs/remotes/download-only-origin').trim(), 'refs/remotes/download-only-origin/git-annex')
})

for (const [what, change] of [
  ['git-annex never reached', (dir) => git(dir, 'config', '--unset', 'remote.origin.annex-uuid')],
  ['git-annex ignores', (dir) => git(dir, 'config', 'remote.origin.annex-ignore', 'true')],
  ['holds a password in its address', (dir) => git(dir, 'remote', 'set-url', 'origin', 'https://ana:secret@example.org/study.git')],
  ['needs a helper program', (dir) => git(dir, 'remote', 'set-url', 'origin', 'datalad-annex::https://example.org/study')],
  // git reads "~" as the home folder; resolving it like a relative folder would point inside the project.
  ['is addressed from the home folder', (dir) => git(dir, 'config', 'remote.origin.url', '~/server')],
  ['has an address over several lines', (dir) => git(dir, 'config', 'remote.origin.url', '../server\nsecond-line')]
]) {
  test(`a remote that ${what} is not given to the subject`, skipServer, async () => {
    const { sub, linked } = await cloneOfServer({ beforeNest: change })
    assert.deepEqual(linked, { linked: [] })
    assert.equal(git(sub, 'remote').trim(), '')
  })
}
