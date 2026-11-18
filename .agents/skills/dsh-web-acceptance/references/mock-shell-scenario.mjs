/**
 * No-service acceptance scenario for an isolated dsh web shell.
 *
 * It closes the preview dialog ("继续") and the following get-started
 * dialog ("关闭"), never the login or API-key buttons. It does not submit a
 * chat, open a provider, or call a model. A page error or an /api or
 * /plugins HTTP error fails the run.
 */

const PREVIEW_BUTTON = /继续|Continue|知道了|Got it/
const START_DIALOG = /开始使用|Get started/
const CLOSE_BUTTON = /^关闭$|^Close$/

export async function dismissHarnessDialog(page) {
  const preview = page.getByRole('button', { name: PREVIEW_BUTTON }).first()
  try {
    await preview.click({ timeout: 8_000 })
    await page.waitForTimeout(300)
  } catch {
    // This shell did not show the preview button.
  }
  const start = page.getByRole('dialog', { name: START_DIALOG })
  const appeared = await start.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)
  if (!appeared) return 'preview'
  // Close the get-started dialog. Do not click 登录 or 添加 API Key.
  await start.getByRole('button', { name: CLOSE_BUTTON }).click({ timeout: 3_000 })
  await page.waitForTimeout(300)
  return 'start'
}

export async function run({ page, screenshot, captureFrame, assertClean }) {
  await dismissHarnessDialog(page)
  const leftover = page.getByRole('dialog', { name: /预览版说明|开始使用|Get started|Preview/ })
  if (await leftover.isVisible().catch(() => false)) {
    throw new Error('The first-run dialog is still open.')
  }
  await page.waitForTimeout(400)
  if (typeof captureFrame === 'function') await captureFrame(500)
  if (typeof screenshot === 'function') await screenshot('shell.png')
  assertClean()
}
