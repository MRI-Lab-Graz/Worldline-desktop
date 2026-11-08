import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describeSync, remoteSettingsState, noteIfCurrent } from '../src/gui/renderer/sync-cards.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const snap = (extra = {}) => ({ hasUpstream: true, upstream: 'backup/main', ahead: 0, behind: 0, remoteUrl: '/Volumes/USB/study', sourceAccepts: null, ...extra })

test('no remote: nothing to describe', () => {
  for (const health of [null, undefined, { hasUpstream: false }]) {
    const view = describeSync(health)
    assert.equal(view.remoteLine, '')
    assert.equal(view.statusLine, '')
    assert.equal(view.update.countText, '')
    assert.equal(view.publish.countText, '')
  }
})

test('in sync', () => {
  const view = describeSync(snap())
  assert.equal(view.statusLine, 'Everything is in sync.')
  assert.equal(view.update.label, 'Get updates')
  assert.equal(view.update.countText, 'none waiting')
  assert.equal(view.publish.label, 'Send my saves')
  assert.equal(view.publish.countText, 'nothing to send')
})

test('ahead only, with singular and plural', () => {
  assert.equal(describeSync(snap({ ahead: 3 })).statusLine, '3 saves of yours are not there yet · nothing new from others')
  assert.equal(describeSync(snap({ ahead: 1 })).statusLine, '1 save of yours is not there yet · nothing new from others')
  assert.equal(describeSync(snap({ ahead: 3 })).publish.countText, '3 waiting')
  assert.equal(describeSync(snap({ ahead: 3 })).update.countText, 'none waiting')
})

test('behind only, with singular and plural', () => {
  assert.equal(describeSync(snap({ behind: 2 })).statusLine, 'All your saves are there · 2 new saves from others are waiting')
  assert.equal(describeSync(snap({ behind: 1 })).statusLine, 'All your saves are there · 1 new save from others is waiting')
  assert.equal(describeSync(snap({ behind: 2 })).update.countText, '2 waiting')
  assert.equal(describeSync(snap({ behind: 2 })).publish.countText, 'nothing to send')
})

test('both ahead and behind', () => {
  assert.equal(describeSync(snap({ ahead: 2, behind: 1 })).statusLine, '2 saves of yours are not there yet · 1 new save from others is waiting')
})

test('unknown counts say "not checked yet", never "none waiting"', () => {
  const view = describeSync(snap({ ahead: null, behind: null }))
  assert.equal(view.statusLine, 'Not checked yet.')
  assert.equal(view.update.countText, 'not checked yet')
  assert.equal(view.publish.countText, 'not checked yet')
  const half = describeSync(snap({ ahead: 2, behind: null }))
  assert.equal(half.update.countText, 'not checked yet')
  assert.equal(half.publish.countText, '2 waiting')
  assert.match(half.statusLine, /2 saves of yours are not there yet · .*not checked yet/)
  assert.equal(describeSync(snap({ ahead: undefined, behind: undefined })).update.countText, 'not checked yet')
})

test('help text explains each card and keeps the old names once', () => {
  const view = describeSync(snap())
  assert.match(view.update.help, /Bring in saves that others \(or another computer\) added there\. Nothing of yours is changed\./)
  assert.equal(view.update.help.match(/called Update/g).length, 1)
  assert.match(view.publish.help, /Copy the saves you made here to backup, so others can get them\./)
  assert.equal(view.publish.help.match(/called Publish/g).length, 1)
})

test('a folder, an online repository and a missing location read differently', () => {
  assert.equal(describeSync(snap()).remoteLine, 'backup — a folder at /Volumes/USB/study')
  assert.equal(describeSync(snap({ remoteUrl: 'C:\\Users\\Ana\\USB\\study' })).remoteLine, 'backup — a folder at C:\\Users\\Ana\\USB\\study')
  assert.equal(describeSync(snap({ remoteUrl: 'file:///Volumes/USB/study' })).remoteLine, 'backup — a folder at /Volumes/USB/study')
  assert.equal(describeSync(snap({ upstream: 'origin/main', remoteUrl: 'https://gin.g-node.org/me/study' })).remoteLine, 'origin — an online repository: https://gin.g-node.org/me/study')
  assert.equal(describeSync(snap({ upstream: 'origin/main', remoteUrl: 'git@github.com:me/study.git' })).remoteLine, 'origin — an online repository: git@github.com:me/study.git')
  assert.equal(describeSync(snap({ remoteUrl: null })).remoteLine, 'backup')
})

