// AI 整理的真实准确率（花真钱，不在回归里跑）：拿本机真实的错题照片，用本机配好的 AI 走一遍「开始整理」，
// 把框出来的题和对错画在照片上，人工核对。
// 用法：npx electron test/quiet.cjs test/sort-real.cjs  （CS_REAL_DATA=真实数据目录，CS_REAL_PHOTOS=照片目录，CS_REAL_PICK=逗号分隔的文件名）
const fs = require('node:fs'); const path = require('node:path');
const real = process.env.CS_REAL_DATA || 'G:\\ClassroomStudioData';
const dir = process.env.CS_REAL_PHOTOS;
if (!dir) { console.error('CS_REAL_PHOTOS 要指向照片目录'); process.exit(2); }
const pick = (process.env.CS_REAL_PICK || '').split(',').map((s) => s.trim()).filter(Boolean);
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'sort-real-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); process.env.CS_AI_DUMP = path.join(out, 'dump');
fs.mkdirSync(path.join(process.env.CS_DATA_DIR, 'browser'), { recursive: true }); fs.mkdirSync(process.env.CS_AI_DUMP, { recursive: true });
// AI 配置：密钥用系统加密，要连同 Local State 一起拷才解得开；测完删掉
fs.copyFileSync(path.join(real, 'ai.json'), path.join(process.env.CS_DATA_DIR, 'ai.json'));
fs.copyFileSync(path.join(real, 'browser', 'Local State'), path.join(process.env.CS_DATA_DIR, 'browser', 'Local State'));
const names = [...new Set(pick.map((f) => f.replace(/^李/, '').match(/^[\u4e00-\u9fa5]+/)?.[0]).filter(Boolean))];
const students = names.map((n, i) => ({ id: 'r' + i, name: n, grade: '高二', hue: i * 40, textbook: '人教版 2019', subject: 'physics', tags: [], lessons: 0, lastTopic: '', lastAt: '' }));
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students, studentId: students[0]?.id ?? 'free', slots: [], learning: {} } }));

