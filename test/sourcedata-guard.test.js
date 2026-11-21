import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicTarget, pushRefusal } from '../src/datalad/sourcedata-guard.js'

test('isPublicTarget: web URLs, well-known public hosts and their ssh spellings are public', () => {
  for (const url of [
    'https://gin.g-node.org/x',
    'http://lab/x',
    'git://x/y',
    'git@github.com:lab/s.git',
    'ssh://git@gitlab.com/lab/s',
    'ssh://git@gitlab.com:2222/lab/s',
    'git+ssh://github.com/lab/s',
    'git@github.com.:lab/s',
    'git@GitHub.com:lab/s',
    'git@codeberg.org:lab/s',
    'git@openneuro.org:lab/s',
    'git@bitbucket.org:lab/s'
  ]) {
    assert.equal(isPublicTarget(url), true, url)
  }
})

test('isPublicTarget: the lab server, a local path and nothing are not public', () => {
  for (const url of ['ssh://user@lab-server.uni.at/data/s', 'user@10.0.0.5:/data/s', '/Volumes/USB/s', 'C:\\share\\s', '', undefined]) {
    assert.equal(isPublicTarget(url), false, String(url))
  }
})

// A fake runner keyed on the git subcommand.
const runner = ({ tracked = '', remotes = {} }) => ({
  calls: [],
  async run(command, args) {
    this.calls.push([command, ...args])
    const sub = args.slice(2)
    if (sub[0] === 'ls-files') return { failed: false, exitCode: 0, stdout: tracked, stderr: '' }
    if (sub[0] === 'remote' && sub.length === 1) return { failed: false, exitCode: 0, stdout: Object.keys(remotes).join('\n'), stderr: '' }
    if (sub[0] === 'remote' && sub[1] === 'get-url' && !(sub.at(-1) in remotes)) return { failed: true, exitCode: 2, stdout: '', stderr: 'No such remote' }
    if (sub[0] === 'remote' && sub[1] === 'get-url') return { failed: false, exitCode: 0, stdout: `${remotes[sub.at(-1)]}\n`, stderr: '' }
    return { failed: true, exitCode: 1, stdout: '', stderr: 'unexpected' }
  }
})

test('pushRefusal: tracked sourcedata/ and a public remote is refused, naming the remote', async () => {
  const r = runner({ tracked: 'sourcedata/sub-01\n', remotes: { origin: 'git@github.com:lab/s.git' } })
  const refusal = await pushRefusal({ runner: r, projectPath: '/p', remoteName: 'origin' })
  assert.equal(refusal, '"origin" is a public host and this project tracks sourcedata/ (raw data). Send it only to the internal lab server.')
  assert.deepEqual(r.calls[0], ['git', '-C', '/p', 'ls-files', '--', 'sourcedata'])
})

test('pushRefusal: nothing tracked under sourcedata/ means the push may go', async () => {
  const r = runner({ tracked: '', remotes: { origin: 'git@github.com:lab/s.git' } })
  assert.equal(await pushRefusal({ runner: r, projectPath: '/p', remoteName: 'origin' }), null)
})

test('pushRefusal: the internal lab server may get sourcedata/', async () => {
  const r = runner({ tracked: 'sourcedata/a.csv\n', remotes: { origin: 'ssh://user@lab-server.uni.at/data/s' } })
  assert.equal(await pushRefusal({ runner: r, projectPath: '/p', remoteName: 'origin' }), null)
})

test('pushRefusal: no remote named checks every remote and names the public one', async () => {
  const r = runner({ tracked: 'sourcedata/a.csv\n', remotes: { origin: 'ssh://user@lab-server.uni.at/data/s', gh: 'https://github.com/lab/s' } })
  assert.match(await pushRefusal({ runner: r, projectPath: '/p' }), /^"gh" is a public host/)
})

test('pushRefusal: a remote name that git cannot resolve fails closed', async () => {
  const r = runner({ tracked: 'sourcedata/a.csv\n', remotes: {} })
  assert.match(await pushRefusal({ runner: r, projectPath: '/p', remoteName: 'nope' }), /Could not check/)
})

// Wiring: main.js asks the guard before any push command runs and returns the refusal as a failed, unrun result.
import { readFileSync } from 'node:fs'
const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('main.js runs pushRefusal for PUSHES before adapter.runCommand and refuses without running', () => {
  assert.match(main, /import \{ pushRefusal \} from '\.\.\/datalad\/sourcedata-guard\.js'/)
  const guard = main.indexOf('PUSHES.has(payload.commandName)')
  const run = main.indexOf('adapter.runCommand(payload.commandName')
  assert.ok(guard > 0 && run > guard, 'guard must come before the run')
  assert.match(main.slice(guard, run), /pushRefusal\(\{ runner: toolRunner, projectPath: request\.projectPath, remoteName: request\.remoteName \}\)/)
  assert.match(main.slice(guard, run), /code: 'SOURCEDATA_PUBLIC_TARGET'/)
})
