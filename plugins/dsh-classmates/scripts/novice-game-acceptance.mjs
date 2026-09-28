import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const file=resolve('demo/novice-minesweeper/index.html'),out=resolve('demo/recordings/novice-live');
const receipt={at:new Date().toISOString(),sha256:createHash('sha256').update(await readFile(file)).digest('hex'),checks:[],errors:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
const url=pathToFileURL(file).href;
async function check(name,fn){try{await fn();receipt.checks.push({name,passed:true});}catch(e){receipt.checks.push({name,passed:false,error:String(e)});}}
try{
const context=await browser.newContext({viewport:{width:1365,height:1000}}),page=await context.newPage();
page.on('pageerror',e=>receipt.errors.push(String(e)));await page.goto(url);
const state=()=>page.evaluate(()=>window.msGetState());
const cells=page.locator('[data-row][data-col]');
await check('Flagged first cell does not start game',async()=>{await cells.first().click({button:'right'});await cells.first().click();assert.equal((await state()).status,'ready');assert.equal((await state()).firstClickDone,false);await cells.first().click({button:'right'});});
await check('Desktop first reveal and timer',async()=>{assert.equal(await cells.count(),81);await cells.nth(40).click();assert.equal((await state()).status,'playing');assert.ok((await state()).revealedCount>0);await expect.poll(async()=>(await state()).timer).toBeGreaterThan(0);});
await check('Covered mines are not visible',async()=>{const bombs=page.locator('[data-row][data-col]:not(.revealed):not(.flag) .bomb');for(let i=0;i<await bombs.count();i++)await expect(bombs.nth(i)).toBeHidden();});
await check('Right click flag toggle',async()=>{const c=page.locator('[data-row][data-col]:not(.revealed)').first();await c.click({button:'right'});assert.equal((await state()).flags,1);const before=await state();await c.click();assert.equal((await state()).revealedCount,before.revealedCount);await c.click({button:'right'});assert.equal((await state()).flags,0);});
await page.screenshot({path:`${out}/game-desktop.png`});
await check('Reset and all difficulties',async()=>{for(const [name,count] of [['暖场 6×6',36],['初级 9×9',81],['中级 16×16',256],['高级 16×30',480]]){await page.getByRole('button',{name,exact:true}).click();assert.equal(await cells.count(),count);assert.equal((await state()).status,'ready');}await page.getByRole('button',{name:'重新开始',exact:true}).click();assert.equal((await state()).timer,0);});
await check('Keyboard movement, flag and reveal',async()=>{await cells.first().focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator(':focus').getAttribute('data-col'),'1');await page.keyboard.press('f');assert.equal((await state()).flags,1);await page.keyboard.press('f');await page.keyboard.press('Enter');assert.equal((await state()).status,'playing');});
await check('Invalid custom mine count is rejected',async()=>{const before=(await state()).config;await page.getByRole('button',{name:'自定义',exact:true}).click();await page.getByRole('spinbutton',{name:'行数',exact:true}).fill('5');await page.getByRole('spinbutton',{name:'列数',exact:true}).fill('5');await page.getByRole('spinbutton',{name:'雷数',exact:true}).fill('99');await page.getByRole('button',{name:'开始',exact:true}).click();assert.deepEqual((await state()).config,before);await expect(page.getByRole('alert')).toBeVisible();});
const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
const mp=await mobile.newPage();mp.on('pageerror',e=>receipt.errors.push(String(e)));await mp.goto(url);
await check('Mobile tap and long press flag',async()=>{const cs=mp.locator('[data-row][data-col]');await cs.nth(40).tap();assert.equal((await mp.evaluate(()=>window.msGetState())).status,'playing');const c=mp.locator('[data-row][data-col]:not(.revealed)').first();const b=await c.boundingBox();assert.ok(b);const cdp=await mobile.newCDPSession(mp);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});await new Promise(r=>setTimeout(r,650));await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal((await mp.evaluate(()=>window.msGetState())).flags,1);await cdp.detach();});
await check('Mobile no document horizontal overflow',async()=>{assert.ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));});
await mp.screenshot({path:`${out}/game-mobile.png`,fullPage:true});
await mobile.close();await context.close();
}finally{await browser.close();await writeFile(`${out}/game-acceptance.json`,JSON.stringify(receipt,null,2));}
console.log(JSON.stringify(receipt,null,2));
