import { DatabaseSync } from 'node:sqlite';
import { readFile,writeFile } from 'node:fs/promises';
const db=new DatabaseSync('C:/Users/27837/.ocg-mgr/data.sqlite',{readOnly:true});
const key=db.prepare('SELECT key FROM access_keys WHERE is_primary=1 AND enabled=1 AND deleted_at IS NULL').get().key; db.close();
const config=JSON.parse(await readFile('demo/recordings/model-config-v2.json','utf8'));
const receipts=[];
for (const model of config.models) {
  const started=Date.now();
  const params={model:model.id,[model.maxTokensField]:model.maxTokens,...(model.reasoningEffort?{reasoning_effort:model.reasoningEffort}:{}),messages:[{role:'user',content:'这是工具连通性预检。请调用 report_ready 工具，value 填 ready。不要读文件，不要做其他任务。'}],tools:[{type:'function',function:{name:'report_ready',description:'Report readiness',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}}]};
  try {
    const response=await fetch('http://127.0.0.1:19042/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(180000)});
    const body=await response.json();
    const choice=body.choices?.[0];
    const receipt={model:model.id,status:response.status,outputBudget:model.maxTokens,outputField:model.maxTokensField,effort:model.reasoningEffort??'provider default',finishReason:choice?.finish_reason,toolNames:choice?.message?.tool_calls?.map(t=>t.function.name),usage:body.usage,error:body.error,elapsedMs:Date.now()-started};
    if (choice?.message?.tool_calls?.length) {
      params.messages.push(choice.message,...choice.message.tool_calls.map(t=>({role:'tool',tool_call_id:t.id,content:'ready confirmed'})),{role:'user',content:'预检结束，只回复“就绪”。'});
      const r2=await fetch('http://127.0.0.1:19042/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(180000)});
      const j2=await r2.json(); receipt.followup={status:r2.status,finishReason:j2.choices?.[0]?.finish_reason,content:j2.choices?.[0]?.message?.content,error:j2.error};
    }
    receipts.push(receipt); console.log(JSON.stringify(receipt));
  } catch(error) { receipts.push({model:model.id,error:error.message,elapsedMs:Date.now()-started}); console.log(model.id,error.message); }
  await writeFile('demo/recordings/model-probes-v2.json',JSON.stringify(receipts,null,2));
}
