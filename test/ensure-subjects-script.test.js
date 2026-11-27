// Runs server/worldline-ensure-subjects (bash) against a temporary root.
import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SCRIPT = path.join(__dirname, '..', 'server', 'worldline-ensure-subjects')
const have = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0
const skip = process.platform === 'win32' ? 'bash script, not run on Windows'
  : !have('bash', ['-c', 'true']) ? 'bash missing'
  : !have('git', ['--version']) ? 'git missing' : false
// Only the tests that really create a subject (git annex init) need git-annex; the refusal tests do not.
const haveAnnex = have('git', ['annex', 'version'])
const skipAnnex = skip || (haveAnnex ? false : 'git-annex missing')

function setup () {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-ens-')))
  const root = path.join(tmp, 'root')
  const project = path.join(root, 'proj')
  fs.mkdirSync(project, { recursive: true })
  const cfg = path.join(tmp, 'gitconfig')
  fs.writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.org\n')
  const env = { ...process.env, WORLDLINE_ROOT: root, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' }
  assert.strictEqual(spawnSync('git', ['init', '-q', project], { env }).status, 0)
  const run = (...args) => {
    const r = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' })
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), err: r.stderr }
  }
  return { tmp, root, project, run, env }
}
const git = (env, dir, ...a) => spawnSync('git', ['-C', dir, ...a], { env, encoding: 'utf8' }).stdout.trim()

test('creates a subject dataset and reports created', { skip: skipAnnex }, () => {
  const s = setup()
  const r = s.run(s.project, 'sub-001')
  assert.deepStrictEqual(r.out, ['created sub-001'])
  assert.strictEqual(r.code, 0)
  const dir = path.join(s.project, 'sub-001')
  assert.ok(fs.existsSync(path.join(dir, '.git')))
  assert.strictEqual(git(s.env, dir, 'config', 'receive.denyCurrentBranch'), 'updateInstead')
  assert.ok(fs.existsSync(path.join(dir, '.git', 'annex')))
})

