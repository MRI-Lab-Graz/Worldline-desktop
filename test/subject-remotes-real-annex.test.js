// Real git, git-annex, DataLad and the real server script: the incident end to end. A subject renamed in the clone
// plus a brand-new one, then Send: the server gets both folders, the project push is accepted, and it is repeatable.
// "ssh" is faked by running the remote command locally; pushInsteadOf lands pushes to ssh://testhost/<abs> in /<abs>
// (not insteadOf: that would also rewrite `git remote get-url`, which the app reads to decide what to prepare).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

// This file's own git identity and URL redirect (Windows CI has no identity); nothing global.
const gitConfig = join(mkdtempSync(join(tmpdir(), 'dlad-subject-remotes-cfg-')), 'gitconfig')
writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.org\n[url "/"]\n\tpushInsteadOf = ssh://testhost/\n')
process.env.GIT_CONFIG_GLOBAL = gitConfig

// A fake `ssh` for git and datalad: it drops the options and the host and runs the remote command here.
const fakeBin = mkdtempSync(join(tmpdir(), 'dlad-subject-remotes-ssh-'))
writeFileSync(join(fakeBin, 'ssh'), `#!/bin/sh
case " $* " in *" -fN "*|*" -O "*) exit 0;; esac
while [ $# -gt 0 ]; do
  case "$1" in -o|-p|-i|-l|-S) shift 2;; -*) shift;; *) break;; esac
done
shift
exec sh -c "$*"
`, { mode: 0o755 })
process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH}`

const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const skip = (process.platform === 'win32' || !has('bash', ['--version']) || !has('git', ['annex', 'version']) || !has('datalad', ['--version']))
  && 'bash, git-annex and datalad are needed (not on Windows)'

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server')
const run = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
const head = (dir) => run(dir, 'git', 'rev-parse', 'HEAD').trim()

test('a renamed and a new subject reach the server when sending', { skip }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dlad-subject-remotes-')))
  const serverRoot = join(root, 'server')
  await mkdir(serverRoot)
  const serverProject = join(serverRoot, 'study')
  run(serverRoot, 'datalad', 'create', '--', serverProject)
  run(serverProject, 'datalad', 'create', '-d', '.', '--', 'sub-134001')
  await writeFile(join(serverProject, 'sub-134001', 'a.txt'), 'old subject\n')
  run(join(serverProject, 'sub-134001'), 'datalad', 'save', '-m', 'old')
  run(serverProject, 'datalad', 'save', '-d', '.', '-r', '-m', 'project')
  for (const d of [serverProject, join(serverProject, 'sub-134001')]) {
    run(d, 'git', 'config', 'receive.denyCurrentBranch', 'updateInstead')
  }
  const oldHead = head(join(serverProject, 'sub-134001'))

  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const project = join(root, 'study')
  const cloned = await adapter.runCommand('cloneInstall', { source: serverProject, targetPath: project })
  assert.equal(cloned.ok, true, JSON.stringify(cloned.userError ?? cloned.stderr))
  const addr = `ssh://testhost${serverProject}`
  run(project, 'git', 'remote', 'set-url', 'origin', addr)
  run(join(project, 'sub-134001'), 'git', 'remote', 'set-url', 'origin', `${addr}/sub-134001`)

  // The incident: rename in the clone, plus a brand-new subject.
  await adapter.runCommand('save', { projectPath: project, message: 'before' })
  run(project, 'mv', 'sub-134001', 'sub-001')
  run(project, 'datalad', 'create', '-d', '.', '--', 'sub-002')
  await writeFile(join(project, 'sub-002', 'b.txt'), 'new subject\n')
  run(join(project, 'sub-002'), 'datalad', 'save', '-m', 'new')
  const saved = await adapter.runCommand('save', { projectPath: project, message: 'rename and add' })
  assert.equal(saved.ok, true, JSON.stringify(saved.userError ?? saved.stderr))

  let sshCalls = 0
  const runSsh = (args) => new Promise((resolve) => {
    sshCalls += 1
    const child = spawn('sh', ['-c', args[args.length - 1]], {
      env: { ...process.env, PATH: `${serverDir}${delimiter}${process.env.PATH}`, WORLDLINE_ROOT: serverRoot }
    })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => resolve({ code, stdout, stderr, timedOut: false }))
  })
  const prepared = await adapter.prepareSubjectRemotes(project, { remoteName: 'origin', favorites: [`ssh://testhost${serverRoot}`], runSsh })
  assert.deepEqual([...prepared.created].sort(), ['sub-001', 'sub-002'], JSON.stringify(prepared))
  assert.deepEqual([...prepared.pointed].sort(), ['sub-001', 'sub-002'])
  for (const s of ['sub-001', 'sub-002']) {
    assert.equal(run(join(project, s), 'git', 'config', 'remote.origin.url').trim(), `${addr}/${s}`)
  }

  const sent = await adapter.runCommand('push', { projectPath: project, remoteName: 'origin' })
  assert.equal(sent.ok, true, JSON.stringify(sent.userError ?? sent.stderr))

  for (const s of ['sub-001', 'sub-002']) {
    const server = join(serverProject, s)
    assert.equal(head(server), head(join(project, s)), `${s} commit did not arrive`)
    assert.equal(run(server, 'git', 'rev-parse', '--is-inside-work-tree').trim(), 'true')
  }
  assert.match(run(join(serverProject, 'sub-001'), 'git', 'ls-files'), /a\.txt/)
  assert.match(run(join(serverProject, 'sub-002'), 'git', 'ls-files'), /b\.txt/)
  assert.equal(head(join(serverProject, 'sub-134001')), oldHead, 'the old folder must stay untouched')
  assert.match(run(project, 'datalad', 'status'), /nothing to save/)

  const fresh = join(root, 'fresh')
  run(root, 'datalad', 'install', '-r', '-s', serverProject, fresh)
  // Annexed files arrive as links until fetched: fetching proves the data reached the new server folders too.
  run(fresh, 'datalad', 'get', '-r', '--', 'sub-001', 'sub-002')
  assert.equal(await readFile(join(fresh, 'sub-001', 'a.txt'), 'utf8'), 'old subject\n')
  assert.equal(await readFile(join(fresh, 'sub-002', 'b.txt'), 'utf8'), 'new subject\n')

  // Second Send: nothing to prepare, push still fine.
  const before = sshCalls
  await adapter.prepareSubjectRemotes(project, { remoteName: 'origin', favorites: [`ssh://testhost${serverRoot}`], runSsh })
  assert.equal(sshCalls, before, 'second send must not call ssh')
  const again = await adapter.runCommand('push', { projectPath: project, remoteName: 'origin' })
  assert.equal(again.ok, true, JSON.stringify(again.userError ?? again.stderr))
})
