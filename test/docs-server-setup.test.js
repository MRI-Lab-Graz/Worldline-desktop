import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('server-setup.md tells the administrator how to install and protect the server', () => {
  assert.ok(existsSync(new URL('../docs/server-setup.md', import.meta.url)))
  const md = rd('docs/server-setup.md')
  for (const s of ['worldline-ensure-subjects', 'chmod +t', 'receive.denyDeletes', 'receive.denyNonFastForwards', '/usr/local/bin', 'WORLDLINE_ROOT', 'command -v', 'ForceCommand', 'Later, not yet recommended']) {
    assert.ok(md.includes(s), `server-setup.md misses ${s}`)
  }
})

test('the workflow doc explains renamed or new subjects and links the server setup', () => {
  const md = rd('docs/product/researcher-workflow.md')
  assert.match(md, /## Sending renamed or new subjects/)
  assert.match(md, /\(\.\.\/server-setup\.md\)/)
  assert.ok(existsSync(new URL('../docs/server-setup.md', import.meta.url)))
})

test('SECURITY.md names the new SSH command and says the server script is the authority', () => {
  const md = rd('SECURITY.md')
  assert.match(md, /worldline-ensure-subjects/)
  assert.match(md, /server script is the authority/i)
  assert.match(md, /additive/i)
  assert.match(md, /BatchMode/)
})

const KEY = 'The lab server is not set up for this yet'

test('the missing-script wording is the same in the app, the workflow doc, the server doc and SECURITY.md', () => {
  for (const f of ['src/datalad/subject-remotes.js', 'docs/product/researcher-workflow.md', 'docs/server-setup.md', 'SECURITY.md']) {
    assert.ok(rd(f).includes(KEY), `${f} misses the shared sentence`)
  }
})

test('the sticky-bit text says who may delete and that contents are not protected', () => {
  const md = rd('docs/server-setup.md')
  assert.match(md, /owner of the repository folder/)
  assert.match(md, /NOT their contents|not their contents/i)
  assert.match(md, /directly on the server/)
  assert.match(md, /every repository on the server/)
  assert.match(md, /command -v git/)
  assert.match(md, /PermitUserEnvironment/)
})

test('the docs index lists the server setup page', () => {
  assert.match(rd('docs/index.md'), /server-setup/)
})

test('the workflow doc says the subject remote is pointed at the new folder', () => {
  assert.match(rd('docs/product/researcher-workflow.md'), /points the subject's remote/)
})
