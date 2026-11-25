// Real Electron, plain git only. The "What changed" list: no pointless checkboxes where everything is saved anyway
// (BIDS and PRISM projects), a ticked folder shows its files as ticked, and file names are readable in full.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot } from './fixtures.mjs'

// Short enough for Windows paths, long enough that the old 34-character cut hid the end.
const NAME = 'sub-001_ses-1_task-rest_biometrics.tsv'
const SECOND = 'sub-001_ses-2_task-rest_biometrics.tsv'
let app
let plain
let bids

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.org', ...args], { cwd })

// A project with a changed long-named file and a nested dataset holding two changed files.
async function project(root, name, extra = {}) {
  const folder = join(root, name)
  const sub = join(folder, 'sub-001')
  await mkdir(sub, { recursive: true })
  git(sub, 'init', '-q')
  for (const file of [NAME, SECOND]) await writeFile(join(sub, file), 'a\n')
  git(sub, 'add', '.')
  git(sub, 'commit', '-qm', 'subject')
  git(folder, 'init', '-q')
  await writeFile(join(folder, NAME), 'a\n')
  for (const [file, content] of Object.entries(extra)) await writeFile(join(folder, file), content)
  git(folder, 'submodule', 'add', './sub-001', 'sub-001')
  git(folder, 'add', '.')
  git(folder, 'commit', '-qm', 'project')
  await writeFile(join(folder, NAME), 'b\n')
  for (const file of [NAME, SECOND]) await writeFile(join(sub, file), 'b\n')
  return folder
}

test.before(async () => {
  const root = await createTempRoot()
  plain = await project(root, 'plain')
  bids = await project(root, 'bids', { 'dataset_description.json': '{"Name":"x","BIDSVersion":"1.8.0"}' })
  app = await launchApp({ trustedPaths: [plain, bids] })
})
test.after(async () => { await app?.close() })

const box = (path) => `#changed-files-output input[data-changed-path="${path}"]`
const state = (path) => app.page.$eval(box(path), (node) => ({ checked: node.checked, disabled: node.disabled }))
const open = async (folder) => {
  await app.openProject(folder)
  await app.page.waitForSelector(box(`sub-001/${NAME}`), { state: 'attached', timeout: 30_000 })
}

test('files inside a ticked folder show as ticked; untick the folder to choose single files', async () => {
  await open(plain)
  const nested = `sub-001/${NAME}`
  assert.deepEqual(await state(nested), { checked: true, disabled: true })
  await app.page.click(box('sub-001'))
  assert.deepEqual(await state(nested), { checked: false, disabled: false })
  await app.page.click(box(nested))
  assert.deepEqual(await state(nested), { checked: true, disabled: false })
  await app.page.click(box('sub-001'))
  assert.deepEqual(await state(`sub-001/${SECOND}`), { checked: true, disabled: true })
  await app.page.click('#changed-files-select-none')
  assert.deepEqual(await state(nested), { checked: false, disabled: false })
  await app.page.click('#changed-files-select-all')
  assert.deepEqual(await state(nested), { checked: true, disabled: true })
})

test('file names are shown in full', async () => {
  const cut = await app.page.$$eval('#changed-files-output .changed-file-path', (nodes) =>
    nodes.filter((node) => node.scrollWidth > node.clientWidth + 1 || getComputedStyle(node).whiteSpace === 'nowrap').map((node) => node.textContent))
  assert.deepEqual(cut, [])
})

test('a BIDS project offers no choice and says that everything is saved', async () => {
  await open(bids)
  await app.page.waitForSelector('#save-checkpoint-panel.saves-everything', { timeout: 30_000 })
  for (const selector of [box(NAME), box(`sub-001/${NAME}`), '#changed-files-select-all', '#changed-files-select-none']) {
    assert.equal(await app.page.isVisible(selector), false, selector)
  }
  assert.equal(await app.page.inputValue('#message'), '')
  assert.equal(await app.page.textContent('#changed-files-hint'), 'All changes will be saved together.')
  // Not a tip that can be switched off: it says what Save will do.
  await app.page.evaluate(() => document.getElementById('save-tips-toggle').click())
  assert.equal(await app.page.isVisible('#changed-files-hint'), true)
  await app.page.evaluate(() => document.getElementById('save-tips-toggle').click())
})

test('an ordinary project opened afterwards has its checkboxes back', async () => {
  await open(plain)
  await app.page.waitForSelector(box(NAME), { state: 'visible', timeout: 30_000 })
  assert.equal(await app.page.textContent('#changed-files-hint'), 'Choose which changed files this save should include.')
})
