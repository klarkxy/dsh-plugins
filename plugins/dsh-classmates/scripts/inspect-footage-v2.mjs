import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const ff='E:/Users/27837/Tools/ffmpeg/ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe';
const dir='.test-output/team-edit-v2/qa';await mkdir(dir,{recursive:true});
const times=[2840,2945,246,438,480,862,1070,3202,510,2075,3500,645,1940,1548,1754,1804,3858,2480,3470,3812,3790,3904,3880,3933];
async function run(a){await new Promise((ok,fail)=>{const c=spawn(ff,['-v','error','-y',...a],{stdio:'inherit'});c.on('exit',x=>x===0?ok():fail(Error(String(x))));c.on('error',fail);});}
for(let i=0;i<times.length;i++)await run(['-ss',String(times[i]),'-i','demo/recordings/minesweeper-v2-full.webm','-frames:v','1','-vf','scale=360:240',`${dir}/${i}.png`]);
for(let p=0;p<2;p++){
 const inputs=Array.from({length:12},(_,i)=>['-i',`${dir}/${p*12+i}.png`]).flat();
 const layout=Array.from({length:12},(_,i)=>`${(i%4)*360}_${Math.floor(i/4)*240}`).join('|');
 await run([...inputs,'-filter_complex',`xstack=inputs=12:layout=${layout}`,'-frames:v','1',`${dir}/sheet-${p}.png`]);
}
await writeFile(`${dir}/index.json`,JSON.stringify(times));
