import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { notSentText } from '../src/gui/renderer/project-card.js'

const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8')

test('the message names the folder, says why and what to do', () => {
  const text = notSentText(['derivatives'])
  assert.match(text, /Not sent: derivatives\./)
  assert.match(text, /server has no place for it yet/)
  assert.match(text, /only on this computer/)
  assert.match(text, /Sending again will not change this/)
  assert.match(text, /Everything else was sent\./)
  assert.match(text, /who looks after the server/)
})

test('many folders: plural, five names and a count of the rest', () => {
  const text = notSentText(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  assert.match(text, /Not sent: a, b, c, d, e and 2 more\./)
  assert.match(text, /no place for them yet/)
})

test('every place that reported "not everything" shows this text instead', () => {
  assert.doesNotMatch(app, /Sent, but not everything/)
  assert.equal(app.match(/notSentText\(result\.notSent\)/g)?.length, 3)
})
