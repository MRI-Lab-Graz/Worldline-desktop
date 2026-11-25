// Real Electron. Nothing may make the window scroll sideways: not a long command, path, file name, URL or sentence,
// in any box or pop-up. Long text wraps (or scrolls inside its own box). Put very long text into every element in
// turn and look at what grows. Run via `npm run test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot } from './fixtures.mjs'

let app

// A project with the long names people really have, so the rows the app builds itself are checked too.
// Names stay within what Windows allows for a whole path.
const longName = `sub-01_${'task-averylongtaskname'.repeat(4)}_bold`
test.before(async () => {
  const project = join(await createTempRoot(), `study-${'longfoldername'.repeat(4)}`)
  await mkdir(project)
  const git = (...args) => execFileSync('git', args, { cwd: project })
  git('init', '-q')
  git('config', 'user.email', 'e2e@example.org')
  git('config', 'user.name', 'E2E Test')
  await writeFile(join(project, `${longName}.tsv`), `id\t${'y'.repeat(500)}\n`)
  git('add', '.')
  git('commit', '-q', '-m', `${'z'.repeat(400)} ${'word '.repeat(100)}`)
  await writeFile(join(project, `${longName}.tsv`), `id\t${'q'.repeat(500)}\n`)
  app = await launchApp({ trustedPaths: [project] })
  await app.openProject(project)
  await app.page.click('.show-diff-button')
  await app.page.waitForSelector('.diff-cell-changed', { timeout: 30_000 })
  // The smallest window the app allows.
  await app.page.setViewportSize({ width: 980, height: 640 })
})
test.after(async () => { await app?.close() })

// One word with no place to break (a hash, a path) and many words (which only stay on one line if CSS says so).
const LONG = [['unbroken', 'x'.repeat(3000)], ['sentence', 'word '.repeat(600)]]

for (const [kind, text] of LONG) {
  test(`no element lets a long ${kind} widen the window or a pop-up`, async () => {
    const offenders = await app.page.evaluate((long) => {
      for (const node of document.querySelectorAll('[hidden]')) node.hidden = false
      for (const node of document.querySelectorAll('details')) node.open = true
      for (const hiding of ['onboarding-collapsed', 'hero-slim', 'save-tips-off']) {
        for (const node of document.querySelectorAll(`.${hiding}`)) node.classList.remove(hiding)
      }
      const tooWide = (node) => node.scrollWidth > node.clientWidth + 1
      const name = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${[...node.classList].map((c) => `.${c}`).join('')}`
      const found = new Set()
      const probe = (root, isTooWide) => {
        for (const node of [root, ...root.querySelectorAll('*')]) {
          if (['SCRIPT', 'STYLE', 'SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'IMG', 'BR', 'HR'].includes(node.tagName)) continue
          if (node.closest('svg, .sr-only') || (root === document.body && node.closest('.global-busy-overlay'))) continue
          const added = document.createTextNode(long)
          node.append(added)
          if (isTooWide()) found.add(name(node))
          added.remove()
        }
      }
      probe(document.body, () => tooWide(document.documentElement))
      // Pop-ups lie over the page, so they never widen it: check each card on its own, one at a time.
      const overlays = [...document.querySelectorAll('.global-busy-overlay')]
      for (const overlay of overlays) overlay.hidden = true
      for (const overlay of overlays) {
        overlay.hidden = false
        const card = overlay.firstElementChild
        probe(card, () => tooWide(card) || card.getBoundingClientRect().width > window.innerWidth)
        overlay.hidden = true
      }
      return [...found]
    }, text)
    assert.deepEqual(offenders, [])
  })
}
