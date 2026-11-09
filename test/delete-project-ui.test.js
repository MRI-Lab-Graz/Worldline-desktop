import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('../src/gui/renderer/index.html')
const app = read('../src/gui/renderer/app.js')
const css = read('../src/gui/renderer/styles.css')

const thisProject = html.slice(html.indexOf('>This project<'), html.indexOf('>Your Name and Email<'))

test('Setup > This project ends with a Danger zone that says what is and is not deleted', () => {
  assert.match(thisProject, /Danger zone/)
  assert.match(thisProject, /id="delete-project-open"/)
  assert.match(thisProject, /Copies on a remote are not touched/)
})

test('the delete dialog is a modal that needs the name typed and starts disabled', () => {
  const dialog = html.slice(html.indexOf('id="delete-project-overlay"'))
  assert.match(dialog, /role="dialog" aria-modal="true"/)
  assert.match(dialog, /id="delete-project-name"[^>]*autocomplete="off"/)
  assert.match(dialog, /id="delete-project-confirm"[^>]*disabled/)
  assert.match(dialog, /id="delete-project-warnings"/)
})

test('the page asks the main process for a preview before it shows the dialog, and fills it with textContent only', () => {
  const block = app.slice(app.indexOf("elements.deleteProjectOpen.addEventListener('click'"))
  assert.ok(block.indexOf('api.getDeletionPreview(') > 0)
  assert.ok(block.indexOf('api.getDeletionPreview(') < block.indexOf('.hidden = false'))
  const dialogCode = app.slice(app.indexOf('const deleteProjectFocus'), app.indexOf('const deleteProjectFocus') + 4000)
  assert.doesNotMatch(dialogCode, /innerHTML/) // folder and project names come from the disk: never read as HTML
})

test('confirm is enabled only when the typed name matches, and a mismatch deletes nothing', () => {
  assert.match(app, /deleteProjectConfirm\.disabled = !projectNameMatches\(/)
  const submit = app.slice(app.indexOf("elements.deleteProjectForm.addEventListener('submit'"))
  assert.ok(submit.indexOf('projectNameMatches(') > 0 && submit.indexOf('projectNameMatches(') < submit.indexOf('api.deleteProject('))
})

test('after a delete the project leaves the recent list and the page goes back to the start screen', () => {
  const submit = app.slice(app.indexOf("elements.deleteProjectForm.addEventListener('submit'"))
  assert.match(submit, /withoutProject\(/)
  assert.match(submit, /persistRecentProjects\(\)/)
  assert.match(submit, /setProjectDependentSectionsVisible\(false\)/)
  assert.match(submit, /setOnboardingExpanded\(true\)/)
})

test('a red danger button style exists', () => {
  assert.match(css, /\.button-danger\b/)
})
