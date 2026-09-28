import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const base='demo/recordings/classmates-first-look';
await mkdir(`${base}/voice`,{recursive:true});
const narration=JSON.parse(await readFile(`${base}/narration.json`,'utf8'));
for(const part of narration){
 const path=`${base}/voice/${part.id}`;
 await writeFile(`${path}.txt`,part.text);
 try{await access(`${path}.mp3`);console.log(`VOICE_EXISTS ${part.id}`);continue;}catch{}
 await new Promise((ok,fail)=>{const c=spawn(process.execPath,['C:/Users/27837/AppData/Roaming/npm/node_modules/mmx-cli/dist/mmx.mjs','speech','synthesize','--text-file',`${path}.txt`,'--voice','Chinese (Mandarin)_Crisp_Girl','--speed','1.03','--out',`${path}.mp3`,'--subtitles','--non-interactive','--quiet'],{stdio:'inherit'});c.on('error',fail);c.on('exit',code=>code===0?ok():fail(Error(`mmx ${code}`)));});
 console.log(`VOICE_READY ${part.id}`);
}
