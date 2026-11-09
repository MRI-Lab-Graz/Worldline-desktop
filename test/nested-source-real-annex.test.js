// Real git, git-annex and DataLad: a subject folder nested into a project that was cloned from a read-only
// source must still be able to download its files from that source (an rsync remote stands in for OpenNeuro's S3).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const hasTools = has('git', ['annex', 'version']) && has('datalad', ['--version']) && has('rsync', ['--version'])

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
