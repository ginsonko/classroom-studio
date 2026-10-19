// 真实网页课件验收：只读打开指定 HTML，看脚本是否报错、动画是否在跑。
// 用法：$env:CS_HTML='C:\path\to\file.html'; npx electron test/quiet.cjs test/real-html.cjs
const fs = require('node:fs'); const path = require('node:path');
const file = process.env.CS_HTML;
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'html-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
const { app } = require('electron'); const logs = [];
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (e) => { const d = e.level !== undefined ? e : {}; logs.push({ level: d.level, message: String(d.message).slice(0, 300), frame: d.frame?.url?.slice(0, 60) }); }));
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw Error('Timed out'); };
(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA')); await until(() => student.webContents.executeJavaScript('!!window.__studioQA'));
  student.setBounds({ x: 0, y: 0, width: 1280, height: 760 }); student.show();
  api.files.authorize(file);
  const t0 = Date.now();
  await teacher.webContents.executeJavaScript(`__studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(file)}),'student').then(()=>true)`);
  const frame = await until(() => student.webContents.mainFrame.framesInSubtree.find((f) => f !== student.webContents.mainFrame && f.url.startsWith('lesson:')), 15000);
  await until(() => frame.executeJavaScript('document.readyState==="complete"'), 30000);
  const loadMs = Date.now() - t0;
  const sample = () => frame.executeJavaScript(`(()=>{const a=document.getAnimations?document.getAnimations():[];return {anims:a.length,running:a.filter(x=>x.playState==='running').length,ls:(()=>{try{localStorage.setItem('__t','1');return 'ok'}catch(e){return String(e)}})(),reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,cookie:(()=>{try{document.cookie='__c=1;path=/';return document.cookie.includes('__c=1')?'ok':'not kept'}catch(e){return String(e)}})(),title:document.title,h:document.body.scrollHeight}})()`);
  const s1 = await sample(); await sleep(4000); const s2 = await sample();
  fs.writeFileSync(path.join(out, 'student.png'), (await student.webContents.capturePage()).toPNG());
  await sleep(1500); fs.writeFileSync(path.join(out, 'student-2.png'), (await student.webContents.capturePage()).toPNG());
  const res = { file, loadMs, s1, s2, errors: logs.filter((l) => l.level === 'error' || l.level >= 3 || /Error|error/.test(l.message)).slice(0, 30) };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 1)); console.log('RESULT ' + out);
  for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((e) => { console.error(e); console.log(JSON.stringify(logs.slice(-20), null, 1)); app.exit(1); });
