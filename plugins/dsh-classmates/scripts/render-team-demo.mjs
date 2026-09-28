import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const ffmpeg = 'E:/Users/27837/Tools/ffmpeg/ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe';
const work = '.test-output/team-edit/render';
await mkdir(work, { recursive: true });
const originals = 'demo/recordings/minesweeper-full.webm';
const history = 'demo/recordings/team-history-inspection.webm';
// Every interval is actual recorded UI at original speed. No composited UI or freeze frames.
// The voice announces the switch from original execution to post-run history inspection.
const sections = [
  { id:'01', clips:[['live',202,22,'full']] },
  { id:'02', clips:[['live',437,48,'team']] },
  { id:'03', clips:[['live',523,38,'member']] },
  { id:'04', clips:[['history',26,10,'team'],['history',122,17,'member'],['history',285,15,'member']] },
  { id:'05', clips:[['history',148,12,'member'],['live',612,7,'full'],['history',314,24,'member']] },
  { id:'06', clips:[['history',363.5,19,'member'],['history',397.8,22,'member']] },
  { id:'07', clips:[['history',501,11,'member'],['history',531,32,'member']] },
  { id:'08', clips:[['history',576,41,'team']] },
  { id:'09', clips:[['history',617,12,'team'],['live',1975,8,'full'],['history',629,16,'team']] },
];
const filters = {
  full: 'scale=1440:960',
  team: 'crop=1080:720:350:0,scale=1440:960',
  member: 'crop=1200:800:240:0,scale=1440:960',
};
async function run(args) {
  return new Promise((ok, fail) => {
    const child = spawn(ffmpeg, ['-v','error','-y',...args], { stdio:'inherit' });
    child.once('error',fail);
    child.once('exit',code=>code===0?ok():fail(Error(`ffmpeg: ${code}`)));
  });
}
const list = paths=>paths.map(p=>`file '${resolve(p).replaceAll('\\','/')}'`).join('\n');
const rendered=[];
let timeline=0;
const metadata=[];
const narration=JSON.parse(await readFile('demo/recordings/team-narration.json','utf8'));
for (const section of sections) {
  const pieces=[];
  let duration=0;
  for (const [i,[source,start,length,crop]] of section.clips.entries()) {
    const file=`${work}/${section.id}-${i}.mp4`;
    await run(['-ss',String(start),'-i',source==='live'?originals:history,'-t',String(length),'-vf',filters[crop],'-an','-r','25','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-threads','4',file]);
    pieces.push(file); duration+=length;
  }
  const concat=`${work}/${section.id}.txt`;
  await writeFile(concat,list(pieces));
  const file=`${work}/section-${section.id}.mp4`;
  await run(['-f','concat','-safe','0','-i',concat,'-i',`demo/recordings/voice/${section.id}.mp3`,'-map','0:v:0','-map','1:a:0','-c:v','copy','-af',`adelay=400,apad=whole_dur=${duration},loudnorm=I=-16:TP=-1.5:LRA=7`,'-t',String(duration),'-c:a','aac','-b:a','160k','-ar','48000','-movflags','+faststart',file]);
  metadata.push({ ...section, title:narration.find(n=>n.id===section.id).title, timelineStart:timeline, duration });
  timeline+=duration; rendered.push(file);
  console.log(`Rendered section ${section.id}: ${duration}s`);
}
await writeFile(`${work}/all.txt`,list(rendered));
await run(['-f','concat','-safe','0','-i',`${work}/all.txt`,'-c:v','copy','-af','aresample=async=1:first_pts=0','-c:a','aac','-b:a','160k','-t',String(timeline),'-movflags','+faststart','demo/recordings/minesweeper-team-demo.mp4']);
await writeFile('demo/recordings/team-edit-manifest.json',JSON.stringify({ video:'minesweeper-team-demo.mp4',duration:timeline,voice:'Chinese (Mandarin)_Crisp_Girl',speechModel:'speech-2.8-hd',speechSpeed:1.03,playbackSpeed:1,bottomCaptionBar:false,burnedSubtitles:false,sources:{live:originals,history},sections:metadata,note:'Historical inspection is explicitly announced in narration. UI is actual footage, cropped for readability. Model calls disabled for inspection. No time stretching or fabricated UI.'},null,2));
console.log(`TEAM_VIDEO_READY ${timeline}s`);