const electron = require('electron'); const { app } = electron;
const files = pick.map((f) => path.join(dir, f));
electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw Error('timeout'); };
const cleanup = () => { for (const f of ['ai.json', path.join('browser', 'Local State')]) fs.rmSync(path.join(process.env.CS_DATA_DIR, f), { force: true }); };
/** 把框和对错画到照片上，存成 00.jpg、01.jpg… */
async function draw(call, res) {
  for (const [i, r] of res.entries()) {
    // 走 data URL：本地文件地址画到画布上会「污染」画布，导不出图
    const src = 'data:image/jpeg;base64,' + fs.readFileSync(r.path).toString('base64');
    const png = await call(`const img=new Image();img.src=${JSON.stringify(src)};await img.decode();const t=${r.turn || 0},side=t===90||t===270;
      const iw=side?img.naturalHeight:img.naturalWidth,ih=side?img.naturalWidth:img.naturalHeight,W=1000,H=Math.round(ih*W/iw);
      const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
      g.save();g.translate(W/2,H/2);g.rotate(t*Math.PI/180);const dw=side?H:W,dh=side?W:H;g.drawImage(img,-dw/2,-dh/2,dw,dh);g.restore();
      const col={wrong:'#e00',right:'#0a0',half:'#e90',unsure:'#90f',none:'#06f'};
      for(const q of ${JSON.stringify(r.regions)}){for(const s of q.segs){const x0=(s.x0??0)*W,x1=(s.x1??1)*W,y0=s.y0*H,y1=s.y1*H;g.strokeStyle=col[q.mark]||'#06f';g.lineWidth=4;g.strokeRect(x0,y0,x1-x0,y1-y0);
        g.fillStyle=col[q.mark]||'#06f';g.fillRect(x0,y0,120,34);g.fillStyle='#fff';g.font='bold 24px sans-serif';g.fillText(q.n+' '+q.mark,x0+4,y0+26);}}
      return c.toDataURL('image/jpeg',.85)`);
    if (png.__err) { console.log('draw failed', r.file, png.__err); continue; }
    fs.writeFileSync(path.join(out, `${String(i).padStart(2, '0')}.jpg`), Buffer.from(png.split(',')[1], 'base64'));
  }
}
const timer = setTimeout(() => { console.error('timed out'); cleanup(); app.exit(1); }, 900000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (code) => teacher.webContents.executeJavaScript(`(async()=>{try{const Q=__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`);
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  teacher.setBounds({ x: -5000, y: 30, width: 1440, height: 900 }); teacher.showInactive();
  await until(() => call(`return Q.useStudy.getState().loaded`));
  // CS_REAL_REPLAY=上次的输出目录：不再花钱，拿存下的回复原文用现在的解析重算一遍、重画
  const replay = process.env.CS_REAL_REPLAY;
  if (replay) {
    const prev = JSON.parse(fs.readFileSync(path.join(replay, 'result.json'), 'utf8'));
    const raw = fs.readdirSync(path.join(replay, 'dump')).map((f) => JSON.parse(fs.readFileSync(path.join(replay, 'dump', f), 'utf8')).reply);
    const res = [];
    for (const r of prev.res) {
      const reply = raw.find((x) => { try { return JSON.parse(x).title?.trim().slice(0, 60) === r.title; } catch { return false; } });
      const p = reply ? await call(`return Q.sortLogic.parseImageReply(JSON.parse(${JSON.stringify(reply)}))`) : { regions: [] };
      if (p.__err) throw Error(p.__err);
      res.push({ ...r, path: path.join(dir, r.file), kind: p.kind ?? r.kind, regions: p.regions ?? [] });
    }
    await draw(call, res);
    for (const r of res) console.log(`${r.file} → ${r.kind} 「${r.title}」 ${r.regions.map((q) => q.n + ':' + q.mark + '×' + q.segs.length).join(' ')}`);
    console.log('REPLAY →', out);
    cleanup(); clearTimeout(timer); app.exit(0); return;
  }
  await call(`Q.sort.openSort({tab:'new'});return true`);
  await until(() => call(`return !!document.querySelector('.sort[role=dialog]')`));
  await call(`[...document.querySelectorAll('.sort button')].find(b=>b.innerText.includes('选择文件')).click();return true`);
  await until(() => call(`return Q.sort.useSort.getState().items.length===${files.length}`));
  const est = await until(() => call(`return Q.sort.useSort.getState().est`), 5000).catch(() => null);
  console.log('estimate', JSON.stringify(est));
  const t0 = Date.now();
  await call(`[...document.querySelectorAll('.sort-f .btn-cue')].find(b=>b.innerText.includes('开始整理')).click();return true`);
  await until(() => call(`const s=Q.sort.useSort.getState();return s.phase==='review'`), 800000);
  const ms = Date.now() - t0;
  const res = await call(`const s=Q.sort.useSort.getState();return s.analyses.map((a,i)=>({file:s.items[i].name,path:s.items[i].path,kind:a.kind,via:a.via,name:a.name,student:(Q.useStore.getState().students.find(x=>x.id===a.studentId)||{}).name,title:a.title,note:a.note,turn:a.turn,regions:(a.regions||[]).map(r=>({n:r.n,mark:r.mark,segs:r.segs}))}))`);
  if (res.__err) throw Error(res.__err);
  await draw(call, res);
  const step1 = fs.readdirSync(process.env.CS_AI_DUMP).length;
  // CS_REAL_ARCHIVE=1：接着归档，等后台看图补题干 / 答案 / 自检跑完，量全程的花费，存下每道题的截图
  let questions = [];
  if (process.env.CS_REAL_ARCHIVE) {
    await call(`[...document.querySelectorAll('.sort-f .btn-cue')].find(b=>b.innerText.includes('归档')).click();return true`);
    await until(() => call(`return Q.sort.useSort.getState().phase==='done'`), 300000);
    let last = -1, still = 0;
    while (still < 8) { await sleep(5000); const k = fs.readdirSync(process.env.CS_AI_DUMP).length; still = k === last ? still + 1 : 0; last = k; }
    questions = await call(`const r=Q.sort.useSort.getState().record;const qs=Q.useStudy.getState().data.questions.filter(q=>r.questions.includes(q.id));
      const out=[];for(const q of qs)out.push({source:q.source,stem:q.stem.slice(0,160),answer:(q.answer||'').slice(0,80),points:q.points,qtype:q.qtype,check:q.check,checkNote:q.checkNote,img:q.image?await Q.host.call('study.imageData',q.image):''});return out`);
    if (questions.__err) throw Error(questions.__err);
    for (const [i, q] of questions.entries()) { if (q.img) fs.writeFileSync(path.join(out, `q${String(i).padStart(2, '0')}.${q.img.startsWith('data:image/png') ? 'png' : 'jpg'}`), Buffer.from(q.img.split(',')[1], 'base64')); delete q.img; }
    for (const q of questions) console.log(`  ${q.source} [${q.qtype}] ${q.check ?? ''} ${q.stem.replace(/\s+/g, ' ').slice(0, 60)} → ${q.answer.replace(/\s+/g, ' ').slice(0, 30)}`);
  }
  // 文件名以时间戳开头，排序即先后；前 step1 个是「开始整理」看图，后面是归档后的补题、自检
  const dumps = fs.readdirSync(process.env.CS_AI_DUMP).sort().map((f) => JSON.parse(fs.readFileSync(path.join(process.env.CS_AI_DUMP, f), 'utf8')));
  const sum = (ds) => ds.reduce((s, d) => ({ in: s.in + (d.usage?.prompt_tokens || 0), out: s.out + (d.usage?.completion_tokens || 0) }), { in: 0, out: 0 });
  const usage = sum(dumps), split = { look: sum(dumps.slice(0, step1)), fill: sum(dumps.slice(step1)) };
  const replies = dumps.map((d) => ({ ms: d.ms, finish: d.finish, usage: d.usage, reply: String(d.reply || '').slice(0, 1500) }));
  const ledger = await call(`return await Q.host.call('ai.ledger')`).catch(() => null);
  console.log('split', JSON.stringify(split), 'ledger', JSON.stringify(ledger)?.slice(0, 600));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ms, est, usage, split, ledger, calls: dumps.length, res: res.map(({ path: _p, ...x }) => x), questions, replies }, null, 2));
  for (const r of res) console.log(`${r.file} → ${r.kind}/${r.via}${r.turn ? ' 转' + r.turn : ''} 名字「${r.name}」→ ${r.student ?? '?'} 「${r.title}」 ${r.regions.map((q) => q.n + ':' + q.mark + '×' + q.segs.length).join(' ')}${r.note ? ' ⚠ ' + r.note : ''}`);
  console.log(`RESULT ${res.length} 张 ${Math.round(ms / 1000)} s，${dumps.length} 次调用，输入 ${usage.in} / 输出 ${usage.out} tokens · ${out}`);
  cleanup(); clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('FAIL', e); cleanup(); clearTimeout(timer); app.exit(1); });
