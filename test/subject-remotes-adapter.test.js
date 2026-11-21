import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

const ORIGIN = 'ssh://datalad/lab/proj'
const FAVS = ['ssh://datalad/lab']

// Answers by prefix; every call is recorded. Remote changes (set-url/add) always succeed.
class Runner {
  constructor(origins) {
    this.origins = origins // path -> url (missing = no origin)
    this.calls = []
  }
  async run(command, args = []) {
    this.calls.push(args)
    const ok = { command, args, exitCode: 0, stdout: '', stderr: '', failed: false }
    if (args[2] === 'remote' && args[3] === 'get-url') {
      const url = this.origins[args[1]]
      return url ? { ...ok, stdout: `${url}\n` } : { ...ok, exitCode: 2, failed: true, stderr: 'No such remote' }
    }
    return ok
  }
  changes() {
    return this.calls.filter((a) => a[2] === 'remote' && a[3] !== 'get-url').map((a) => a.slice(1).join(' '))
  }
}

async function project(installed, registered = installed) {
  const root = await mkdtemp(join(tmpdir(), 'wl-subj-'))
  await writeFile(join(root, '.gitmodules'), registered.map((n) => `[submodule "${n}"]\n\tpath = ${n}\n\turl = ./${n}\n`).join(''))
  for (const n of installed) {
    await mkdir(join(root, n), { recursive: true })
    await writeFile(join(root, n, '.git'), 'gitdir: x\n')
  }
  return root
}
const sshOk = (stdout) => async () => ({ code: 0, stdout, stderr: '', timedOut: false })
const prep = (root, runner, runSsh, favorites = FAVS) =>
  new DataLadAdapter({ runner }).prepareSubjectRemotes(root, { remoteName: 'origin', favorites, runSsh })

test('(a) a local project origin is skipped and ssh is never called', async () => {
  const root = await project(['sub-01'])
  const runner = new Runner({ [root]: '/Volumes/USB/proj' })
  const out = await prep(root, runner, async () => assert.fail('ssh called'))
  assert.equal(out.skipped, 'no-ssh-origin')
  assert.deepEqual(runner.changes(), [])
})

test('(b) an ssh origin outside the favorites is skipped', async () => {
  const root = await project(['sub-01'])
  const runner = new Runner({ [root]: 'ssh://other/lab/proj' })
  const out = await prep(root, runner, async () => assert.fail('ssh called'))
  assert.equal(out.skipped, 'not-a-favorite')
})

test('no installed top-level subjects: skipped, no ssh', async () => {
  const root = await project(['derivatives'])
  const out = await prep(root, new Runner({ [root]: ORIGIN }), async () => assert.fail('ssh called'))
  assert.equal(out.skipped, 'no-subjects')
})

test('(c) one ssh call for the subjects whose origin differs or is missing; only those are pointed', async () => {
  const root = await project(['sub-01', 'sub-02', 'sub-03'])
  const runner = new Runner({
    [root]: ORIGIN,
    [join(root, 'sub-01')]: './sub-01', // drifted
    [join(root, 'sub-03')]: `${ORIGIN}/sub-03` // correct
  }) // sub-02 has no origin
  const sent = []
  const out = await prep(root, runner, async (args) => {
    sent.push(args)
    return { code: 0, stdout: 'created sub-01\nexists sub-02\n', stderr: '', timedOut: false }
  })
  assert.equal(sent.length, 1)
  assert.match(sent[0].at(-1), /'sub-01' 'sub-02'$/)
  assert.doesNotMatch(sent[0].at(-1), /sub-03/)
  assert.deepEqual(out.created, ['sub-01'])
  assert.deepEqual(out.exists, ['sub-02'])
  assert.deepEqual(out.pointed.sort(), ['sub-01', 'sub-02'])
  assert.deepEqual(runner.changes().sort(), [
    `${join(root, 'sub-01')} remote set-url origin ${ORIGIN}/sub-01`,
    `${join(root, 'sub-02')} remote add origin ${ORIGIN}/sub-02`
  ].sort())
})

test('(d) a refused name is reported and not pointed', async () => {
  const root = await project(['sub-01', 'sub-02'])
  const runner = new Runner({ [root]: ORIGIN })
  const out = await prep(root, runner, sshOk('created sub-01\nrefused sub-02 not writable\n'))
  assert.deepEqual(out.refused, [{ name: 'sub-02', reason: 'not writable' }])
  assert.deepEqual(out.pointed, ['sub-01'])
  assert.equal(runner.changes().length, 1)
})

test('(e) ssh exit 255 gives a plain sentence without raw stderr and changes nothing', async () => {
  const root = await project(['sub-01'])
  const runner = new Runner({ [root]: ORIGIN })
  const out = await prep(root, runner, async () => ({ code: 255, stdout: '', stderr: 'user@host: Permission denied (publickey).', timedOut: false }))
  assert.match(out.failed, /did not accept your key/)
  assert.doesNotMatch(out.failed, /publickey|user@host/)
  assert.deepEqual(runner.changes(), [])
  assert.deepEqual(out.pointed, [])
})

test('timeout, rejection and a non-zero exit without lines all fail softly', async () => {
  for (const run of [
    async () => ({ code: 255, stdout: '', stderr: '', timedOut: true }),
    async () => { throw new Error('boom /secret/path') },
    async () => ({ code: 1, stdout: 'banner only\n', stderr: '', timedOut: false })
  ]) {
    const root = await project(['sub-01'])
    const runner = new Runner({ [root]: ORIGIN })
    const out = await prep(root, runner, run)
    assert.equal(typeof out.failed, 'string')
    assert.doesNotMatch(out.failed, /secret|boom/)
    assert.deepEqual(runner.changes(), [])
  }
})

