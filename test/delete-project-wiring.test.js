import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('../src/gui/main.js')
const preload = read('../src/gui/preload.js')
const start = main.indexOf("handle('adapter:deleteProject'")
const block = start < 0 ? '' : main.slice(start, main.indexOf('\nhandle(', start + 10))

test('deleteProject checks in this order: opened root, exact name, native confirmation, then deletes', () => {
  const order = ['requireAuthorizedRoot(', 'assertDeletableProject(', 'projectNameMatches(', 'confirmNative(', 'deleteProjectFolder(']
  const at = order.map((needle) => block.indexOf(needle))
  assert.ok(at.every((i) => i >= 0), `missing step: ${JSON.stringify(at)}`)
  assert.deepEqual([...at].sort((a, b) => a - b), at)
  assert.match(block, /confirmLabel: 'Delete project'/)
})

test('after a delete the folder is no longer an authorized root', () => {
  assert.match(block, /authorizedRoots\.delete\(/)
})

test('the preview channel is guarded the same way and tells the page what a delete would lose', () => {
  const p = main.indexOf("handle('adapter:getDeletionPreview'")
  const preview = p < 0 ? '' : main.slice(p, main.indexOf('\nhandle(', p + 10))
  assert.ok(preview.indexOf('requireAuthorizedRoot(') > 0 && preview.indexOf('assertDeletableProject(') > preview.indexOf('requireAuthorizedRoot('))
  assert.match(preview, /getDeletionRisk\(/)
  assert.match(preview, /folderSize\(/)
})

test('the page can reach both through the preload bridge', () => {
  assert.match(preload, /deleteProject: .*ipcRenderer\.invoke\('adapter:deleteProject'/)
  assert.match(preload, /getDeletionPreview: .*ipcRenderer\.invoke\('adapter:getDeletionPreview'/)
})

test('the file watcher on the project is stopped before the folder goes (Windows cannot delete a watched folder)', () => {
  const stop = block.indexOf('activeProjectWatcher.stop()')
  assert.ok(stop > 0 && stop < block.indexOf('deleteProjectFolder('))
})

test('names and paths from the disk are cleaned of line breaks and bidi tricks before they go into the native dialog', () => {
  const ask = block.slice(block.indexOf('confirmNative('), block.indexOf('if (!confirmed)'))
  assert.match(ask, /previewPaths\(\[basename\(target\)\]\)/)
  assert.match(ask, /previewPaths\(\[target\]\)/)
  assert.doesNotMatch(ask, /\$\{target\}|\$\{basename\(target\)\}/)
})
