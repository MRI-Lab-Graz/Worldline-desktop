import test from 'node:test'
import assert from 'node:assert/strict'
import { launchProjectPath } from '../src/gui/launch-path.js'

test('launchProjectPath: the first absolute path after the app arguments', () => {
  assert.equal(launchProjectPath(['/Applications/W', '/data/study']), '/data/study')
  assert.equal(launchProjectPath(['w.exe', 'C:\\data\\study']), 'C:\\data\\study')
})

test('launchProjectPath: flags, relative paths and nothing give null', () => {
  assert.equal(launchProjectPath(['/app']), null)
  assert.equal(launchProjectPath(['/app', '--inspect=1', 'study']), null)
  assert.equal(launchProjectPath(['/app', '--no-sandbox', '/data/study']), '/data/study')
  assert.equal(launchProjectPath([]), null)
  assert.equal(launchProjectPath(undefined), null)
})

test('the launch path travels main -> preload -> renderer on the channels both sides use', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (f) => readFileSync(new URL(`../src/gui/${f}`, import.meta.url), 'utf8')
  assert.match(read('main.js'), /handle\('launch:takePending'/)
  assert.match(read('main.js'), /send\('launch:open'/)
  assert.match(read('preload.js'), /invoke\('launch:takePending'/)
  assert.match(read('preload.js'), /on\('launch:open'/)
  assert.match(read('renderer/app.js'), /api\.takeLaunchPath\(\)/)
})