test('file URLs: Windows drive and server paths read as folders, bad escapes never throw', () => {
  assert.equal(describeSync(snap({ remoteUrl: 'file:///C:/Users/Ana/USB' })).remoteLine, 'backup — a folder at C:\\Users\\Ana\\USB')
  assert.equal(describeSync(snap({ remoteUrl: 'file://server/share/x' })).remoteLine, 'backup — a folder at \\\\server\\share\\x')
  assert.equal(describeSync(snap({ remoteUrl: 'file:///100%/x' })).remoteLine, 'backup — a folder at /100%/x')
})

test('credentials in a URL never reach the screen text', () => {
  const view = describeSync(snap({ upstream: 'origin/main', remoteUrl: 'https://me:s3cret@gitlab.com/me/study.git' }))
  assert.doesNotMatch(JSON.stringify(view), /s3cret|me:/)
  assert.match(view.remoteLine, /https:\/\/\*\*\*@gitlab\.com\/me\/study\.git/)
})

test('a place that does not accept changes: calm wording, button not disabled by this view', () => {
  const view = describeSync(snap({ ahead: 2, sourceAccepts: 'no' }))
  assert.match(view.publish.help, /does not accept changes/)
  assert.doesNotMatch(view.publish.help, /refused!/)
  assert.equal(view.publish.disabled, undefined)
  assert.equal(view.publish.countText, '2 waiting')
  assert.doesNotMatch(describeSync(snap({ sourceAccepts: 'yes' })).publish.help, /does not accept/)
})

test('markup: the Sync section has three blocks and keeps the button ids', () => {
  const html = read('../src/gui/renderer/index.html')
  const section = html.slice(html.indexOf('id="sync-data-section"'), html.indexOf('id="files-panel"'))
  assert.match(section, /<h3[^>]*>Where your saves are shared<\/h3>/)
  assert.match(section, /<h3[^>]*>Get updates<\/h3>/)
  assert.match(section, /<h3[^>]*>Send my saves<\/h3>/)
  assert.match(section, /<button id="update-project"[^>]*>Get updates<\/button>/)
  assert.match(section, /<button id="publish-project"[^>]*>Send my saves<\/button>/)
  for (const id of ['sync-actions-strip', 'sync-actions-quiet', 'remote-info', 'open-remote-settings', 'sync-remote-line', 'sync-status-line', 'sync-update-help', 'sync-update-count', 'sync-publish-help', 'sync-publish-count']) {
    assert.match(section, new RegExp(`id="${id}"`))
  }
  assert.doesNotMatch(section, /Update \(remote\)|Publish \(remote\)/)
  assert.doesNotMatch(section, /called (Update|Publish)/, 'the old names live in describeSync only, so they appear once')
})

