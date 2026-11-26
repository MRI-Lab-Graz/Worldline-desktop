// Real Electron. Subject folders saved outside the app stay ordinary folders: opening the project names them, and
// nothing converts them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot } from './fixtures.mjs'

const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
const run = (command, args) => execFileSync(command, args, { env, stdio: 'ignore' })
let app
let top

test.before(async () => {
  top = join(await createTempRoot(), 'top')
  run('datalad', ['create', top])
  await writeFile(join(top, 'dataset_description.json'), '{"Name":"x","BIDSVersion":"1.9.0"}\n')
  await mkdir(join(top, 'sub-001'))
  await writeFile(join(top, 'sub-001', 'a.tsv'), 'a\n')
  run('datalad', ['-C', top, 'save', '-m', 'saved outside the app'])
  app = await launchApp({ trustedPaths: [top] })
  await app.openProject(top)
})
test.after(async () => { await app?.close() })

test('opening the project names the ordinary subject folders and leaves them as they are', async () => {
  const notice = app.page.locator('#ordinary-folders-notice')
  await notice.waitFor({ state: 'visible', timeout: 30_000 })
  assert.match(await notice.textContent(), /sub-001/)
  assert.equal(await app.page.locator('#ordinary-folders-notice').count(), 1)
  await assert.rejects(access(join(top, 'sub-001', '.git')))
})
