import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
const repo=process.cwd(),root=resolve('.test-output/novice-live'),workspace=resolve('demo/novice-minesweeper'),evidence=resolve('demo/recordings/novice-live');
await mkdir(workspace,{recursive:true});await mkdir(evidence,{recursive:true});
if((await readdir(workspace)).length)throw Error('Fresh run requires an empty workspace');
process.env.DSH_HOME=join(root,'home');process.env.DSH_TELEMETRY_DISABLED='1';process.env.NO_UPDATE_NOTIFIER='1';process.env.OCG_API_KEY='task-local-host-injected';
const profile=join(process.env.DSH_HOME,'profiles','novice-live');
const db=new DatabaseSync('C:/Users/27837/.ocg-mgr/data.sqlite',{readOnly:true});
const key=db.prepare('SELECT key FROM access_keys WHERE is_primary=1 AND enabled=1 AND deleted_at IS NULL').get().key;db.close();
const response=await fetch('http://127.0.0.1:19042/v1/models',{headers:{Authorization:`Bearer ${key}`}});
if(!response.ok)throw Error(`Model catalog ${response.status}`);
const catalog=await response.json(),ids=['step-5-preview','mimo-v2.6-flash','space-bunny'];
for(const id of ids)if(!catalog.data.some(m=>m.id===id))throw Error(`Missing ${id}`);
console.log('AVAILABLE_MODELS',ids);
const modelConfig=JSON.parse(await readFile(join(repo,'demo/recordings/model-config-v2.json'),'utf8'));
const {initProfile,loadLayeredEnv}=await import('@deepseek-ai/dsh-app-boot');
const {runProfile}=await import('@deepseek-ai/dsh/profile-boot');
initProfile(profile,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@deepseek-ai/dsh-experimental-agent-team-profile','@klarkxy/dsh-classmates']);
const plugin=join(profile,'node_modules/@klarkxy/dsh-classmates');await mkdir(plugin,{recursive:true});
execFileSync('tar',['-xf',join(repo,'klarkxy-dsh-classmates-0.2.0-alpha.1.tgz'),'-C',plugin,'--strip-components=1']);
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([
 {id:'agent-default-model',config:{provider:'ocg',model:'step-5-preview',reasoningEffort:'high'}},
 {id:'session-title-llm',disabled:true},
 {id:'llm-pi-ai',config:{providers:{ocg:{displayName:'Local OCG',apiKeyEnv:'OCG_API_KEY',api:'openai-completions',baseURL:'http://127.0.0.1:19042/v1',compat:{supportsDeveloperRole:false,thinkingFormat:'openai',supportsReasoningEffort:true},models:modelConfig.models.filter(m=>ids.includes(m.id)).map(m=>({id:m.id,name:m.id,contextWindow:m.contextWindow,maxTokens:m.maxTokens,input:m.input??['text','image'],reasoningEfforts:m.id==='step-5-preview'?{low:'low',medium:'medium',high:'high'}:false,compat:{maxTokensField:m.maxTokensField}}))}}}},
 {id:'classmates',config:{roles:[]}},
 {id:'ui-theme',config:{preference:'light'}},
 {id:'ui-settings-general',name:'@deepseek-ai/dsh-client-ui-settings-general',config:{welcomeNoticeVersion:'2026-08-13.1'}}
],null,2));
const receipt={startedAt:new Date().toISOString(),initialWorkspaceFiles:[],initialRoles:[],availableModels:ids,requests:[],wire:[],tools:[],turns:[]};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url.startsWith('http://127.0.0.1:19042/')){
  const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${key}`);
  if(typeof init?.body==='string'){const b=JSON.parse(init.body);receipt.wire.push({at:new Date().toISOString(),model:b.model});}
  return originalFetch(input,{...init,headers});
 }return originalFetch(input,init);
};
process.chdir(workspace);
const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('classmates-novice-live',workspace),profile:'novice-live',patchFiles:[],args:['--host','127.0.0.1','--port','19445','--no-open']});
ctx.on('session/event',(session,event)=>{
 if(event.type==='request/header'){const c=event.data.header.config;receipt.requests.push({at:new Date().toISOString(),session:session.id,provider:c.provider,model:c.model,effort:c.reasoningEffort??null});}
 if(event.type==='assistant/message')for(const b of event.data.message.content)if(b.type==='tool-call')receipt.tools.push({at:new Date().toISOString(),session:session.id,callId:b.id,name:b.name});
 if(event.type==='tool/result')receipt.tools.push({at:new Date().toISOString(),session:session.id,callId:event.data.message.toolCallId,isError:event.data.message.isError});
 if(event.type==='turn/end')receipt.turns.push({at:new Date().toISOString(),session:session.id,reason:event.data.reason.kind});
});
const persist=()=>writeFile(join(evidence,'live-evidence.json'),JSON.stringify(receipt,null,2));
const timer=setInterval(()=>void persist(),5000);
await ctx.workspaceRegistry.create(workspace,'新手扫雷');
console.log('NOVICE_READY');
for await(const line of createInterface({input:process.stdin})){
 try{
 if(line.trim()==='state')console.log(JSON.stringify({agents:ctx.agents.list().map(a=>({id:a.id,membership:ctx.agentTeams.tryMembership(a)})),wire:receipt.wire.length,tools:receipt.tools.slice(-10),turns:receipt.turns.slice(-5)}));
 if(line.trim()==='roles')console.log(JSON.stringify(await ctx.get('classmatesController').load()));
 if(line.trim()==='stop'){clearInterval(timer);await persist();await shutdown.shutdown(0);break;}
 }catch(e){console.error(String(e));}
}
process.exit(0);
