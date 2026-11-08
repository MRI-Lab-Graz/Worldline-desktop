import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, access } from 'node:fs/promises'

const dir = new URL('../docs/tutorials/', import.meta.url)
const shots = new URL('../docs/_static/screenshots/', import.meta.url)
const tutorials = (await readdir(dir)).filter((f) => f.endsWith('.md'))
const text = new Map(await Promise.all(tutorials.map(async (f) => [f, await readFile(new URL(f, dir), 'utf8')])))

test('every screenshot a tutorial shows exists', async () => {
  for (const [file, md] of text) {
    for (const [, name] of md.matchAll(/_static\/screenshots\/([^)\s]+)\)/g)) {
      await access(new URL(name, shots)).catch(() => assert.fail(`${file} shows missing ${name}`))
    }
  }
})

test('tutorials use the current names, not the old Update/Publish ones', () => {
  for (const [file, md] of text) {
    for (const stale of ['Update and Publish', 'Publish integration', 'Update before', 'not published']) {
      assert.ok(!md.includes(stale), `${file} still says "${stale}"`)
    }
  }
})

test('the multimodal tutorial shows the Setup remote and Choose data pictures', () => {
  const md = text.get('04-multimodal-project.md')
  assert.match(md, /12-setup-remote\.png/)
  assert.match(md, /13-choose-data\.png/)
})
