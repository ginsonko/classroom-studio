// 学情 AI 真实模型实测（手动运行，会产生费用）：在真实数据目录的副本上，用已配置的模型跑识题、出题自检、课后总结、画像、课件。
// 用法：npm run build 后 set CS_DATA_DIR=<数据副本> && npx electron test/quiet.cjs test/study-real.cjs
// 不会碰原始数据目录；输出写到 <数据副本>/../real-out。
const fs = require('node:fs'); const path = require('node:path');
if (!process.env.CS_DATA_DIR || /ClassroomStudioData[\\/]*$/i.test(process.env.CS_DATA_DIR)) { console.error('CS_DATA_DIR 必须指向数据副本'); process.exit(2); }
const out = path.join(process.env.CS_DATA_DIR, '..', 'real-out'); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1';
const { app, BrowserWindow } = require('electron'); const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw Error('Timed out ' + what); };
const timer = setTimeout(() => { console.error('study real timed out'); app.exit(1); }, 900000);

// 三道题，答案人工算好，用来判断模型读题、解题对不对
const PROBLEMS = [
  { id: 'incline', expect: ['2', '4'], qtype: '计算', html: `<p>如图所示，质量 <i>m</i>=2 kg 的物块从倾角 <i>θ</i>=37° 的固定斜面顶端由静止开始下滑，物块与斜面间的动摩擦因数 <i>μ</i>=0.5，斜面长 <i>L</i>=4 m。取 <i>g</i>=10 m/s²，sin37°=0.6，cos37°=0.8。求：</p><p>（1）物块下滑时的加速度大小 <i>a</i>；</p><p>（2）物块滑到斜面底端时的速度大小 <i>v</i>。</p>`,
    svg: `<svg width="300" height="170"><polygon points="20,150 280,150 20,10" fill="#eee" stroke="#000" stroke-width="2"/><rect x="70" y="40" width="40" height="26" fill="#9cf" stroke="#000" transform="rotate(28 90 53)"/><path d="M240 150 A40 40 0 0 0 245 132" fill="none" stroke="#000"/><text x="210" y="142" font-size="16">37°</text></svg>` },
  { id: 'lenz', expect: ['B'], qtype: '选择', html: `<p>如图所示，条形磁铁 N 极朝下，竖直向下靠近水平放置的闭合铝环（磁铁在铝环正上方）。从上往下看，铝环中感应电流的方向和铝环受到磁铁作用力的方向分别是（　　）</p><p>A．顺时针，竖直向上　　　B．逆时针，竖直向下</p><p>C．逆时针，竖直向上　　　D．顺时针，竖直向下</p>`,
    svg: `<svg width="200" height="190"><rect x="85" y="10" width="30" height="90" fill="#fff" stroke="#000" stroke-width="2"/><rect x="85" y="55" width="30" height="45" fill="#e44"/><text x="93" y="85" font-size="18" fill="#fff">N</text><text x="94" y="40" font-size="18">S</text><line x1="100" y1="105" x2="100" y2="130" stroke="#000" marker-end="url(#a)"/><defs><marker id="a" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs><ellipse cx="100" cy="160" rx="70" ry="14" fill="none" stroke="#888" stroke-width="5"/></svg>` },
  { id: 'proton', expect: ['0.21', '6.6'], qtype: '计算', html: `<p>一个质子（质量 <i>m</i>=1.67×10<sup>−27</sup> kg，电荷量 <i>q</i>=1.6×10<sup>−19</sup> C）以 <i>v</i>=2.0×10<sup>6</sup> m/s 的速度垂直磁场方向射入磁感应强度 <i>B</i>=0.10 T 的匀强磁场，不计重力。求：</p><p>（1）质子做匀速圆周运动的轨道半径 <i>r</i>；</p><p>（2）质子运动的周期 <i>T</i>。</p>`, svg: '' },
];
async function render(p) {
  const w = new BrowserWindow({ show: false, width: 900, height: 520, webPreferences: { offscreen: true } });
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:24px 32px;font:20px/1.7 'Microsoft YaHei',sans-serif;background:#fff;color:#111;display:flex;gap:24px"><div style="flex:1">${p.html}</div>${p.svg ? `<div>${p.svg}</div>` : ''}</body>`;
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); await sleep(700);
  const img = await w.webContents.capturePage(); w.destroy();
  fs.writeFileSync(path.join(out, `problem-${p.id}.png`), img.toPNG());
  return img.toDataURL();
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (code) => teacher.webContents.executeJavaScript(`(async()=>{const Q=__studioQA,A=Q.studyAi,L=Q.studyLogic,s=Q.useStore.getState();${code}})()`);
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const cfg = await call(`return await Q.host.call('ai.getConfig')`);
  if (!cfg.hasKey) throw Error('副本里没有可用的 Key');
  const report = { model: cfg.model, visionModel: cfg.visionModel || '(同主模型)', steps: [] };
  const step = async (name, code) => {
    const t = Date.now();
    try { const r = await call(code); report.steps.push({ name, ok: true, ms: Date.now() - t, r }); console.log(`OK ${name} ${Date.now() - t}ms`); return r; }
    catch (e) { report.steps.push({ name, ok: false, ms: Date.now() - t, error: String(e.message || e) }); console.log(`FAIL ${name}: ${e.message}`); return null; }
  };

  // 1. 看图识题（三道）
  const reads = [];
  for (const p of PROBLEMS) {
    const img = await render(p);
    const r = await step('识题 ' + p.id, `const cfg=await Q.host.call('ai.getConfig');return await A.readQuestion(cfg,{image:${JSON.stringify(img)}})`);
    if (r) {
      const hit = p.expect.map((x) => r.answer.replace(/\s/g, '').includes(x) || L_match(r.answer, x));
      r.check = { expect: p.expect, hit, qtypeOk: r.qtype === p.qtype, points: await call(`return ${JSON.stringify(r.points)}.map(k=>k+' '+L.pointLabel(k))`) };
      reads.push({ p, r });
    }
  }
  function L_match(a, x) { return /^[A-D]$/.test(x) ? new RegExp('(^|[^A-Z])' + x + '([^A-Z]|$)').test(a.toUpperCase()) : false; }

  // 2. 出题 + 盲解自检（磁场 + 楞次定律）
  const pts = await call(`return [...new Set([...L.guessPoints('带电粒子在匀强磁场中做匀速圆周运动 半径'),...L.guessPoints('楞次定律 感应电流方向')])].slice(0,2)`);
  const drafts = await step('组作业出题+自检', `return await A.draftQuestions(${JSON.stringify(pts)},3,2,4,[],()=>{})`);

  // 3. 课后总结（用识题结果造一节课的作答）
  const student = await call(`const st=s.students.find(x=>x.id===s.studentId)||s.students[0];return st?{id:st.id,name:st.name,grade:st.grade,tags:st.tags||[]}:{id:'stu-x',name:'测试学生',grade:'高二',tags:[]}`);
  const results = ['right', 'wrong', 'half'];
  const qs = reads.map(({ r }, i) => ({ id: 'rq' + i, stem: r.stem, answer: r.answer, analysis: r.analysis, points: r.points, difficulty: r.difficulty, qtype: r.qtype, origin: 'board', status: 'bank', createdAt: new Date().toISOString() }));
  const now = Date.now();
  const atts = qs.map((q, i) => ({ id: 'a' + i, studentId: student.id, questionId: q.id, result: results[i % 3], at: new Date(now - i * 600000).toISOString() }));
  const lesson = await step('课后总结', `const qs=${JSON.stringify(qs)},at=${JSON.stringify(atts)};return await A.lessonByAi({student:${JSON.stringify(student.name)},topic:'牛顿定律应用与电磁感应复习',minutes:90,attempts:at.map(a=>({q:qs.find(q=>q.id===a.questionId),a})),notes:'斜面受力分析能自己画出来；楞次定律"来拒去留"记混了，判断电流方向时没有先判断原磁场变化；质子半径计算时数量级算错一次，自己发现并改正。',homework:'楞次定律专项 6 题'})`);

  // 4. 学生画像（造 6 周历史）
  const hist = [];
  for (let w = 0; w < 6; w++) qs.forEach((q, i) => hist.push({ id: `h${w}-${i}`, studentId: student.id, questionId: q.id, result: (i === 1 && w > 2) ? 'wrong' : (w + i) % 4 === 0 ? 'half' : 'right', at: new Date(now - (w * 7 + 1) * 86400000 - i * 3600000).toISOString() }));
  const portrait = await step('学生画像', `const d={...L.emptyStudy(),questions:${JSON.stringify(qs)},attempts:${JSON.stringify([...hist, ...atts])}};const p=L.profile(${JSON.stringify(student.id)},d);return {p:{attempts:p.attempts,accuracy:p.accuracy,weak:p.weak.map(m=>L.pointLabel(m.key))},...await A.portraitByAi(${JSON.stringify(student.name)},${JSON.stringify(student.grade)},${JSON.stringify(student.tags)},p,[])}`);

  // 5. AI 课件 → PPTX + PDF
  const course = await step('AI 课件大纲', `const r=await A.outlineByAi('电磁感应现象与楞次定律',${JSON.stringify(pts)},${JSON.stringify(student.name + '，' + student.grade)},60,${JSON.stringify(qs.slice(1, 2))});return {...r,md:L.outlineMarkdown(r.outline)}`);
  if (course) await step('课件导出', `return await Q.host.call('study.document',{kind:'courseware',title:'电磁感应现象与楞次定律',markdown:${JSON.stringify(course.md)},formats:['pptx','pdf']})`);
  if (lesson) await step('课后长图导出', `const l={id:'l1',studentId:${JSON.stringify(student.id)},date:new Date().toISOString().slice(0,10),topic:'牛顿定律应用与电磁感应复习',minutes:90,notes:'',attemptIds:[],homework:'楞次定律专项 6 题',...${JSON.stringify(lesson)},via:'ai',createdAt:new Date().toISOString()};return await Q.host.call('study.document',{kind:'lesson',title:'课后反馈',markdown:L.lessonMarkdown(l,${JSON.stringify(student.name)}),formats:['png','docx']})`);
  if (drafts) await step('作业导出', `const qs=${JSON.stringify(drafts.drafts)}.map((d,i)=>({id:'d'+i,...d,qtype:'计算',origin:'ai',status:'bank',createdAt:new Date().toISOString()}));return await Q.host.call('study.document',{kind:'homework',title:'AI出题作业',markdown:L.homeworkMarkdown('AI出题作业',${JSON.stringify(student.name)},qs),formats:['pdf']})`);

  // 6. 识题结果放进题库，看列表里公式是否正常显示
  const bankQs = [...qs, ...(drafts?.drafts ?? []).map((d, i) => ({ id: 'dq' + i, stem: d.stem, answer: d.answer, analysis: d.analysis, points: d.points, difficulty: d.difficulty, qtype: '计算', origin: 'ai', status: d.check === 'ok' ? 'bank' : 'inbox', check: d.check, checkNote: d.checkNote, createdAt: new Date().toISOString() }))];
  await call(`const S=Q.useStudy.getState();S.update(d=>({...d,questions:[...d.questions,...${JSON.stringify(bankQs)}]}));s.set({page:'study'});return true`);
  teacher.setBounds({ x: 30, y: 30, width: 1440, height: 900 }); teacher.show();
  await sleep(800);
  await call(`[...document.querySelectorAll('.ags-tabs button')].find(b=>b.innerText.includes('题库')).click();return true`);
  await sleep(1200);
  fs.writeFileSync(path.join(out, 'bank-latex.png'), (await teacher.webContents.capturePage()).toPNG());
  report.katexInBank = await call(`return document.querySelectorAll('.sd-q-main .katex').length`);

  const ledger = (api.ledger?.entries ?? []).filter((e) => e.at > now - 3600000 && ['题库识题', '组作业出题', '组作业自检', '课后总结', '学生画像', 'AI 课件'].includes(e.feature));
  report.ledger = ledger.map((e) => ({ feature: e.feature, model: e.model, in: e.input ?? e.prompt_tokens, out: e.output ?? e.completion_tokens, cny: e.cny }));
  report.totalCny = ledger.reduce((a, e) => a + (e.cny || 0), 0);
  report.consoleErrors = errors;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('TOTAL ¥' + report.totalCny.toFixed(4) + ' calls=' + ledger.length);
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((e) => { console.error(e); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1); });
