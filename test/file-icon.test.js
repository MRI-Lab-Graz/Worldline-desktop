import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/gui/renderer/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? ''
const rem = (text, property) => Number.parseFloat(new RegExp(`${property}: ([\\d.]+)rem`).exec(text)?.[1])

// A small rounded square in front of a name reads as a checkbox that cannot be ticked.
test('the file icon is a page (taller than wide, with a folded corner), not a square that looks like a checkbox', () => {
  const file = `${rule('.file-icon-file')}${rule('.file-icon')}` // the file rule overrides the base one
  assert.ok(rem(file, 'height') > rem(file, 'width'), 'a page is taller than it is wide')
  assert.ok(rule('.file-icon-file::before') !== '', 'the folded corner')
})
