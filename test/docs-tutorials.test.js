import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, access } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const dir = new URL('docs/tutorials/', root)
const shots = new URL('docs/_static/screenshots/', root)
const read = (url) => readFile(url, 'utf8')
const tutorials = (await readdir(dir)).filter((f) => f.endsWith('.md'))
const text = new Map(await Promise.all(tutorials.map(async (f) => [f, await read(new URL(f, dir))])))
const productDocs = (await readdir(new URL('docs/product/', root))).filter((f) => f.endsWith('.md')).map((f) => `docs/product/${f}`)
const userDocs = ['README.md', 'docs/install.md', ...productDocs, ...tutorials.map((f) => `docs/tutorials/${f}`)]

test('every screenshot a tutorial shows exists', async () => {
  for (const [file, md] of text) {
    for (const [, name] of md.matchAll(/_static\/screenshots\/([^)\s]+)\)/g)) {
      await access(new URL(name, shots)).catch(() => assert.fail(`${file} shows missing ${name}`))
    }
  }
})

test('every screenshot the README, install guide and product docs show exists', async () => {
  for (const file of ['README.md', 'docs/install.md', ...productDocs]) {
    const md = await read(new URL(file, root))
    for (const [, name] of md.matchAll(/_static\/screenshots\/([^)\s]+)\)/g)) {
      await access(new URL(name, shots)).catch(() => assert.fail(`${file} shows missing ${name}`))
    }
  }
})

test('the server and delete features have a picture in the docs', async () => {
  const install = await read(new URL('docs/install.md', root))
  const workflow = await read(new URL('docs/product/researcher-workflow.md', root))
  assert.match(install, /_static\/screenshots\/14-connection-favorites\.png/)
  assert.match(workflow, /_static\/screenshots\/15-delete-project\.png/)
})

test('user-facing docs use the current names, not the old ones', async () => {
  for (const file of userDocs) {
    const md = await read(new URL(file, root))
    for (const stale of ['Update and Publish', 'Publish integration', 'Update before', 'not published', 'Update Project', 'Get Data & Remote Sync', 'Merge in progress banner']) {
      assert.ok(!md.includes(stale), `${file} still says "${stale}"`)
    }
  }
})

test('the button names the tutorials use exist in the app', async () => {
  const ui = (await read(new URL('src/gui/renderer/index.html', root))) + (await read(new URL('src/gui/renderer/sync-cards.js', root))) + (await read(new URL('src/gui/renderer/data-panel.js', root)))
  const all = [...text.values()].join('\n')
  for (const name of ['Get updates', 'Send my saves', 'Disconnect from this remote', 'Choose data', 'Download selected', 'Remote settings…']) {
    if (all.includes(name)) assert.ok(ui.includes(name), `the app has no "${name}"`)
  }
})

test('the multimodal tutorial shows the Setup remote and Choose data pictures', () => {
  const md = text.get('04-multimodal-project.md')
  assert.match(md, /12-setup-remote\.png/)
  assert.match(md, /13-choose-data\.png/)
})
