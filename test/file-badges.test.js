import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderActionButton, renderAnnexBadge, renderChangeMarker, renderFilesLegend } from '../src/gui/renderer/file-badges.js'

const textOf = (html) => html.replace(/<[^>]*>/g, '').trim()
const label = (html) => /aria-label="([^"]*)"/.exec(html)?.[1]

test('no marker when the content is here (the normal case) or unknown', () => {
  assert.equal(renderAnnexBadge(true), '')
  assert.equal(renderAnnexBadge(null), '')
  assert.equal(renderAnnexBadge(undefined), '')
})

test('files whose content is not on this computer get a cloud icon with a name for screen readers and a tooltip', () => {
  const html = renderAnnexBadge(false)
  assert.match(html, /<svg[^>]*aria-hidden="true"/)
  assert.match(html, /role="img"/)
  assert.equal(label(html), 'Not downloaded')
  assert.match(html, /title="Not downloaded"/)
  assert.equal(textOf(html), '', 'no words on screen, the icon says it')
})

test('folders with only some of their content here get a half-filled cloud', () => {
  const html = renderAnnexBadge('partial')
  assert.equal(label(html), 'Partly downloaded')
  assert.match(html, /row-icon-partial/)
})

test('a changed file gets a dot; a folder with a change inside gets a quieter ring', () => {
  assert.equal(label(renderChangeMarker({ type: 'file', gitStatus: 'modified' })), 'Changed since the last save')
  assert.equal(label(renderChangeMarker({ type: 'file', gitStatus: 'changed' })), 'Changed since the last save')
  assert.equal(label(renderChangeMarker({ type: 'directory', gitStatus: 'changed' })), 'Something inside changed since the last save')
  assert.match(renderChangeMarker({ type: 'directory', gitStatus: 'changed' }), /row-dot-inside/)
  assert.equal(renderChangeMarker({ type: 'file', gitStatus: null }), '')
})

test('other states keep their meaning in the tooltip, and a conflict stays loud', () => {
  assert.equal(label(renderChangeMarker({ type: 'file', gitStatus: 'untracked' })), 'New, not saved yet')
  assert.equal(label(renderChangeMarker({ type: 'file', gitStatus: 'added' })), 'New, not saved yet')
  assert.equal(label(renderChangeMarker({ type: 'file', gitStatus: 'deleted' })), 'Deleted since the last save')
  assert.equal(label(renderChangeMarker({ type: 'file', gitStatus: 'renamed' })), 'Renamed since the last save')
  const conflict = renderChangeMarker({ type: 'file', gitStatus: 'conflict' })
  assert.match(label(conflict), /Conflict/)
  assert.match(conflict, /row-dot-conflict/)
})

test('markers have no visible words', () => {
  for (const status of ['modified', 'untracked', 'deleted', 'conflict']) {
    assert.equal(textOf(renderChangeMarker({ type: 'file', gitStatus: status })), '', status)
  }
})

test('an action button is an icon button: name for screen readers, tooltip with the explanation, caller attributes escaped', () => {
  const html = renderActionButton(
    { action: 'unlock', label: 'Unlock', title: "Some software can't open these files." },
    { 'data-data-action': 'unlock', 'data-data-path': 'a "b"/c.nii.gz' }
  )
  assert.match(html, /^<button type="button" class="button button-ghost row-action"/)
  assert.equal(label(html), 'Unlock')
  assert.match(html, /title="Unlock: Some software can&#39;t open these files\."/)
  assert.match(html, /data-data-action="unlock"/)
  assert.match(html, /data-data-path="a &quot;b&quot;\/c\.nii\.gz"/)
  assert.match(html, /<svg[^>]*aria-hidden="true"/)
  assert.equal(textOf(html), '')
})

test('every action has its own icon', () => {
  const svgs = ['get', 'drop', 'unlock', 'open'].map((action) => renderActionButton({ action, label: action, title: '' }, {}).match(/<svg.*<\/svg>/s)[0])
  assert.equal(new Set(svgs).size, 4)
})

test('the legend says in words what each symbol means', () => {
  const words = textOf(renderFilesLegend())
  for (const meaning of ['changed since the last save', 'something inside changed', 'not downloaded', 'partly downloaded']) {
    assert.match(words.toLowerCase(), new RegExp(meaning), meaning)
  }
})

test('the Files tree uses the quiet markers and icon buttons, and keeps the full words for the Changed-files lists', () => {
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const tree = app.slice(app.indexOf('function renderFileTreeNodes'), app.indexOf('function renderGitStatusBadge'))
  assert.match(tree, /renderChangeMarker\(node\)/)
  assert.match(tree, /renderActionButton\(/)
  assert.doesNotMatch(tree, /renderGitStatusBadge\(/)
  assert.match(app, /\$\{renderGitStatusBadge\(entry\.status\)\}/) // the Changed-files list still says it in words
  assert.match(app, /renderFilesLegend\(\)/)
})

test('row buttons are hidden until the mouse or keyboard focus is on the row, and always shown on touch screens', () => {
  const css = readFileSync(new URL('../src/gui/renderer/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(css, /\.finder-row \.row-action\s*\{[^}]*opacity: 0/)
  assert.match(css, /\.finder-row:hover \.row-action,\s*\.finder-row:focus-within \.row-action\s*\{[^}]*opacity: 1/)
  assert.match(css, /@media \(hover: none\)[^{]*\{[\s\S]*?\.row-action\s*\{[^}]*opacity: 1/)
})
