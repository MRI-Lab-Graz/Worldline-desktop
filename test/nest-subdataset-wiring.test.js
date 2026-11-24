import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldBlockForIdentity } from '../src/gui/renderer/identity-guard.js'
import { parseNestProgress } from '../src/gui/renderer/run-activity.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('src/gui/main.js')
const app = read('src/gui/renderer/app.js')

test('nestSubdataset gets the same trust re-check as createSubdataset, right before it runs', () => {
  assert.match(main, /payload\.commandName === 'createSubdataset' \|\| payload\.commandName === 'nestSubdataset'/)
})

test('nestSubdatasets (the batch) gets the same trust re-check', () => {
  assert.match(main, /payload\.commandName === 'nestSubdataset' \|\| payload\.commandName === 'nestSubdatasets'/)
})

test('nestSubdatasets is blocked while the git identity is incomplete', () => {
  assert.equal(shouldBlockForIdentity('nestSubdatasets', { available: true, name: '', email: '', complete: false }), true)
})

test('nestSubdataset is blocked while the git identity is incomplete', () => {
  assert.equal(shouldBlockForIdentity('nestSubdataset', { available: true, name: '', email: '', complete: false }), true)
})

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`)
  assert.notEqual(start, -1, `${name} not found`)
  return source.slice(start, source.indexOf('\n}\n', start))
}

test('automatic nesting makes ONE nestSubdatasets call for all subjects', () => {
  const body = functionBody(app, 'nestBidsCandidates')
  assert.match(body, /'nestSubdatasets'/)
  assert.doesNotMatch(body, /'nestSubdataset'/)
  assert.doesNotMatch(body, /'createSubdataset'/)
  assert.doesNotMatch(body, /untrackPath/, 'the batch untracks')
  assert.equal(body.split("'save'").length - 1, 1, 'only the parent save is left')
})

test('"Convert to subdataset" tries nestSubdataset first and uses DataLad only when the folder has its own git files', () => {
  const start = app.indexOf("event.target.closest('[data-convert-subdataset-path]')")
  const body = app.slice(start, app.indexOf('\n})\n', start))
  const nest = body.indexOf("'nestSubdataset'")
  const fallback = body.indexOf("'NEST_NEEDS_DATALAD'")
  const legacy = body.indexOf("'createSubdataset'")
  assert.ok(nest !== -1 && nest < fallback && fallback < legacy, 'nestSubdataset, then the code check, then createSubdataset')
})

test('the overlay gets its count from the "Nested k of N" lines of the batch', () => {
  assert.deepEqual(parseNestProgress('Nested 3 of 16: sub-03'), { done: 3, total: 16 })
  assert.equal(parseNestProgress('init (ok)'), null)
  assert.equal(parseNestProgress('Nested x of y'), null)
  assert.match(app, /parseNestProgress\(/)
})
