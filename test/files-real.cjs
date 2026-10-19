const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const {Files}=require('../electron/files.cjs');
const samples=JSON.parse(fs.readFileSync(path.join(__dirname,'../.out/A/real-courseware.json'),'utf8'));
const out=path.join(__dirname,'../.out/A/real-files');fs.mkdirSync(out,{recursive:true});
const service=new Files(path.join(out,'cache'));const results=[];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pick=ext=>{const entries=samples[ext]||[];if(!entries.length)return null;if(ext==='ppt'||ext==='pptx')return entries.slice().sort((a,b)=>Number(b[0])-Number(a[0]))[0][1];return entries[0][1];};
(async()=>{
 for(const ext of ['pdf','docx','pptx','doc','ppt']){
  const input=pick(ext);if(!input)continue;
  service.authorize(input);const before=hash(input),started=Date.now();
  try{const converted=await service.convert(input,p=>{if(p.stage==='opening')console.log(ext+': opening');});if(converted.render==='images'){assert.ok(Array.isArray(converted.images)&&converted.images.length>0);for(const image of converted.images){assert.ok(fs.statSync(image.path).size>=100);assert.ok(image.w>0&&image.h>0);}}else{assert.ok(fs.statSync(converted.pdf).size>40);}const cached=await service.convert(input,()=>{});assert.equal(cached.cached,true);if(converted.render==='images')assert.equal(cached.images.length,converted.images.length);assert.equal(hash(input),before);results.push({ext,input,render:converted.render,output:converted.render==='images'?converted.images.map(x=>x.path):converted.pdf,slides:converted.images?.length||0,ok:true,cached:true,sourceUnchanged:true,ms:Date.now()-started});console.log(ext+': PASS ('+(Date.now()-started)+' ms)');}
  catch(e){results.push({ext,input,ok:false,error:e.message,sourceUnchanged:hash(input)===before});console.log(ext+': FAIL '+e.message.slice(-500));}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 }
 const good=results.every(x=>x.ok);process.exitCode=good?0:1;
})().catch(e=>{console.error(e);process.exitCode=1;});
