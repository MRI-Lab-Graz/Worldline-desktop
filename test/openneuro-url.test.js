import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openNeuroRepoAddress } from '../src/gui/renderer/openneuro-url.js'
import { mapCommandError } from '../src/datalad/errors.js'
import { DataLadAdapter } from '../src/datalad/adapter.js'

const GH = 'https://github.com/OpenNeuroDatasets/ds000102'

test('an OpenNeuro dataset web page (with or without a version) maps to its repository address', () => {
  for (const page of [
    'https://openneuro.org/datasets/ds000102',
    'https://openneuro.org/datasets/ds000102/versions/00001',
    'https://www.openneuro.org/datasets/ds000102/versions/1.0.0/file-display/README',
    '  https://openneuro.org/datasets/DS000102?foo=1#x  '
  ]) {
    assert.equal(openNeuroRepoAddress(page), GH, page)
  }
})

test('anything else gives null: real repository addresses, other hosts, look-alike hosts, odd ids, other schemes', () => {
  for (const other of [
    GH,
    'https://github.com/OpenNeuroDatasets/ds000102.git',
    'https://openneuro.org.evil.example/datasets/ds000102',
    'https://evil.example/openneuro.org/datasets/ds000102',
    'https://openneuro.org/datasets/ds00010',
    'https://openneuro.org/datasets/ds000102x',
    'https://openneuro.org/datasets/../ds000102',
    'http://openneuro.org/datasets/ds000102',
    'ftp://openneuro.org/datasets/ds000102',
    'gin:lab/study',
    '/Volumes/data/ds000102',
    '',
    undefined
  ]) {
    assert.equal(openNeuroRepoAddress(other), null, String(other))
  }
})

test('a failed clone of an OpenNeuro page says what address to use', () => {
  const error = mapCommandError('cloneInstall', {
    args: ['install', '-r', '-s', 'https://openneuro.org/datasets/ds000102/versions/00001', '--', '/x/flanker'],
    stderr: 'fatal: repository not found',
    stdout: ''
  })
  assert.equal(error.code, 'REPO_NOT_FOUND')
  assert.match(error.message, /OpenNeuro web page/)
  assert.ok(error.message.includes(GH))
})

test('a failed clone of any other address keeps the general message', () => {
  const error = mapCommandError('cloneInstall', { args: ['install', '-s', 'https://example.org/x.git', '--', '/x'], stderr: 'fatal: repository not found', stdout: '' })
  assert.equal(error.code, 'REPO_NOT_FOUND')
  assert.doesNotMatch(error.message, /OpenNeuro/)
})

class FailingRunner {
  async run(command, args = []) {
    return { command, args, exitCode: 1, stdout: '', stderr: 'fatal: repository not found\n', failed: true }
  }
}

test('a clone that failed is not also described as "Clone completed"', async () => {
  const adapter = new DataLadAdapter({ runner: new FailingRunner() })
  const result = await adapter.runCommand('cloneInstall', { source: 'https://openneuro.org/datasets/ds000102', targetPath: '/tmp/ds' })

  assert.equal(result.ok, false)
  assert.deepEqual(result.warnings.filter((w) => w.code === 'CLONE_STDERR_OUTPUT'), [])
})

test('the remote-address field warns about a web page address and offers the repository address as a button', () => {
  const read = (p) => readFileSync(new URL(`../src/gui/renderer/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const html = read('index.html')
  const app = read('app.js')
  assert.match(html, /id="get-remote-url-suggestion"[^>]*hidden/)
  assert.match(html, /id="get-remote-url-use"/)
  assert.match(html, /not a web page/)
  assert.match(app, /import \{ openNeuroRepoAddress \} from '\.\/openneuro-url\.js'/)
  const wiring = app.slice(app.indexOf("elements.getRemoteSourceUrl.addEventListener('input'"))
  assert.ok(wiring.indexOf('openNeuroRepoAddress(') > 0 && wiring.includes('textContent'))
  assert.doesNotMatch(wiring.slice(0, 1200), /innerHTML/)
  assert.match(app, /getRemoteUrlUse\.addEventListener\('click'/)
})
