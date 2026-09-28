import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const ffmpeg = 'E:/Users/27837/Tools/ffmpeg/ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe';
const work = '.test-output/video-edit';
await mkdir(work, { recursive: true });
const segments = [
  [202, 222, '普通用户提出需求：不用安装、不写代码'],
  [437, 452, 'Step 5 Preview 主控；MiniMax 制作；MiMo 检查'],
  [612, 620, '第一版出现遮罩，无法操作——保留真实问题'],
  [700, 712, '用户用日常语言反馈，主控继续修复'],
  [1974, 1986, '多轮修复后：立即翻格、首击安全、计时'],
  [2032, 2055, '实际操作：右键插旗、取消、重开和切换难度'],
  [2058, 2067, '390px 移动视口：格子加大，左右滑动看全', 'mobile'],
  [2084, 2093, '踩雷后显示结果，并提供重新开始'],
  [2390, 2405, 'Step 5 Preview 交付：双击 index.html 即可玩'],
  [2405, 2412, '检查成员未完成报告；最终由 Codex 独立浏览器验收'],
];
await writeFile(`${work}/header.txt`, '真实录屏节选 · 等待与环境准备已省略 · 无配音');
const font = "fontfile='C\\:/Windows/Fonts/msyh.ttc'";
async function run(args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(Error(`ffmpeg exit ${code}`)));
  });
}
const clips = [];
for (const [index, [start, end, caption, kind]] of segments.entries()) {
  const text = `${work}/caption-${index}.txt`;
  await writeFile(text, caption);
  const frame = kind === 'mobile'
    ? 'crop=390:844:0:0,pad=1440:960:525:58:color=0x20252d'
    : 'scale=1440:960';
  const filter = `${frame},pad=1440:1064:0:0:color=0x17202b,drawtext=${font}:textfile=${work}/header.txt:fontcolor=0xb8c7d8:fontsize=20:x=32:y=978,drawtext=${font}:textfile=${text}:fontcolor=white:fontsize=26:x=32:y=1013`;
  const output = `${work}/clip-${index}.mp4`;
  await run(['-ss', String(start), '-i', 'demo/recordings/minesweeper-full.webm', '-t', String(end - start), '-vf', filter, '-an', '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '4', output]);
  clips.push(output);
  console.log(`Rendered real-footage segment ${index + 1}/${segments.length}`);
}
await writeFile(`${work}/concat.txt`, clips.map(path => `file '${resolve(path).replaceAll('\\', '/')}'`).join('\n'));
await run(['-f', 'concat', '-safe', '0', '-i', `${work}/concat.txt`, '-c', 'copy', '-movflags', '+faststart', 'demo/recordings/minesweeper-demo.mp4']);
await writeFile('demo/recordings/edit-manifest.json', JSON.stringify({ source: 'minesweeper-full.webm', realTimeFootage: true, playbackSpeed: 1, segments, note: 'Actual frames only; waits/preflight omitted; mobile viewport is cropped and centered; captions added.' }, null, 2));
console.log('Demo video ready.');
