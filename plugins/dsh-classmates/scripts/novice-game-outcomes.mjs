import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const file=resolve('demo/novice-minesweeper/index.html'),out=resolve('demo/recordings/novice-live');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1200,height:900},recordVideo:{dir:`${out}/gameplay`,size:{width:1200,height:900}}});
const page=await context.newPage(),receipt={at:new Date().toISOString(),sha256:createHash('sha256').update(await readFile(file)).digest('hex'),won:false,lost:false,games:[],errors:[]};
page.on('pageerror',e=>receipt.errors.push(String(e)));
try{
await page.goto(pathToFileURL(file).href);
for(let attempt=0;attempt<15&&(!receipt.won||!receipt.lost);attempt++){
 await page.getByRole('button',{name:'暖场 6×6',exact:true}).click();
 const knownMines=new Set();let steps=0;
 for(;steps<38;steps++){
  const status=await page.evaluate(()=>window.msGetState().status);
  if(status==='won'||status==='lost'){
   receipt[status]=true;receipt.games.push({attempt,status,steps});
   await page.screenshot({path:`${out}/game-${status}.png`});
   const before=await page.evaluate(()=>window.msGetState());
   await page.locator('[data-row][data-col]').first().dispatchEvent('click');
   assert.deepEqual(await page.evaluate(()=>window.msGetState()),before);
   break;
  }
  const cells=await page.locator('[data-row][data-col]').evaluateAll(es=>es.map(e=>({r:+e.dataset.row,c:+e.dataset.col,open:e.classList.contains('revealed'),n:Number(e.textContent.trim())||0})));
  const safe=new Set();let changed=true;
  while(changed){changed=false;
   for(const cell of cells.filter(c=>c.open)){
    const neighbors=cells.map((c,i)=>({...c,i})).filter(c=>Math.abs(c.r-cell.r)<=1&&Math.abs(c.c-cell.c)<=1&&!(c.r===cell.r&&c.c===cell.c));
    const unknown=neighbors.filter(c=>!c.open&&!knownMines.has(c.i));
    const mines=neighbors.filter(c=>knownMines.has(c.i)).length;
    if(cell.n===mines)for(const c of unknown)safe.add(c.i);
    if(unknown.length&&cell.n-mines===unknown.length)for(const c of unknown){knownMines.add(c.i);changed=true;}
   }
  }
  const unknown=cells.map((c,i)=>({...c,i})).filter(c=>!c.open&&!knownMines.has(c.i));
  if(!unknown.length)break;
  const target=[...safe][0]??unknown[Math.floor(Math.random()*unknown.length)].i;
  await page.locator('[data-row][data-col]').nth(target).click();
 }
}
assert.ok(receipt.won&&receipt.lost,'Need to observe both normal game endings');
await page.getByRole('button',{name:'重新开始',exact:true}).click();assert.equal((await page.evaluate(()=>window.msGetState())).status,'ready');
receipt.resetAfterEnd=true;
}catch(e){receipt.failure=String(e);}finally{await context.close();await browser.close();await writeFile(`${out}/game-outcomes.json`,JSON.stringify(receipt,null,2));}
console.log(JSON.stringify(receipt,null,2));