test('(f) uninstalled subjects are not sent to the server', async () => {
  const root = await project(['sub-01'], ['sub-01', 'sub-02'])
  let sent
  await prep(root, new Runner({ [root]: ORIGIN }), async (args) => {
    sent = args.at(-1)
    return { code: 0, stdout: 'created sub-01\n', stderr: '', timedOut: false }
  })
  assert.match(sent, /'sub-01'$/)
  assert.doesNotMatch(sent, /sub-02/)
})

test('names the server prints but we did not ask for are ignored', async () => {
  const root = await project(['sub-01'])
  const runner = new Runner({ [root]: ORIGIN })
  const out = await prep(root, runner, sshOk('created sub-99\nexists sub-98\nrefused sub-97 x\ncreated sub-01\n'))
  assert.deepEqual(out.created, ['sub-01'])
  assert.deepEqual(out.exists, [])
  assert.deepEqual(out.refused, [])
  assert.deepEqual(out.pointed, ['sub-01'])
})

test('the refusal reason is capped to 120 characters and stripped of control characters', async () => {
  const root = await project(['sub-01'])
  const out = await prep(root, new Runner({ [root]: ORIGIN }), sshOk(`refused sub-01 bad\x1b[31m${'x'.repeat(300)}\x07\n`))
  const { reason } = out.refused[0]
  assert.ok(reason.length <= 120)
  assert.doesNotMatch(reason, /[\x00-\x1f\x7f]/)
})

test('an unsafe remote name is refused before anything runs', async () => {
  const root = await project(['sub-01'])
  await assert.rejects(new DataLadAdapter({ runner: new Runner({}) }).prepareSubjectRemotes(root, { remoteName: '-x', favorites: FAVS, runSsh: sshOk('') }), /Invalid remote name/)
})

// --- fix round 1 ---
const originCase = async (current, { subs = ['sub-01'] } = {}) => {
  const root = await project(subs)
  const runner = new Runner({ [root]: ORIGIN, ...(current === undefined ? {} : { [join(root, subs[0])]: current }) })
  let calls = 0
  const out = await prep(root, runner, async () => { calls++; return { code: 0, stdout: `created ${subs[0]}\n`, stderr: '', timedOut: false } })
  return { out, calls, runner }
}

test('origins on another host, another protocol or a local path are kept, not sent, not changed', async () => {
  for (const url of ['https://example.org/x/sub-01', 'ssh://other/lab/proj/sub-01', 'ssh://datalad/lab/other/sub-01', '/Volumes/USB/sub-01', 'datalad:lab/proj/sub-01', 'C:\\data\\sub-01']) {
    const { out, calls, runner } = await originCase(url)
    assert.deepEqual(out.kept, ['sub-01'], url)
    assert.equal(calls, 0, url)
    assert.deepEqual(runner.changes(), [], url)
  }
})

test('missing, relative and same-host same-parent origins are processed; an equal one is not', async () => {
  for (const url of [undefined, './sub-134001', 'ssh://DATALAD/lab/proj/sub-134001']) {
    const { out, calls } = await originCase(url)
    assert.equal(calls, 1, String(url))
    assert.deepEqual(out.pointed, ['sub-01'])
    assert.deepEqual(out.kept, [])
  }
  const same = await originCase(`${ORIGIN}/sub-01`)
  assert.equal(same.calls, 0)
  assert.deepEqual(same.out.kept, [])
})

test('a subject folder that is a symbolic link is not installed: not sent, not changed', { skip: process.platform === 'win32' }, async () => {
  const { symlink } = await import('node:fs/promises')
  const root = await project(['sub-01'])
  const elsewhere = await mkdtemp(join(tmpdir(), 'wl-other-'))
  await writeFile(join(elsewhere, '.git'), 'gitdir: x\n')
  const { rm } = await import('node:fs/promises')
  await rm(join(root, 'sub-01'), { recursive: true })
  await symlink(elsewhere, join(root, 'sub-01'), 'dir')
  const runner = new Runner({ [root]: ORIGIN })
  const out = await prep(root, runner, async () => assert.fail('ssh called'))
  assert.equal(out.skipped, 'no-subjects')
  assert.deepEqual(runner.changes(), [])
})

test('a missing ssh program gets its own plain sentence', async () => {
  const root = await project(['sub-01'])
  const out = await prep(root, new Runner({ [root]: ORIGIN }), async () => { throw Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' }) })
  assert.match(out.failed, /no ssh program/)
  assert.doesNotMatch(out.failed, /know that server/)
})

test('a missing script (ssh exit 127) says the server is not set up, without raw stderr, and changes nothing', async () => {
  const root = await project(['sub-01'])
  const runner = new Runner({ [root]: ORIGIN })
  const out = await prep(root, runner, async () => ({ code: 127, stdout: '', stderr: 'bash: worldline-ensure-subjects: command not found', timedOut: false }))
  assert.match(out.failed, /The lab server is not set up for this yet/)
  assert.match(out.failed, /worldline-ensure-subjects/)
  assert.match(out.failed, /docs\/server-setup\.md/)
  assert.doesNotMatch(out.failed, /bash|command not found/)
  assert.deepEqual(runner.changes(), [])
})
