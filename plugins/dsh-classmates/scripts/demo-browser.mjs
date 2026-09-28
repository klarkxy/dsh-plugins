// Interactive local Playwright recorder. Each input line is coordinator-owned JS.
import { chromium } from '@playwright/test';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve('demo/recordings');
const recordingName = process.env.DSH_RECORDING_NAME || 'minesweeper-full';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: directory, size: { width: 1440, height: 960 } } });
const page = await context.newPage();
const video = page.video();
const startedAt = Date.now();
const chapters = [];
const chapter = async (title) => { chapters.push({ seconds: (Date.now() - startedAt) / 1000, title }); await writeFile(`${directory}/${recordingName === 'minesweeper-full' ? 'chapters' : `${recordingName}-chapters`}.json`, JSON.stringify(chapters, null, 2)); };
page.on('pageerror', error => console.log('PAGE_ERROR', error.message));
await page.goto(process.env.DSH_DEMO_URL);
console.log('RECORDER_READY');
console.log(await page.locator('body').innerText());
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === 'stop') break;
  try { const result = await eval(`(async()=>{${line}\n})()`); if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result)); }
  catch (error) { console.log('ACTION_ERROR', error.message); }
}
await context.close();
await video.saveAs(`${directory}/${recordingName}.webm`);
await browser.close();
console.log(`VIDEO_SAVED demo/recordings/${recordingName}.webm`);
process.exit(0);
