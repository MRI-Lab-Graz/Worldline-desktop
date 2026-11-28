// Real Electron and DataLad. A nested folder without a place on the server: the app says what stayed behind, and the
// "not sent yet" line is up to date afterwards.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot } from './fixtures.mjs'

const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
const run = (command, args) => execFileSync(command, args, { env, stdio: 'ignore' })
let app

test.before(async () => {
  const root = await createTempRoot()
  const top = join(root, 'top')
  run('datalad', ['create', top])
  run('datalad', ['create', '-d', top, join(top, 'derivatives')])
  run('git', ['init', '-q', '--bare', join(root, 'server.git')])
  run('git', ['-C', top, 'remote', 'add', 'origin', join(root, 'server.git')])
  run('datalad', ['-C', top, 'push', '--to', 'origin'])
  await new DataLadAdapter().trackRemote(top, 'origin') // as the app does, also on Windows' adjusted branches
  await writeFile(join(top, 'a.txt'), 'a')
  run('datalad', ['-C', top, 'save', '-m', 'a'])
  app = await launchApp({ trustedPaths: [top] })
  await app.openProject(top)
})
test.after(async () => { await app?.close() })

test('Send my saves names the folder that stayed behind and refreshes the status', async () => {
  await app.page.waitForFunction(() => document.body.textContent.includes('not sent yet'), undefined, { timeout: 30_000 })
  await app.page.waitForFunction(() => !document.getElementById('publish-project').disabled, undefined, { timeout: 30_000 })
  await app.page.evaluate(() => document.getElementById('publish-project').click())
  await app.page.waitForFunction(() => document.getElementById('last-action-state').textContent.startsWith('Not sent: derivatives.'), undefined, { timeout: 60_000 })
  const output = await app.page.textContent('#command-output')
  assert.match(output, /Everything else was sent\./)
  assert.match(output, /Not sent: derivatives\./)
  await app.page.waitForFunction(() => !document.body.textContent.includes('not sent yet'), undefined, { timeout: 30_000 })
})
