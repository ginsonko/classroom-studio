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
/**
 * 课堂录制：录制组件把 WebM 分块写进原始文件；下课后在后台排队转成 MP4。
 * 转码不算「忙」：老师可以马上关学生窗口、开始下一节课，顶部显示回放生成进度。
 */
class Recording {
 constructor({directory,ffmpeg,onChange,send,onSaved}){this.directory=directory;this.ffmpeg=ffmpeg;this.onChange=onChange;this.send=send;this.onSaved=onSaved;this.current=null;this.queue=Promise.resolve();this.metaQueue=Promise.resolve();this.jobs=[];this.jobRun=Promise.resolve();this.status={phase:'idle',bytes:0,micLevel:0,systemLevel:0,jobs:[]};}
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
  this.current={...meta,folder,handle:await fsp.open(meta.raw,'wx'),seq:0}; this.queue=Promise.resolve();
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
 async save(c=this.current){if(!c)return;const {handle,folder,failurePromise,...fields}=c,meta=JSON.parse(JSON.stringify(fields));const task=this.metaQueue.then(()=>atomicJSON(path.join(folder,'recording.json'),meta));this.metaQueue=task.catch(()=>{});await task;}
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
  const file=path.join(item.folder,'recording.json'),meta=await readJSON(file,null);if(!meta)throw new Error('找不到这段录像的信息');
  if(patch&&typeof patch==='object'&&'analysis' in patch)meta.analysis=patch.analysis??null;
  const task=this.metaQueue.then(()=>atomicJSON(file,meta));this.metaQueue=task.catch(()=>{});await task;return true;
 }
 async stop(){if(!this.current||!['starting','recording'].includes(this.status.phase))return this.status;clearTimeout(this.startTimeout);this.update({phase:'stopping'});this.send({type:'record:stop',recordId:this.current.id});return this.status;}
 /** 等到这一节真正收尾（原始文件已关闭），最多等 ms */
 async settle(ms=60000){const until=Date.now()+ms;while(this.live&&Date.now()<until)await new Promise(r=>setTimeout(r,200));return !this.live;}
 async stopped(data){
  if(!this.current||data.recordId!==this.current.id)return;
  clearTimeout(this.startTimeout);await this.queue;
  const c=this.current;if(c.handle){await c.handle.close();c.handle=null;}c.phase='recoverable';c.endedAt=Date.now();
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
  c.phase='recoverable';c.error=String(message);try{if(c.handle){await c.handle.sync();await c.handle.close();c.handle=null;}await this.save(c);}catch(e){c.error+='；收尾保存：'+e.message;}
  if(this.current===c){this.current=null;this.update({phase:'error',error:c.error});}
 }
 async convert(folder,{seconds=0,progress}={}){
  const meta=await readJSON(path.join(folder,'recording.json'),null);if(!meta)throw new Error('找不到这段录像的信息');
  const raw=path.join(folder,'capture.webm'), output=path.join(folder,'课堂回放.mp4'), temp=path.join(folder,'converting.mp4');
  const rawStat=await fsp.stat(raw);const space=await this.disk(folder);if(space.free!==null&&space.free<rawStat.size*1.3+256*1024*1024)throw new Error('生成 MP4 所需空间不足。原录像已保留，请释放此磁盘空间后点击恢复');
  const total=seconds||((meta.endedAt&&meta.startedAt)?(meta.endedAt-meta.startedAt)/1000:0);
  const onOutput=total>0&&progress?(s=>{const m=/time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);if(m)progress(Math.min(0.99,(+m[1]*3600+ +m[2]*60+ +m[3])/total));}):undefined;
  await runProcess(this.ffmpeg,['-hide_banner','-y','-fflags','+genpts','-i',raw,'-map','0:v:0','-map','0:a:0?','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',temp],{timeout:6*60*60*1000,onOutput,lowPriority:true});
  await fsp.rename(temp,output);meta.phase='complete';meta.pending=false;meta.mp4=output;meta.error=null;await atomicJSON(path.join(folder,'recording.json'),meta);
  // MP4 已完整生成，原始 WebM 体积和它差不多，留着只会让磁盘翻倍
  try{if((await fsp.stat(output)).size>0)await fsp.unlink(raw);}catch{}
  progress?.(1);return output;
 }
 /** 上次退出时还没生成完的回放：启动后接着排队 */
 async resume(){
  for(const r of await this.list().catch(()=>[]))if(r.pending&&r.phase==='recoverable'&&!r.error&&fs.existsSync(r.raw))this.enqueue(r.folder,{id:r.id,title:r.title,studentId:r.studentId});
 }
 async remove(rid){
  if(this.current?.id===rid)throw new Error('这节课还在录，下课后再删除');
  if(this.jobs.some(j=>j.id===rid))throw new Error('回放正在生成，完成后再删除');
  const item=(await this.list()).find(x=>x.id===rid);if(!item)throw new Error('找不到这段录像');
  return item.folder;
 }
 async list(){
  await fsp.mkdir(this.directory,{recursive:true});const rows=[];
  for(const e of await fsp.readdir(this.directory,{withFileTypes:true})){if(!e.isDirectory())continue;const folder=path.join(this.directory,e.name);const m=await readJSON(path.join(folder,'recording.json'),null);if(!m)continue;
    const live=this.current?.id===m.id&&this.live;const job=this.jobs.find(j=>j.id===m.id);
    if(m.phase==='cancelled')continue;const ready=fs.existsSync(path.join(folder,'课堂回放.mp4'));
    let bytes=0;for(const f of ['capture.webm','课堂回放.mp4'])try{bytes+=(await fsp.stat(path.join(folder,f))).size;}catch{}
    rows.push({...m,folder,bytes,mp4:path.join(folder,'课堂回放.mp4'),raw:path.join(folder,'capture.webm'),phase:live?this.status.phase:job?'converting':ready?'complete':'recoverable',progress:job?.progress});
  }return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 killAll(){for(const c of children)try{c.kill();}catch{}}
}
module.exports={Recording,runProcess};
