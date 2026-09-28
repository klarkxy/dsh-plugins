import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const manifest=JSON.parse(await readFile('demo/recordings/classmates-first-look/edit-manifest.json','utf8'));
const narration=JSON.parse(await readFile('demo/recordings/classmates-first-look/narration.json','utf8'));
const asr=JSON.parse(await readFile('.test-output/classmates-first-look/subtitle-timing.json','utf8'));
const isWord=c=>/[\p{L}\p{N}]/u.test(c);
const width=s=>[...s].reduce((n,c)=>n+(/[\x00-\x7f]/.test(c)?0.55:1),0);
const cues=[];
for(const section of manifest.sections){
  const source=narration.find(n=>n.id===section.id).text;
  const truth=[...source].flatMap((c,i)=>isWord(c)?[{c:c.toLowerCase(),i}]:[]);
  const heard=[];
  for(const s of asr.segments.filter(s=>s.start>=section.timelineStart&&s.start<section.timelineStart+section.duration)){
    const chars=[...s.text].filter(isWord);
    chars.forEach((c,i)=>heard.push({c:c.toLowerCase(),start:s.start+(s.end-s.start)*i/chars.length,end:s.start+(s.end-s.start)*(i+1)/chars.length}));
  }
  // Align the approved narration to word timestamps, preserving correct text over ASR homophones.
  const rows=truth.length+1,cols=heard.length+1;
  const dp=Array.from({length:rows},()=>new Uint16Array(cols));
  for(let i=0;i<rows;i++)dp[i][0]=i;
  for(let j=0;j<cols;j++)dp[0][j]=j;
  for(let i=1;i<rows;i++)for(let j=1;j<cols;j++)dp[i][j]=Math.min(dp[i-1][j-1]+(truth[i-1].c===heard[j-1].c?0:1),dp[i-1][j]+1,dp[i][j-1]+1);
  const aligned=new Map();let i=truth.length,j=heard.length;
  while(i||j){
    if(i&&j&&dp[i][j]===dp[i-1][j-1]+(truth[i-1].c===heard[j-1].c?0:1)){aligned.set(truth[i-1].i,heard[j-1]);i--;j--;}
    else if(i&&dp[i][j]===dp[i-1][j]+1)i--;else j--;
  }
  const chunks=[];let buffer='',offset=0,position=0;
  for(const clause of source.match(/[^，。；：！？]+[，。；：！？]?/gu)??[]){
    if(buffer&&width(buffer+clause)>28){chunks.push({text:buffer,offset});buffer='';offset=position;}
    if(!buffer)offset=position;
    buffer+=clause;position+=clause.length;
    if(/[。！？]$/.test(clause)){chunks.push({text:buffer,offset});buffer='';offset=position;}
  }
  if(buffer)chunks.push({text:buffer,offset});
  for(const chunk of chunks){
    const times=[...aligned].filter(([k])=>k>=chunk.offset&&k<chunk.offset+chunk.text.length).map(([,v])=>v);
    if(!times.length)throw Error('Unaligned subtitle');
    const text=chunk.text.trim().replace(/Step Five Preview/g,'Step 5 Preview').replace(/MiniMax M 三/g,'MiniMax M3').replace(/MiMo 二点六 Flash/g,'MiMo V2.6 Flash').replace(/MiMo 二点六 Pro/g,'MiMo V2.6 Pro').replace(/[，。；：]$/,'');
    if(width(text)>39)throw Error(`Subtitle too wide: ${text}`);
    cues.push({start:Math.min(...times.map(t=>t.start)),end:Math.max(...times.map(t=>t.end))+0.13,text});
  }
}
cues.sort((a,b)=>a.start-b.start);
for(let i=0;i<cues.length;i++){if(cues[i+1])cues[i].end=Math.min(cues[i].end,cues[i+1].start-0.02);if(cues[i].end<=cues[i].start)throw Error('Invalid cue');}
function time(t,ass=false){let n=Math.round(t*(ass?100:1000));const base=ass?100:1000;const fract=n%base;n=Math.floor(n/base);const s=n%60;n=Math.floor(n/60);const m=n%60;const h=Math.floor(n/60);return `${ass?h:String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${ass?'.':','}${String(fract).padStart(ass?2:3,'0')}`;}
const stem='demo/recordings/classmates-first-look-zh';
await writeFile(`${stem}.srt`,cues.map((c,i)=>`${i+1}\n${time(c.start)} --> ${time(c.end)}\n${c.text}\n`).join('\n'));
const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1440\nPlayResY: 960\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Microsoft YaHei,34,&H00FFFFFF,&H00FFFFFF,&H00141414,&H90000000,0,0,0,0,100,100,0,0,1,2.2,1,2,70,70,34,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`+cues.map(c=>`Dialogue: 0,${time(c.start,true)},${time(c.end,true)},Default,,0,0,0,,${c.text}`).join('\n');
await writeFile(`${stem}.ass`,ass);
await mkdir('.test-output/classmates-first-look',{recursive:true});
await writeFile('.test-output/classmates-first-look/subtitle-cues.json',JSON.stringify(cues,null,2));
console.log(`SUBTITLES_READY ${cues.length} cues`);
if(process.argv.includes('--render'))await new Promise((ok,fail)=>{
  const p=spawn('E:/Users/27837/Tools/ffmpeg/ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe',['-v','error','-y','-i','demo/recordings/classmates-first-look.mp4','-vf',`ass=${stem}.ass`,'-c:v','libx264','-preset','fast','-crf','20','-threads','4','-c:a','copy','-movflags','+faststart',`${stem}.mp4`],{stdio:'inherit'});
  p.on('error',fail);p.on('exit',c=>c===0?ok():fail(Error(`ffmpeg ${c}`)));
});


