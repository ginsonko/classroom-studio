const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
// CS_TEST_OUT：录课检查要求录像目录有 2 GB 空间，项目盘满时可把测试数据放到别的盘
const out=path.join(process.env.CS_TEST_OUT||path.join(__dirname,'../.out/A'),'desktop-'+Date.now());fs.mkdirSync(out,{recursive:true});
process.env.CS_TEST='1';process.env.CS_DATA_DIR=path.join(out,'data');
fs.mkdirSync(process.env.CS_DATA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.CS_DATA_DIR,'workspace.json'),JSON.stringify({local:{roots:[],students:[],slots:[],learning:{}}}));
const {app}=require('electron');const errors=[];const results=[];
app.on('web-contents-created',(_e,wc)=>{wc.on('console-message',(_event,details)=>{if(details?.level>=2)errors.push(details.message);});wc.on('render-process-gone',(_event,d)=>errors.push('renderer-gone:'+d.reason));});
require('../electron/main.cjs');
const until=async(fn,ms=20000)=>{const t=Date.now();while(Date.now()-t<ms){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out');};
const mark=(name,details={})=>{results.push({name,ok:true,...details});console.log('PASS '+name);};
const timer=setTimeout(()=>{console.error('Desktop smoke timed out');app.exit(1);},120000);
(async()=>{
 const api=await until(()=>globalThis.classroomStudioTest),teacher=api.windows.get('teacher'),student=api.windows.get('student');
 const call=(w,code)=>w.webContents.executeJavaScript(code);
 await until(()=>call(teacher,'!!window.__studioQA'));await until(()=>call(student,'!!window.__studioQA'));
 const roles=await Promise.all([call(teacher,'window.csHost.role'),call(student,'window.csHost.role')]);assert.deepEqual(roles,['teacher','student']);assert.notEqual(teacher.webContents.session,student.webContents.session);mark('actual desktop roles and separate session partitions');
 await call(teacher,`(()=>{const s=__studioQA.useStore.getState();s.set({notes:{test:'PRIVATE-SENTINEL'}});s.addStroke('board#0',{id:'private-test',author:'teacher',layer:'private',tool:'pen',color:'red',size:3,pts:[.1,.1,.5,.3,.2,.5]});s.addStroke('board#0',{id:'public-test',author:'teacher',layer:'public',tool:'pen',color:'blue',size:3,pts:[.2,.2,.5,.4,.3,.5]});return true;})()`);
 await until(()=>call(student,`__studioQA.useStore.getState().ink['board#0']?.some(s=>s.id==='public-test')`));
 student.webContents.reload();await until(()=>call(student,'!!window.__studioQA').catch(()=>false));
 const fresh=await call(student,`(()=>{const s=__studioQA.useStore.getState();return {ink:s.ink,notes:s.notes,reader:s.reader,initial:window.csHost.initial}})()`);assert.ok(!JSON.stringify(fresh).includes('private-test'));assert.ok(!JSON.stringify(fresh).includes('PRIVATE-SENTINEL'));mark('late student reload excludes teacher notes and private ink');
 await call(student,`window.csHost.busPost({t:'shared',patch:{pgmMat:{id:'stolen-answer'},drawAuthor:'student',notes:{test:'ATTACK'}}});true`);
 await new Promise(r=>setTimeout(r,150));assert.notEqual(api.publicData.pgmMat.id,'stolen-answer');assert.equal(await call(teacher,"__studioQA.useStore.getState().notes.test"),'PRIVATE-SENTINEL');mark('student role cannot replace content or private notes');
 await call(teacher,`(()=>{const s=__studioQA.useStore.getState();s.addStroke('board#0',{id:'student-test',author:'student',layer:'public',tool:'pen',color:'student',size:3,pts:[.1,.4,.5,.3,.4,.5]});s.undo('board#0','teacher');return true;})()`);
 let ink=await call(teacher,`__studioQA.useStore.getState().ink['board#0'].map(s=>s.id)`);assert.ok(ink.includes('student-test'));assert.ok(!ink.includes('public-test'));await call(teacher,`__studioQA.useStore.getState().redo('board#0','teacher');true`);ink=await call(teacher,`__studioQA.useStore.getState().ink['board#0'].map(s=>s.id)`);assert.ok(ink.includes('public-test'));mark('author-specific undo and redo retain the other participant');
 const sources=JSON.parse(fs.readFileSync(path.join(__dirname,'../.out/A/real-files/results.json'),'utf8'));
 for(const source of sources.filter(x=>x.ok)){
  // Use the original read-only source. PPT/PPTX results contain an array of
  // slide PNGs, so treating `output` as a single path would join it with ','.
  api.files.authorize(source.input);const payload=JSON.stringify(source.input);
  const r=await call(teacher,`(async()=>{const f=__studioQA.fileEntry(${payload});const mat=await __studioQA.openMaterial(f,'teacher');return {pages:mat?.total,title:mat?.title,render:mat?.src?.render}})()`);assert.ok(r.pages>0);mark('render prepared real '+source.ext+' through desktop resource protocol',r);
 }
 const pdf=sources.find(x=>x.ext==='docx').input;
 await call(teacher,`(async()=>{await __studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(pdf)}),'student');return true;})()`);
 await until(()=>call(student,`[...document.querySelectorAll('.doc-image')].some(i=>i.complete&&i.naturalWidth>100)`));
 await fs.promises.writeFile(path.join(out,'student-document.png'),(await student.webContents.capturePage()).toPNG());
 const before=api.publicData.pgmMat.id,bad=path.join(api.files.cache,'bad.pdf');fs.writeFileSync(bad,'not a PDF');
 const failed=await call(teacher,`(async()=>{const m=await __studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(bad)}),'student');return m===null;})()`);assert.equal(failed,true);assert.equal(api.publicData.pgmMat.id,before);mark('bad PDF fails without replacing the student document');
 await call(teacher,`__studioQA.flushStore()`);await api.saving();assert.ok(fs.existsSync(path.join(api.data,'workspace.json')));teacher.webContents.reload();await until(()=>call(teacher,'!!window.__studioQA').catch(()=>false));const restored=await call(teacher,`({notes:__studioQA.useStore.getState().notes,id:__studioQA.useStore.getState().pgmMat.id})`);assert.equal(restored.notes.test,'PRIVATE-SENTINEL');assert.equal(restored.id,before);mark('teacher reload recovers private notes and current material');
 await api.makeWindow('dock');const dock=api.windows.get('dock');await until(()=>call(dock,'!!window.__studioQA'));assert.equal(await call(dock,'window.csHost.role'),'dock');assert.equal(await call(student,`document.querySelector('.tdock')===null`),true);mark('teacher dock is a separate window absent from the student DOM');
 await fs.promises.writeFile(path.join(out,'teacher-console.png'),(await teacher.webContents.capturePage()).toPNG());
 await call(teacher,`window.csHost.call('startLesson',{synthetic:true,title:'Synthetic acceptance',studentId:'test-only'})`);await until(()=>api.recording.status.phase==='recording');await new Promise(r=>setTimeout(r,2600));await call(teacher,`window.csHost.call('stopLesson')`);await until(()=>api.recording.status.phase==='complete'||api.recording.status.phase==='recoverable',30000);assert.equal(api.recording.status.phase,'complete',api.recording.status.error);const mp4=api.recording.status.path;assert.ok(fs.statSync(mp4).size>5000);mark('synthetic local recording produces MP4 with real chunk persistence',{mp4,bytes:fs.statSync(mp4).size});
 await call(teacher,`window.csHost.call('startLesson',{synthetic:true,title:'Synthetic crash recovery'})`);await until(()=>api.recording.status.phase==='recording');const crashed=api.recording.current;await new Promise(r=>setTimeout(r,2600));api.windows.get('recorder').webContents.forcefullyCrashRenderer();await until(()=>api.recording.status.phase==='error');assert.ok(crashed.bytes>0&&crashed.phase==='recoverable');const recovered=await api.recording.convert(crashed.folder);assert.ok(fs.existsSync(recovered));mark('recorder interruption retains raw data and can recover MP4',{mp4:recovered});
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:true,results,consoleErrors:errors,out},null,2));console.log('RESULT '+out);clearTimeout(timer);for(const w of api.windows.values())if(!w.isDestroyed())w.destroy();app.exit(0);
})().catch(error=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:false,error:error.stack,results,consoleErrors:errors,out},null,2));console.error(error);console.error('RESULT '+out);clearTimeout(timer);app.exit(1);});

