import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const base='demo/recordings/minesweeper-v2';
const parts=[
 {id:'10',title:'报告交接与独立验收',text:'收尾时，完成报告必须能对回实际证据。MiMo Flash 交出了桌面和触屏各六十四项通过的结果，也列明没有测试的设备和操作。Space Bunny 则发现了一条永远都会通过的测试断言，负责人让规则同学修正，再交回复核。我另外用独立浏览器完成十组验收，包括真实点格通关、触雷失败、长按取消旗，以及三次触摸双击展开。团队自述和外部验收，可以在这里互相核对。'},
 {id:'11',title:'这轮演示说明了什么',text:'这次演示的重点，是团队确实共同完成了任务：有人制作，有人检查，有人质疑，负责人还要处理反馈并收齐结果。它也暴露了实际成本：前期约定较长，测试脚本反复修正，不能因为换了新模型就省略检查。这里使用了预先配置好的本机环境，并有普通用户反馈；手机测试是触摸视口模拟。保留这些边界，才是一份可以回看的真实演示。游戏文件与完整录屏都随成片保留。'},
];
const existing=JSON.parse(await readFile(`${base}/narration.json`,'utf8'));
await writeFile(`${base}/narration.json`,JSON.stringify([...existing.filter(p=>!parts.some(q=>q.id===p.id)),...parts],null,2));
for(const part of parts){
 const path=`${base}/voice/${part.id}`;
 await writeFile(`${path}.txt`,part.text);
 await new Promise((ok,fail)=>{const child=spawn(process.execPath,['C:/Users/27837/AppData/Roaming/npm/node_modules/mmx-cli/dist/mmx.mjs','speech','synthesize','--text-file',`${path}.txt`,'--voice','Chinese (Mandarin)_Crisp_Girl','--speed','1.03','--out',`${path}.mp3`,'--subtitles','--non-interactive','--quiet'],{stdio:'inherit',shell:false});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error(`mmx ${code}`)));});
 console.log(`VOICE_READY ${part.id}`);
}
