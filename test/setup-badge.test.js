import test from 'node:test'
import assert from 'node:assert/strict'
import { setupBadge } from '../src/gui/renderer/setup-badge.js'

const report = (...status) => ({ checks: status.map((s, i) => ({ label: `T${i}`, status: s })) })

test('no badge when every basic tool is there', () => {
  assert.deepEqual(setupBadge(report('ok', 'ok', 'ok')), { count: 0, label: 'Setup' })
})

test('the badge counts the missing tools and the button label says so for screen readers', () => {
  assert.deepEqual(setupBadge(report('ok', 'missing', 'missing')), { count: 2, label: 'Setup, 2 tools missing' })
  assert.deepEqual(setupBadge(report('missing', 'ok')), { count: 1, label: 'Setup, 1 tool missing' })
})

test('a failed or odd check shows nothing instead of a wrong number', () => {
  assert.deepEqual(setupBadge(undefined), { count: 0, label: 'Setup' })
  assert.deepEqual(setupBadge({}), { count: 0, label: 'Setup' })
})
