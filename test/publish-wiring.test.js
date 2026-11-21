import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// datalad push without --to has to guess the target and could not on Windows ("No push target given"),
// so the push never succeeded and the versions were never sent. The app knows the remote: it says so.
test('Publish pushes to the project\'s named remote instead of letting datalad guess', () => {
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const handler = app.slice(app.indexOf('elements.publishProjectButton.addEventListener'))
  const push = handler.indexOf("runWorkflowCommand('push'")
  const name = handler.indexOf('remoteNameForProject(')
  assert.ok(name !== -1 && name < push, 'the remote is looked up before the push')
  assert.match(handler.slice(push, push + 120), /\{ projectPath, remoteName \}/)
})

test('Send sets up the server folders of nested subjects before it pushes, and a failure never blocks the push', () => {
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const handler = app.slice(app.indexOf('elements.publishProjectButton.addEventListener'))
  const prepare = handler.indexOf('api.prepareSubjectRemotes(projectPath, remoteName, favorites.map((f) => f.address))')
  const push = handler.indexOf("runWorkflowCommand('push'")
  assert.ok(prepare !== -1 && prepare < push, 'subject folders first, then the push')
  assert.match(handler.slice(Math.max(0, prepare - 80), prepare), /try \{/)
  assert.match(handler.slice(prepare, push), /catch/)
  const preload = readFileSync(new URL('../src/gui/preload.js', import.meta.url), 'utf8')
  assert.match(preload, /prepareSubjectRemotes: \(projectPath, remoteName, favorites\) =>\s*ipcRenderer\.invoke\('adapter:prepareSubjectRemotes', \{ projectPath, remoteName, favorites \}\)/)
})

test('the server-folder message is set after the push (its own status line would hide it) and the button is busy meanwhile', () => {
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const handler = app.slice(app.indexOf('elements.publishProjectButton.addEventListener'))
  const busyOn = handler.indexOf("setButtonBusy(elements.publishProjectButton, true, 'Checking the server folders…')")
  const prepare = handler.indexOf('api.prepareSubjectRemotes(')
  const busyOff = handler.indexOf('setButtonBusy(elements.publishProjectButton, false)')
  const push = handler.indexOf("runWorkflowCommand('push'")
  const note = handler.indexOf('setLastActionState(prepNote.text, prepNote.tone)')
  assert.ok(busyOn !== -1 && busyOn < prepare && prepare < busyOff && busyOff < push, 'busy during the prep, released before the push')
  assert.ok(note > push, 'the prep sentence is shown after the push returns')
  assert.doesNotMatch(handler.slice(prepare, push), /setLastActionState/)
})
