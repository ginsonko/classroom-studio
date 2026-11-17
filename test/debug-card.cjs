// 调试：到点提醒卡片到底画在哪、被什么盖住
const fs = require('node:fs'); const path = require('node:path');
const out = process.env.CS_SHOT_OUT || path.join(__dirname, '../.out/dbg'); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, '_data'); process.env.CS_SYNTHETIC_RECORD = '1';
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(path.join(DATA, 'study'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'study', 'study.json'), JSON.stringify({ questions: [], attempts: [], lessons: [], sorts: [], files: [] }));
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {} },
  settings: { autoAnalyze: false, autoRec: { v: 2, start: true, stageButton: true } },
  local: { roots: [], students: [{ id: 'stu-a', name: '莫莫', grade: '高一', hue: 190, textbook: '', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' }], studentId: 'stu-a', slots: [], learning: {} },
}));
const electron = require('electron'); const { app } = electron;
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('timeout'); app.exit(1); }, 120000);
(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const run = (w) => async (code) => { const r = await w.webContents.executeJavaScript(`(async()=>{try{const Q=window.__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  teacher.setBounds({ x: -5000, y: 30, width: 1440, height: 900 }); teacher.showInactive();
  const T = run(teacher);
  await until(() => T(`return Q.useStudy.getState().loaded`), 10000, 'study');
  const at = new Date(); at.setSeconds(0, 0);
  await T(`const st=Q.useStore.getState();st.set({slots:[{id:'s1',studentId:'stu-a',day:(new Date().getDay()+6)%7,date:'${new Date().toISOString().slice(0, 10)}',start:${at.getHours() + at.getMinutes() / 60},len:1,topic:'测试课',repeat:false}]});Q.autoRecord.setAutoRecordSettings({v:2,stageButton:true});Q.autoRecord.tick();return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="autorec-card"]')`), 8000, 'card');
  const info = await T(`const e=document.querySelector('[data-qa="autorec-card"]');const cs=getComputedStyle(e);const r=e.getBoundingClientRect();
    const chain=[];let p=e;while(p&&chain.length<8){const s=getComputedStyle(p);chain.push(p.tagName+'.'+p.className+'{pos:'+s.position+',z:'+s.zIndex+',tf:'+s.transform+',disp:'+s.display+',op:'+s.opacity+'}');p=p.parentElement;}
    const pt=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},pos:cs.position,top:cs.top,right:cs.right,z:cs.zIndex,op:cs.opacity,tf:cs.transform,anim:cs.animationName+','+cs.animationPlayState,text:e.innerText.slice(0,80),atPoint:pt?pt.tagName+'.'+String(pt.className).slice(0,60):'null',chain};`);
  console.log(JSON.stringify(info, null, 2));
  const img = await teacher.webContents.capturePage();
  fs.writeFileSync(path.join(out, 'dbg-teacher.png'), img.toPNG());
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error(e); clearTimeout(timer); app.exit(1); });
