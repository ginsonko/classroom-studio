// 界面排版巡检（竖排文字 / 按钮文字折行 / 文字被硬截断）：在 1280×720 和 1440×900 两种窗口下，
// 依次打开上课页（左栏 240~420、右栏 300~420）、AI 助手（300~420）、学生、学情、备课、自动、课表，以及几个浮层，
// 每个画面截图，并在页面里逐个文字节点检查：
//   vertical  中文被挤成每行一两个字；
//   wrap      按钮 / 标签 / 表头等短文字折成了两行；
//   clipped   文字溢出容器又没有省略号（被硬切掉）。
// 结果写到 <输出目录>/audit.json；有问题时退出码 1（CS_AUDIT_SOFT=1 时只报告）。
// 用法：npm run build 后 npx electron test/quiet.cjs test/ui-audit.cjs   （CS_AUDIT_TAG=before|after 区分输出目录）
const fs = require('node:fs'); const path = require('node:path');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'ui-audit-' + (process.env.CS_AUDIT_TAG || Date.now())); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const libDir = path.join(out, '资料库');
for (const rel of ['高二物理/动量守恒定律 课件.pptx', '高二物理/牛顿第二定律 练习（含答案）.pdf', '初中数学/八上 一次函数 课件.pptx']) { const f = path.join(libDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'sample'); }
const day = new Date(); const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const stu = (id, name, subject, hue) => ({ id, name, grade: '高二', hue, textbook: '人教版 2019', subject, tags: ['基础扎实', '计算粗心'], lessons: 6, lastTopic: '牛顿第二定律的应用', lastAt: ymd(day) });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: {
  roots: [libDir.replace(/\\/g, '/')], students: [stu('stu-w', '王曦若', 'physics', 200), stu('stu-l', '欧阳明轩', 'math', 30), stu('stu-c', '李', 'chem', 120)], studentId: 'stu-w',
  slots: [{ id: 's1', studentId: 'stu-w', day: (day.getDay() + 6) % 7, date: ymd(day), start: 15, len: 1.5, topic: '连接体问题与摩擦临界' }], learning: {},
} }));
const { app } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); } throw Error('timeout'); };
const timer = setTimeout(() => { console.error('ui audit timed out'); app.exit(1); }, 600000);

