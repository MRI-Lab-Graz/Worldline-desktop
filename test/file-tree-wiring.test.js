import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tree = app.slice(app.indexOf('function buildFileTree'), app.indexOf('function renderFileTreeNodes'))

// buildFileTree copies listing fields one by one: a field it does not copy never reaches the row buttons.
test('a file row keeps the listing\'s locked flag, so Unlock is offered only for files that are still links', () => {
  assert.match(tree, /locked: isLeaf \? entry\.locked : undefined/)
})
