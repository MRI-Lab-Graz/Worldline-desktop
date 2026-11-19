import test from 'node:test'
import assert from 'node:assert/strict'
import { openSetupPanel } from '../e2e/open-setup.mjs'

// The page's button exists in the HTML before the app script has attached its click handler, so a click that
// lands too early does nothing (seen on the macOS CI runner). The helper must click again until the panel shows.
function fakePage({ ignoreFirstClicks }) {
  let clicks = 0
  return {
    get clicks() { return clicks },
    waitForSelector: async (selector) => {
      assert.equal(selector, '#check-env')
      if (clicks <= ignoreFirstClicks) throw new Error('Timeout: hidden')
    },
    evaluate: async () => { clicks += 1 },
  }
}

test('clicks again when the first click was lost, until the panel is visible', async () => {
  const page = fakePage({ ignoreFirstClicks: 2 })
  await openSetupPanel(page, { attempts: 5 })
  assert.equal(page.clicks, 3)
})

test('gives up with the real error after the last attempt', async () => {
  const page = fakePage({ ignoreFirstClicks: 99 })
  await assert.rejects(openSetupPanel(page, { attempts: 3 }), /Timeout: hidden/)
  assert.equal(page.clicks, 3)
})
