// #check-env lives in the Setup panel, hidden until #open-settings is clicked. The button is in the HTML before the
// app script attaches its handler, so an early click can be lost: click again until the panel shows.
export async function openSetupPanel(page, { attempts = 5, timeout = 3_000 } = {}) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    await page.evaluate(() => document.getElementById('open-settings').click())
    try {
      await page.waitForSelector('#check-env', { timeout })
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
