import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/gui/renderer/styles.css', import.meta.url), 'utf8')
const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

test('radio buttons and checkboxes size to themselves instead of taking the full-width input rule', () => {
  const body = rule("input:where([type='radio'], [type='checkbox'])")
  assert.match(body, /width:\s*auto/)
  assert.match(body, /padding:\s*0/)
  assert.ok(css.indexOf("input:where([type='radio']") > css.indexOf('\ninput,\nselect {'), 'comes after the global input rule')
})

test('a label that holds a radio or checkbox is one compact row', () => {
  assert.match(rule('label:has(> input[type=\'radio\'], > input[type=\'checkbox\'])'), /display:\s*inline-flex/)
  assert.match(rule('.data-panel fieldset > div'), /flex-wrap:\s*wrap/)
  assert.match(rule('.data-panel legend'), /font-weight/)
})

test('the Add a Remote radios sit in the compact radio row, not the two-column input row', () => {
  const html = readFileSync(new URL('../src/gui/renderer/index.html', import.meta.url), 'utf8')
  assert.match(html, /<div class="get-remote-mode-row">\s*<label><input type="radio" name="add-remote-mode"/)
})
