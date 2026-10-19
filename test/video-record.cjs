// 宣传片 / 新手教程的画面录制：按计划（CS_VIDEO_PLAN=plan.json，由 site/video/make.mjs 生成）逐场景驱动真实界面，
// 屏幕外窗口逐帧截图（带时间戳），画面里的鼠标是注入页面的假光标，不动真实鼠标。AI 讲题用本机假模型服务，不花钱。
// 用法：npx electron test/quiet.cjs test/video-record.cjs   （只录某些场景：CS_VIDEO_ONLY=promo-03,tut-05）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const plan = JSON.parse(fs.readFileSync(process.env.CS_VIDEO_PLAN, 'utf8'));
const only = (process.env.CS_VIDEO_ONLY || '').split(',').filter(Boolean);
const out = path.join(plan.work, 'app-data-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const libDir = path.join(out, '示例资料库');
for (const rel of ['高一物理/第1章 匀变速直线运动/追及相遇问题 讲义.pdf', '高一物理/第1章 匀变速直线运动/追及相遇问题 答案.pdf', '高一物理/第2章 相互作用/受力分析 课件.pptx', '高一物理/第3章 牛顿运动定律/连接体问题 练习.pdf', '高二数学/三角函数/正弦型函数 课件.pptx', '高二化学/水溶液/中和滴定 实验.mp4']) { const f = path.join(libDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'sample'); }
const now = new Date(); const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
const stu = (id, name, grade, subject, hue, topic, tags, lessons) => ({ id, name, grade, hue, textbook: '人教版 2019', subject, tags, lessons, lastTopic: topic, lastAt: ymd(addDays(-2)) });
const students = [stu('stu-a', '林小雨', '高一', 'physics', 200, '追及相遇问题', ['基础扎实', '计算粗心'], 12), stu('stu-b', '陈思远', '高二', 'math', 30, '正弦型函数的图像', ['思路灵活'], 8), stu('stu-c', '赵一鸣', '高二', 'chem', 120, '酸碱中和滴定', ['实验题薄弱'], 5), stu('stu-d', '周可欣', '高三', 'physics', 280, '带电粒子在磁场中的运动', ['冲刺阶段'], 20)];
const monday = addDays(-((now.getDay() + 6) % 7));
const slot = (id, studentId, dayOff, start, len, topic) => { const d = new Date(monday); d.setDate(d.getDate() + dayOff); return { id, studentId, day: dayOff, date: ymd(d), start, len, topic }; };
const slots = [slot('s1', 'stu-a', 0, 15, 1.5, '追及相遇问题'), slot('s2', 'stu-b', 1, 19, 2, '正弦型函数'), slot('s3', 'stu-c', 2, 16, 1.5, '中和滴定曲线'), slot('s4', 'stu-d', 3, 19, 2, '磁场中的圆周运动'), slot('s5', 'stu-a', 4, 15, 1.5, '受力分析'), slot('s6', 'stu-b', 5, 10, 2, '三角恒等变换'), slot('s7', 'stu-d', 6, 14, 2, '电磁感应综合')];
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [libDir.replace(/\\/g, '/')], students, studentId: 'stu-a', slots, learning: {} } }));

const EXPLAIN = {
  title: '追及相遇：最大距离与追上时间', problem: '甲车以 10 m/s 匀速行驶，经过路口时，停在路口的乙车以 2 m/s² 由静止启动同向行驶。求：(1) 追上前两车的最大距离；(2) 乙车经多长时间追上甲车。',
  idea: '追上之前，乙车比甲车慢时距离在变大，比甲车快时距离在变小，所以两车速度相等时距离最大；追上时两车位移相等。',
  steps: [
    { t: '速度相等时距离最大，求时间', tex: 'v_甲=at_1\\Rightarrow t_1=\\frac{10}{2}=5\\,\\text{s}', plain: '10=2t₁，t₁=5 s' },
    { t: '求最大距离', tex: '\\Delta x=v_甲t_1-\\frac{1}{2}at_1^2=50-25=25\\,\\text{m}', plain: 'Δx=50−25=25 m' },
    { t: '追上时位移相等', tex: 'v_甲t=\\frac{1}{2}at^2\\Rightarrow t=10\\,\\text{s}', plain: '10t=t²，t=10 s' },
  ],
  answer: '最大距离 25 m；乙车启动 10 s 后追上甲车。', pitfalls: ['不要把"速度相等"当成"追上"', '追上的条件是位移相等，不是速度相等'],
};
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const j = JSON.parse(body || '{}'); const last = j.messages?.at(-1)?.content; const text = typeof last === 'string' ? last : Array.isArray(last) ? last.map((x) => x.text || '').join('') : '';
    const content = text.includes('只回复') ? '在线' : JSON.stringify(EXPLAIN);
    await new Promise((r) => setTimeout(r, 1600));
    if (j.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      for (let i = 0; i < content.length; i += 40) res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(i, i + 40) } }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      if (j.stream_options?.include_usage) res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 400 } }) + '\n\n');
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  });
});

