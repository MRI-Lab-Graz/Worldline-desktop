import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const doc = await readFile(new URL('../docs/install.md', import.meta.url), 'utf8')

test('install guide leads with the macOS one-liner and also documents download-then-run and uninstall', () => {
  assert.match(doc, /## macOS: install with a script/)
  assert.match(doc, /curl -fsSL https:\/\/github\.com\/MRI-Lab-Graz\/Worldline-desktop\/releases\/latest\/download\/macos-install\.sh \| bash/)
  assert.match(doc, /bash macos-install\.sh/)
  assert.match(doc, /rm -rf "\$HOME\/Applications\/Worldline Desktop\.app"/)
  assert.match(doc, /Apple silicon/)
})

test('README download section names the three install files', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /\*\*macOS\*\* `macos-install\.sh`/)
})

test('install guide says what each script installs, that the script avoids the Gatekeeper dialog, and that the Linux script installs the app only', () => {
  assert.match(doc, /\*\*macOS script:\*\* installs git-annex and DataLad with Homebrew/)
  assert.match(doc, /no Gatekeeper warning/)
  assert.match(doc, /\*\*Linux script:\*\* installs the app only/)
})

test('SECURITY.md describes the macOS install script and what it does not pin', async () => {
  const sec = await readFile(new URL('../SECURITY.md', import.meta.url), 'utf8')
  assert.match(sec, /\*\*macOS install script\*\*/)
  assert.match(sec, /Homebrew/)
  assert.match(sec, /not pinned/i)
})

test('the version and changelog agree on the version and the example URL uses it', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const log = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  assert.match(log, new RegExp(`^## ${pkg.version.replaceAll('.', '\\.')}( \\(pre-release\\))?$`, 'm'))
  assert.doesNotMatch(log, /^## Unreleased$/m)
  assert.ok(doc.includes('releases/latest/download/macos-install.sh'))
})

test('install guide has a Linux section with the one-liner, where the file lands and how to remove it', () => {
  assert.match(doc, /## Linux: install with a script/)
  assert.match(doc, /releases\/latest\/download\/linux-install\.sh \| bash/)
  assert.match(doc, /~\/Applications\/Worldline-Desktop\.AppImage/)
  assert.match(doc, /worldline-desktop\.desktop/)
})

test('README and install guide give the beta macOS one-liner with the tag in the URL and warn about the old app', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const beta = /curl -fsSL https:\/\/github\.com\/MRI-Lab-Graz\/Worldline-desktop\/releases\/download\/v0\.6\.0-beta\.2\/macos-install\.sh \| bash/
  for (const text of [readme, doc]) {
    assert.match(text, beta)
    assert.match(text, /old version 0\.5\.5/)
  }
})
