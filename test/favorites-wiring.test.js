import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('../src/gui/renderer/index.html')
const app = read('../src/gui/renderer/app.js')

test('Setup has the Connection Favorites section and Create project has the Favorite chooser', () => {
  assert.match(html, /Connection Favorites/)
  for (const id of ['favorites-list', 'favorites-name', 'favorites-address', 'favorites-add', 'favorites-note', 'create-favorite']) {
    assert.match(html, new RegExp(`id="${id}"`), id)
  }
})

test('the page loads favorites through cleanFavorites, guarded storage, and shows them as text', () => {
  assert.match(app, /from '\.\/favorites\.js'/)
  assert.match(app, /cleanFavorites\(JSON\.parse\(localStorage\.getItem\(FAVORITES_STORAGE_KEY\)/)
  const at = app.indexOf('function renderFavorites')
  assert.ok(at !== -1)
  const body = app.slice(at, app.indexOf('\n}\n', at))
  assert.match(body, /textContent/)
  assert.doesNotMatch(body, /innerHTML/)
})

test('choosing a favorite switches to the matching source type and only fills the field', () => {
  const at = app.indexOf("elements.createFavorite.addEventListener('change'")
  assert.ok(at !== -1)
  const body = app.slice(at, app.indexOf('\n})\n', at))
  assert.match(body, /favoriteTarget\(/)
  assert.match(body, /updateGetRemoteMode\(\)/)
  assert.match(body, /dispatchEvent\(new Event\('input'/)
  assert.doesNotMatch(body, /runCommand|createProject\(/)
})

test('the Add-favorite row gives the name a narrow column, the address the wide one, and Add its own', () => {
  const css = read('../src/gui/renderer/styles.css')
  assert.match(html, /<div class="field-row favorites-form">/)
  const rule = css.match(/\.favorites-form\s*\{([^}]*)\}/)
  assert.ok(rule, '.favorites-form rule')
  assert.match(rule[1], /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*3fr\)\s+auto/)
})
