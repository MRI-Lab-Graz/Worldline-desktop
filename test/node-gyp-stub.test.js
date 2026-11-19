import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

// GHSA-fc5q-39xc-vjpf (picomatch) has no fix. Its only path in is electron-builder -> @electron/rebuild -> node-gyp
// -> tinyglobby -> picomatch. We ship no native modules, so node-gyp is replaced by an empty local stub and
// electron-builder is told not to rebuild. The audit gate stays strict; nothing is allowlisted.
test('node-gyp is replaced by the local stub and rebuilding is off', () => {
  const pkg = read('../package.json')
  assert.equal(pkg.devDependencies['node-gyp'], 'file:stubs/node-gyp')
  assert.equal(pkg.overrides['node-gyp'], '$node-gyp')
  assert.equal(pkg.build.npmRebuild, false)
  assert.equal(read('../stubs/node-gyp/package.json').name, 'node-gyp')
})

test('the lockfile no longer holds picomatch, fdir or tinyglobby (only node-gyp pulled them in)', () => {
  const keys = Object.keys(read('../package-lock.json').packages)
  for (const name of ['picomatch', 'fdir', 'tinyglobby']) {
    assert.equal(keys.includes(`node_modules/${name}`), false, name)
  }
})

test('the audit allowlist was not touched for this', () => {
  const script = readFileSync(new URL('../tests/npm-audit.sh', import.meta.url), 'utf8')
  assert.match(script, /ALLOWLISTED_ADVISORIES="GHSA-mh99-v99m-4gvg GHSA-ch52-4w7c-c8xp"/)
})
