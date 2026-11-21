// Real git, git-annex and DataLad: the "merge a local PRISM dataset into a cloned, nested BIDS project" workflow.
// Clone (nested subjects come along), copy the PRISM files over the project folder, Save once: every subject
// records its own new files and the project records the new subject commits, with nothing left changed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'
import { deleteProjectFolder } from '../src/gui/delete-project.js'

// A runner (Windows CI) has no git identity; datalad refuses to save without one. This file's own, nothing global.
const gitConfig = join(mkdtempSync(join(tmpdir(), 'dlad-merge-prism-cfg-')), 'gitconfig')
writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.org\n')
process.env.GIT_CONFIG_GLOBAL = gitConfig

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const hasTools = has('git', ['annex', 'version']) && has('datalad', ['--version'])
const skip = !hasTools && 'git-annex and datalad are needed'

// Parent-level "is it saved" is asked of datalad: on Windows git-annex puts each subject on an adjusted branch, so a
// plain `git status` in the parent can say "modified" for a subject that is fully saved.
const run = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' })

// A BIDS source whose subject folders are already their own datasets (like the lab's server project).
async function nestedBidsSource() {
  const root = await mkdtemp(join(tmpdir(), 'dlad-merge-prism-'))
  const source = join(root, 'source')
  await mkdir(source)
  run(root, 'datalad', 'create', '-c', 'text2git', '--', source)
  for (const sub of ['sub-134001', 'sub-134002']) {
    run(source, 'datalad', 'create', '-d', '.', '--', sub)
    await mkdir(join(source, sub, 'anat'), { recursive: true })
    await writeFile(join(source, sub, 'anat', `${sub}_T1w.json`), '{}')
    run(join(source, sub), 'datalad', 'save', '-m', 'mri')
  }
  await writeFile(join(source, 'dataset_description.json'), '{"Name":"mri"}')
  run(source, 'datalad', 'save', '-d', '.', '-r', '-m', 'mri project')
  return { root, source }
}

test('PRISM files copied over a nested clone are saved into each subject in one Save', { skip }, async () => {
  const { root, source } = await nestedBidsSource()
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const project = join(root, 'project')
  const clone = await adapter.runCommand('cloneInstall', { source, targetPath: project })
  assert.equal(clone.ok, true, JSON.stringify(clone.userError ?? clone.stderr))

  // The PRISM data, already renamed to the MRI IDs, copied over the project folder the way a file manager would.
  const prism = join(root, 'prism')
  for (const sub of ['sub-134001', 'sub-134002']) {
    await mkdir(join(prism, sub, 'survey'), { recursive: true })
    await writeFile(join(prism, sub, 'survey', `${sub}_survey.tsv`), 'a\tb\n1\t2\n')
  }
  await cp(prism, project, { recursive: true })

  const save = await adapter.runCommand('save', { projectPath: project, message: 'Add PRISM data' })
  assert.equal(save.ok, true, JSON.stringify(save.userError ?? save.stderr))

  for (const sub of ['sub-134001', 'sub-134002']) {
    const subPath = join(project, sub)
    assert.equal(run(subPath, 'git', 'status', '--porcelain').trim(), '', `${sub} still has changes`)
    assert.match(run(subPath, 'git', 'ls-files'), new RegExp(`survey/${sub}_survey.tsv`), `${sub} did not record its file`)
  }
  assert.match(run(project, 'datalad', 'status'), /nothing to save/, 'the project still shows changes')
  assert.equal(await readFile(join(project, 'dataset_description.json'), 'utf8'), '{"Name":"mri"}')
})

// Deleting the local clone must never reach the place it was cloned from (here a folder; for a lab, a server).
test('deleting the clone leaves its source intact, nested subjects included', { skip }, async () => {
  const { root, source } = await nestedBidsSource()
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const project = join(root, 'project')
  assert.equal((await adapter.runCommand('cloneInstall', { source, targetPath: project })).ok, true)

  await deleteProjectFolder(project, { roots: [project], home: join(root, 'home') })

  assert.equal(await stat(project).then(() => true, () => false), false)
  assert.match(run(source, 'datalad', 'status'), /nothing to save/)
  assert.equal(run(source, 'git', 'fsck', '--no-progress').includes('error'), false)
  for (const sub of ['sub-134001', 'sub-134002']) {
    assert.match(run(join(source, sub), 'git', 'ls-files'), new RegExp(`anat/${sub}_T1w.json`))
    assert.equal(await readFile(join(source, sub, 'anat', `${sub}_T1w.json`), 'utf8'), '{}')
  }
  assert.equal(await readFile(join(source, 'dataset_description.json'), 'utf8'), '{"Name":"mri"}')
})

// "Send my saves" must carry the subjects' own commits, not only the project's.
test('sending a project also sends the commits inside its nested subjects', { skip }, async () => {
  const { root, source } = await nestedBidsSource()
  for (const dir of [source, join(source, 'sub-134001'), join(source, 'sub-134002')]) {
    run(dir, 'git', 'config', 'receive.denyCurrentBranch', 'updateInstead')
  }
  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const project = join(root, 'project')
  assert.equal((await adapter.runCommand('cloneInstall', { source, targetPath: project })).ok, true)
  await mkdir(join(project, 'sub-134001', 'survey'), { recursive: true })
  await writeFile(join(project, 'sub-134001', 'survey', 'psqi.tsv'), 'a\n1\n')
  assert.equal((await adapter.runCommand('save', { projectPath: project, message: 'Add survey' })).ok, true)

  const sent = await adapter.runCommand('push', { projectPath: project, remoteName: 'origin' })
  assert.equal(sent.ok, true, JSON.stringify(sent.userError ?? sent.stderr))
  assert.match(run(join(source, 'sub-134001'), 'git', 'ls-files'), /survey\/psqi\.tsv/)
})
