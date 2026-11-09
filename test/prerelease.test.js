import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderInstallScript } from '../scripts/render-install-script.mjs'

// A beta ships as a GitHub pre-release: tag v0.6.0-beta.1, never "latest". Source-reading tests normalise CRLF.
const read = async (p) => (await readFile(new URL(`../${p}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const pkg = JSON.parse(await read('package.json'))
const lock = JSON.parse(await read('package-lock.json'))
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
const HASH = 'b'.repeat(64)

test('the package version is valid semver and package-lock agrees', () => {
  assert.match(pkg.version, SEMVER)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
})

test('this branch is the first 0.6.0 beta', () => {
  assert.equal(pkg.version, '0.6.0-beta.1')
})

for (const [name, file] of [['macos-install.sh', 'scripts/macos/macos-install.sh'], ['linux-install.sh', 'scripts/linux/linux-install.sh'], ['windows-install.cmd', 'scripts/windows/windows-install.cmd']]) {
  test(`${name} rendered for a beta pins the beta and downloads from that tag, not from latest`, async () => {
    const out = renderInstallScript(await read(file), { version: pkg.version, zipSha256: HASH })
    assert.ok(out.includes('0.6.0-beta.1'))
    assert.match(out, /releases\/download\/v(\$\{APP_VERSION\}|\$AppVersion)\//)
    // "latest" survives only in the template hand-over, which a rendered script never reaches (its version no longer starts with __)
    assert.doesNotMatch(out, /\$AppVersion = '__|APP_VERSION='__/)
    assert.match(out, /__\*/, 'the guard that keeps the hand-over to templates stays')
  })
}

test('the Linux AppImage has a fixed, space-free name that linux-install.sh expects', async () => {
  const sh = await read('scripts/linux/linux-install.sh')
  assert.equal(pkg.build.linux.artifactName, 'Worldline-Desktop-${version}.AppImage')
  assert.ok(sh.includes('APP_FILE="Worldline-Desktop-${APP_VERSION}.AppImage"'))
})

const release = await read('.github/workflows/build-os-artifacts.yml')
const publish = release.slice(release.indexOf('  publish-release:'))

test('a tag with a hyphen is published as a pre-release and never as latest', () => {
  assert.ok(publish.includes("prerelease: ${{ contains(github.ref_name, '-') }}"))
  assert.ok(publish.includes("make_latest: ${{ !contains(github.ref_name, '-') }}"))
})

test('the release note links to this tag for pre-releases and to latest for stable tags, with a beta paragraph only for pre-releases', () => {
  assert.ok(publish.includes('base="$repo_url/download/$GITHUB_REF_NAME"'))
  assert.ok(publish.includes('base="$repo_url/latest/download"'))
  assert.ok(publish.includes('$base/windows-install.cmd') && publish.includes('$base/macos-install.sh') && publish.includes('$base/linux-install.sh'))
  const beta = publish.indexOf('## This is a beta')
  assert.ok(publish.lastIndexOf('if [[ "$GITHUB_REF_NAME" == *-* ]]; then', beta) > publish.indexOf('{\n'))
  assert.match(publish, /pre-release[\s\S]*not been used on all systems[\s\S]*Issues[\s\S]*keep a copy of your real data/)
})

test('the publish job gains no permissions and no secrets', () => {
  assert.doesNotMatch(release, /secrets\./)
  const perms = publish.slice(publish.indexOf('permissions:'), publish.indexOf('steps:'))
  assert.equal(perms.trim(), 'permissions:\n      contents: write\n      id-token: write\n      attestations: write')
})
