import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('src/gui/main.js')
const preload = read('src/gui/preload.js')
const app = read('src/gui/renderer/app.js')

test('the link handler checks the authorized root, then calls the adapter', () => {
  const start = main.indexOf("handle('adapter:linkSubdatasetSource'")
  assert.notEqual(start, -1)
  const body = main.slice(start, main.indexOf('\n})\n', start))
  assert.match(body, /requireAuthorizedRoot\(payload\.projectPath\)/)
  assert.ok(body.includes('adapter.linkSubdatasetSource(payload.projectPath, payload.relativePath)'))
})

test('preload exposes the link call on its own channel', () => {
  assert.match(preload, /linkSubdatasetSource: \(projectPath, relativePath\) =>\s*ipcRenderer\.invoke\('adapter:linkSubdatasetSource', \{ projectPath, relativePath \}\)/)
})

// Automatic nesting after a download and the manual "Convert to subdataset" both create the subdataset.
test('both nesting paths link the new subdataset to the project source after saving it', () => {
  assert.equal(app.split('api.linkSubdatasetSource(').length - 1, 2)
})
