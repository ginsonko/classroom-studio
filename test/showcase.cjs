// 官网 / 教程用的展示截图：示例数据（虚构学生、示例课件），屏幕外窗口，不动真实鼠标。
// 用法：npm run build 后 npx electron test/quiet.cjs test/showcase.cjs   （CS_SHOTS=输出目录，默认 ../site/shots）
const fs = require('node:fs'); const path = require('node:path');
const shots = process.env.CS_SHOTS || path.join(__dirname, '../../site/shots'); fs.mkdirSync(shots, { recursive: true });
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'showcase-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const libDir = path.join(out, '示例资料库');
for (const rel of ['高一物理/第1章 匀变速直线运动/追及相遇问题 讲义.pdf', '高一物理/第1章 匀变速直线运动/追及相遇问题 答案.pdf', '高一物理/第2章 相互作用/受力分析 课件.pptx', '高一物理/第3章 牛顿运动定律/连接体问题 练习.pdf', '高二数学/三角函数/正弦型函数 课件.pptx', '高二化学/水溶液/中和滴定 实验.mp4']) { const f = path.join(libDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'sample'); }
const now = new Date(); const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
const stu = (id, name, grade, subject, hue, topic, tags, lessons) => ({ id, name, grade, hue, textbook: '人教版 2019', subject, tags, lessons, lastTopic: topic, lastAt: ymd(addDays(-2)) });
const students = [
  stu('stu-a', '林小雨', '高一', 'physics', 200, '追及相遇问题', ['基础扎实', '计算粗心'], 12),
  stu('stu-b', '陈思远', '高二', 'math', 30, '正弦型函数的图像', ['思路灵活'], 8),
  stu('stu-c', '赵一鸣', '高二', 'chem', 120, '酸碱中和滴定', ['实验题薄弱'], 5),
  stu('stu-d', '周可欣', '高三', 'physics', 280, '带电粒子在磁场中的运动', ['冲刺阶段'], 20),
];
const monday = addDays(-((now.getDay() + 6) % 7));
const slot = (id, studentId, dayOff, start, len, topic) => { const d = new Date(monday); d.setDate(d.getDate() + dayOff); return { id, studentId, day: dayOff, date: ymd(d), start, len, topic }; };
const slots = [slot('s1', 'stu-a', 0, 15, 1.5, '追及相遇问题'), slot('s2', 'stu-b', 1, 19, 2, '正弦型函数'), slot('s3', 'stu-c', 2, 16, 1.5, '中和滴定曲线'), slot('s4', 'stu-d', 3, 19, 2, '磁场中的圆周运动'), slot('s5', 'stu-a', 4, 15, 1.5, '受力分析'), slot('s6', 'stu-b', 5, 10, 2, '三角恒等变换'), slot('s7', 'stu-d', 6, 14, 2, '电磁感应综合')];
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [libDir.replace(/\\/g, '/')], students, studentId: 'stu-a', slots, learning: {} } }));
const { app } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); } throw Error('timeout'); };
const timer = setTimeout(() => { console.error('showcase timed out'); app.exit(1); }, 480000);
const doc = (id, title, n, answer = false) => ({ id, kind: 'pdf', title, total: n, pages: Array.from({ length: n }, (_, i) => ({ src: `mock/pages/${answer ? 'answer' : 'blank'}-${String(i % 10 + 1).padStart(2, '0')}.png`, w: 595, h: 842 })), ...(answer ? { answerPages: [] } : {}) });
// 手写感的笔迹：圆圈、下划线、对勾。笔迹是 x, y, 压力 三元组，x、y 都以页宽为单位（竖版页面 y 最大约 1.41）
const circle = (cx, cy, rx, ry) => { const p = []; for (let i = 0; i <= 40; i++) { const a = -0.4 + i / 40 * Math.PI * 2.15; p.push(cx + Math.cos(a) * rx * (1 + 0.04 * Math.sin(i)), cy + Math.sin(a) * ry, 0.5); } return p; };
const lineP = (x0, y0, x1, y1) => { const p = []; for (let i = 0; i <= 12; i++) p.push(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12 + Math.sin(i) * 0.002, 0.5); return p; };

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA')); await until(() => call(student, '!!window.__studioQA'));
  const left = Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 }); student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  teacher.showInactive(); student.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, n) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(n + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = run(student, 'student');
  const done = [], failed = [];
  // 截图里不出现本机测试目录
  const tidy = (w) => call(w, `for(const b of document.querySelectorAll('.lib-root > button:first-of-type'))b.textContent='D:/教学资料/示例资料库';true`).catch(() => {});
  const shot = async (w, name, wait = 900) => { await sleep(wait); await tidy(w); w.webContents.invalidate(); await sleep(300); fs.writeFileSync(path.join(shots, name), (await w.webContents.capturePage()).toPNG()); done.push(name); console.log('SHOT ' + name); };
  const step = async (label, fn) => { try { await fn(); } catch (e) { failed.push(label + ': ' + e.message); console.log('SKIP ' + label + ' ' + e.message.split('\n')[0]); } };
  const ink = (key, color, size, pts) => T(`Q.useStore.getState().addStroke(${JSON.stringify(key)},{id:'sc'+Math.random().toString(36).slice(2),author:'teacher',layer:'public',tool:'pen',color:${JSON.stringify(color)},size:${size},pts:${JSON.stringify(pts.map((v) => +v.toFixed(4)))}});return true`);

  await T(`s.set({page:'console',aiOpen:false,libraryOpen:true,rightOpen:true,studentId:'stu-a'});return true`);
  await T(`await Q.refreshLibrary?.();return true`).catch(() => {});

  // 1. 上课：讲义上屏 + 老师批注，学生端同步
  await step('console', async () => {
    const A = doc('t:A', '追及相遇问题 讲义', 10), B = { ...doc('t:B', '追及相遇问题 答案', 10, true), answerPages: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
    await T(`s.showNow(${JSON.stringify(B)});Q.useStore.getState().showNow(${JSON.stringify(A)},{page:0});Q.useStore.getState().set({reader:{mat:${JSON.stringify(A)},view:{materialId:'t:A',page:0,slide:0,fit:'width',zoom:1},split:null}});return true`);
    const red = '#e5484d', blue = '#2563eb', dark = '#334155';
    await ink('t:A#0', red, 3, circle(0.30, 0.238, 0.07, 0.028));
    await ink('t:A#0', red, 3, lineP(0.07, 0.352, 0.57, 0.352));
    // 解答框里画 v-t 图：坐标轴、甲（匀速）、乙（匀加速）、速度相等时刻
    await ink('t:A#0', dark, 2.5, [...lineP(0.15, 0.79, 0.15, 0.52), ...lineP(0.15, 0.52, 0.135, 0.545).slice(0, 6)]);
    await ink('t:A#0', dark, 2.5, [...lineP(0.15, 0.79, 0.58, 0.79), ...lineP(0.58, 0.79, 0.56, 0.775).slice(0, 6)]);
    await ink('t:A#0', blue, 3, lineP(0.15, 0.62, 0.55, 0.62));
    await ink('t:A#0', red, 3, lineP(0.15, 0.79, 0.46, 0.53));
    await ink('t:A#0', '#16a34a', 3, circle(0.353, 0.62, 0.022, 0.022));
    await ink('t:A#0', '#16a34a', 2.5, lineP(0.353, 0.64, 0.353, 0.785));
    await until(() => S(`return (Q.useStore.getState().ink['t:A#0']||[]).length>=8`), 5000);
    for (const name of ['示例资料库', '高一物理', '第1章']) await T(`const r=[...document.querySelectorAll('.lib-tree *,.lib *')].filter(e=>e.children.length<4&&(e.innerText||'').trim().startsWith(${JSON.stringify(name)})).pop();if(r)r.click();return true`).catch(() => {});
    await shot(teacher, '01-teacher-console.png', 1500);
    await shot(student, '02-student-screen.png');
  });
  // 2. 学生端多窗口并排（讲义 + 答案，答案页自动遮住）
  await step('tile', async () => {
    await T(`Q.useStore.getState().focusWin('t:A');Q.useStore.getState().tileWins();return true`);
    await shot(student, '03-student-tile.png', 1500);
    await T(`for(const w of Q.useStore.getState().desk)if(w.id!=='board')Q.useStore.getState().setWin(w.id,{mode:'max'});Q.useStore.getState().focusWin('t:A');return true`).catch(() => {});
  });
  // 3. 互动演示：物理（追及相遇）、数学、化学
  for (const [name, code] of [
    ['04-demo-physics.png', `Q.useStore.getState().showNow({id:'sim:chase',kind:'html',title:'互动演示 · 追及相遇',pages:[{w:1600,h:900}],total:1});await new Promise(r=>setTimeout(r,800));const st=Q.useStore.getState();if(st.sim)st.setShared({sim:{...st.sim,playing:false,offset:2.6,rev:(st.sim.rev||0)+1}});return true`],
    ['05-demo-math.png', `Q.useStore.getState().showNow(Q.demos.makeDemo('m.trig'));return true`],
    ['06-demo-chem.png', `Q.useStore.getState().showNow(Q.demos.makeDemo('c.titration'));return true`],
    ['07-demo-geometry.png', `Q.useStore.getState().showNow(Q.demos.makeDemo('m.triangle'));return true`],
  ]) await step(name, async () => { await T(code); await shot(student, name, 2500); });
  await step('teacher-demo', async () => { await shot(teacher, '08-teacher-demo.png', 800); });
  // 4. AI 助手面板
  await step('ai', async () => {
    await T(`s.set({aiOpen:true});return true`);
    await until(() => T(`return !!document.querySelector('.ai-dock')`), 5000);
    await shot(teacher, '09-ai-dock.png', 1200);
    await T(`Q.useStore.getState().set({aiOpen:false});return true`);
  });
  // 5. 学情：题库、错题、知识网络
  await step('study', async () => {
    await until(() => T(`return Q.useStudy.getState().loaded`), 8000);
    const at = (d) => addDays(-d).toISOString();
    const qs = [
      ['q1', '甲车以 10 m/s 匀速行驶，乙车在甲车后 20 m 处由静止以 2 m/s² 匀加速追赶，求追上所用时间。', '约 11.8 s', ['1.3'], 3, '计算'],
      ['q2', '两车同向行驶，后车刹车加速度为 4 m/s²，问两车恰好不相撞的条件。', '速度相等时恰好相遇', ['1.3'], 4, '计算'],
      ['q3', '物块静止在倾角 30° 的斜面上，画出受力分析图并求摩擦力大小。', 'f = mg sin30°', ['2.4'], 2, '计算'],
      ['q4', '质量为 m 的物体在水平拉力 F 作用下做匀加速运动，动摩擦因数为 μ，求加速度。', 'a = (F − μmg)/m', ['3.1'], 2, '填空'],
      ['q5', '两个物体用轻绳连接放在光滑水平面上，用力 F 拉动，求绳上的张力。', 'T = m₂F/(m₁+m₂)', ['3.3'], 3, '计算'],
      ['q6', '小球从 20 m 高处自由下落，求落地时间和落地速度（g 取 10 m/s²）。', '2 s，20 m/s', ['1.2'], 1, '选择'],
    ];
    const res = [['q1', 'wrong', 9], ['q1', 'half', 5], ['q1', 'right', 1], ['q2', 'wrong', 6], ['q2', 'wrong', 2], ['q3', 'right', 8], ['q4', 'half', 7], ['q4', 'right', 3], ['q5', 'wrong', 4], ['q6', 'right', 10]];
    await T(`const S=Q.useStudy.getState();S.update(d=>({...d,questions:${JSON.stringify(qs.map(([id, stem, answer, points, difficulty, qtype], i) => ({ id, stem, answer, points, difficulty, qtype, origin: 'manual', status: i < 5 ? 'bank' : 'inbox', createdAt: at(12 - i) })))},attempts:${JSON.stringify(res.map(([questionId, result, d], i) => ({ id: 'a' + i, studentId: 'stu-a', questionId, result, at: at(d) })))},portraits:{'stu-a':{text:'林小雨物理概念清楚，受力分析规范；追及相遇类题目在临界条件判断上反复出错，计算时容易漏单位。建议先画 v-t 图找"速度相等"这一关键时刻，再列位移关系。',at:${JSON.stringify(at(1))},via:'ai'}}}));return true`);
    await T(`Q.useStore.getState().set({page:'study'});return true`);
    await shot(teacher, '10-study.png', 1500);
    for (const [tab, file] of [['题库', '11-study-bank.png'], ['错题本', '12-study-wrongbook.png'], ['知识', '13-study-map.png']]) {
      await step(file, async () => { await T(`const b=[...document.querySelectorAll('.ags-tabs button')].find(b=>b.innerText.includes(${JSON.stringify(tab)}));if(!b)throw Error('no tab ${tab}');b.click();return true`); await shot(teacher, file, 1000); });
    }
  });
  // 6. 学生、课表、备课、自动
  for (const [page, file] of [['students', '14-students.png'], ['schedule', '15-schedule.png'], ['agents', '16-agents.png'], ['auto', '17-auto.png']]) {
    await step(file, async () => { await T(`Q.useStore.getState().set({page:${JSON.stringify(page)}});return true`); await shot(teacher, file, 1200); });
  }
  // 7. 说明书 / 关于
  await step('help', async () => {
    await T(`Q.useStore.getState().set({page:'console'});const b=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='帮助'||b.getAttribute('aria-label')==='帮助');if(!b)throw Error('no help button');b.click();return true`);
    await shot(teacher, '18-help-manual.png', 1200);
  });
  // 8. 外观皮肤
  await step('skins', async () => { await T(`const b=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='帮助'||b.getAttribute('aria-label')==='帮助');if(b)b.click();Q.useStore.getState().set({skinsOpen:true});return true`); await shot(teacher, '19-skins.png', 1000); await T(`Q.useStore.getState().set({skinsOpen:false});return true`); });

  fs.writeFileSync(path.join(shots, 'shots.json'), JSON.stringify({ done, failed }, null, 2));
  console.log('DONE ' + done.length + ' shots, ' + failed.length + ' skipped'); for (const f of failed) console.log('  - ' + f);
  console.log('RESULT ' + shots);
  clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((e) => { console.error(e); clearTimeout(timer); app.exit(2); });
