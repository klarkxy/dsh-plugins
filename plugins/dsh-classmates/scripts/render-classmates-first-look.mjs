import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const ffmpeg='E:/Users/27837/Tools/ffmpeg/ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe';
const work='.test-output/classmates-first-look/render';
const sources={run:'demo/recordings/minesweeper-v2-full.webm',intro:'demo/recordings/classmates-intro.webm'};
const base='demo/recordings/classmates-first-look';
await mkdir(work,{recursive:true});
// Source intervals are actual screen recordings at their original speed.
// Long waits are cut; no UI recreation, freeze frames, or time stretching.
const sections=JSON.parse(await readFile(`${base}/edit-plan.json`,'utf8'));
const filters={full:'scale=1440:960',config:'crop=1200:800:150:60,scale=1440:960',team:'crop=1080:720:350:0,scale=1440:960',member:'crop=1080:720:350:60,scale=1440:960',mobile:'crop=390:844:0:0,scale=-2:960,pad=1440:960:(ow-iw)/2:0:color=0x101827'};
async function run(args){return new Promise((ok,fail)=>{const c=spawn(ffmpeg,['-v','error','-y',...args],{stdio:'inherit'});c.on('error',fail);c.on('exit',code=>code===0?ok():fail(Error(`ffmpeg ${code}`)));});}
const list=paths=>paths.map(p=>`file '${resolve(p).replaceAll('\\','/')}'`).join('\n');
const narration=JSON.parse(await readFile(`${base}/narration.json`,'utf8'));
let timeline=0;const rendered=[],metadata=[];
for(const section of sections){
 const pieces=[];let duration=0;
 for(const[i,[source,start,length,crop]]of section.clips.entries()){
  const file=`${work}/${section.id}-${i}.mp4`;
  await run(['-ss',String(start),'-i',sources[source],'-t',String(length),'-vf',filters[crop],'-an','-r','25','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-threads','4',file]);
  pieces.push(file);duration+=length;
 }
 const concat=`${work}/${section.id}.txt`;await writeFile(concat,list(pieces));
 const file=`${work}/section-${section.id}.mp4`;
 await run(['-f','concat','-safe','0','-i',concat,'-i',`${base}/voice/${section.id}.mp3`,'-map','0:v:0','-map','1:a:0','-c:v','copy','-af',`adelay=400,apad=whole_dur=${duration},loudnorm=I=-16:TP=-1.5:LRA=7`,'-t',String(duration),'-c:a','aac','-b:a','160k','-ar','48000',file]);
 metadata.push({...section,title:narration.find(n=>n.id===section.id).title,timelineStart:timeline,duration});
 timeline+=duration;rendered.push(file);console.log(`SECTION_READY ${section.id} ${duration}s`);
}
await writeFile(`${work}/all.txt`,list(rendered));
await run(['-f','concat','-safe','0','-i',`${work}/all.txt`,'-c:v','copy','-af','aresample=async=1:first_pts=0','-c:a','aac','-b:a','160k','-t',String(timeline),'-movflags','+faststart','demo/recordings/classmates-first-look.mp4']);
await run(['-i','demo/recordings/classmates-first-look.mp4','-vn','-ac','1','-ar','24000','-c:a','libmp3lame','-b:a','96k',`${base}/narration-mix.mp3`]);
await writeFile(`${base}/edit-manifest.json`,JSON.stringify({video:'classmates-first-look.mp4',duration:timeline,voice:'Chinese (Mandarin)_Crisp_Girl',speechModel:'speech-2.8-hd',speed:1.03,playbackSpeed:1,bottomCaptionBar:false,burnedSubtitles:false,sources,sections:metadata,note:'All footage is real recorded UI. Chronological waiting gaps are removed; some earlier configuration or completion views are placed beside matching narration. No synthetic UI or reenacted model output.'},null,2));
console.log(`VIDEO_READY ${timeline}s`);

