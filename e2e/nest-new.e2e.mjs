// Real Electron. In a nested project a subject folder that appears while it is open is nested by Save; a folder that is
// already saved is left alone; a flat project stays flat; and a send that would empty a folder on the server is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot } from './fixtures.mjs'

const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
const run = (command, args) => execFileSync(command, args, { env, stdio: 'ignore' })
let app
let project
let flat
let sent
let server

const file = async (root, path) => {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), 'a\n')
}
async function bids(path) {
  run('datalad', ['create', '-c', 'text2git', path])
  await writeFile(join(path, 'dataset_description.json'), '{"Name":"x","BIDSVersion":"1.8.0"}')
  await file(path, 'sub-001/a.tsv')
  run('datalad', ['-C', path, 'save', '-m', 'flat'])
}
const modules = () => readFile(join(project, '.gitmodules'), 'utf8').catch(() => '')

test.before(async () => {
  const root = await createTempRoot()
  project = join(root, 'p')
  await bids(project) // sub-001 stays an ordinary folder
  run('datalad', ['create', '-d', project, join(project, 'sub-000')]) // the project is a nested one
  flat = join(root, 'f')
  await bids(flat)

  sent = join(root, 's')
  server = join(root, 'server')
  await bids(sent)
  run('git', ['clone', '-q', sent, server])
  run('git', ['-C', server, 'config', 'receive.denyCurrentBranch', 'updateInstead'])
  run('git', ['-C', sent, 'remote', 'add', 'origin', server])
  run('datalad', ['-C', sent, 'push', '--to', 'origin'])
  await new DataLadAdapter().trackRemote(sent, 'origin') // as the app does, also on Windows' adjusted branches
  // Turned into a nested dataset by hand (as "Convert to subdataset" would).
  run('git', ['-C', sent, 'rm', '-r', '-q', '--cached', 'sub-001'])
  run('git', ['-C', sent, 'commit', '-qm', 'untrack'])
  run('datalad', ['create', '-f', '-d', sent, join(sent, 'sub-001')])
  run('datalad', ['-C', sent, 'save', '-r', '-m', 'nested'])

  app = await launchApp({ trustedPaths: [project, flat, sent] })
})
test.after(async () => { await app?.close() })

test('opening leaves a saved folder as it is', async () => {
  await app.openProject(project)
  await app.page.waitForFunction(() => !document.getElementById('detect-project').disabled, undefined, { timeout: 90_000 }) // opening is over
  assert.doesNotMatch(await modules(), /sub-001/)
})

const save = async (name) => {
  await app.page.waitForFunction((text) => document.getElementById('changed-files-output').textContent.includes(text), name, { timeout: 30_000 })
  await app.page.evaluate(() => {
    const input = document.getElementById('message')
    input.value = 'e2e: new subject'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await app.page.waitForFunction(() => !document.getElementById('save-project').disabled, undefined, { timeout: 15_000 })
  await app.page.evaluate(() => document.getElementById('save-project').click())
  await app.page.waitForFunction(() => !document.getElementById('save-project').classList.contains('is-busy') && document.getElementById('last-action-state').textContent !== 'Saving…', undefined, { timeout: 90_000 })
}

test('Save nests a subject folder that appeared meanwhile, and only that one', async () => {
  await file(project, 'sub-002/a.tsv')
  await save('sub-002')
  const registered = await modules()
  assert.match(registered, /path = sub-002/)
  assert.doesNotMatch(registered, /sub-001/)
  assert.ok(existsSync(join(project, 'sub-002', '.git')))
})

test('Save leaves a flat project flat', async () => {
  await app.openProject(flat)
  await app.page.waitForFunction(() => !document.getElementById('detect-project').disabled, undefined, { timeout: 90_000 })
  await file(flat, 'sub-009/a.tsv')
  await save('sub-009')
  assert.ok(!existsSync(join(flat, '.gitmodules')))
  assert.ok(!existsSync(join(flat, 'sub-009', '.git')))
  // Not whether the save went through: that needs the BIDS validator, which this setup does not install.
})

test('Send my saves refuses to empty a folder on the server', async () => {
  await app.openProject(sent)
  await app.page.waitForFunction(() => !document.getElementById('publish-project').disabled, undefined, { timeout: 30_000 })
  await app.page.evaluate(() => document.getElementById('publish-project').click())
  await app.page.waitForFunction(() => document.getElementById('command-output').textContent.includes('would empty sub-001'), undefined, { timeout: 60_000 })
  assert.ok(existsSync(join(server, 'sub-001', 'a.tsv')), 'the file is still on the server')
})
