import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/gui/renderer/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function ruleBody (css, sel) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) return m[2]
  }
  return null
}

const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '')

test('the title box container takes the free space and may shrink', () => {
  const body = ruleBody(css, '.project-strip-identity-text')
  assert.ok(body, 'rule .project-strip-identity-text exists')
  assert.match(body, /flex:\s*1 1 auto/)
  assert.match(body, /min-width:\s*0/)
})

test('the title input fills its container up to a sensible maximum', () => {
  const body = ruleBody(css, '.project-strip-title-input')
  assert.match(body, /width:\s*100%/)
  const max = body.match(/max-width:\s*(\d+)ch/)
  assert.ok(max && Number(max[1]) >= 40, 'max-width is at least 40ch')
})

test('the markup uses the container class and explains the title box', () => {
  const html = read('index.html')
  assert.match(html, /<div class="project-strip-identity-text">\s*<p id="current-project-title"/)
  const input = html.match(/<input[^>]*id="current-project-title-input"[^>]*>/)[0]
  assert.match(input, /title="Click to give this project a title \(shown only on this computer\)"/)
  assert.match(input, /aria-labelledby="current-project-title"/)
})

test('the identity row grows too (and stretches when the strip stacks), so the box has room', () => {
  const body = ruleBody(css, '.project-strip-identity')
  assert.match(body, /flex:\s*1 1 auto/)
  assert.match(body, /min-width:\s*0/)
  assert.match(ruleBody(css, '.project-strip-identity') && css.slice(css.indexOf('@media (max-width: 980px)')), /\.project-strip-identity\s*\{\s*align-self:\s*stretch/)
})
