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
