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
  assert.ok(!/chmod|umask|chgrp/.test(src.replace(/^\s*#.*$/gm, '')))
})
