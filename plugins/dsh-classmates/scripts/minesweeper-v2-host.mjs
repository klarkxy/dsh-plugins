import { mkdir, readFile, writeFile, cp, access, rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
const repo=process.cwd();
const root=resolve('.test-output/minesweeper-v2-native');
const home=join(root,'home');
const profile=join(home,'profiles','minesweeper-v2');
const workspace=resolve('demo/minesweeper-v2-run');
const evidence=resolve('demo/recordings/minesweeper-v2');
await mkdir(profile,{recursive:true}); await mkdir(evidence,{recursive:true});
process.env.DSH_HOME=home; process.env.DSH_TELEMETRY_DISABLED='1';
process.env.OCG_API_KEY='task-local-host-injected';
process.env.DSH_TEST_BROWSER_WS=(await readFile(join(root,'browser-endpoint.txt'),'utf8')).trim();
process.env.NO_UPDATE_NOTIFIER='1';
const modelConfig=JSON.parse(await readFile(resolve('demo/recordings/model-config-v2.json'),'utf8'));
const shared='先与主控明确任务、接口和写入范围，不要与其他成员同时覆盖同一文件。通过官方团队任务和消息交接，完成后给主控返回结果与证据。阅读工作区 AGENTS.md 的测试环境说明。不要读取凭据或修改工作区外的文件。';
const roles=[
  {id:'designer',name:'界面制作同学',description:'负责视觉设计、页面与交互，把作品做得清晰精致、适合普通人直接使用。',model:{provider:'ocg',id:'mimo-v2.6-pro'},instructions:shared},
  {id:'engineer',name:'规则工程同学',description:'负责核心规则与功能实现，和界面成员约定稳定接口，验证规则和边界情况。',model:{provider:'ocg',id:'step-5-preview',reasoningEffort:'high'},instructions:shared},
  {id:'tester',name:'实机体验同学',description:'通过真实浏览器检查桌面和手机流程，复现问题并提供证据；默认不修改产品代码。',model:{provider:'ocg',id:'mimo-v2.6-flash'},instructions:shared+'请实际连接已就绪的浏览器服务，执行用户操作，不能用代码阅读代替交互验收。测试脚本与报告可以写入主控分配的路径。'},
  {id:'reviewer',name:'独立复核同学',description:'独立检查实现、协作交接和修复结果，必要时用真实浏览器复现，明确区分已验证和未验证。',model:{provider:'ocg',id:'space-bunny'},instructions:shared+'默认不修改产品代码；发现具体问题应给主控可复现步骤，不把成员的自述当作通过证据。'},
].map(r=>({schemaVersion:1,revision:1,enabled:true,...r}));
const patch=[
  {id:'agent-default-model',config:{provider:'ocg',model:'step-5-preview',reasoningEffort:'high'}},
  {id:'session-title-llm',disabled:true},
  {id:'llm-pi-ai',config:{providers:{ocg:{displayName:'Local OCG',apiKeyEnv:'OCG_API_KEY',api:'openai-completions',baseURL:'http://127.0.0.1:19042/v1',compat:{supportsDeveloperRole:false,thinkingFormat:'openai',supportsReasoningEffort:true},models:modelConfig.models.map(m=>({id:m.id,name:m.id,contextWindow:m.contextWindow,maxTokens:m.maxTokens,input:m.input??['text','image'],reasoningEfforts:m.id==='step-5-preview'?{low:'low',medium:'medium',high:'high'}:false,compat:{maxTokensField:m.maxTokensField}}))}}}},
  {id:'classmates',config:{roles}},
  {id:'ui-theme',config:{preference:'light'}},
  {id:'ui-settings-general',name:'@deepseek-ai/dsh-client-ui-settings-general',config:{welcomeNoticeVersion:'2026-08-13.1'}},
  {id:'directory-picker',disabled:true},
  {insert:[{id:'demo-directory-browse',name:'@deepseek-ai/dsh-host-directory-picker-browse'},{id:'demo-directory-browse-ui',name:'@deepseek-ai/dsh-client-ui-directory-picker-browse'}]},
];
const {initProfile,loadLayeredEnv}=await import('@deepseek-ai/dsh-app-boot');
const {runProfile}=await import('@deepseek-ai/dsh/profile-boot');
initProfile(profile,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@deepseek-ai/dsh-experimental-agent-team-profile','@klarkxy/dsh-classmates']);
const localPlugin=join(profile,'node_modules','@klarkxy','dsh-classmates');
await mkdir(localPlugin,{recursive:true});
for(const name of ['dist','package.json','cordis.patch.yml']) await cp(join(repo,name),join(localPlugin,name),{recursive:true});
let existingPatch='';try{existingPatch=await readFile(join(profile,'cordis.patch.yml'),'utf8');}catch{}
if(!existingPatch.includes('llm-pi-ai'))await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify(patch,null,2));
// Only environment instructions are seeded; all product code is left to the DSH team.
await writeFile(join(workspace,'AGENTS.md'),`# 本轮测试环境\n\n这是全新的扫雷工作目录。所有产品实现由本次团队完成，不要读取旧版扫雷目录。\n\n- Node.js 和 @playwright/test 已在父工程安装，可直接从本目录的 .mjs 脚本导入。PowerShell 执行环境可用。\n- Windows 受限进程不能直接启动浏览器。本轮已提供独立本机 Edge 浏览器服务，并已通过同一沙箱链路完成真实点击和截图预检。请在 Node 脚本中使用 await chromium.connect(process.env.DSH_TEST_BROWSER_WS)，再 newContext/newPage。不要使用 chromium.launch 或 playwright-cli 启动新进程，也不要重启/关闭整个共享服务。\n- 每位测试者创建自己的 browser.newContext，使用完关闭自己的 context 和连接。不要修改其他成员页面。\n- 需要浏览器访问作品时，可使用 pathToFileURL 指向本目录页面；若需要 HTTP，使用 Node 标准库在 127.0.0.1 的本地端口服务本目录。\n- 实际执行命令用 node <脚本路径>；测试代码写在文件中，避免复杂 PowerShell 多层转义。\n- 成员依任务分工写入明确范围；测试和复核成员默认只读产品代码，报告与测试脚本可写到约定的独立目录。\n- 不读取凭据，不修改工作区之外的文件。\n`);
for(const name of ['sandbox-probe.txt','sandbox-browser-probe.png']) await rm(join(workspace,name),{force:true});
const db=new DatabaseSync('C:/Users/27837/.ocg-mgr/data.sqlite',{readOnly:true});
const key=db.prepare('SELECT key FROM access_keys WHERE is_primary=1 AND enabled=1 AND deleted_at IS NULL').get().key;db.close();
let receipt={startedAt:new Date().toISOString(),requests:[],wire:[],tools:[],turns:[],boots:[]};
try{receipt=JSON.parse(await readFile(join(evidence,'live-evidence.json'),'utf8'));}catch{}
receipt.boots.push(new Date().toISOString());
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url.startsWith('http://127.0.0.1:19042/')){
    const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${key}`);
    if(typeof init?.body==='string'){
      const b=JSON.parse(init.body);receipt.wire.push({at:new Date().toISOString(),model:b.model,max_tokens:b.max_tokens??null,max_completion_tokens:b.max_completion_tokens??null,reasoning_effort:b.reasoning_effort??null,assistantHistory:b.messages?.filter(m=>m.role==='assistant').length??0,reasoningHistory:b.messages?.filter(m=>m.role==='assistant'&&m.reasoning_content).length??0});
    }
    return realFetch(input,{...init,headers});
  } return realFetch(input,init);
};
process.chdir(workspace);
const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('classmates-minesweeper-v2',workspace),profile:'minesweeper-v2',patchFiles:[],args:['--host','127.0.0.1','--port','19435','--no-open']});
ctx.on('session/event',(session,event)=>{
  if(event.type==='request/header'){const c=event.data.header.config;receipt.requests.push({session:session.id,provider:c.provider,model:c.model,effort:c.reasoningEffort??null,maxTokens:c.maxTokens??null});}
  if(event.type==='assistant/message')for(const b of event.data.message.content)if(b.type==='tool-call')receipt.tools.push({at:new Date().toISOString(),session:session.id,callId:b.id,name:b.name});
  if(event.type==='tool/result')receipt.tools.push({at:new Date().toISOString(),session:session.id,callId:event.data.message.toolCallId,isError:event.data.message.isError});
  if(event.type==='turn/end')receipt.turns.push({at:new Date().toISOString(),session:session.id,reason:event.data.reason.kind});
});
const persist=()=>writeFile(join(evidence,'live-evidence.json'),JSON.stringify(receipt,null,2));
const interval=setInterval(()=>void persist(),5000);
console.log('V2_READY');
for await(const line of createInterface({input:process.stdin})){
  if(line.trim()==='state')console.log(JSON.stringify({agents:ctx.agents.list().map(a=>({id:a.id,role:ctx.agentTeams.tryMembership(a)?.role,members:ctx.agentTeams.tryMembership(a)?.role==='lead'?ctx.agentTeams.listMembers(a):undefined})),wire:receipt.wire.length,recentTools:receipt.tools.slice(-12),turns:receipt.turns.slice(-6)}));
  if(line.trim()==='stop'){clearInterval(interval);await persist();await shutdown.shutdown(0);break;}
}
process.exit(0);
