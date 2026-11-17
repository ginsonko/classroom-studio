// 1.7.0-A：真实九类示例、教师私有预监、风格参考启动、小羽入口、布局。
// 先构建：npx vite build --outDir .out/dist-me --emptyOutDir
// 运行：node test/v170-showcase-desktop.cjs（自动通过 quiet.cjs 启动离屏 Electron）
// CS_TEST_OUT / CS_SHOWCASE_SHOTS 可指定日志和截图目录。绝不使用真实桌面或付费引擎。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
if (process.env.CS_DESK_REAL) throw Error('请清除 CS_DESK_REAL；本测试只允许离屏运行');
if (!process.versions.electron) {
  const env = { ...process.env, CS_DIST: process.env.CS_DIST || '.out/dist-me', CS_SHOW: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = require('node:child_process').spawnSync(require('electron'), [path.join(__dirname, 'quiet.cjs'), __filename], { env, stdio: 'inherit', windowsHide: true });
  if (r.error) console.error(r.error);
  process.exit(r.status ?? 1);
}
const out = path.resolve(process.env.CS_TEST_OUT || path.join(ROOT, '.out', 'wu', 'showcase-desktop'));
const shots = path.resolve(process.env.CS_SHOWCASE_SHOTS || path.join(out, '截图'));
fs.mkdirSync(shots, { recursive: true });
process.env.CS_TEST = '1';
process.env.CS_SHOW = '0';
process.env.CS_DATA_DIR = path.join(out, 'data');
process.env.CODEX_HOME = path.join(out, 'codex-home');
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-agent.cjs');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
const { app, BrowserWindow } = require('electron');
const results = [], errors = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); });
  wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason));
});
require('../electron/main.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { const r = await fn(); if (r) return r; } catch (e) { last = e; } await sleep(100); }
  throw Error('Timed out ' + what + (last ? ': ' + last.message : ''));
}
const mark = name => { results.push(name); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('Showcase desktop timeout'); app.exit(1); }, 300000);
let teacher;
(async () => {
  const api = await until(() => globalThis.classroomStudioTest, 'main');
  teacher = api.windows.get('teacher');
  const student = await api.makeWindow('student');
  const exec = (w, code) => w.webContents.executeJavaScript(`(async()=>{const Q=window.__studioQA,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];${code}})()`);
  const T = code => exec(teacher, code);
  const S = code => exec(student, code);
  await until(() => T('return !!Q'), 'teacher QA');
  await until(() => S('return !!Q'), 'student QA');
  const shot = async name => {
    teacher.webContents.invalidate(); await sleep(350);
    fs.writeFileSync(path.join(shots, name + '.png'), (await teacher.webContents.capturePage()).toPNG());
  };
  const click = async selector => {
    await T(`const b=$(${JSON.stringify(selector)});if(!b)throw Error('missing '+${JSON.stringify(selector)});b.click()`); await sleep(100);
  };
  const point = async selector => {
    const p = await T(`const e=$(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`);
    teacher.webContents.sendInputEvent({ type: 'mouseMove', ...p }); await sleep(120);
  };
  const snapshot = () => S('const s=Q.useStore.getState();return JSON.stringify({mat:s.pgmMat,view:s.pgm,ink:s.ink,desk:s.desk})');
  await T(`localStorage.setItem('cs.agent.studioKey','0');Q.useStore.getState().set({page:'agents'});Q.guide.useGuide.setState({welcome:false,active:false})`);
  await until(() => T(`return !!$('.sc-card') && $$('.ags-cli-row.ok').length>0`), 'new task');
  const mf = await T('return await Q.showcase.loadShowcase()');
  assert.deepEqual(mf.items.map(i => i.id), ['html','ppt','quiz','homework','test','notes','plan','plugin','free']);
  assert.equal(mf.items.reduce((n,i) => n + (i.preview.srcUrl || i.preview.imageUrls?.length ? 1 : 0), 0), 9);
  mark('manifest: 9 real local previews');
  const original = await snapshot();

  const { Showcase, cleanRelPath } = require('../electron/showcase.cjs');
  const service = new Showcase();
  for (const p of ['../main.cjs','/absolute','C:/secret','a/../secret','a\\..\\secret','a\0b']) assert.throws(() => service.resolveRel(p));
  assert.throws(() => service.resolveProtocolUrl('showcase://wrong/manifest.json'));
  assert.throws(() => service.resolveProtocolUrl('showcase://asset/%2e%2e%2fmain.cjs'));
  assert.throws(() => service.prepareStart({ styleRef: ['missing/file.html'] }));
  assert.throws(() => service.prepareStart({ styleRef: ['custom/_showcase/shot-1.webp'] }));
  assert.equal(cleanRelPath('custom/test.html'), 'custom/test.html');
  const jroot = fs.mkdtempSync(path.join(require('os').tmpdir(),'cs-sc-junction-')); // exFAT 盘不支持 junction
  const escape = path.join(jroot, 'outside'); fs.mkdirSync(escape, { recursive: true });
  fs.writeFileSync(path.join(escape,'outside.txt'),'not an example');
  const sampleRoot = path.join(jroot,'security-examples'); fs.mkdirSync(sampleRoot,{recursive:true});
  fs.symlinkSync(escape,path.join(sampleRoot,'link'),'junction');
  assert.throws(() => new Showcase({rootDir:sampleRoot}).resolveRel('link/outside.txt'));
  fs.rmSync(jroot,{recursive:true,force:true});
  mark('path boundaries: traversal, absolute paths, junction escape and missing style source rejected');
  assert.match(fs.readFileSync(path.join(ROOT,'scripts/pack.mjs'),'utf8'), /\['dist','electron','bin'\]/);
  mark('packaging copies complete electron tree including examples/_showcase');

  for (const [width,height] of [[1440,900],[1920,1080]]) {
    teacher.setBounds({ x: -5000, y: 0, width, height }); teacher.showInactive(); await sleep(400);
    await T(`Q.guide.useGuide.setState({welcome:true,active:false})`);
    for (const item of mf.items) {
      await point(`[data-tpl-id="${item.id}"]`);
      await until(() => T(`return $('.sc-card')?.dataset.showcaseId===${JSON.stringify(item.id)}`), 'hover ' + item.id);
      await click(`[data-tpl-id="${item.id}"]`);
      await sleep(650);
      const metrics = await T(`const c=$('.sc-card'),r=c.getBoundingClientRect();
        const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
        const visible=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&b.bottom>0&&b.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none'};
        const hits=$$('button').filter(b=>!c.contains(b)&&visible(b)&&overlap(r,b.getBoundingClientRect())).map(b=>b.textContent||b.getAttribute('aria-label'));
        const g=$('.guide-card');return {id:c.dataset.showcaseId,highlights:c.querySelectorAll('.sc-hl li').length,estimate:c.innerText.includes('仅估算'),inside:r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,guide:!!g&&overlap(r,g.getBoundingClientRect()),hits,rect:r.toJSON()}`);
      assert.equal(metrics.highlights,3); assert.ok(metrics.estimate); assert.ok(metrics.inside,JSON.stringify(metrics)); assert.equal(metrics.guide,false,JSON.stringify(metrics)); assert.deepEqual(metrics.hits,[],JSON.stringify(metrics));
      if (width===1440&&item.id==='html') await shot('戊-1440-示例卡-互动课件');
      if (width===1440&&item.id==='ppt') await shot('戊-1440-示例卡-讲课PPT');
      if (width===1920&&item.id==='test') await shot('戊-1920-示例卡-测验卷');
      if (width===1920&&item.id==='free') await shot('戊-1920-示例卡-自定义');
    }
    mark(width+'×'+height+': hover/select 9 cards, 7 elements, no clipping or external button/guide overlap');
  }
  await T(`Q.guide.useGuide.setState({welcome:false,active:false})`);
  await click('[data-tpl-id="html"]');
  await point('[data-tpl-id="ppt"]');
  await point('.sc-card'); await sleep(350);
  assert.equal(await T(`return $('.sc-card').dataset.showcaseId`),'ppt');
  await point('.ags-title'); await sleep(350);
  assert.equal(await T(`return $('.sc-card').dataset.showcaseId`),'html');
  mark('hover survives moving into card; leaving restores selected type');
  for(const id of ['html','plugin']) {
    await click(`[data-tpl-id="${id}"]`);
    await until(()=>T(`return $('.sc-video')?.readyState>=2&&!$('.sc-video').paused`),'video loaded');
    const before=await T(`return $('.sc-video').currentTime`);await sleep(650);
    const after=await T(`const v=$('.sc-video');return {t:v.currentTime,muted:v.muted,loop:v.loop,poster:v.poster}`);
    assert.notEqual(before,after.t);assert.ok(after.muted&&after.loop&&after.poster);
  }
  mark('both WebM previews really play, muted, looping with posters');
  await click('[data-tpl-id="ppt"]');
  const first=await T(`return $('.sc-slide').src`);
  await until(()=>T(`return $('.sc-slide').src!==${JSON.stringify(first)}`),'slideshow changes',5000);
  await click('.sc-dot');assert.equal(await T(`return $('.sc-dot').getAttribute('aria-selected')`),'true');
  mark('slides advance automatically and dots switch manually');

  const open = async (id,index=0) => {
    await T(`return Q.showcase.openShowcaseExample(${JSON.stringify(id)},${index})`);
    await until(()=>T(`return !!$('.sc-viewer-body .stage')||!!$('.sc-plugin-stage iframe')||!!$('.sc-viewer-body canvas')||!!$('.sc-viewer-body .media')`),'full viewer '+id,40000);
    await until(()=>T(`return !$('.sc-viewer-wait')`),'viewer ready '+id,40000);
  };
  await click('[data-tpl-id="html"]');await click('[data-qa="showcase-open"]');
  await until(()=>T(`return !!$('.sc-viewer-body iframe')`),'HTML frame');
  const htmlFrame=await until(()=>teacher.webContents.mainFrame.framesInSubtree.find(f=>f.url.startsWith('lesson:')),'HTML live frame');
  await until(()=>htmlFrame.executeJavaScript(`document.readyState==='complete'&&!!document.querySelector('input[type=range]')`),'HTML range ready');
  const htmlResult=await htmlFrame.executeJavaScript(`(()=>{const r=document.querySelector('input[type=range]');if(!r)return false; r.value=Number(r.min)+Number(r.step||1);r.dispatchEvent(new Event('input',{bubbles:true}));return {range:r.value,body:document.body.textContent.length}})()`);
  assert.ok(htmlResult&&htmlResult.body>100);await shot('戊-预监打开示例-互动课件');
  await T(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));Q.useStore.getState().take()`);
  assert.equal(await snapshot(),original);
  await click('[aria-label="关闭示例预览"]');
  await T('Q.useStore.getState().take()');assert.equal(await snapshot(),original);
  mark('interactive HTML opens in private preview; Enter/take never publishes even after closing viewer');
  await open('test');assert.ok(await T('return Q.useStore.getState().pvw.mat.total>1'));
  await click('.sc-pager [aria-label="下一页"]');assert.equal(await T('return Q.useStore.getState().pvw.view.page'),1);
  await shot('戊-预监打开示例-PDF');
  await open('ppt',mf.items.find(i=>i.id==='ppt').full.findIndex(f=>f.kind==='pptx'));
  assert.ok(await T('return Q.useStore.getState().pvw.mat.total>=14'));
  await click('.sc-pager [aria-label="下一页"]');assert.equal(await T('return Q.useStore.getState().pvw.view.page'),1);
  assert.equal(await snapshot(),original);mark('PDF and PPTX use real paginated readers; next page works, student unchanged');
  for(let index=0;index<3;index++){await open('free',index);assert.equal(await T('return Q.showcase.useShowcase.getState().viewer.index'),index);}
  assert.equal(await snapshot(),original);mark('all 3 custom examples open');
  await open('plugin');
  const pluginFrame=await until(()=>teacher.webContents.mainFrame.framesInSubtree.find(f=>f.url.startsWith('plugin://dev-showcase-')),'plugin live');
  await until(()=>pluginFrame.executeJavaScript('!!window.cs?.context'),'plugin SDK');
  const blocked=await pluginFrame.executeJavaScript(`(async()=>{let n=0;for(const f of [()=>cs.present.open('screen.html'),()=>cs.board.addText('must never show')])try{await f()}catch(e){if(e.message.includes('老师预监'))n++}document.querySelector('input[type=range]').dispatchEvent(new Event('input',{bubbles:true}));return n})()`);
  assert.equal(blocked,2);await sleep(250);assert.equal(await snapshot(),original);
  mark('plugin SDK runs and adjusts; present.open and board.addText cannot affect students');
  await click('[aria-label="关闭示例预览"]');

  await click('[data-tpl-id="html"]');await click('[data-qa="showcase-apply"]');
  assert.match(await T(`return $('[data-qa="style-ref-chip"]').textContent`),/互动课件/);
  await click('[aria-label="移除风格参考"]');assert.equal(await T(`return !!$('[data-qa="style-ref-chip"]')`),false);
  await click('[data-qa="showcase-apply"]');
  const seen=[],spawn=api.agents._spawnRun.bind(api.agents);
  api.agents._spawnRun=(task,text)=>{const bg=fs.readFileSync(path.join(task.work,'任务背景.md'),'utf8');const refs=[...bg.matchAll(/\.cs-kit\/examples\/([^\s、]+?)(?=\n|、|$)/g)].map(m=>m[1]);seen.push({bg,text,refs,exists:refs.every(p=>fs.existsSync(path.join(task.work,'.cs-kit/examples',p)))});return spawn(task,text)};
  await T(`const cb=$('.ags-new-form input[type=checkbox]');if(cb?.checked)cb.click();$$('.ags-new-form .ags-field').filter(f=>f.querySelector('input[type=checkbox]')).forEach(f=>f.querySelectorAll('input[type=checkbox]').forEach(c=>{if(c.checked)c.click()}))`);
  await T(`const i=$('.ags-new-form .ags-field input:not([type=checkbox])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'超重与失重');i.dispatchEvent(new Event('input',{bubbles:true}))`);await sleep(200);
  await click('.ags-go');await until(()=>seen.length,'fake task started');
  assert.ok(seen[0].exists&&seen[0].refs.length);assert.match(seen[0].bg,/\.cs-kit\/examples\/courseware-html\//);assert.match(seen[0].text,/\.cs-kit\/examples\//);
  const task=api.agents.list()[0];await until(()=>['done','failed'].includes(api.agents.tasks.get(task.id)?.status),'fake task done',40000);
  assert.equal(api.agents.tasks.get(task.id).status,'done',JSON.stringify(api.agents.tasks.get(task.id).events));
  mark('apply/remove style chip and start via form; source exists before fake engine starts, context contains sample path');
  // 插件任务不会自动安装通用设计包，单独验证这条启动路径。
  await T(`return Q.host.call('agents.start',{engine:'codex',kind:'plugin',title:'reference test',prompt:'PLUGIN',formats:[],styleRef:{id:'plugin'}})`);
  await until(()=>seen.length===2,'plugin reference task');assert.ok(seen[1].exists);assert.match(seen[1].bg,/\.cs-kit\/examples\/plugin-dev\//);
  mark('plugin task references also exist before engine starts');

  await T(`const r=await Q.assistantTools.runTool('show_examples',{}, {chatId:'showcase-test',turnId:'t',confirm:async()=>false,granted:()=>[],grant:async()=>[],sendParent:async()=>[]});if(!r.card?.examples)throw Error(JSON.stringify(r));window.exampleToolResult=r;Q.assistant.useAssistant.setState({open:true,view:'chat',chat:{id:'showcase-test',title:'示例',created:Date.now(),updated:Date.now(),running:false,cny:0,source:'test',persona:'',count:1,turns:[],items:[{id:'showcase-tool',kind:'tool',name:'show_examples',status:'done',at:Date.now(),turn:'t',card:r.card}]}})`);
  await until(()=>T(`return $$('.as-ex-card').length===9`),'assistant examples');
  await T(`$('.as-list').scrollTop=0`);
  await shot('戊-小羽示例卡');await click('[data-qa="as-ex-open-html"]');await until(()=>T(`return !!$('.sc-viewer-body iframe')`),'assistant full example');assert.equal(await snapshot(),original);
  await click('[aria-label="关闭示例预览"]');await click('[data-qa="as-ex-apply-ppt"]');
  await until(()=>T(`return Q.useStore.getState().page==='agents'&&$('[data-tpl-id="ppt"]')?.classList.contains('on')&&$('[data-qa="style-ref-chip"]')?.textContent.includes('讲课')`),'assistant workshop apply');
  mark('real show_examples tool emits 9 cards; open and go-to-workshop buttons work');
  // 已打开账本时也要切回新任务，而不是丢掉跳转意图。
  await T(`$$('.ags-tabs button').find(b=>b.innerText.includes('账本')).click()`);await sleep(150);
  await T(`Q.showcase.applyShowcaseToWorkshop('html')`);
  await until(()=>T(`return !!$('.ags-new-form')&&$('[data-qa="style-ref-chip"]')?.textContent.includes('互动课件')`),'ledger to new task');
  mark('workshop intent switches ledger back to new task');
  for(const t of api.agents.tasks.values())if(t.status==='running')api.agents.halt(t,'stopped','test finished');
  assert.deepEqual(errors.filter(e=>!/Autofill|DevTools|favicon|net::ERR/.test(e)),[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:true,passed:results.length,results,errors,shots},null,2));
  console.log('TOTAL '+results.length+' passed, 0 failed');
  clearTimeout(timer);for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.destroy();app.exit(0);
})().catch(async e=>{
  try{if(teacher)fs.writeFileSync(path.join(out,'failure.png'),(await teacher.webContents.capturePage()).toPNG())}catch{}
  console.error('FAIL',e.stack||e);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:false,passed:results.length,results,error:String(e.stack||e),errors},null,2));app.exit(1);
});
