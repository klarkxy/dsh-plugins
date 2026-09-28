// Actual UI walkthrough of the existing demo profile; model calls are disabled.
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
process.env.DSH_HOME=resolve('.test-output/minesweeper-v2-native/home');
process.env.DSH_TELEMETRY_DISABLED='1';
process.env.OCG_API_KEY='recording-no-model-calls';
process.env.NO_UPDATE_NOTIFIER='1';
const workspace=resolve('demo/minesweeper-v2-run');
const realFetch=globalThis.fetch;
let blockedCalls=0;
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url.startsWith('http://127.0.0.1:19042/')){blockedCalls++;throw Error('Model calls disabled during UI walkthrough');}
 return realFetch(input,init);
};
const {loadLayeredEnv}=await import('@deepseek-ai/dsh-app-boot');
const {runProfile}=await import('@deepseek-ai/dsh/profile-boot');
process.chdir(workspace);
const {shutdown}=await runProfile({environment:loadLayeredEnv('classmates-intro',workspace),profile:'minesweeper-v2',patchFiles:[],args:['--host','127.0.0.1','--port','19437','--no-open']});
console.log('INTRO_READY');
for await(const line of createInterface({input:process.stdin}))if(line.trim()==='stop'){console.log(`BLOCKED_MODEL_CALLS ${blockedCalls}`);await shutdown.shutdown(0);break;}
process.exit(0);
