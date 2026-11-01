'use strict';
// 1.5.1 微信分段：回放切成长度相等、每段不到 1 小时的几段（这里把上限缩到几十秒，用小视频测）
const assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {Recording,runProcess,partCount,cutTimes,PART_MAX}=require('../electron/recording.cjs');
const ffmpeg=process.env.CS_FFMPEG||path.join(__dirname,'..','bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
const root=path.join(process.env.CS_TEST_OUT||os.tmpdir(),'v151-split-'+Date.now());
let n=0;const ok=async(name,fn)=>{await fn();n++;console.log('ok '+name);};

async function makeRecord(name,seconds,{webm=false}={}){
  const folder=path.join(root,'recordings',name);await fsp.mkdir(folder,{recursive:true});
  const out=path.join(folder,webm?'capture.webm':'课堂回放.mp4');
  const codec=webm?['-c:v','libvpx','-b:v','100k','-deadline','realtime','-c:a','libopus']:['-c:v','libx264','-preset','ultrafast','-g','20','-pix_fmt','yuv420p','-c:a','aac'];
  await runProcess(ffmpeg,['-hide_banner','-y','-f','lavfi','-i',`testsrc=size=160x120:rate=10:duration=${seconds}`,'-f','lavfi','-i',`sine=frequency=440:duration=${seconds}`,...codec,'-shortest',out],{timeout:120000,lowPriority:true});
  const now=Date.now();
  const meta={id:'rec-'+name,title:'追及相遇',studentId:'s1',chapters:[],createdAt:new Date(2026,10,1,14,40).toISOString(),phase:webm?'recoverable':'complete',raw:path.join(folder,'capture.webm'),mp4:path.join(folder,'课堂回放.mp4'),bytes:0,startedAt:now-seconds*1000,endedAt:now,...(webm?{pending:true}:{})};
  await fsp.writeFile(path.join(folder,'recording.json'),JSON.stringify(meta));
  return folder;
}
const readMeta=async f=>JSON.parse(await fsp.readFile(path.join(f,'recording.json'),'utf8'));
const files=async f=>{try{return (await fsp.readdir(path.join(f,'微信分段'))).sort();}catch{return [];}};

(async()=>{
  await ok('段数和切点：不到 59 分钟不切，超过就按 59 分钟一段算最少段数，切点均分',async()=>{
    assert.equal(PART_MAX,3540);
    assert.equal(partCount(1800),1);assert.equal(partCount(3540),1);assert.equal(partCount(3541),2);
    assert.equal(partCount(5400),2);assert.equal(partCount(7080),2);assert.equal(partCount(7200),3);assert.equal(partCount(3*3600),4);
    assert.deepEqual(cutTimes(5400,2),[2700]);assert.deepEqual(cutTimes(7200,3),[2400,4800]);assert.deepEqual(cutTimes(100,1),[]);
  });

  const splits=[];
  const rec=new Recording({directory:path.join(root,'recordings'),ffmpeg,onChange(){},send(){},label:m=>m.studentId==='s1'?'小王':undefined,onSplit:r=>splits.push(r)});
  const folder=await makeRecord('a',200);

  await ok('切成 4 段：每段不到上限、长度差不多、加起来是整段，文件名带学生、日期、第几段',async()=>{
    const parts=await rec.splitParts(folder,{max:60,limit:70});
    assert.equal(parts.length,4);
    for(const p of parts){assert.ok(p.seconds<70,'每段不到上限 '+p.seconds);assert.ok(Math.abs(p.seconds-50)<=4,'长度差不多 '+p.seconds);assert.ok(p.bytes>0);}
    assert.ok(Math.abs(parts.reduce((a,p)=>a+p.seconds,0)-200)<=4);
    assert.equal(parts[0].file,'小王 11月1日 追及相遇 第1段（共4段）.mp4');
    assert.deepEqual(await files(folder),parts.map(p=>p.file).sort());
    assert.ok(!fs.existsSync(path.join(folder,'微信分段.tmp')),'临时文件夹清掉了');
    const m=await readMeta(folder);assert.equal(m.parts.length,4);assert.equal(m.splitError,null);
    assert.equal(splits.at(-1).parts.length,4);
    assert.ok(fs.existsSync(m.mp4),'完整回放保留');
    // 微信、手机上边下边播要 moov 在前（faststart）
    const head=(await fsp.readFile(path.join(folder,'微信分段',parts[1].file))).toString('latin1');
    assert.ok(head.indexOf('moov')>0&&head.indexOf('moov')<head.indexOf('mdat'),'faststart');
  });

  await ok('回放列表：带上分段和路径，占用空间算上分段',async()=>{
    const row=(await rec.list()).find(r=>r.id==='rec-a');
    assert.equal(row.parts.length,4);assert.ok(fs.existsSync(row.parts[0].path));assert.equal(row.splitting,false);
    const mp4=(await fsp.stat(row.mp4)).size,sum=row.parts.reduce((a,p)=>a+p.bytes,0);
    assert.equal(row.bytes,mp4+sum);
  });

  await ok('重新切：旧的分段换成新的，不留多余文件',async()=>{
    const parts=await rec.splitParts(folder,{max:120,limit:130});
    assert.equal(parts.length,2);assert.deepEqual(await files(folder),parts.map(p=>p.file).sort());
  });

  await ok('不超过上限：不切，删掉以前切的分段',async()=>{
    assert.deepEqual(await rec.splitParts(folder,{max:300,limit:310}),[]);
    assert.deepEqual(await files(folder),[]);assert.deepEqual((await readMeta(folder)).parts,[]);
  });

  await ok('没有学生名字：用日期和课名；课名是默认的「课堂回放」时不重复',async()=>{
    const f=await makeRecord('b',130);const m=await readMeta(f);m.studentId=null;m.title='课堂回放';await fsp.writeFile(path.join(f,'recording.json'),JSON.stringify(m));
    const parts=await rec.splitParts(f,{max:60,limit:70});
    assert.equal(parts.length,3);assert.equal(parts[2].file,'11月1日 第3段（共3段）.mp4');
  });

  await ok('MP4 不在：报错并记在 recording.json 里，回放页能显示原因',async()=>{
    const f=path.join(root,'recordings','c');await fsp.mkdir(f,{recursive:true});await fsp.writeFile(path.join(f,'recording.json'),JSON.stringify({id:'rec-c',title:'x',createdAt:new Date().toISOString(),phase:'complete'}));
    await assert.rejects(rec.splitParts(f),/还没生成/);
    assert.match((await readMeta(f)).splitError,/还没生成/);assert.ok(splits.at(-1).error);
    await fsp.rm(f,{recursive:true,force:true});
  });

  await ok('手动分段：回放没生成完不让切；正在切时不让删',async()=>{
    await assert.rejects(rec.splitQueued('rec-nope'),/找不到/);
    const p=rec.splitQueued('rec-a');
    await new Promise(r=>setTimeout(r,30));
    if(rec.splitting.has('rec-a'))await assert.rejects(rec.remove('rec-a'),/切完再删/);
    await p;
  });

  await ok('开关打开：生成回放后自动切；关着不切',async()=>{
    let on=false;const saved=[];
    const auto=new Recording({directory:path.join(root,'recordings'),ffmpeg,onChange(){},send(){},onSaved:r=>saved.push(r),split:()=>on,partLimits:{max:60,limit:70}});
    const f1=await makeRecord('off',90,{webm:true});
    await auto.enqueue(f1,{id:'rec-off',title:'追及相遇',studentId:'s1'});
    assert.equal(saved.length,1);assert.deepEqual(await files(f1),[]);
    on=true;const f2=await makeRecord('on',90,{webm:true});
    await auto.enqueue(f2,{id:'rec-on',title:'追及相遇',studentId:'s1'});
    assert.equal(saved.length,2);
    const got=await files(f2);assert.equal(got.length,2,'90 秒按 60 秒一段切成 2 段：'+got.join(','));
    const m=await readMeta(f2);assert.equal(m.phase,'complete');assert.equal(m.parts.length,2);
  });

  console.log(`PASS ${n}/9`);
  await fsp.rm(root,{recursive:true,force:true}).catch(()=>{});
})().catch(e=>{console.error(e);process.exit(1);});
