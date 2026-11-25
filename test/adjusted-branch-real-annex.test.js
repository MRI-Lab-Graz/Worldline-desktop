// Real git, git-annex and DataLad. On Windows git-annex keeps every dataset on an adjusted branch
// ("adjusted/master(unlocked)"): the clone has no upstream there, and each nested dataset sits one git-annex commit
// above the version the project records. `git annex adjust` makes the same situation on any platform.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

const gitConfig = join(mkdtempSync(join(tmpdir(), 'dlad-adjusted-cfg-')), 'gitconfig')
writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.org\n')
process.env.GIT_CONFIG_GLOBAL = gitConfig

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const skip = (!has('git', ['annex', 'version']) || !has('datalad', ['--version'])) && 'git-annex and datalad are needed'
const sh = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const branch = (dir) => sh(dir, 'git', 'branch', '--show-current')
const adjust = (dir) => { if (!branch(dir).startsWith('adjusted/')) sh(dir, 'git', 'annex', 'adjust', '--unlock') }

// A downloaded project with one nested subject, both on adjusted branches.
function downloadedProject() {
  const root = mkdtempSync(join(tmpdir(), 'dlad-adjusted-'))
  const server = join(root, 'server')
  const project = join(root, 'study')
  sh(root, 'datalad', 'create', server)
  sh(server, 'datalad', 'create', '-d', '.', 'sub-01')
  writeFileSync(join(server, 'sub-01', 'a.nii'), 'x'.repeat(2048))
  sh(server, 'datalad', 'save', '-r', '-m', 'data')
  sh(root, 'datalad', 'clone', server, project)
  sh(project, 'datalad', 'get', '-n', '-r', '.')
  adjust(join(project, 'sub-01'))
  adjust(project)
  return { server, project, sub: join(project, 'sub-01') }
}

test('a download on an adjusted branch knows its remote and counts only the person’s own saves', { skip }, async () => {
  const { project } = downloadedProject()
  const adapter = new DataLadAdapter()
  const before = await adapter.getProjectHealth(project)
  assert.equal(before.hasUpstream, true)
  assert.match(before.upstream, /^origin\//)
  assert.deepEqual([before.ahead, before.behind], [0, 0])

  writeFileSync(join(project, 'notes.txt'), 'mine\n')
  sh(project, 'datalad', 'save', '-m', 'notes')
  assert.equal((await adapter.getProjectHealth(project)).ahead, 1)
})

test('a nested dataset that only sits on its adjusted branch is not an unsaved change', { skip }, async () => {
  const { project, sub } = downloadedProject()
  const adapter = new DataLadAdapter()
  assert.match(sh(project, 'git', 'status', '--porcelain'), /sub-01/, 'git itself reports it')
  const fresh = await adapter.getWorkingTreeStatus(project)
  assert.deepEqual([fresh.clean, fresh.totalChanged, fresh.unstagedCount, fresh.files], [true, 0, 0, []])

  writeFileSync(join(sub, 'new.json'), '{}\n')
  assert.deepEqual((await adapter.getWorkingTreeStatus(project)).files.map((f) => f.path), ['sub-01'])
  sh(project, 'datalad', 'save', '-r', '-m', 'enrich')
  assert.equal((await adapter.getWorkingTreeStatus(project)).clean, true)
})

test('a nested dataset with a save the project has not recorded still shows', { skip }, async () => {
  const { project, sub } = downloadedProject()
  writeFileSync(join(sub, 'new.json'), '{}\n')
  sh(sub, 'datalad', 'save', '-m', 'only in the subject')
  const status = await new DataLadAdapter().getWorkingTreeStatus(project)
  assert.deepEqual(status.files.map((f) => f.path), ['sub-01'])
})

test('Send and Get updates work from a freshly downloaded adjusted branch', { skip }, async () => {
  const { server, project } = downloadedProject()
  for (const repo of [server, join(server, 'sub-01')]) sh(repo, 'git', 'config', 'receive.denyCurrentBranch', 'updateInstead')
  writeFileSync(join(project, 'notes.txt'), 'mine\n')
  sh(project, 'datalad', 'save', '-m', 'notes')

  const adapter = new DataLadAdapter()
  const sent = await adapter.runCommand('push', { projectPath: project })
  assert.equal(sent.ok, true, sent.stdout + sent.stderr)
  assert.equal((await adapter.getProjectHealth(project)).ahead, 0)
  const updated = await adapter.runCommand('update', { projectPath: project })
  assert.equal(updated.ok, true, updated.stdout + updated.stderr)
})
