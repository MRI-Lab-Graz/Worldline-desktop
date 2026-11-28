// A subject taken out of the project must not come back: "Get updates" cannot delete a separately tracked folder, so
// it stays behind untracked, and a plain Save would record (and a Send upload) it again. Real git, annex and DataLad.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

// A runner (Windows CI) has no git identity; datalad refuses to save without one. This file's own, nothing global.
const gitConfig = join(mkdtempSync(join(tmpdir(), 'dlad-removed-cfg-')), 'gitconfig')
writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.org\n')
process.env.GIT_CONFIG_GLOBAL = gitConfig

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const skip = !(has('git', ['annex', 'version']) && has('datalad', ['--version'])) && 'git-annex and datalad are needed'
const run = (cwd, cmd, ...args) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    if (error.stdout) error.message += `\nstdout:\n${error.stdout}`
    throw error
  }
}

// A project with two separately tracked subjects (one name with spaces), cloned; then the source takes `gone` out.
// Non-ASCII subject paths are covered by nest-subdataset-real-annex.test.js.
async function removedUpstream(gone = 'sub-02 with space') {
  const root = await mkdtemp(join(tmpdir(), 'dlad-removed-'))
  const source = join(root, 'source')
  await mkdir(source)
  run(root, 'datalad', 'create', '-c', 'text2git', '--', source)
  for (const sub of ['sub-01', gone]) {
    run(source, 'datalad', 'create', '-d', '.', '--', sub)
    await writeFile(join(source, sub, 'data.json'), '{}')
  }
  run(source, 'datalad', 'save', '-d', '.', '-r', '-m', 'data')
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const project = join(root, 'project')
  assert.equal((await adapter.runCommand('cloneInstall', { source, targetPath: project })).ok, true)
  run(source, 'datalad', 'remove', '-d', '.', '--reckless', 'kill', gone)
  return { root, project, adapter, gone }
}

const tracked = (project) => run(project, 'git', '-c', 'core.quotePath=false', 'ls-tree', '--name-only', 'HEAD')

test('fixture command failures include stdout', () => {
  assert.throws(
    () => run(tmpdir(), process.execPath, '-e', "console.log('fixture error'); process.exit(1)"),
    /stdout:\nfixture error/
  )
})

test('Get updates says which removed folder is still here', { skip }, async () => {
  const { project, adapter, gone } = await removedUpstream()
  const update = await adapter.runCommand('update', { projectPath: project })
  assert.equal(update.ok, true, update.stderr)
  const warning = update.warnings.find((w) => w.code === 'REMOVED_FOLDER_STILL_HERE')
  assert.ok(warning, JSON.stringify(update.warnings))
  assert.ok(warning.message.includes(gone))
  assert.ok(!warning.message.includes('sub-01'))
})

for (const [commandName, extra] of [['save', {}], ['save', { paths: ['notes.txt'] }], ['run', { command: 'git --version' }]]) {
  test(`${commandName} ${JSON.stringify(extra)} refuses while a removed folder is still here`, { skip }, async () => {
    const { project, adapter, gone } = await removedUpstream()
    await adapter.runCommand('update', { projectPath: project })
    await writeFile(join(project, 'notes.txt'), 'mine\n')
    const before = run(project, 'git', 'rev-parse', 'HEAD')

    const result = await adapter.runCommand(commandName, { projectPath: project, message: 'my work', ...extra })

    assert.equal(result.ok, false)
    assert.equal(result.userError.code, 'REMOVED_FOLDER_STILL_HERE')
    assert.ok(result.userError.message.includes(gone))
    assert.equal(run(project, 'git', 'rev-parse', 'HEAD'), before, 'nothing was recorded')
    assert.ok(!tracked(project).includes(gone))
  })
}

test('once the folder is moved out of the project, Save works', { skip }, async () => {
  const { root, project, adapter, gone } = await removedUpstream()
  await adapter.runCommand('update', { projectPath: project })
  await rename(join(project, gone), join(root, 'set-aside'))
  await writeFile(join(project, 'notes.txt'), 'mine\n')

  const result = await adapter.runCommand('save', { projectPath: project, message: 'my work' })

  assert.equal(result.ok, true, JSON.stringify(result.userError ?? result.stderr))
  assert.ok(tracked(project).includes('notes.txt'))
  assert.ok(!tracked(project).includes(gone))
})

test('a removed folder inside a separately tracked folder is refused too', { skip }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-removed-deep-'))
  const project = join(root, 'project')
  run(root, 'datalad', 'create', '-c', 'text2git', '--', project)
  run(project, 'datalad', 'create', '-d', '.', '--', 'sub-01')
  const subject = join(project, 'sub-01')
  run(subject, 'datalad', 'create', '-d', '.', '--', 'ses-1')
  await writeFile(join(subject, 'ses-1', 'data.json'), '{}')
  run(project, 'datalad', 'save', '-d', '.', '-r', '-m', 'data')
  // What an update leaves behind: gone from the history of sub-01, still on disk.
  run(subject, 'git', 'rm', '--cached', '-q', 'ses-1')
  run(subject, 'git', 'commit', '-qm', 'withdraw ses-1')
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })

  const result = await adapter.runCommand('save', { projectPath: project, message: 'my work' })

  assert.equal(result.userError?.code, 'REMOVED_FOLDER_STILL_HERE', result.stderr)
  assert.ok(result.userError.message.includes('sub-01/ses-1'))
})

test('a removed folder that git ignores, or that is empty, does not block Save', { skip }, async () => {
  const { project, adapter, gone } = await removedUpstream('sub-02')
  await adapter.runCommand('update', { projectPath: project })
  await writeFile(join(project, '.git', 'info', 'exclude'), `/${gone}/\n`)
  await mkdir(join(project, 'unrelated-empty'))
  await writeFile(join(project, 'notes.txt'), 'mine\n')

  const result = await adapter.runCommand('save', { projectPath: project, message: 'my work' })

  assert.equal(result.ok, true, JSON.stringify(result.userError ?? result.stderr))
  assert.ok(!tracked(project).includes(gone))
})