test('second run reports exists and changes nothing', { skip: skipAnnex }, () => {
  const s = setup()
  s.run(s.project, 'sub-001')
  const dir = path.join(s.project, 'sub-001')
  const before = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8')
  const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8')
  const r = s.run(s.project, 'sub-001')
  assert.deepStrictEqual(r.out, ['exists sub-001'])
  assert.strictEqual(r.code, 0)
  assert.strictEqual(fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'), before)
  assert.strictEqual(fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8'), head)
})

test('a non-dataset folder, a file and a symlink are refused and untouched', { skip }, () => {
  const s = setup()
  fs.mkdirSync(path.join(s.project, 'sub-002'))
  fs.writeFileSync(path.join(s.project, 'sub-002', 'keep.txt'), 'x')
  fs.writeFileSync(path.join(s.project, 'sub-003'), 'f')
  fs.symlinkSync(s.tmp, path.join(s.project, 'sub-004'))
  const r = s.run(s.project, 'sub-002', 'sub-003', 'sub-004')
  assert.strictEqual(r.code, 1)
  assert.strictEqual(r.out.length, 3)
  for (const l of r.out) assert.match(l, /^refused sub-00[234] exists but is not a dataset$/)
  assert.deepStrictEqual(fs.readdirSync(path.join(s.project, 'sub-002')), ['keep.txt'])
  assert.ok(fs.lstatSync(path.join(s.project, 'sub-004')).isSymbolicLink())
  assert.ok(!fs.existsSync(path.join(s.tmp, '.git')))
})

test('hostile names are refused and create nothing', { skip }, () => {
  const s = setup()
  const bad = ['../evil', 'sub-../x', 'sub-a/b', '-rf', '--help', 'sub-', 'sub-$(touch pwned)', 'sub-a;b', 'sub- a', 'sub-.x', 'sub-' + 'a'.repeat(64), 'Sub-001', 'x', '.', 'sub-1\ncreated sub-evil', 'sub-2\n', '', 'created sub-x']
  const r = s.run(s.project, ...bad)
  assert.strictEqual(r.code, 1)
  assert.strictEqual(r.out.length, bad.length)
  for (const l of r.out) assert.match(l, /^refused /)
  assert.ok(r.out.includes('refused (empty) name not allowed'))
  assert.deepStrictEqual(fs.readdirSync(s.project).sort(), ['.git'])
  assert.deepStrictEqual(fs.readdirSync(s.root), ['proj'])
  assert.ok(!fs.existsSync('pwned'))
})

test('a bad project is an error with exit 2 and creates nothing', { skip }, () => {
  const s = setup()
  const outside = path.join(s.tmp, 'outside'); fs.mkdirSync(outside); git(s.env, outside, 'init', '-q')
  const nogit = path.join(s.root, 'nogit'); fs.mkdirSync(nogit)
  const link = path.join(s.root, 'link'); fs.symlinkSync(s.project, link)
  const nested = path.join(s.project, 'deep'); fs.mkdirSync(path.join(nested, '.git'), { recursive: true })
  for (const p of [outside, nogit, link, nested, 'proj', s.root, '']) {
    const r = s.run(p, 'sub-001')
    assert.strictEqual(r.code, 2, p)
    assert.match(r.out[0], /^error /, p)
  }
  assert.strictEqual(s.run().code, 2)
  for (const d of [outside, nogit, s.project, nested]) assert.ok(!fs.existsSync(path.join(d, 'sub-001')))
})

test('one refused name does not stop the others', { skip: skipAnnex }, () => {
  const s = setup()
  const r = s.run(s.project, 'sub-001', '../x', 'sub-002')
  assert.strictEqual(r.code, 1)
  assert.deepStrictEqual(r.out, ['created sub-001', 'refused ../x name not allowed', 'created sub-002'])
})

test('a failed setup removes only the folder this run made', { skip }, () => {
  const s = setup()
  const env = { ...s.env, PATH: fs.mkdtempSync(path.join(s.tmp, 'bin-')) }
  for (const c of ['git', 'mkdir', 'rm', 'dirname', 'tr']) {
    const real = spawnSync('bash', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim()
    if (c !== 'git') fs.symlinkSync(real, path.join(env.PATH, c))
  }
  // git shim that fails on `annex`
  fs.writeFileSync(path.join(env.PATH, 'git'), '#!/bin/sh\ncase " $* " in *" annex "*) exit 1;; esac\nexec ' + spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim() + ' "$@"\n', { mode: 0o755 })
  fs.mkdirSync(path.join(s.project, 'sub-009'))
  const r = spawnSync('/bin/bash', [SCRIPT, s.project, 'sub-001', 'sub-009'], { env, encoding: 'utf8' })
  assert.strictEqual(r.status, 1)
  assert.match(r.stdout, /^refused sub-001 /m)
  assert.ok(!fs.existsSync(path.join(s.project, 'sub-001')), 'half-made folder removed')
  assert.ok(fs.existsSync(path.join(s.project, 'sub-009')), 'pre-existing folder kept')
  assert.match(r.stdout, /^refused sub-001 setup failed$/m)
  if (haveAnnex) assert.deepStrictEqual(s.run(s.project, 'sub-001').out, ['created sub-001'])
})

test('script has no force/recursive-delete shortcuts and one guarded rm', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  for (const w of ['-rf', '--force', '--existing', 'rmdir', 'eval ']) assert.ok(!src.includes(w), w)
  const rms = src.match(/\brm\b/g) || []
  assert.strictEqual(rms.length, 1)
  assert.strictEqual(src.split('rm -r -- "$target"').length, 2)
  // The only permission steps: a group-friendly umask for a group-shared project, and making the new hook runnable.
  const code = src.replace(/^\s*#.*$/gm, '')
  assert.ok(!/chgrp|chown|setfacl/.test(code))
  assert.deepStrictEqual(code.match(/\b(chmod|umask)\b[^&|;\n]*/g), ['umask 002', 'umask 002', 'chmod +x "$hook"'])
})

// A group-shared project: core.sharedRepository plus a setgid folder, so new things get the project's group.
function shared ({ config = 'group', setgid = true } = {}) {
  const s = setup()
  if (config) git(s.env, s.project, 'config', 'core.sharedRepository', config)
  fs.chmodSync(s.project, setgid ? 0o2770 : 0o770)
  // the usual server umask, whatever the test machine has
  s.run = (...args) => {
    const r = spawnSync('bash', ['-c', 'umask 022; exec bash "$0" "$@"', SCRIPT, ...args], { env: s.env, encoding: 'utf8' })
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), err: r.stderr }
  }
  s.dir = path.join(s.project, 'sub-001')
  s.hook = path.join(s.dir, '.git', 'hooks', 'push-to-checkout')
  return s
}
const mode = (p) => fs.statSync(p).mode & 0o7777
const groupWrites = (p) => (mode(p) & 0o020) !== 0
// A colleague's computer: commits one file and sends it with the usual server umask.
function send (s, from, file, text, branch = 'master') {
  if (!fs.existsSync(from)) assert.strictEqual(spawnSync('git', ['init', '-q', from], { env: s.env }).status, 0)
  fs.mkdirSync(path.dirname(path.join(from, file)), { recursive: true })
  fs.writeFileSync(path.join(from, file), text)
  git(s.env, from, 'add', '-A')
  git(s.env, from, 'commit', '-qm', text)
  return spawnSync('bash', ['-c', 'umask 022; exec git -C "$0" push -q "$1" "HEAD:$2"', from, s.dir, branch], { env: s.env, encoding: 'utf8' })
}

test('in a group-shared project a new subject and everything sent to it stays group-writable', { skip: skipAnnex }, () => {
  const s = shared()
  assert.deepStrictEqual(s.run(s.project, 'sub-001').out, ['created sub-001'])
  assert.ok(['1', 'group'].includes(git(s.env, s.dir, 'config', 'core.sharedRepository')))
  assert.ok(groupWrites(s.dir) && groupWrites(path.join(s.dir, '.git')) && groupWrites(path.join(s.dir, '.git', 'hooks')))
  assert.ok((mode(s.hook) & 0o100) !== 0, 'hook is executable')
  const from = path.join(s.tmp, 'colleague')
  // the first send arrives in a repository that has no commit yet
  const first = send(s, from, 'ses-1/a.tsv', 'one')
  assert.strictEqual(first.status, 0, first.stderr)
  assert.strictEqual(fs.readFileSync(path.join(s.dir, 'ses-1', 'a.tsv'), 'utf8'), 'one')
  assert.ok(groupWrites(path.join(s.dir, 'ses-1')) && groupWrites(path.join(s.dir, 'ses-1', 'a.tsv')))
  const second = send(s, from, 'ses-2/b.tsv', 'two')
  assert.strictEqual(second.status, 0, second.stderr)
  assert.ok(groupWrites(path.join(s.dir, 'ses-2')) && groupWrites(path.join(s.dir, 'ses-2', 'b.tsv')))
})

test('the hook still refuses to overwrite a change made on the server', { skip: skipAnnex }, () => {
  const s = shared()
  s.run(s.project, 'sub-001')
  const from = path.join(s.tmp, 'colleague')
  send(s, from, 'a.tsv', 'one')
  fs.writeFileSync(path.join(s.dir, 'a.tsv'), 'edited on the server')
  const r = send(s, from, 'a.tsv', 'two')
  assert.notStrictEqual(r.status, 0)
  assert.strictEqual(fs.readFileSync(path.join(s.dir, 'a.tsv'), 'utf8'), 'edited on the server')
})

test('a project that is not fully group-shared gets no wider permissions', { skip: skipAnnex }, () => {
  for (const options of [{ config: null }, { setgid: false }, { config: 'umask' }]) {
    const s = shared(options)
    assert.deepStrictEqual(s.run(s.project, 'sub-001').out, ['created sub-001'])
    assert.ok(!groupWrites(s.dir) && !groupWrites(path.join(s.dir, '.git')), JSON.stringify(options))
    assert.ok(!fs.existsSync(s.hook), JSON.stringify(options))
    assert.strictEqual(git(s.env, s.dir, 'config', 'core.sharedRepository'), '', JSON.stringify(options))
  }
})

test('a new subject uses the project\'s branch, so a send shows up on the server', { skip: skipAnnex }, () => {
  for (const branch of ['main', 'master']) {
    const s = shared()
    git(s.env, s.project, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`)
    s.run(s.project, 'sub-001')
    assert.strictEqual(git(s.env, s.dir, 'symbolic-ref', 'HEAD'), `refs/heads/${branch}`)
    const r = send(s, path.join(s.tmp, 'colleague'), 'a.tsv', 'one', branch)
    assert.strictEqual(r.status, 0, r.stderr)
    assert.strictEqual(fs.readFileSync(path.join(s.dir, 'a.tsv'), 'utf8'), 'one')
  }
})

test('the server script keeps Unix line endings in every checkout, also on Windows', { skip: !have('git', ['--version']) && 'git missing' }, () => {
  const r = spawnSync('git', ['check-attr', 'eol', '--', 'server/worldline-ensure-subjects'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
  assert.match(r.stdout, /: eol: lf\s*$/)
  assert.ok(!fs.readFileSync(SCRIPT).includes('\r'))
})
