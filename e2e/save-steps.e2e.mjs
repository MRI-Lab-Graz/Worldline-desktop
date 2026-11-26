// Real Electron and DataLad. While Save runs, the button names the step it is on, and the result of an earlier action
// is gone, so it cannot be read as the result of this one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot } from './fixtures.mjs'

let app
let projectPath

test.before(async () => {
  projectPath = join(await createTempRoot(), 'steps')
  const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
  execFileSync('datalad', ['create', projectPath], { stdio: 'ignore', env })
  app = await launchApp({ trustedPaths: [projectPath] })
  await app.openProject(projectPath)
})
test.after(async () => { await app?.close() })

test('Save names each step on its button and clears the earlier result at once', async () => {
  await writeFile(join(projectPath, 'a.txt'), 'a')
  await app.page.waitForSelector('[data-changed-path="a.txt"]', { state: 'attached', timeout: 30_000 })
  await app.page.waitForFunction(() => !document.getElementById('message').disabled)
  await app.page.evaluate(() => {
    const button = document.getElementById('save-project')
    const output = document.getElementById('command-output')
    output.textContent = 'EARLIER RESULT'
    window.e2eSteps = []
    new MutationObserver(() => {
      const label = button.textContent.trim()
      if (window.e2eSteps.at(-1)?.label !== label) window.e2eSteps.push({ label, output: output.textContent })
    }).observe(button, { childList: true, characterData: true, subtree: true })
    const input = document.getElementById('message')
    input.value = 'e2e: steps'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await app.page.waitForFunction(() => !document.getElementById('save-project').disabled, undefined, { timeout: 15_000 })
  const idle = await app.page.evaluate(() => document.getElementById('save-project').textContent.trim())
  await app.page.evaluate(() => document.getElementById('save-project').click())
  await app.page.waitForFunction((label) => window.e2eSteps.at(-1)?.label === label, idle, { timeout: 60_000 })

  const steps = await app.page.evaluate(() => window.e2eSteps)
  assert.deepEqual(steps.map((step) => step.label), ['Looking for changes…', 'Saving…', idle])
  assert.ok(!steps[0].output.includes('EARLIER RESULT'), steps[0].output)
  assert.match(await app.page.textContent('#command-output'), /Saved/)
})

test('a Save that stops early does not leave "Saving…" as the last action', async () => {
  await writeFile(join(projectPath, 'b.txt'), 'b')
  await app.page.waitForSelector('[data-changed-path="b.txt"]', { state: 'attached', timeout: 30_000 })
  await app.page.evaluate(() => {
    const input = document.getElementById('message')
    input.value = 'e2e: broken'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await app.page.waitForFunction(() => !document.getElementById('save-project').disabled, undefined, { timeout: 15_000 })
  await writeFile(join(projectPath, '.git', 'index'), 'broken') // the scan for changes now fails
  await app.page.evaluate(() => document.getElementById('save-project').click())
  await app.page.waitForFunction(() => !document.getElementById('save-project').classList.contains('is-busy'), undefined, { timeout: 30_000 })
  assert.equal(await app.page.textContent('#last-action-state'), 'Save did not run.')
})
