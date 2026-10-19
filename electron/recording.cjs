'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const {spawn}=require('node:child_process');
const {atomicJSON,id,readJSON}=require('./core.cjs');
function runProcess(command,args,{timeout=300000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); let output='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('处理超时，原录制文件已保留'));},timeout);
    child.stdout.on('data',v=>{output=(output+v).slice(-12000);});child.stderr.on('data',v=>{output=(output+v).slice(-12000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(output||'处理程序退出，代码 '+code));});
  });
}
class Recording {
 constructor({directory,ffmpeg,onChange,send}){this.directory=directory;this.ffmpeg=ffmpeg;this.onChange=onChange;this.send=send;this.current=null;this.queue=Promise.resolve();this.metaQueue=Promise.resolve();this.status={phase:'idle',bytes:0,micLevel:0,systemLevel:0};}
 async disk(directory=this.directory){let target=directory;while(target){try{const v=await fsp.statfs(target);return {free:Number(v.bavail)*Number(v.bsize),total:Number(v.blocks)*Number(v.bsize)};}catch{const parent=path.dirname(target);if(parent===target)break;target=parent;}}return {free:null,total:null};}
 update(p){this.status={...this.status,...p};this.onChange(this.status);}
 async start(settings,synthetic=false){
  if(['starting','recording','stopping','converting'].includes(this.status.phase))throw new Error('上一段录制还未结束');
  this.directory=settings.recordings;await fsp.mkdir(this.directory,{recursive:true});
  if((await this.disk()).free<2*1024**3)throw new Error('录像目录可用空间不足 2 GB，请在设置中换一个磁盘');
  const recordId=id(), stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const folder=path.join(this.directory,stamp+'-'+recordId.slice(0,8));await fsp.mkdir(folder);
  const meta={id:recordId,title:settings.title||'课堂回放',studentId:settings.studentId||null,chapters:[],createdAt:new Date().toISOString(),phase:'starting',raw:path.join(folder,'capture.webm'),mp4:path.join(folder,'课堂回放.mp4'),bytes:0,synthetic,settings:{microphone:settings.microphone,systemAudio:settings.systemAudio,bitrate:settings.bitrate}};
  this.current={...meta,folder,handle:await fsp.open(meta.raw,'wx'),seq:0}; this.queue=Promise.resolve();
  await atomicJSON(path.join(folder,'recording.json'),meta);
  this.update({phase:'starting',id:recordId,studentId:meta.studentId,bytes:0,error:null,folder,micLevel:0,systemLevel:0,startedAt:null});
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
 async save(){if(!this.current)return;const {handle,folder,failurePromise,...fields}=this.current,meta=JSON.parse(JSON.stringify(fields));const task=this.metaQueue.then(()=>atomicJSON(path.join(folder,'recording.json'),meta));this.metaQueue=task.catch(()=>{});await task;}
 async stop(){if(!this.current||!['starting','recording'].includes(this.status.phase))return this.status;clearTimeout(this.startTimeout);this.update({phase:'stopping'});this.send({type:'record:stop',recordId:this.current.id});return this.status;}
 async stopped(data){
  if(!this.current||data.recordId!==this.current.id)return;
  clearTimeout(this.startTimeout);await this.queue;
  const c=this.current;if(c.handle){await c.handle.close();c.handle=null;}c.phase='recoverable';c.endedAt=Date.now();await this.save();
  if(!c.bytes){c.phase='cancelled';await this.save();this.update({phase:'idle',error:null,bytes:0});return;}
  this.update({phase:'converting'});
  try{await this.convert(c.folder);c.phase='complete';await this.save();this.update({phase:'complete',path:c.mp4});}
  catch(e){c.phase='recoverable';c.error=e.message;await this.save();this.update({phase:'recoverable',error:'原录像已保存，MP4 尚未完成：'+e.message});}
 }
 async fail(message,fromWrite=false){
  const c=this.current;if(!c)return;if(c.failing)return;
  c.failing=true;clearTimeout(this.startTimeout);this.send({type:'record:abort',recordId:c.id});
  if(!fromWrite)await this.queue.catch(()=>{});
  c.phase='recoverable';c.error=String(message);try{if(c.handle){await c.handle.sync();await c.handle.close();c.handle=null;}await this.save();}catch(e){c.error+='；收尾保存：'+e.message;}
  if(this.current===c)this.update({phase:'error',error:c.error});
 }
 async convert(folder){
  const meta=await readJSON(path.join(folder,'recording.json'),null);if(!meta)throw new Error('找不到这段录像的信息');
  const raw=path.join(folder,'capture.webm'), output=path.join(folder,'课堂回放.mp4'), temp=path.join(folder,'converting.mp4');
  const rawStat=await fsp.stat(raw);const space=await this.disk(folder);if(space.free!==null&&space.free<rawStat.size*1.3+256*1024*1024)throw new Error('生成 MP4 所需空间不足。原录像已保留，请释放此磁盘空间后点击恢复');
  await runProcess(this.ffmpeg,['-hide_banner','-y','-fflags','+genpts','-i',raw,'-map','0:v:0','-map','0:a:0?','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',temp],{timeout:6*60*60*1000});
  await fsp.rename(temp,output);meta.phase='complete';meta.mp4=output;meta.error=null;await atomicJSON(path.join(folder,'recording.json'),meta);return output;
 }
 async list(){
  await fsp.mkdir(this.directory,{recursive:true});const rows=[];
  for(const e of await fsp.readdir(this.directory,{withFileTypes:true})){if(!e.isDirectory())continue;const folder=path.join(this.directory,e.name);const m=await readJSON(path.join(folder,'recording.json'),null);if(!m)continue;
    const live=this.current?.id===m.id&&['starting','recording','stopping','converting'].includes(this.status.phase);
    if(m.phase==='cancelled')continue;const ready=fs.existsSync(path.join(folder,'课堂回放.mp4'));
    rows.push({...m,folder,mp4:path.join(folder,'课堂回放.mp4'),raw:path.join(folder,'capture.webm'),phase:live?this.status.phase:ready?'complete':'recoverable'});
  }return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
}
module.exports={Recording,runProcess};
