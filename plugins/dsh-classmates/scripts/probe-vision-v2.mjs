import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
const db=new DatabaseSync('C:/Users/27837/.ocg-mgr/data.sqlite',{readOnly:true});
const key=db.prepare('SELECT key FROM access_keys WHERE is_primary=1 AND enabled=1 AND deleted_at IS NULL').get().key;db.close();
const config=JSON.parse(await readFile('demo/recordings/model-config-v2.json','utf8'));
const png=await readFile('demo/minesweeper-v2-run/tests/shots/smoke-connect.png');
const results=[];
for(const model of config.models){
 const r=await fetch('http://127.0.0.1:19042/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:model.id,[model.maxTokensField]:model.maxTokens,...(model.reasoningEffort?{reasoning_effort:model.reasoningEffort}:{}),messages:[{role:'user',content:[{type:'text',text:'读取图片上的英文标题，只输出标题，不解释。'},{type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]}]}),signal:AbortSignal.timeout(180000)});
 const j=await r.json();const result={model:model.id,status:r.status,answer:j.choices?.[0]?.message?.content,error:j.error};results.push(result);console.log(JSON.stringify(result));
 await writeFile('demo/recordings/minesweeper-v2/vision-probes.json',JSON.stringify(results,null,2));
}