const { app, BrowserWindow, screen } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(120); } throw Error('timeout'); };
const timer = setTimeout(() => { console.error('video record timed out'); app.exit(1); }, 3600000);

// 页面里的假光标：移动、点击涟漪、高亮框
const CURSOR = `(()=>{if(window.__vc)return true;const st=document.createElement('style');st.textContent=\`
#__vc{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform .7s cubic-bezier(.45,.05,.25,1);filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
.__vc-ring{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #35d6e8;z-index:2147483646;pointer-events:none;animation:__vcr .6s ease-out forwards}
@keyframes __vcr{to{transform:scale(3.4);opacity:0}}
.__vc-hl{position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #35d6e8;border-radius:12px;box-shadow:0 0 0 9999px rgba(3,6,12,.48),0 0 24px rgba(53,214,232,.8);transition:all .55s cubic-bezier(.45,.05,.25,1);opacity:0}
.__vc-hl.on{opacity:1}.__vc-hl b{position:absolute;left:0;top:-38px;background:#35d6e8;color:#04131a;font:700 16px "Microsoft YaHei UI",sans-serif;padding:5px 12px;border-radius:8px;white-space:nowrap}
.__vc-hl.below b{top:auto;bottom:-38px}\`;document.head.append(st);
const c=document.createElement('div');c.id='__vc';c.innerHTML='<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-6.6 1.2L16 21.5l-3 1.3-3.6-7.2L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';document.body.append(c);
const hl=document.createElement('div');hl.className='__vc-hl';hl.innerHTML='<b></b>';document.body.append(hl);
const find=(q)=>{if(q.startsWith('$'))return document.querySelector(q.slice(1));const t=q.trim();const els=[...document.querySelectorAll('button,a,input,textarea,[role=tab],summary,label,.rail-b')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight});return els.find(e=>(e.getAttribute('aria-label')||'')===t)||els.find(e=>(e.innerText||'').trim()===t)||els.find(e=>(e.placeholder||'').includes(t))||els.find(e=>(e.innerText||'').includes(t))||els.find(e=>(e.getAttribute('aria-label')||e.title||'').includes(t))};
let x=innerWidth*.62,y=innerHeight*.58;c.style.transform=\`translate(\${x}px,\${y}px)\`;
window.__vc={find,
 async to(q,ms=700){const e=typeof q==='string'?find(q):null;if(typeof q==='string'&&!e)throw Error('cursor target not found: '+q);const r=e?e.getBoundingClientRect():{left:q[0],top:q[1],width:0,height:0};x=r.left+Math.min(r.width/2,r.width-6);y=r.top+r.height/2;c.style.transition='transform '+ms+'ms cubic-bezier(.45,.05,.25,1)';c.style.transform=\`translate(\${x}px,\${y}px)\`;await new Promise(r=>setTimeout(r,ms+60));return e},
 ring(){const g=document.createElement('div');g.className='__vc-ring';g.style.left=x+'px';g.style.top=y+'px';document.body.append(g);setTimeout(()=>g.remove(),700)},
 hl(q,label,pad=6){if(!q){hl.classList.remove('on');return true}const e=find(q);if(!e)throw Error('highlight target not found: '+q);const r=e.getBoundingClientRect();Object.assign(hl.style,{left:r.left-pad+'px',top:r.top-pad+'px',width:r.width+pad*2+'px',height:r.height+pad*2+'px'});hl.querySelector('b').textContent=label||'';hl.querySelector('b').style.display=label?'':'none';hl.classList.toggle('below',r.top<60);hl.classList.add('on');return true},
 hide(){c.style.opacity=0},show(){c.style.opacity=1}};return true})()`;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA')); await until(() => call(student, '!!window.__studioQA'));
  const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4200;
  teacher.setBounds({ x: left, y: 20, width: 1440, height: 900 }); student.setBounds({ x: left, y: 940, width: 1600, height: 900 });
  const card = new BrowserWindow({ x: left + 1700, y: 20, width: 1600, height: 900, show: false, frame: false, backgroundColor: '#07090f' });
  for (const w of [teacher, student, card]) { w.showInactive(); w.webContents.setBackgroundThrottling(false); }
  const W = { teacher, student, card };
  const wrap = (code) => `(async()=>{try{const Q=window.__studioQA,s=Q&&Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const R = (who) => async (code) => { const r = await call(W[who], wrap(code)); if (r && r.__err) throw Error(who + ': ' + r.__err); return r; };
  const T = R('teacher'), S = R('student');
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'gpt-demo',visionModel:'gpt-demo',key:'sk-demo-0000'});localStorage.setItem('cs.ai.screen','0');return true`);
  await until(() => T(`return Q.useStudy.getState().loaded`), 8000);
  // 学情示例数据
  const at = (d) => addDays(-d).toISOString();
  const qs = [['q1', '甲车以 10 m/s 匀速行驶，乙车在甲车后 20 m 处由静止以 2 m/s² 匀加速追赶，求追上所用时间。', '约 11.8 s', ['1.3'], 3, '计算'], ['q2', '两车同向行驶，后车刹车加速度为 4 m/s²，问两车恰好不相撞的条件。', '速度相等时恰好相遇', ['1.3'], 4, '计算'], ['q3', '物块静止在倾角 30° 的斜面上，画出受力分析图并求摩擦力大小。', 'f = mg sin30°', ['2.4'], 2, '计算'], ['q4', '质量为 m 的物体在水平拉力 F 作用下做匀加速运动，动摩擦因数为 μ，求加速度。', 'a = (F − μmg)/m', ['3.1'], 2, '填空'], ['q5', '两个物体用轻绳连接放在光滑水平面上，用力 F 拉动，求绳上的张力。', 'T = m₂F/(m₁+m₂)', ['3.3'], 3, '计算']];
  const res = [['q1', 'wrong', 9], ['q1', 'half', 5], ['q1', 'right', 1], ['q2', 'wrong', 6], ['q2', 'wrong', 2], ['q3', 'right', 8], ['q4', 'half', 7], ['q4', 'right', 3], ['q5', 'wrong', 4]];
  await T(`Q.useStudy.getState().update(d=>({...d,questions:${JSON.stringify(qs.map(([id, stem, answer, points, difficulty, qtype], i) => ({ id, stem, answer, points, difficulty, qtype, origin: 'manual', status: 'bank', createdAt: at(12 - i) })))},attempts:${JSON.stringify(res.map(([questionId, result, d], i) => ({ id: 'a' + i, studentId: 'stu-a', questionId, result, at: at(d) })))}}));return true`);
  const tidy = () => call(teacher, `for(const b of document.querySelectorAll('.lib-root > button:first-of-type'))b.textContent='D:/教学资料/示例资料库';true`).catch(() => {});

  // ── 动作 ──
  const ACT = {
    wait: async (ms) => sleep(ms),
    T: async (code) => T(code), S: async (code) => S(code),
    js: async (who, code) => R(who)(code),
    cursor: async (who) => call(W[who], CURSOR),
    hide: async (who) => call(W[who], 'window.__vc&&window.__vc.hide();true'),
    to: async (who, q, ms = 700) => { await call(W[who], CURSOR); await call(W[who], `window.__vc.to(${JSON.stringify(q)},${ms}).then(()=>true)`); },
    click: async (who, q, ms = 700) => { await ACT.to(who, q, ms); await call(W[who], `(()=>{window.__vc.ring();const e=window.__vc.find(${JSON.stringify(q)});e.click();return true})()`); await sleep(250); },
    hl: async (who, q, label = '', pad = 6) => { await call(W[who], CURSOR); await call(W[who], `window.__vc.hl(${JSON.stringify(q)},${JSON.stringify(label)},${pad})`); },
    type: async (who, q, text, cps = 14) => {
      await ACT.click(who, q);
      for (let i = 1; i <= [...text].length; i++) {
        await call(W[who], `(()=>{const e=window.__vc.find(${JSON.stringify(q)});const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(text)}.slice(0,${JSON.stringify([...text].slice(0, i).join('').length)}));e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await sleep(1000 / cps);
      }
    },
    key: async (who, keyCode) => { W[who].webContents.sendInputEvent({ type: 'keyDown', keyCode }); W[who].webContents.sendInputEvent({ type: 'keyUp', keyCode }); await sleep(200); },
    // 一笔一笔画出来：笔迹点逐步加长（同一 id 反复 upsert），学生端同步
    ink: async (key, color, size, pts, ms = 900) => {
      const id = 'v' + Math.random().toString(36).slice(2), n = pts.length / 3, steps = Math.max(4, Math.round(ms / 45));
      for (let k = 1; k <= steps; k++) { const m = Math.max(2, Math.round(n * k / steps)); await T(`Q.useStore.getState().addStroke(${JSON.stringify(key)},{id:'${id}',author:'teacher',layer:'public',tool:'pen',color:${JSON.stringify(color)},size:${size},pts:${JSON.stringify(pts.slice(0, m * 3).map((v) => +v.toFixed(4)))}});return true`); await sleep(ms / steps); }
    },
    card: async (html) => { await card.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); },
    scroll: async (who, sel, y) => call(W[who], `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e)e.scrollTo({top:${y},behavior:'smooth'});return true})()`),
  };
  const runSteps = async (steps, label) => { for (const s of steps) { try { await ACT[s[0]](...s.slice(1)); } catch (e) { console.log('WARN', label, s[0], String(e.message).split('\n')[0]); } } };

  const report = [];
  for (const video of plan.videos) for (const sc of video.scenes) {
    if (only.length && !only.includes(sc.id)) continue;
    const dir = path.join(plan.work, sc.id); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    for (const w of ['teacher', 'student']) await call(W[w], `window.__vc&&(window.__vc.hl(null),window.__vc.show());true`).catch(() => {});
    await runSteps(sc.setup || [], sc.id + ' setup');
    if (sc.win === 'teacher') { await tidy(); await call(teacher, CURSOR); }
    await sleep(sc.settle ?? 600);
    const w = W[sc.win], frames = []; let stop = false;
    const t0 = Date.now();
    const timeline = (async () => { await runSteps(sc.steps || [], sc.id); })();
    while (!stop) {
      const t = Date.now() - t0; if (t > sc.dur * 1000) break;
      w.webContents.invalidate();
      const img = await w.webContents.capturePage();
      const name = String(frames.length).padStart(5, '0') + '.jpg';
      fs.writeFileSync(path.join(dir, name), img.toJPEG(90)); frames.push([name, (Date.now() - t0) / 1000]);
      const spent = Date.now() - t0 - t; if (spent < 40) await sleep(40 - spent);
      if (sc.win === 'teacher' && frames.length % 25 === 1) tidy();
    }
    await timeline;
    // concat 清单：每帧显示到下一帧的时间戳
    const lines = ["ffconcat version 1.0"]; for (let i = 0; i < frames.length; i++) { const next = i + 1 < frames.length ? frames[i + 1][1] : sc.dur; const start = i ? frames[i][1] : 0; lines.push(`file '${frames[i][0]}'`, `duration ${Math.max(0.001, next - start).toFixed(4)}`); }
    lines.push(`file '${frames.at(-1)[0]}'`);
    fs.writeFileSync(path.join(dir, 'frames.txt'), lines.join('\n') + '\n');
    const size = (await w.webContents.capturePage()).getSize();
    report.push({ id: sc.id, frames: frames.length, fps: +(frames.length / sc.dur).toFixed(1), size });
    console.log('SCENE', sc.id, frames.length, 'frames', (frames.length / sc.dur).toFixed(1), 'fps', size.width + 'x' + size.height);
  }
  fs.writeFileSync(path.join(plan.work, 'record-report.json'), JSON.stringify(report, null, 2));
  clearTimeout(timer); server.close(); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((e) => { console.error(e); clearTimeout(timer); app.exit(2); });
