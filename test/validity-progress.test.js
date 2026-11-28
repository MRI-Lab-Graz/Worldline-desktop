import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkingElapsedText } from '../src/gui/renderer/project-card.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('src/gui/renderer/index.html')
const app = read('src/gui/renderer/app.js')
const css = read('src/gui/renderer/styles.css')

test('the elapsed line counts up in minutes and seconds', () => {
  assert.match(checkingElapsedText(0), /^Still working: 0:00\./)
  assert.match(checkingElapsedText(9_900), /^Still working: 0:09\./)
  assert.match(checkingElapsedText(125_000), /^Still working: 2:05\./)
  assert.match(checkingElapsedText(1000), /large dataset can take a few minutes/)
})

test('the validity box has a moving bar and a timer, hidden until a check runs', () => {
  const box = /<section id="save-step-valid"[\s\S]*?<\/section>/.exec(html)[0]
  assert.match(box, /<div id="save-validity-busy" hidden>/)
  assert.match(box, /class="loading-bar" aria-hidden="true"/)
  // aria-hidden: a screen reader must not announce every second
  assert.match(box, /<p id="save-validity-elapsed"[^>]*aria-hidden="true"/)
})

test('the page shows them only while checking and stops the timer afterwards', () => {
  const body = app.slice(app.indexOf('function renderCheckingProgress'), app.indexOf('function renderCheckingProgress') + 900)
  assert.match(body, /saveValidityBusy\.hidden = !checking/)
  assert.match(body, /clearInterval\(checkingTimer\)/)
  assert.match(body, /setInterval\(/)
  assert.match(app, /verdict: 'checking', startedAt: Date\.now\(\)/)
})

test('the BIDS and PRISM badges spin while checking', () => {
  assert.match(app, /classList\.toggle\('badge-wait', out\.tone === 'wait'\)/)
  assert.match(css, /\.badge-wait::after\s*\{[^}]*animation:\s*button-spin/)
})
