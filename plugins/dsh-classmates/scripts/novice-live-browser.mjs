import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
const dir=resolve('demo/recordings/novice-live');await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir,size:{width:1440,height:1000}}});
const page=await context.newPage();page.setDefaultTimeout(8000);let prompts=[];try{prompts=JSON.parse(await readFile(`${dir}/prompts.json`,'utf8'));}catch{}let shot=0;
page.on('pageerror',e=>console.log('PAGE_ERROR',String(e)));
console.log('BROWSER_READY');
for await(const line of createInterface({input:process.stdin})){
 try{const c=JSON.parse(line);
 if(c.action==='open')await page.goto(c.url);
 if(c.action==='click')await page.getByRole(c.role??'button',{name:c.name,exact:true}).click();
 if(c.action==='text')await page.getByText(c.text,{exact:true}).click();
 if(c.action==='press')await page.getByRole('textbox').last().press(c.key);
 if(c.action==='controls')console.log(await page.locator('button').evaluateAll(es=>es.map(e=>({text:e.innerText,label:e.getAttribute('aria-label')}))));
 if(c.action==='prompt'){
  if(/[\r\n]/.test(c.text)||[...c.text].length>50)throw Error('Prompt must be one line, at most 50 characters');
  await page.getByRole('textbox').last().fill(c.text);await page.getByRole('textbox').last().press('Enter');
  prompts.push({at:new Date().toISOString(),text:c.text,characters:[...c.text].length});await writeFile(`${dir}/prompts.json`,JSON.stringify(prompts,null,2));
 }
 if(c.action==='shot')await page.screenshot({path:`${dir}/${c.name??`screen-${++shot}`}.png`});
 if(c.action==='stop')break;
 const transcript=await page.locator('body').innerText();await writeFile(`${dir}/latest-ui.txt`,transcript);console.log(transcript.slice(-6500));
 console.log('URL',page.url());
 }catch(e){console.log('ERROR',String(e));}
}
await context.close();await browser.close();process.exit(0);
