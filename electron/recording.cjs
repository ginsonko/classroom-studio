'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {atomicJSON,id,readJSON}=require('./core.cjs');
const children=new Set();
function runProcess(command,args,{timeout=300000,onOutput,lowPriority=false}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); let output='';children.add(child);
    // 后台生成回放时让出 CPU：下一节课的录制和腾讯会议更要紧
    if(lowPriority)try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
    const timer=setTimeout(()=>{child.kill();reject(new Error('处理超时，原录制文件已保留'));},timeout);
    const take=v=>{output=(output+v).slice(-12000);onOutput?.(String(v));};
    child.stdout.on('data',take);child.stderr.on('data',take);
    child.on('error',e=>{children.delete(child);clearTimeout(timer);reject(e);});
    child.on('close',code=>{children.delete(child);clearTimeout(timer);code===0?resolve(output):reject(new Error(output||'处理程序退出，代码 '+code));});
  });
}
const LIVE=['starting','recording','stopping'];
/** 微信发不了超过 1 小时的视频；每段按 59 分钟算，关键帧对齐后多出几秒也不会到 1 小时 */
const PART_MAX=59*60,PART_LIMIT=3600,PARTS_DIR='微信分段';
const safeName=s=>String(s||'').replace(/[\\/:*?"<>|\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
/** 读视频时长（秒）：ffmpeg 只给输入不给输出时会报错退出，时长在它打印的信息里 */
async function probeSeconds(ffmpeg,file){
  let text='';try{text=await runProcess(ffmpeg,['-hide_banner','-i',file],{timeout:60000});}catch(e){text=String(e.message||'');}
  const m=/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);return m?+m[1]*3600+ +m[2]*60+ +m[3]:0;
}
/** 切成 n 段时每段的起点（秒，不含 0） */
function cutTimes(seconds,n){return Array.from({length:n-1},(_,i)=>+(seconds*(i+1)/n).toFixed(2));}
/** 不超过 max 秒的最少段数（时长不超过 max 不切） */
const partCount=(seconds,max=PART_MAX)=>seconds>max?Math.ceil(seconds/max):1;
/**
 * 课堂录制：录制组件把 WebM 分块写进原始文件；下课后在后台排队转成 MP4。
 * 转码不算「忙」：老师可以马上关学生窗口、开始下一节课，顶部显示回放生成进度。
 */
class Recording {
 constructor({directory,ffmpeg,onChange,send,onSaved,split,label,onSplit,partLimits}){this.directory=directory;this.ffmpeg=ffmpeg;this.onChange=onChange;this.send=send;this.onSaved=onSaved;this.split=split;this.label=label;this.onSplit=onSplit;this.splitting=new Set();this.partLimits=partLimits;this.current=null;this.queue=Promise.resolve();this.metaQueue=Promise.resolve();this.jobs=[];this.jobRun=Promise.resolve();this.status={phase:'idle',bytes:0,micLevel:0,systemLevel:0,jobs:[]};}
 async disk(directory=this.directory){let target=directory;while(target){try{const v=await fsp.statfs(target);return {free:Number(v.bavail)*Number(v.bsize),total:Number(v.blocks)*Number(v.bsize)};}catch{const parent=path.dirname(target);if(parent===target)break;target=parent;}}return {free:null,total:null};}
 update(p){this.status={...this.status,...p,jobs:this.jobs.map(j=>({id:j.id,title:j.title,progress:j.progress}))};this.onChange(this.status);}
 get live(){return LIVE.includes(this.status.phase);}
 async start(settings,synthetic=false){
  if(this.live)throw new Error('上一段录制还未结束');
  this.directory=settings.recordings;await fsp.mkdir(this.directory,{recursive:true});
  if((await this.disk()).free<2*1024**3)throw new Error('录像目录可用空间不足 2 GB，请在设置中换一个磁盘');
  const recordId=id(), stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const folder=path.join(this.directory,stamp+'-'+recordId.slice(0,8));await fsp.mkdir(folder);
  const meta={id:recordId,title:settings.title||'课堂回放',studentId:settings.studentId||null,chapters:[],createdAt:new Date().toISOString(),phase:'starting',raw:path.join(folder,'capture.webm'),mp4:path.join(folder,'课堂回放.mp4'),bytes:0,synthetic,settings:{microphone:settings.microphone,systemAudio:settings.systemAudio,bitrate:settings.bitrate}};
  this.current={...meta,folder,handle:await fsp.open(meta.raw,'wx'),seq:0,voiceSeq:0,voiceBytes:0}; this.queue=Promise.resolve();this.voiceQueue=Promise.resolve();
  await atomicJSON(path.join(folder,'recording.json'),meta);
  this.update({phase:'starting',id:recordId,studentId:meta.studentId,bytes:0,error:null,warning:null,path:null,folder,micLevel:0,systemLevel:0,startedAt:null});
  this.send({type:'record:start',recordId,settings,synthetic});
  clearTimeout(this.startTimeout);this.startTimeout=setTimeout(()=>{if(this.status.phase==='starting')this.fail('录制未能启动，请检查音频设备后重试');},25000);
  return this.status;
 }
 async ready(data){if(!this.current||data.recordId!==this.current.id)return;if(this.status.phase!=='starting'){this.send({type:'record:abort',recordId:data.recordId});return;}clearTimeout(this.startTimeout);this.current.phase='recording';this.current.startedAt=Date.now();await this.save();this.update({phase:'recording',startedAt:this.current.startedAt,audio:data.audio});}
 async chunk(data){
  if(!this.current||data.recordId!==this.current.id||this.current.failing)throw new Error('录制会话已关闭');
  const chunk=Buffer.from(data.bytes);if(chunk.length>32*1024*1024)throw new Error('录制分块过大');
  const c=this.current;
  const work=this.queue.then(async()=>{
   if(data.seq!==c.seq)throw new Error('录制分块顺序中断，已保留原文件');
   if(!c.handle)throw new Error('录制文件已关闭');
   await c.handle.writeFile(chunk);await c.handle.sync();c.seq++;c.bytes+=chunk.length;c.lastWrite=Date.now();
   await this.save();this.update({bytes:c.bytes,lastWrite:c.lastWrite});
   if(c.seq%5===0 && (await this.disk()).free<c.bytes*1.3+512*1024*1024){this.update({warning:'剩余空间不足，正在结束录制并预留 MP4 导出空间'});this.send({type:'record:stop',recordId:c.id});}
  });
  this.queue=work.catch(async e=>{await this.fail(e.message,true);});
  await work; return {bytes:c.bytes};
 }
 /**
  * 课后语音转写用的双声道纯音频（左：老师麦克风，右：系统声音）。和录像分开写：这里出错只停语音轨，录像照常。
  */
 async voice(data){
  const c=this.current;if(!c||data.recordId!==c.id||c.failing||c.voiceFailed)return {ok:false};
  const chunk=Buffer.from(data.bytes);if(chunk.length>8*1024*1024)return {ok:false};
  const work=this.voiceQueue.then(async()=>{
   if(c.voiceFailed||this.current!==c)return;
   if(data.seq!==c.voiceSeq)throw new Error('语音分块顺序中断');
   if(!c.voiceHandle){c.voice=path.join(c.folder,'voice.webm');c.voiceHandle=await fsp.open(c.voice,'wx');}
   await c.voiceHandle.writeFile(chunk);c.voiceSeq++;c.voiceBytes+=chunk.length;
  });
  this.voiceQueue=work.catch(async e=>{c.voiceFailed=true;c.voiceError=String(e.message||e);try{await c.voiceHandle?.close();}catch{}c.voiceHandle=null;});
  await this.voiceQueue;return {ok:!c.voiceFailed};
 }
 async closeVoice(c){await this.voiceQueue?.catch(()=>{});if(c.voiceHandle){try{await c.voiceHandle.sync();await c.voiceHandle.close();}catch{}c.voiceHandle=null;}}
 async save(c=this.current){if(!c)return;const {handle,voiceHandle,folder,failurePromise,...fields}=c,meta=JSON.parse(JSON.stringify(fields));const task=this.metaQueue.then(()=>atomicJSON(path.join(folder,'recording.json'),meta));this.metaQueue=task.catch(()=>{});await task;}
 /** 课堂时间线：换课件、翻页、记作答……记下离开始录像多少秒，跟着 recording.json 存（录像分块写入时一起落盘） */
 chapter(v){
  const c=this.current;if(!c||this.status.phase!=='recording'||!c.startedAt)return false;
  const title=String(v?.title||'').replace(/\s+/g,' ').trim().slice(0,120);if(!title)return false;
  const kind=['material','page','board','attempt','question','note'].includes(v?.kind)?v.kind:'note';
  const t=Math.max(0,Math.round((Date.now()-c.startedAt)/100)/10),list=c.chapters||(c.chapters=[]);
  const last=list[list.length-1];
  // 连着翻页只留停下来的那一页
  if(last&&kind==='page'&&last.kind==='page'&&t-last.t<8)list.pop();
  else if(last&&last.kind===kind&&last.title===title)return true;
  list.push({t,kind,title,...(typeof v?.ref==='string'?{ref:v.ref.slice(0,200)}:{})});
  if(list.length>600)list.splice(0,list.length-600);
  return true;
 }
 /** 下课分析用：在给定的秒数截帧（最多 24 张，1280 宽 JPEG），返回 data URL */
 async frames(rid,times){
  const item=(await this.list()).find(x=>x.id===rid);if(!item)throw new Error('找不到这段录像');
  if(this.current?.id===rid)throw new Error('这节课还在录');
  const src=fs.existsSync(item.mp4)?item.mp4:item.raw;if(!fs.existsSync(src))throw new Error('录像文件不在了');
  const dir=path.join(item.folder,'frames');await fsp.mkdir(dir,{recursive:true});
  const out=[];
  for(const [i,t0] of (Array.isArray(times)?times:[]).slice(0,24).entries()){
   const t=Math.max(0,Number(t0)||0),file=path.join(dir,`f${String(i).padStart(2,'0')}-${Math.round(t)}.jpg`);
   try{await runProcess(this.ffmpeg,['-hide_banner','-y','-ss',t.toFixed(2),'-i',src,'-frames:v','1','-vf','scale=1280:-2','-q:v','4',file],{timeout:90000,lowPriority:true});out.push({t,url:'data:image/jpeg;base64,'+(await fsp.readFile(file)).toString('base64')});}catch{}
  }
  return out;
 }
 /** 给 recording.json 补字段（下课分析的结果） */
 async patchMeta(rid,patch){
  const item=(await this.list()).find(x=>x.id===rid);if(!item)throw new Error('找不到这段录像');
  if(!patch||typeof patch!=='object')return true;
  // 渲染进程只能改这两项：录像分析结果、下课后流水线（板书、课后总结）
  const p={};if('analysis' in patch)p.analysis=patch.analysis??null;if('after' in patch)p.after=patch.after&&typeof patch.after==='object'?patch.after:null;
  if(Object.keys(p).length)await this.mergeMeta(item.folder,p);return true;
 }
 /** 改 recording.json 的几个字段。读和写都排进同一个队列：下课分析、微信分段、语音转写可能同时在写，免得互相覆盖 */
 async mergeMeta(folder,patch){
  const file=path.join(folder,'recording.json');
  const task=this.metaQueue.then(async()=>{const m=await readJSON(file,null);if(!m)throw new Error('找不到这段录像的信息');for(const [k,v] of Object.entries(patch)){if(v===null)delete m[k];else m[k]=v;}await atomicJSON(file,m);});
  this.metaQueue=task.catch(()=>{});await task;
 }
 async stop(){if(!this.current||!['starting','recording'].includes(this.status.phase))return this.status;clearTimeout(this.startTimeout);this.update({phase:'stopping'});this.send({type:'record:stop',recordId:this.current.id});return this.status;}
 /** 等到这一节真正收尾（原始文件已关闭），最多等 ms */
 async settle(ms=60000){const until=Date.now()+ms;while(this.live&&Date.now()<until)await new Promise(r=>setTimeout(r,200));return !this.live;}
 async stopped(data){
  if(!this.current||data.recordId!==this.current.id)return;
  clearTimeout(this.startTimeout);await this.queue;
  const c=this.current;if(c.handle){await c.handle.close();c.handle=null;}await this.closeVoice(c);c.phase='recoverable';c.endedAt=Date.now();
  if(!c.bytes){c.phase='cancelled';await this.save(c);this.current=null;this.update({phase:'idle',error:null,bytes:0});return;}
  c.pending=true;await this.save(c);this.current=null;
  this.update({phase:'saved',id:c.id,studentId:c.studentId,folder:c.folder,path:null,error:null});
  this.enqueue(c.folder,{id:c.id,title:c.title,studentId:c.studentId,seconds:(c.endedAt-(c.startedAt||c.endedAt))/1000});
 }
 /** 后台转 MP4：一次一个，按下课顺序 */
 enqueue(folder,{id:rid,title,studentId,seconds}){
  if(this.jobs.some(j=>j.id===rid))return this.jobs.find(j=>j.id===rid).done;
  const job={id:rid,title:title||'课堂回放',studentId,folder,seconds:seconds||0,progress:0};this.jobs.push(job);this.update({});
  job.done=this.jobRun=this.jobRun.catch(()=>{}).then(async()=>{
   let last=0;
   try{
    const out=await this.convert(folder,{seconds:job.seconds,progress:p=>{job.progress=p;if(Date.now()-last>1000){last=Date.now();this.update({});}}});
    this.jobs=this.jobs.filter(j=>j!==job);
    if(this.live||this.status.phase==='saved'&&this.status.id!==job.id)this.update({});else this.update({phase:'complete',id:job.id,studentId:job.studentId,path:out,error:null});
    this.onSaved?.({id:job.id,title:job.title,studentId:job.studentId,path:out});
    // 分段失败不影响回放本身，原因记在 recording.json 里，回放页可以再点一次
    if(this.split?.())await this.splitParts(folder,this.partLimits).catch(()=>{});
    return out;
   }catch(e){
    this.jobs=this.jobs.filter(j=>j!==job);
    const meta=await readJSON(path.join(folder,'recording.json'),null);if(meta){meta.phase='recoverable';meta.pending=false;meta.error=e.message;await atomicJSON(path.join(folder,'recording.json'),meta).catch(()=>{});}
    if(this.live)this.update({warning:'上一节的回放没能生成 MP4（原录像已保留，可在「回放」里点恢复）：'+e.message});else this.update({phase:'recoverable',id:job.id,error:'原录像已保存，MP4 尚未完成：'+e.message});
    throw e;
   }
  });
  return job.done;
 }
 async fail(message,fromWrite=false){
  const c=this.current;if(!c)return;if(c.failing)return;
  c.failing=true;clearTimeout(this.startTimeout);this.send({type:'record:abort',recordId:c.id});
  if(!fromWrite)await this.queue.catch(()=>{});
  c.phase='recoverable';c.error=String(message);await this.closeVoice(c);try{if(c.handle){await c.handle.sync();await c.handle.close();c.handle=null;}await this.save(c);}catch(e){c.error+='；收尾保存：'+e.message;}
  if(this.current===c){this.current=null;this.update({phase:'error',error:c.error});}
 }
 async convert(folder,{seconds=0,progress}={}){
  const meta=await readJSON(path.join(folder,'recording.json'),null);if(!meta)throw new Error('找不到这段录像的信息');
  const raw=path.join(folder,'capture.webm'), output=path.join(folder,'课堂回放.mp4'), temp=path.join(folder,'converting.mp4');
  const rawStat=await fsp.stat(raw);const space=await this.disk(folder);if(space.free!==null&&space.free<rawStat.size*1.3+256*1024*1024)throw new Error('生成 MP4 所需空间不足。原录像已保留，请释放此磁盘空间后点击恢复');
  const total=seconds||((meta.endedAt&&meta.startedAt)?(meta.endedAt-meta.startedAt)/1000:0);
  const onOutput=total>0&&progress?(s=>{const m=/time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);if(m)progress(Math.min(0.99,(+m[1]*3600+ +m[2]*60+ +m[3])/total));}):undefined;
  await runProcess(this.ffmpeg,['-hide_banner','-y','-fflags','+genpts','-i',raw,'-map','0:v:0','-map','0:a:0?','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',temp],{timeout:6*60*60*1000,onOutput,lowPriority:true});
  // 转码要几分钟，这期间下课存板书等可能往 recording.json 里写过东西：只改这几项，别拿开头读的旧内容整个盖回去
  await fsp.rename(temp,output);await this.mergeMeta(folder,{phase:'complete',pending:false,mp4:output,error:null});
  // MP4 已完整生成，原始 WebM 体积和它差不多，留着只会让磁盘翻倍
  try{if((await fsp.stat(output)).size>0)await fsp.unlink(raw);}catch{}
  progress?.(1);return output;
 }
 /**
  * 把回放切成几段长度相等、每段不到 1 小时的 MP4，放进「微信分段」文件夹，方便发微信。
  * 直接拷贝视频流不重新编码：几十秒就切完，画质不变；切点落在关键帧上，各段前后差几秒。
  */
 async splitParts(folder,{max=PART_MAX,limit=PART_LIMIT}={}){
  const file=path.join(folder,'recording.json'),meta=await readJSON(file,null);if(!meta)throw new Error('找不到这段录像的信息');
  const mp4=path.join(folder,'课堂回放.mp4'),dir=path.join(folder,PARTS_DIR),tmp=path.join(folder,PARTS_DIR+'.tmp');
  // 下课分析可能同时在往 recording.json 写结果，读和写都放进同一个队列，免得互相覆盖
  const writeMeta=async patch=>{const task=this.metaQueue.then(async()=>{const m=await readJSON(file,null)||meta;Object.assign(m,patch);await atomicJSON(file,m);});this.metaQueue=task.catch(()=>{});await task;};
  this.splitting.add(meta.id);
  try{
   if(!fs.existsSync(mp4))throw new Error('回放 MP4 还没生成');
   const seconds=await probeSeconds(this.ffmpeg,mp4)||((meta.endedAt&&meta.startedAt)?(meta.endedAt-meta.startedAt)/1000:0);
   if(!seconds)throw new Error('读不出回放时长');
   const old=Array.isArray(meta.parts)?meta.parts:[];
   if(partCount(seconds,max)<2){for(const p of old)await fsp.unlink(path.join(dir,p.file)).catch(()=>{});await writeMeta({parts:[],splitError:null});return [];}
   const size=(await fsp.stat(mp4)).size,space=await this.disk(folder);
   if(space.free!==null&&space.free<size*1.05+128*1024*1024)throw new Error('磁盘空间不够放分段视频，请先腾出 '+Math.ceil(size/1024**2)+' MB 左右');
   const d=new Date(meta.createdAt||Date.now()),day=`${d.getMonth()+1}月${d.getDate()}日`;
   const base=safeName([this.label?.(meta),day,meta.title&&meta.title!=='课堂回放'?meta.title:''].filter(Boolean).join(' '))||'课堂回放';
   let parts=[];
   // 关键帧隔得很远时某段可能超过 1 小时，多切一段再试
   for(let n=partCount(seconds,max);n<=partCount(seconds,max)+2;n++){
    await fsp.rm(tmp,{recursive:true,force:true});await fsp.mkdir(tmp,{recursive:true});
    await runProcess(this.ffmpeg,['-hide_banner','-y','-i',mp4,'-map','0:v:0','-map','0:a:0?','-c','copy','-f','segment','-segment_times',cutTimes(seconds,n).join(','),'-reset_timestamps','1','-segment_format_options','movflags=+faststart','-segment_start_number','1',path.join(tmp,'part%d.mp4')],{timeout:60*60*1000,lowPriority:true});
    const made=(await fsp.readdir(tmp)).filter(f=>/^part\d+\.mp4$/.test(f)).sort((a,b)=>parseInt(a.slice(4))-parseInt(b.slice(4)));
    parts=[];for(const f of made)parts.push({tmpName:f,seconds:Math.round(await probeSeconds(this.ffmpeg,path.join(tmp,f))),bytes:(await fsp.stat(path.join(tmp,f))).size});
    if(parts.length>1&&parts.every(p=>p.seconds>0&&p.seconds<limit))break;
    if(n===partCount(seconds,max)+2)throw new Error('切出来的分段还是超过 1 小时（视频关键帧间隔太长）');
   }
   for(const p of old)await fsp.unlink(path.join(dir,p.file)).catch(()=>{});
   await fsp.mkdir(dir,{recursive:true});
   const out=[];
   for(const [i,p] of parts.entries()){const name=`${base} 第${i+1}段（共${parts.length}段）.mp4`;await fsp.rm(path.join(dir,name),{force:true});await fsp.rename(path.join(tmp,p.tmpName),path.join(dir,name));out.push({file:name,seconds:p.seconds,bytes:p.bytes});}
   await fsp.rm(tmp,{recursive:true,force:true});
   await writeMeta({parts:out,splitError:null});
   this.onSplit?.({id:meta.id,title:meta.title,studentId:meta.studentId,dir,parts:out});
   return out;
  }catch(e){
   await fsp.rm(tmp,{recursive:true,force:true}).catch(()=>{});
   await writeMeta({splitError:e.message}).catch(()=>{});
   this.onSplit?.({id:meta.id,title:meta.title,studentId:meta.studentId,dir,parts:[],error:e.message});
   throw e;
  }finally{this.splitting.delete(meta.id);}
 }
 /** 回放页手动点「切成微信分段」：和生成回放排在同一个队列里，不会同时跑两个 ffmpeg */
 splitQueued(rid){
  return this.list().then(rows=>{
   const item=rows.find(x=>x.id===rid);if(!item)throw new Error('找不到这段录像');
   if(item.phase!=='complete')throw new Error('回放 MP4 生成完以后才能分段');
   const task=this.jobRun.catch(()=>{}).then(()=>this.splitParts(item.folder,this.partLimits));this.jobRun=task.catch(()=>{});return task;
  });
 }
 /** 上次退出时还没生成完的回放：启动后接着排队 */
 async resume(){
  for(const r of await this.list().catch(()=>[]))if(r.pending&&r.phase==='recoverable'&&!r.error&&fs.existsSync(r.raw))this.enqueue(r.folder,{id:r.id,title:r.title,studentId:r.studentId});
 }
 async remove(rid){
  if(this.current?.id===rid)throw new Error('这节课还在录，下课后再删除');
  if(this.jobs.some(j=>j.id===rid))throw new Error('回放正在生成，完成后再删除');
  if(this.splitting.has(rid))throw new Error('正在切微信分段，切完再删除');
  const item=(await this.list()).find(x=>x.id===rid);if(!item)throw new Error('找不到这段录像');
  return item.folder;
 }
 async list(){
  await fsp.mkdir(this.directory,{recursive:true});const rows=[];
  for(const e of await fsp.readdir(this.directory,{withFileTypes:true})){if(!e.isDirectory())continue;const folder=path.join(this.directory,e.name);const m=await readJSON(path.join(folder,'recording.json'),null);if(!m)continue;
    const live=this.current?.id===m.id&&this.live;const job=this.jobs.find(j=>j.id===m.id);
    if(m.phase==='cancelled')continue;const ready=fs.existsSync(path.join(folder,'课堂回放.mp4'));
    let bytes=0;for(const f of ['capture.webm','课堂回放.mp4','voice.webm'])try{bytes+=(await fsp.stat(path.join(folder,f))).size;}catch{}
    const parts=[];for(const p of Array.isArray(m.parts)?m.parts:[])try{const s=await fsp.stat(path.join(folder,PARTS_DIR,p.file));bytes+=s.size;parts.push({...p,path:path.join(folder,PARTS_DIR,p.file)});}catch{}
    rows.push({...m,folder,bytes,parts,splitting:this.splitting.has(m.id),mp4:path.join(folder,'课堂回放.mp4'),raw:path.join(folder,'capture.webm'),phase:live?this.status.phase:job?'converting':ready?'complete':'recoverable',progress:job?.progress});
  }return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 killAll(){for(const c of children)try{c.kill();}catch{}}
}
module.exports={Recording,runProcess,partCount,cutTimes,PART_MAX};