// 在页面里运行：逐个文字节点量行数
const AUDIT = `(() => {
  const CJK = /[\\u3400-\\u9fff]/, issues = [], seen = new Set();
  const name = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')); return p.join(' > '); };
  const visible = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } return true; };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) {
    const t = tw.currentNode, s = t.textContent.replace(/\\s+/g, ' ').trim(), el = t.parentElement;
    if (!el || [...s].length < 2 || el.closest('svg,canvas,textarea,pre,code,.katex,.ai-manim-code,[data-audit-skip]')) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.bottom < 0 || b.right < 0 || b.top > innerHeight || b.left > innerWidth) continue;
    if (!visible(el)) continue;
    const r = document.createRange(); r.selectNodeContents(t);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0.5 && x.height > 0.5);
    if (!rects.length) continue;
    const lines = [...new Set(rects.map((x) => Math.round(x.top / 3)))].length, n = [...s].length;
    const short = el.closest('button,[role=tab],th,label,.chip,.tag,.badge') || n <= 8;
    let kind = '';
    if (lines >= 2 && CJK.test(s) && n / lines <= 2.6) kind = 'vertical';
    else if (lines >= 2 && short && n <= 14 && !/\\n/.test(t.textContent.trim())) kind = 'wrap';
    if (!kind) {
      // 被硬截断：从自己往上找第一个裁剪内容的祖先，文字超出它的右边界且没有省略号
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (!/hidden|clip/.test(cs.overflowX)) continue;
        const eb = e.getBoundingClientRect(), right = Math.max(...rects.map((x) => x.right));
        if (right > eb.right + 2 && getComputedStyle(el).textOverflow !== 'ellipsis' && cs.textOverflow !== 'ellipsis' && rects.every((x) => x.left < eb.right)) kind = 'clipped';
        break;
      }
    }
    if (!kind) continue;
    const key = kind + name(el) + s.slice(0, 20); if (seen.has(key)) continue; seen.add(key);
    issues.push({ kind, text: s.slice(0, 40), lines, w: Math.round(b.width), at: [Math.round(b.left), Math.round(b.top)], el: name(el) });
  }
  return issues;
})()`;

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  student.setBounds({ x: left, y: 960, width: 1280, height: 720 }); student.showInactive();
  teacher.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error(r.__err); return r; };
  const all = [];
  const check = async (label) => {
    await sleep(500); teacher.webContents.invalidate(); await sleep(250);
    const file = label.replace(/[^\w\u4e00-\u9fff-]+/g, '_') + '.png';
    fs.writeFileSync(path.join(out, file), (await teacher.webContents.capturePage()).toPNG());
    const issues = await call(teacher, AUDIT);
    for (const i of issues) all.push({ view: label, ...i });
    console.log(`${issues.length ? 'ISSUES' : 'ok    '} ${label}${issues.length ? '  ' + issues.map((i) => i.kind + ':' + i.text).slice(0, 6).join(' | ') : ''}`);
  };
  const sizes = (process.env.CS_AUDIT_SIZES || '1280x720,1440x900').split(',').map((s) => s.split('x').map(Number));
  for (const [W, H] of sizes) {
    teacher.setBounds({ x: left, y: 30, width: W, height: H }); await sleep(400);
    const tag = `${W}x${H}`;
    // 上课页：左栏各种宽度 × 右栏，各个标签页
    for (const lw of [240, 300, 360, 420]) {
      await T(`s.set({page:'console',aiOpen:false,libraryOpen:true,rightOpen:true,libraryW:${lw},rightW:340});return true`);
      await check(`${tag} 上课 左栏${lw}`);
    }
    await T(`s.set({libraryW:300});return true`);
    for (const tabName of ['分类', '最近', '收藏']) {
      await T(`const b=[...document.querySelectorAll('.lib-tabs button')].find(b=>b.innerText.includes(${JSON.stringify(tabName)}));if(b)b.click();return true`);
      await check(`${tag} 上课 左栏300 ${tabName}`);
    }
    await T(`const b=document.querySelector('.lib-tabs button');if(b)b.click();return true`);
    for (const rw of [300, 420]) { await T(`s.set({rightW:${rw}});return true`); await check(`${tag} 上课 右栏${rw}`); }
    await T(`s.set({rightW:340});return true`);
    // AI 助手 300~420
    for (const aw of [300, 360, 420]) {
      await T(`s.set({page:'console',aiOpen:true});return true`);
      await until(() => T(`return !!document.querySelector('.ai-dock')`), 5000);
      await T(`document.querySelector('.ai-dock').style.width='${aw}px';return true`);
      await check(`${tag} AI助手${aw}`);
    }
    await T(`document.querySelector('.ai-dock').style.width='';s.set({aiOpen:false});return true`);
    for (const [page, label] of [['students', '学生'], ['study', '学情'], ['agents', '备课'], ['auto', '自动'], ['schedule', '课表']]) {
      await T(`s.set({page:${JSON.stringify(page)}});return true`);
      await check(`${tag} ${label}`);
      if (page === 'agents' || page === 'auto' || page === 'study') {
        // 页面里的二级标签页也点一遍
        const tabs = await T(`return [...document.querySelectorAll('main [role=tab], main .tabs button, main .seg button, .main [role=tab]')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,6)`).catch(() => []);
        for (const name of tabs.slice(1)) { await T(`const b=[...document.querySelectorAll('main [role=tab], main .tabs button, main .seg button, .main [role=tab]')].find(b=>b.innerText.trim()===${JSON.stringify(name)});if(b)b.click();return true`); await check(`${tag} ${label} ${name}`); }
      }
    }
    // 浮层：AI 设置、命令面板、皮肤
    await T(`s.set({page:'console',aiOpen:true});return true`); await sleep(300);
    await T(`const b=[...document.querySelectorAll('.ai-h button')].find(b=>/设置/.test(b.getAttribute('aria-label')||b.dataset.tip||b.title||''));if(b)b.click();return !!b`);
    await check(`${tag} AI设置`);
    await T(`const b=[...document.querySelectorAll('.ai-h button')].find(b=>/设置/.test(b.getAttribute('aria-label')||b.dataset.tip||b.title||''));if(b)b.click();s.set({aiOpen:false,paletteOpen:true});return true`);
    await check(`${tag} 命令面板`);
    await T(`s.set({paletteOpen:false,skinsOpen:true});return true`);
    await check(`${tag} 外观`);
    await T(`s.set({skinsOpen:false});return true`);
  }
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(all, null, 2));
  const kinds = all.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {});
  console.log('TOTAL ' + all.length + ' ' + JSON.stringify(kinds)); console.log('RESULT ' + out);
  clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(all.length && !process.env.CS_AUDIT_SOFT ? 1 : 0);
})().catch((e) => { console.error(e); clearTimeout(timer); app.exit(2); });
