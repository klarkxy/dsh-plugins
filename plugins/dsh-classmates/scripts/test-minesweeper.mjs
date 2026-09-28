import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const path = resolve('demo/minesweeper/index.html');
const before = createHash('sha256').update(await readFile(path)).digest('hex');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(4000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#overlay')).toBeHidden();
  for (const [level, cells, mines] of [['easy', 81, 10], ['medium', 256, 40], ['hard', 480, 99]]) {
    for (const position of [0, Math.floor(cells / 2), cells - 1]) {
      await page.locator(`[data-level="${level}"]`).click();
      await expect(page.locator('.cell')).toHaveCount(cells);
      await expect(page.locator('#mineCount')).toHaveText(String(mines));
      await expect(page.locator('#timer')).toHaveText('0.0');
      await page.locator('.cell').nth(position).click();
      await expect(page.locator('#overlay')).toBeHidden();
      if (await page.locator('.cell.revealed').count() === 0) throw Error(`${level} first click did not reveal cells`);
    }
    checks.push(`${level}: board size, mine count and three safe first clicks`);
  }
  await page.locator('[data-level="easy"]').click();
  const cell = page.locator('.cell').first();
  await cell.click({ button: 'right' });
  await expect(page.locator('#mineCount')).toHaveText('9');
  await cell.click({ button: 'right' });
  await expect(page.locator('#mineCount')).toHaveText('10');
  checks.push('right-click flag and unflag');
  await page.locator('#flagToggle').click();
  await cell.click();
  await expect(page.locator('#mineCount')).toHaveText('9');
  await cell.click();
  await expect(page.locator('#mineCount')).toHaveText('10');
  checks.push('flag mode click and unclick');
  await page.locator('#flagToggle').click();
  await cell.focus(); await cell.press('Enter');
  await page.waitForTimeout(1200);
  if (Number(await page.locator('#timer').innerText()) < 1) throw Error('Timer did not start');
  await page.locator('#restartBtn').click();
  await expect(page.locator('#timer')).toHaveText('0.0');
  checks.push('keyboard reveal, timer and restart');
  // Use deterministic randomness in a separate test context. Learn the mine
  // positions from the game's own loss display, then replay that same board to
  // verify the win condition without reading or changing the private game state.
  const replay = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await replay.addInitScript(() => { let seed = 1753; Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }; });
  const replayPage = await replay.newPage();
  replayPage.setDefaultTimeout(4000);
  await replayPage.goto(pathToFileURL(path).href);
  await replayPage.locator('.cell').nth(40).click();
  for (let i = 0; i < 81 && !await replayPage.locator('#overlay').isVisible(); i++)
    if (!await replayPage.locator('.cell').nth(i).evaluate(e => e.classList.contains('revealed'))) await replayPage.locator('.cell').nth(i).click();
  await expect(replayPage.locator('#overlay')).toBeVisible();
  await expect(replayPage.locator('#overlay')).toContainText('踩到雷');
  const mines = await replayPage.locator('.cell.mine').evaluateAll(es => es.map(e => Number(e.dataset.y) * 9 + Number(e.dataset.x)));
  if (mines.length !== 10) throw Error('Loss screen did not reveal exactly ten mines');
  const stopped = await replayPage.locator('#timer').innerText();
  await replayPage.waitForTimeout(1100);
  await expect(replayPage.locator('#timer')).toHaveText(stopped);
  checks.push('loss reveals all mines and stops the timer');
  await replayPage.reload();
  await replayPage.locator('.cell').nth(40).click();
  for (let i = 0; i < 81 && !await replayPage.locator('#overlay').isVisible(); i++)
    if (!mines.includes(i) && !await replayPage.locator('.cell').nth(i).evaluate(e => e.classList.contains('revealed'))) await replayPage.locator('.cell').nth(i).click();
  await expect(replayPage.locator('#overlay')).toBeVisible();
  await expect(replayPage.locator('#overlay')).not.toContainText('踩到雷');
  await expect(replayPage.locator('.cell.revealed')).toHaveCount(71);
  const wonTime = await replayPage.locator('#timer').innerText();
  await replayPage.waitForTimeout(1100);
  await expect(replayPage.locator('#timer')).toHaveText(wonTime);
  checks.push('deterministic replay: revealing all safe cells wins and stops timer');
  await replay.close();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.setDefaultTimeout(4000);
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(pathToFileURL(path).href);
  for (const level of ['easy', 'medium', 'hard']) {
    await mobile.locator(`[data-level="${level}"]`).tap();
    await mobile.locator('.cell').first().tap();
    await expect(mobile.locator('#overlay')).toBeHidden();
    if (await mobile.locator('.cell.revealed').count() === 0) throw Error(`Mobile ${level} tap did not reveal cells`);
    await mobile.locator('.cell').last().scrollIntoViewIfNeeded();
    const box = await mobile.locator('.cell').last().boundingBox();
    if (!box || box.x < 0 || box.x + box.width > 391) throw Error(`Mobile ${level}: last cell unreachable`);
  }
  checks.push('mobile: three difficulties, taps and reaching rightmost cells');
  await mobile.locator('[data-level="easy"]').tap();
  await mobile.locator('#flagToggle').tap();
  await mobile.locator('.cell').first().tap();
  await expect(mobile.locator('#mineCount')).toHaveText('9');
  await mobile.locator('.cell').first().tap();
  await expect(mobile.locator('#mineCount')).toHaveText('10');
  await mobile.locator('#flagToggle').tap();
  const touch = await mobile.context().newCDPSession(mobile);
  const touchBox = await mobile.locator('.cell').first().boundingBox();
  for (const remaining of ['9', '10']) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 }] });
    await mobile.waitForTimeout(550);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(mobile.locator('#mineCount')).toHaveText(remaining);
    await mobile.waitForTimeout(900);
  }
  checks.push('mobile: flag-mode taps and long-press flag/unflag');
  if (errors.length) throw Error(errors.join('\n'));
  const after = createHash('sha256').update(await readFile(path)).digest('hex');
  if (before !== after) throw Error('Game changed during test; rerun against final file');
  await writeFile('demo/recordings/game-acceptance.json', JSON.stringify({ sha256: after, checks, pageErrors: errors, passed: true }, null, 2));
  console.log(JSON.stringify({ checks, passed: true }));
} catch (error) {
  await writeFile('demo/recordings/game-acceptance.json', JSON.stringify({ sha256: before, checks, pageErrors: errors, passed: false, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