test('wiring: a failing card render cannot skip the button gating', () => {
  const app = read('../src/gui/renderer/app.js')
  const body = app.slice(app.indexOf('function applyRemoteGatedButtons'), app.indexOf('function setStatusLine'))
  assert.ok(body.indexOf('computeRemoteGating(') < body.indexOf('renderSyncCards('))
  assert.match(body, /try \{\s*renderSyncCards/)
})

test('wiring: renderSyncCards is called only from applyRemoteGatedButtons', () => {
  const app = read('../src/gui/renderer/app.js')
  assert.equal(app.match(/renderSyncCards\(/g).length, 2, 'one definition, one call')
  const body = app.slice(app.indexOf('function applyRemoteGatedButtons'), app.indexOf('function setStatusLine'))
  assert.match(body, /renderSyncCards\(/)
})

test('wiring: app.js renders the cards from describeSync with textContent only', () => {
  const app = read('../src/gui/renderer/app.js')
  assert.match(app, /import \{ describeSync, remoteSettingsState, noteIfCurrent \} from '\.\/sync-cards\.js'/)
  const body = app.slice(app.indexOf('function renderSyncCards'), app.indexOf('function setStatusLine'))
  assert.match(body, /describeSync\(/)
  assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML/)
  for (const id of ['syncRemoteLine', 'syncStatusLine', 'syncUpdateHelp', 'syncUpdateCount', 'syncPublishHelp', 'syncPublishCount']) {
    assert.match(body, new RegExp(`elements\\.${id}\\.textContent`))
  }
})

const NONE = 'No remote is connected yet.'
const mine = (extra = {}) => snap({ projectPath: '/proj', ...extra })

test('remoteSettingsState: no project, or a snapshot of another project, disables the block with a plain reason', () => {
  assert.deepEqual(remoteSettingsState(null, ''), { disabled: true, reason: 'No project is open.', connectedLine: '', canDisconnect: false })
  for (const health of [null, mine({ projectPath: '/other' })]) {
    assert.deepEqual(remoteSettingsState(health, '/proj'), { disabled: true, reason: 'Checking this project…', connectedLine: '', canDisconnect: false })
  }
})

test('remoteSettingsState: no remote says so and cannot disconnect, but Add a Remote is open', () => {
  assert.deepEqual(remoteSettingsState({ projectPath: '/proj', hasUpstream: false }, '/proj'), { disabled: false, reason: '', connectedLine: NONE, canDisconnect: false })
})

test('remoteSettingsState: a remote is described like the Sync tab and can be disconnected, also when the source refuses changes', () => {
  for (const extra of [{}, { sourceAccepts: 'no' }]) {
    const state = remoteSettingsState(mine(extra), '/proj')
    assert.equal(state.disabled, false)
    assert.equal(state.canDisconnect, true)
    assert.equal(state.connectedLine, describeSync(mine(extra)).remoteLine)
    assert.match(state.connectedLine, /^backup — a folder at /)
  }
})

test('markup: the Remote subsection in Setup holds the moved controls in order; the Sync tab only links to it', () => {
  const html = read('../src/gui/renderer/index.html')
  const setup = html.slice(html.indexOf('id="settings-card"'), html.indexOf('<h3 class="setup-section-title">Your Name and Email'))
  assert.match(setup, /<h4[^>]*id="setup-remote-heading"[^>]*tabindex="-1"[^>]*>Remote<\/h4>/)
  assert.match(setup, /id="setup-remote-line"/)
  assert.match(setup, /<p id="setup-remote-note"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(setup, /Adding a remote makes it the place Get updates and Send my saves use from now on\./)
  const at = (id) => setup.indexOf(`id="${id}"`)
  for (const id of ['setup-remote-line', 'add-remote', 'add-remote-mode-folder', 'add-remote-mode-url', 'add-remote-location', 'add-remote-browse', 'add-remote-name', 'add-remote-connect', 'disconnect-remote']) {
    assert.ok(at(id) > 0, `${id} in Setup`)
  }
  assert.ok(at('setup-remote-line') < at('add-remote') && at('add-remote') < at('disconnect-remote'), 'connected now, Add a Remote, Disconnect')
  assert.doesNotMatch(setup.match(/<details id="add-remote"[^>]*>/)[0], /hidden/)
  const sync = html.slice(html.indexOf('id="sync-data-section"'), html.indexOf('id="files-panel"'))
  assert.doesNotMatch(sync, /id="add-remote|id="disconnect-remote/)
  assert.match(sync, /<button id="open-remote-settings" class="button button-ghost" type="button">Remote settings…<\/button>/)
})

test('wiring: the remote block renders from remoteSettingsState on Setup open and on every health render', () => {
  const app = read('../src/gui/renderer/app.js')
  assert.match(app, /function renderRemoteSettings\(\)[\s\S]*remoteSettingsState\(state\.projectHealthSnapshot/)
  const body = app.slice(app.indexOf('function renderRemoteSettings'), app.indexOf('\n}\n', app.indexOf('function renderRemoteSettings')))
  assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML/)
  assert.match(body, /setupRemoteLine\.textContent = /)
  const render = app.slice(app.indexOf('function renderProjectHealth'), app.indexOf('function renderProjectHealth') + 600)
  assert.match(render, /renderRemoteSettings\(\)/)
  const open = app.slice(app.indexOf("elements.openSettingsButton.addEventListener('click', () => {\n  elements.settingsCard"), app.indexOf('async function refreshGitIdentity'))
  assert.match(open, /renderRemoteSettings\(\)/)
})

test('wiring: Add a Remote and Disconnect also write their outcome into #setup-remote-note with textContent', () => {
  const app = read('../src/gui/renderer/app.js')
  const add = app.slice(app.indexOf("elements.addRemoteConnect.addEventListener('click'"), app.indexOf("elements.disconnectRemoteButton.addEventListener('click'"))
  assert.match(add, /setSetupRemoteNote\(`Connected to \$\{remoteName\} and sent your saves\.`, projectPath\)/)
  assert.match(add, /setSetupRemoteNote\('Add a Remote failed[^']*', projectPath\)/)
  assert.match(add, /runWorkflowCommand\('addRemote'/)
  assert.match(app, /function setSetupRemoteNote\(text, projectPath\) \{[\s\S]*?elements\.setupRemoteNote\.textContent = shown/)
  const dis = app.slice(app.indexOf("elements.disconnectRemoteButton.addEventListener('click'"), app.indexOf("elements.refreshBranchesButton.addEventListener"))
  assert.match(dis, /setSetupRemoteNote\(/)
  assert.match(dis, /window\.confirm\(/)
})

test('wiring: the Sync link and the Home bar button open Setup at the Remote subsection', () => {
  const app = read('../src/gui/renderer/app.js')
  const fn = app.slice(app.indexOf('function openRemoteSettings'), app.indexOf('\n}\n', app.indexOf('function openRemoteSettings')))
  assert.match(fn, /openSettingsButton\.click\(\)/, 'the same code path as the Setup button')
  assert.match(fn, /setupRemoteHeading\.focus\(\)/)
  assert.match(fn, /addRemote\.open = true/)
  assert.match(fn, /addRemoteLocation\.focus\(\)/)
  assert.match(app, /openRemoteSettingsButton\.addEventListener\('click', \(\) => openRemoteSettings\(\)\)/)
  const row = app.slice(app.indexOf("closest('button[data-add-remote]')"), app.indexOf("closest('button[data-add-remote]')") + 200)
  assert.match(row, /openRemoteSettings\(\{ openForm: true \}\)/)
  assert.doesNotMatch(row, /showTools/)
})

test('noteIfCurrent: a result is shown only while the project it belongs to is still open', () => {
  assert.equal(noteIfCurrent('/a', '/a', 'Connected.'), 'Connected.')
  assert.equal(noteIfCurrent('/a', '/b', 'Connected.'), null)
  assert.equal(noteIfCurrent('/a', '', 'Connected.'), null)
})

test('wiring: Disconnect is project-bound, gated while commands run, and re-synced after every command', () => {
  const app = read('../src/gui/renderer/app.js')
  const dis = app.slice(app.indexOf("elements.disconnectRemoteButton.addEventListener('click'"), app.indexOf("elements.refreshBranchesButton.addEventListener"))
  assert.match(dis, /remoteNameForProject\(state\.projectHealthSnapshot, projectPath\)/)
  assert.doesNotMatch(dis, /state\.projectHealthSnapshot\?\.upstream/)
  assert.match(dis, /setSetupRemoteNote\('[^']*', projectPath\)/)
  const gate = app.slice(app.indexOf('function syncDisconnectGating'), app.indexOf('\n}\n', app.indexOf('function syncDisconnectGating')))
  assert.match(gate, /state\.pendingCommands\.size > 0/)
  assert.match(gate, /computeRemoteGating\(health\)/)
  const run = app.slice(app.indexOf('state.pendingCommands.delete(commandName)'), app.indexOf('state.pendingCommands.delete(commandName)') + 200)
  assert.match(run, /syncDisconnectGating\(\)/)
  assert.match(app.slice(app.indexOf('function applyRemoteGatedButtons'), app.indexOf('function setStatusLine')), /syncDisconnectGating\(health\)/)
})

test('wiring: the Setup note is only written for the open project and cleared when the project changes', () => {
  const app = read('../src/gui/renderer/app.js')
  assert.match(app, /function setSetupRemoteNote\(text, projectPath\) \{[\s\S]*noteIfCurrent\(projectPath, readProjectPath\(\), text\)/)
  const add = app.slice(app.indexOf("elements.addRemoteConnect.addEventListener('click'"), app.indexOf("elements.disconnectRemoteButton.addEventListener('click'"))
  assert.doesNotMatch(add, /setSetupRemoteNote\([^)]*\)(?<!projectPath\))\n/)
  for (const call of add.match(/setSetupRemoteNote\(.*\)\n/g)) assert.match(call, /projectPath\)/, call)
  assert.match(app.slice(app.indexOf('function resetDataPanel'), app.indexOf('function resetDataPanel') + 300), /setupRemoteNote\.textContent = ''/)
})

test('markup and words: plainer Disconnect text and an accessible fieldset', () => {
  const html = read('../src/gui/renderer/index.html')
  assert.match(html, /<button id="disconnect-remote"[^>]*>Disconnect from this remote<\/button>/)
  assert.match(html, /<fieldset id="setup-remote-fieldset"[^>]*aria-describedby="setup-remote-reason"[^>]*>\s*<legend class="sr-only">Add a Remote<\/legend>/)
  const app = read('../src/gui/renderer/app.js')
  assert.doesNotMatch(app, /sibling config|Disconnect from Source/)
  assert.doesNotMatch(readFileSync(new URL('../docs/product/researcher-workflow.md', import.meta.url), 'utf8'), /Disconnect from Source/)
  assert.match(app, /Could not disconnect\. See 'Details of last action' on the Home view\./)
})
