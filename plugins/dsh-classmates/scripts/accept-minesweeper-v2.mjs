// Coordinator-owned independent interaction acceptance. Does not edit product files.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const folder=resolve('demo/minesweeper-v2-run/files');
const output=resolve('demo/recordings/minesweeper-v2/acceptance');
await mkdir(output,{recursive:true});
const hashFiles=async()=>Object.fromEntries(await Promise.all(['index.html','styles.css','ui.js','engine.js','package.json'].map(async n=>[n,createHash('sha256').update(await readFile(`${folder}/${n}`)).digest('hex')])));
const before=await hashFiles();
const browser=await chromium.launch({channel:'msedge',headless:true});
const receipts=[],errors=[];
const desktop=await browser.newContext({viewport:{width:1440,height:960}});
const page=await desktop.newPage();
page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(5000);
const url=(level='beginner',seed=1729)=>`${pathToFileURL(`${folder}/index.html`).href}?level=${level}&seed=${seed}`;
const cell=(p,r,c)=>p.locator(`.cell[data-r="${r}"][data-c="${c}"]`);
async function check(name,fn){try{const detail=await fn();receipts.push({name,passed:true,detail});console.log('PASS',name);}catch(e){receipts.push({name,passed:false,error:e.message});console.log('FAIL',name,e.message.slice(0,220));}}
await check('难度切换、雷数与九次首击安全',async()=>{
 for(const [level,rows,cols,mines]of[['beginner',9,9,10],['intermediate',16,16,40],['expert',16,30,99]])for(const[r,c]of[[0,0],[rows-1,cols-1],[Math.floor(rows/2),Math.floor(cols/2)]]){
  await page.goto(url());await page.locator(`[data-level="${level}"].level-tab`).click();
  await expect(page.locator('.cell')).toHaveCount(rows*cols);await expect(page.locator('[data-mines]')).toHaveText(String(mines).padStart(3,'0'));
  await cell(page,r,c).click();await expect(cell(page,r,c)).toHaveClass(/is-revealed/);await expect(page.locator('.is-exploded')).toHaveCount(0);
 }return{firstClicks:9};
});
await check('桌面右键插旗取消与问号循环',async()=>{
 await page.goto(url());const target=cell(page,0,0);
 await target.click({button:'right'});await expect(target).toHaveClass(/is-flagged/);await expect(page.locator('[data-mines]')).toHaveText('009');
 await target.click({button:'right'});await expect(target).not.toHaveClass(/is-flagged/);await expect(page.locator('[data-mines]')).toHaveText('010');
 await page.locator('#questionToggle').click();await target.click({button:'right'});await target.click({button:'right'});await expect(target).toHaveClass(/is-question/);
 await target.click({button:'right'});await expect(target).not.toHaveClass(/is-question|is-flagged/);
});
await check('键盘、计时与重新开始',async()=>{
 await page.goto(url());const target=cell(page,0,0);await target.focus();await target.press('Enter');await expect(target).toHaveClass(/is-revealed/);
 await expect(page.locator('[data-timer]')).not.toHaveText('00:00',{timeout:4000});
 const covered=page.locator('.cell:not(.is-revealed)').first();await covered.focus();await covered.press('f');await expect(covered).toHaveClass(/is-flagged/);await covered.press('f');await expect(covered).not.toHaveClass(/is-flagged/);
 await page.locator('[data-face]').click();await expect(page.locator('[data-timer]')).toHaveText('00:00');await expect(page.locator('.cell.is-revealed')).toHaveCount(0);
});
let visibleMines=[];
await check('真实点击触雷、失败弹窗与计时停止',async()=>{
 await page.goto(url('beginner',4242));await cell(page,0,0).click();
 for(let i=0;i<81&&!await page.locator('.cell.is-exploded').count();i++){
  const target=page.locator('.cell:not(.is-revealed)').first();if(!await target.count())break;await target.click();
 }
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('#resultCard')).toHaveClass(/is-lose/);
 await expect(page.locator('.cell.is-mine')).toHaveCount(10);
 visibleMines=await page.locator('.cell.is-mine').evaluateAll(es=>es.map(e=>`${e.dataset.r},${e.dataset.c}`));
 const stopped=await page.locator('[data-timer]').innerText();await page.waitForTimeout(1150);await expect(page.locator('[data-timer]')).toHaveText(stopped);
 await page.screenshot({path:`${output}/desktop-loss.png`});return{visibleMines:visibleMines.length};
});
await check('固定种子重放：双击展开、真实逐格点击胜利与弹窗重开',async()=>{
 if(visibleMines.length!==10)throw Error('Missing loss-screen mine oracle');
 const mines=new Set(visibleMines);await page.goto(url('beginner',4242));await cell(page,0,0).click();
 const cells=await page.locator('.cell').evaluateAll(es=>es.map(e=>({r:+e.dataset.r,c:+e.dataset.c,revealed:e.classList.contains('is-revealed'),n:+e.textContent})));
 const target=cells.find(a=>a.revealed&&a.n>0&&cells.some(b=>Math.abs(a.r-b.r)<=1&&Math.abs(a.c-b.c)<=1&&!b.revealed&&!mines.has(`${b.r},${b.c}`)));
 if(!target)throw Error('No chord test candidate');
 for(const p of visibleMines){const[r,c]=p.split(',').map(Number);if(Math.abs(target.r-r)<=1&&Math.abs(target.c-c)<=1)await cell(page,r,c).click({button:'right'});}
 const count=await page.locator('.cell.is-revealed').count();await cell(page,target.r,target.c).dblclick();await expect.poll(()=>page.locator('.cell.is-revealed').count()).toBeGreaterThan(count);
 for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(!mines.has(`${r},${c}`)&&!await cell(page,r,c).evaluate(e=>e.classList.contains('is-revealed')))await cell(page,r,c).click();
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('#resultCard')).toHaveClass(/is-win/);await expect(page.locator('.cell.is-revealed:not(.is-mine)')).toHaveCount(71);
 const stopped=await page.locator('[data-timer]').innerText();await page.waitForTimeout(1150);await expect(page.locator('[data-timer]')).toHaveText(stopped);
 await page.screenshot({path:`${output}/desktop-win.png`});await page.getByRole('button',{name:'再来一局',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('.cell.is-revealed')).toHaveCount(0);
 return{oracle:'Mine coordinates read only from prior defeat display; same seeded board replayed with actual UI clicks; no engine state access or engine action calls.'};
});
const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const phone=await mobile.newPage();phone.setDefaultTimeout(5000);phone.on('pageerror',e=>errors.push(e.message));
const cdp=await mobile.newCDPSession(phone);
async function longPress(target){await target.scrollIntoViewIfNeeded();const b=await target.boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,radiusX:5,radiusY:5,force:1}]});await phone.waitForTimeout(620);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await phone.waitForTimeout(100);}
await check('手机插旗按钮和真实长按取消',async()=>{
 await phone.goto(url());const target=cell(phone,0,0);
 await phone.locator('[data-fab]').tap();await target.tap();await expect(target).toHaveClass(/is-flagged/);await target.tap();await expect(target).not.toHaveClass(/is-flagged/);await phone.locator('[data-fab]').tap();
 await longPress(target);await expect(target).toHaveClass(/is-flagged/);await longPress(target);await expect(target).not.toHaveClass(/is-flagged/);await expect(target).not.toHaveClass(/is-revealed/);
});
await check('手机真实双次点按数字展开，连续三次重放',async()=>{
 if(visibleMines.length!==10)throw Error('Missing defeat-screen oracle');
 const mines=new Set(visibleMines);
 for(let trial=0;trial<3;trial++){
  await phone.goto(url('beginner',4242));await cell(phone,0,0).tap();
  const cells=await phone.locator('.cell').evaluateAll(es=>es.map(e=>({r:+e.dataset.r,c:+e.dataset.c,revealed:e.classList.contains('is-revealed'),n:+e.textContent})));
  const target=cells.find(a=>a.revealed&&a.n>0&&cells.some(b=>Math.abs(a.r-b.r)<=1&&Math.abs(a.c-b.c)<=1&&!b.revealed&&!mines.has(`${b.r},${b.c}`)));
  if(!target)throw Error('No mobile chord candidate');
  await phone.locator('[data-fab]').tap();
  for(const p of visibleMines){const[r,c]=p.split(',').map(Number);if(Math.abs(target.r-r)<=1&&Math.abs(target.c-c)<=1)await cell(phone,r,c).tap();}
  await phone.locator('[data-fab]').tap();
  const count=await phone.locator('.cell.is-revealed').count();
  await cell(phone,target.r,target.c).tap();await phone.waitForTimeout(120);await cell(phone,target.r,target.c).tap();
  await expect.poll(()=>phone.locator('.cell.is-revealed').count()).toBeGreaterThan(count);await expect(phone.locator('.cell.is-exploded')).toHaveCount(0);
 }
});
await check('手机高级格子放大、手指横滑与棋盘两端可达',async()=>{
 await phone.goto(url('expert'));await expect(phone.locator('.cell')).toHaveCount(480);
 const first=await cell(phone,0,0).boundingBox();if(first.width<32||first.height<32)throw Error(`Small tile ${first.width}x${first.height}`);
 const width=await phone.evaluate(()=>document.documentElement.scrollWidth);if(width>390)throw Error(`Page overflow ${width}`);
 const sc=phone.locator('#boardScroll');await sc.scrollIntoViewIfNeeded();const b=await sc.boundingBox();const y=Math.min(680,b.y+75);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y,radiusX:5,radiusY:5,force:1}]});
 for(let x=290;x>=70;x-=40){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,radiusX:5,radiusY:5,force:1}]});await phone.waitForTimeout(35);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>sc.evaluate(e=>e.scrollLeft)).toBeGreaterThan(10);
 await cell(phone,0,29).scrollIntoViewIfNeeded();await cell(phone,0,29).tap();await expect(cell(phone,0,29)).toHaveClass(/is-revealed/);
 await cell(phone,0,0).scrollIntoViewIfNeeded();await expect(cell(phone,0,0)).toBeInViewport();
 await phone.screenshot({path:`${output}/mobile-expert.png`});return{tile:first.width,viewport:390,pageWidth:width};
});
await check('手机三档难度与窄屏页面布局',async()=>{
 for(const width of[360,390]){
  await phone.setViewportSize({width,height:844});
  for(const[level,count]of[['beginner',81],['intermediate',256],['expert',480]]){
   await phone.goto(url(level));await expect(phone.locator('.cell')).toHaveCount(count);
   if(await phone.evaluate(()=>document.documentElement.scrollWidth)>width)throw Error(`Page overflow ${width} ${level}`);
   if(level!=='beginner'&&(await cell(phone,0,0).boundingBox()).width<32)throw Error(`${level} tiles below 32px`);
  }
 }
 await phone.goto(url());await cell(phone,0,0).tap();await phone.screenshot({path:`${output}/mobile-beginner.png`});
});
await check('运行无页面错误',async()=>{if(errors.length)throw Error(JSON.stringify(errors));});
await browser.close();
const after=await hashFiles();const unchanged=JSON.stringify(before)===JSON.stringify(after);
const report={at:new Date().toISOString(),passed:receipts.every(r=>r.passed)&&unchanged,unchangedDuringTest:unchanged,hashes:after,receipts,errors};
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,groups:receipts.length,unchanged}));
process.exitCode=report.passed?0:1;
