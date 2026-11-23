import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('../src/gui/main.js')
const preload = read('../src/gui/preload.js')
const app = read('../src/gui/renderer/app.js')
const html = read('../src/gui/renderer/index.html')

test('the main process lists server folders only through ssh-browse, read-only and with no folder of ours', () => {
  assert.match(main, /import \{ listSshFolders, runSsh \} from '\.\/ssh-browse\.js'/)
  assert.match(main, /handle\('ssh:listFolders', async \(_event, address\) => listSshFolders\(address\)\)/)
})

test('the page can ask for a server listing, and Browse opens it for ssh:// addresses only', () => {
  assert.match(preload, /listSshFolders: \(address\) => ipcRenderer\.invoke\('ssh:listFolders', address\)/)
  assert.match(app, /sshBrowse\(/)
  assert.match(html, /id="ssh-browse-overlay"/)
  assert.match(html, /id="ssh-browse-list"/)
})

test('server folder names are shown as text, never as HTML', () => {
  const at = app.indexOf('function renderSshBrowse')
  assert.ok(at !== -1)
  const body = app.slice(at, app.indexOf('\n}\n', at))
  assert.match(body, /textContent/)
  assert.doesNotMatch(body, /innerHTML/)
})
