// 1.2.2 PPT 分步：真实打开一份带单击动画的 PPTX（test/steps-deck.cjs 生成），等后台生成分步画面，
// 核对每一帧图片的内容；在学生画面里用翻页键一下一下放、跨页、倒回去，截屏核对画面；
// 「整页显示」开关；再改用内置排版（macOS 走的那条路）重新生成，核对画面。原文件不被改动。
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v122-steps-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'steps-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', boardSkin: 'ivory' },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
}));
const deck = require('./steps-deck.cjs');
const pptx = path.join(out, '课件', '分步动画 测试.pptx'); fs.mkdirSync(path.dirname(pptx), { recursive: true }); deck.write(pptx);
const before = { size: fs.statSync(pptx).size, mtime: fs.statSync(pptx).mtimeMs, sha: require('node:crypto').createHash('sha256').update(fs.readFileSync(pptx)).digest('hex') };
const electron = require('electron'); const { app, nativeImage } = electron; const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('steps test timed out'); app.exit(1); }, 600000);
const results = [];
const ok = (name, cond, detail) => { assert.ok(cond, name + ' ' + (detail ?? '')); results.push(name); console.log('PASS', name, detail ?? ''); };

// ── 看图：box 是 1280×720 坐标；rect 是图片里幻灯片所在的区域 ──
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
function probe(img, rect = null) {
  const s = img.getSize(), bmp = img.toBitmap(), R = rect ?? { x: 0, y: 0, w: s.width, h: s.height };
  const at = (fx, fy) => [Math.round(R.x + fx * R.w), Math.round(R.y + fy * R.h)];
  const px = (x, y) => { const i = (y * s.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
  return {
    /** 色块中间 40% 的区域里有多少比例接近这个颜色 */
    color(box, hex) {
      const [r, g, b] = rgb(hex), [x0, y0] = at((box[0] + box[2] * .3) / 1280, (box[1] + box[3] * .3) / 720), [x1, y1] = at((box[0] + box[2] * .7) / 1280, (box[1] + box[3] * .7) / 720);
      let hit = 0, all = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const p = px(x, y); all++; if (Math.abs(p[0] - r) < 50 && Math.abs(p[1] - g) < 50 && Math.abs(p[2] - b) < 50) hit++; }
      return all ? hit / all : 0;
    },
    /** 区域里深色像素的个数（看文字有没有显示） */
    dark(box) {
      const [x0, y0] = at(box[0] / 1280, box[1] / 720), [x1, y1] = at((box[0] + box[2]) / 1280, (box[1] + box[3]) / 720);
      let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = px(x, y); if (p[0] + p[1] + p[2] < 300) n++; }
      return n;
    },
  };
}
const B = deck.BOX, C = deck.C;
const TEXT = [B.p1text[0], B.p1text[1], 520, 260];
/** 每一帧该有的样子（[page, click, sub] → 检查） */
function expectFrame(p, page, click, sub = 0) {
  const has = (box, hex) => p.color(box, hex) > .8, none = (box, hex) => p.color(box, hex) < .05;
  if (page === 1) return { pic: click >= 4 ? has(B.p1pic, C.blue) : none(B.p1pic, C.blue), text: p.dark(TEXT) };
  if (page === 2) return { group: click >= 1 ? has(B.p2a, C.green) && has(B.p2b, C.green) : none(B.p2a, C.green) && none(B.p2b, C.green), exit: click >= 2 ? none(B.p2exit, C.orange) : has(B.p2exit, C.orange), after: click >= 2 && sub >= 1 ? has(B.p2after, C.purple) : none(B.p2after, C.purple) };
  if (page === 3) return { auto: has(B.p3auto, C.cyan), click: click >= 1 ? has(B.p3click, C.yellow) && has(B.p3alt, C.red) : none(B.p3click, C.yellow) && none(B.p3alt, C.red) };
  if (page === 4) return { plain: has(B.p4, C.magenta) };
  return {};
}
const allTrue = (o) => Object.values(o).every((v) => v === true || typeof v === 'number');

/** 核对分步结果里的每帧图片（整页帧用原来那页的图） */
function checkFrames(label, steps, original) {
  const byPage = new Map(steps.pages.map((s) => [s.page, s]));
  ok(`${label}：第 2、3、4 页分步，第 1、5 页不分步`, [...byPage.keys()].join(',') === '1,2,3' && byPage.get(1).clicks === 4 && byPage.get(2).clicks === 2 && byPage.get(3).clicks === 1, JSON.stringify(steps.pages.map((s) => [s.page, s.clicks, s.frames.length])));
  const texts = [];
  for (const s of steps.pages) {
    let sub = 0, prevClick = -1;
    for (const f of s.frames) {
      sub = f.click === prevClick ? sub + 1 : 0; prevClick = f.click;
      const file = f.path ?? original[s.page];
      const img = nativeImage.createFromPath(file);
      assert.ok(!img.isEmpty(), file);
      const e = expectFrame(probe(img), s.page, f.click, sub);
      ok(`${label}：第 ${s.page + 1} 页按 ${f.click} 下${sub ? `（之后第 ${sub} 帧，等 ${f.wait}ms）` : ''}的画面对`, allTrue(e), JSON.stringify(e));
      if (s.page === 1) texts.push(e.text);
      fs.copyFileSync(file, path.join(out, `${label}-p${s.page + 1}-c${f.click}${sub ? '-' + sub : ''}.png`));
    }
  }
  ok(`${label}：三段文字一段一段出现（深色像素逐下增加，开头几乎没有）`, texts[0] < 80 && texts[1] > texts[0] + 300 && texts[2] > texts[1] + 300 && texts[3] > texts[2] + 300 && Math.abs(texts[4] - texts[3]) < texts[3] * .15, texts.join(' → '));
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await call(teacher, `window.csHost.call('student')`);
  const student = await until(() => api.windows.get('student'), 15000, 'student window');
  await until(() => call(student, '!!window.__studioQA'), 15000, 'student ready');
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 }); student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = run(student, 'student');
  await T(`s.set({page:'console',aiOpen:false});return true`);
  api.files.authorize(pptx);

  // ── 打开课件：先显示整页，分步画面在后台生成好再补上 ──
  const t0 = Date.now();
  const m0 = await T(`const m=await Q.openMaterial(Q.fileEntry(${JSON.stringify(pptx)}),'student');if(m)return m.total;try{await Q.prepareMaterial(Q.fileEntry(${JSON.stringify(pptx)}));return 'prepare ok?'}catch(e){return String(e&&e.message||e)}`);
  if (typeof m0 === 'string') throw Error('打开失败：' + m0);
  const opened = await T(`const st=Q.useStore.getState();return {kind:st.pgmMat.kind,total:st.pgmMat.total}`);
  ok('课件打开到学生画面', opened.kind === 'slides' && opened.total === 5, JSON.stringify(opened));
  await until(() => T(`return Q.useStore.getState().pgmMat.pages[1]?.clicks===4`), 300000, 'steps ready');
  ok('分步画面生成好后补进学生画面', true, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const mat = await T(`const m=Q.useStore.getState().pgmMat;return {pages:m.pages.map(p=>({src:p.src,clicks:p.clicks,steps:p.steps}))}`);
  ok('只有带单击动画的页有分步', mat.pages.map((p) => p.clicks ?? 0).join(',') === '0,4,2,1,0', mat.pages.map((p) => p.clicks ?? 0).join(','));
  ok('学生窗口拿到同样的分步信息', await S(`return Q.useStore.getState().pgmMat.pages[2]?.steps?.length`) === 4);

  // 缓存里的分步结果
  const find = (dir, name) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { const r = find(p, name); if (r) return r; } else if (e.name === name) return p; } return null; };
  const stepsFile = find(process.env.CS_DATA_DIR, 'steps.json') ?? find(path.join(out), 'steps.json');
  assert.ok(stepsFile, 'steps.json');
  const docDir = path.dirname(path.dirname(stepsFile)), manifest = JSON.parse(fs.readFileSync(path.join(docDir, 'manifest.json'), 'utf8'));
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  const original = manifest.images?.map((x) => x.path) ?? [];
  console.log('engine', manifest.engine, 'render', manifest.render);
  ok('分步画面和原课件用同一种方式出图', steps.engine === manifest.engine && !steps.error, `${manifest.engine} ${steps.error ?? ''}`);
  ok('分步副本出完图就删掉', !fs.existsSync(path.join(path.dirname(stepsFile), 'steps.pptx')));
  if (manifest.render === 'images') checkFrames(manifest.engine === 'local-office-slides' ? 'Office' : '内置', steps, original);

  // ── 学生画面：翻页键一下一下放 ──
  await T(`s.setShared({pgm:{...Q.useStore.getState().pgm,page:0,build:undefined}});return true`);
  await until(() => S(`return Q.useStore.getState().pgm.page===0`), 5000, 'page 0');
  const key = async (k) => { await S(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}));return true`); };
  const state = () => T(`const p=Q.useStore.getState().pgm;return p.page+':'+(p.build&&p.build[0]===p.page?p.build[1]:'-')`);
  const shotStage = async () => {
    const r = await S(`const p=document.querySelector('[data-cur-stage] .stage .page');const b=p.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,k:devicePixelRatio}`);
    const img = await student.webContents.capturePage();
    const k = img.getSize().width / (await S(`return innerWidth`));
    return { img, p: probe(img, { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }) };
  };
  const look = async (page, click, sub = 0, name) => {
    await sleep(700);
    const { img, p } = await shotStage();
    fs.writeFileSync(path.join(out, `stage-${name ?? `${page + 1}-${click}`}.png`), img.toPNG());
    return expectFrame(p, page, click, sub);
  };
  const press = async (k, want, label, [page, click, sub] = []) => {
    await key(k);
    const got = await until(async () => { const s = await state(); return s === want ? s : null; }, 5000, label + ' → ' + want).catch(async (e) => { throw Error(e.message + ' got ' + await state()); });
    const e = page === undefined ? {} : await look(page, click, sub);
    ok(label, allTrue(e), `${got} ${JSON.stringify(e)}`);
  };
  await press('PageDown', '1:0', '翻到第 2 页：从头开始，文字和图片都还没出现', [1, 0]);
  const t1 = (await look(1, 0)).text;
  await press('PageDown', '1:1', '按 1 下：第一段出现', [1, 1]);
  await press('ArrowRight', '1:2', '按 2 下（→ 键也行）：第二段出现', [1, 2]);
  await press('ArrowDown', '1:3', '按 3 下（↓ 键）：第三段出现', [1, 3]);
  const t3 = (await look(1, 3)).text;
  ok('学生画面上文字逐段出现', t3 > t1 + 900, `${t1} → ${t3}`);
  ok('浮层显示按到第几下', await S(`return document.querySelector('.dzoom-steps .num')?.textContent`) === '3/4', await S(`return document.querySelector('.dzoom-steps .num')?.textContent`));
  await press('PageDown', '1:4', '按 4 下：图片出现（整页原图）', [1, 4]);
  await press('PageDown', '2:0', '放完再按：翻到第 3 页开头', [2, 0]);
  await press('PageDown', '2:1', '第 3 页按 1 下：组合整组出现', [2, 1]);
  // 第 2 下：橙色块先消失，0.5 秒后紫色块自动出现
  await key('PageDown');
  await until(async () => (await state()) === '2:2', 5000, '2:2');
  { await sleep(150); const { p } = await shotStage(); const early = expectFrame(p, 2, 2, 0);
    ok('第 3 页按 2 下：橙色块马上消失，紫色块还没出现', early.exit && early.after, JSON.stringify(early)); }
  { const e = await look(2, 2, 1, '3-2-after'); ok('…约 0.5 秒后紫色块自动接着出现', allTrue(e), JSON.stringify(e)); }
  await press('PageDown', '3:0', '强调动画不算一下：直接翻到第 4 页，自动出现的青色块已在', [3, 0]);
  await press('PageDown', '3:1', '第 4 页按 1 下：黄色和红色块一起出现', [3, 1]);
  await press('PageDown', '4:-', '第 5 页只有强调动画：整页显示', [4, 0]);
  ok('没有动画的页浮层显示「分步」', await S(`return document.querySelector('.dzoom-steps .num')?.textContent`) === '分步');
  await press('PageDown', '4:-', '最后一页再按不动');
  // 倒回去
  await press('PageUp', '3:1', '往回翻：回到第 4 页是放完的样子', [3, 1]);
  await press('ArrowLeft', '3:0', '再往回：退一下', [3, 0]);
  await press('PageUp', '2:2', '再往回：第 3 页放完的样子（紫色块在）', [2, 2, 1]);
  await press('PageUp', '2:1', '退一下：橙色块回来，紫色块不见', [2, 1]);

  // ── 整页显示开关 ──
  await S(`document.querySelector('.dzoom-steps').click();return true`);
  await until(() => T(`return Q.useStore.getState().slideSteps===false`), 5000, 'toggle off');
  ok('点开关改成整页显示（老师端同步）', true);
  { await sleep(700); const { img, p } = await shotStage(); fs.writeFileSync(path.join(out, 'stage-whole-3.png'), img.toPNG());
    const e = [p.color(B.p2a, C.green), p.color(B.p2exit, C.orange), p.color(B.p2after, C.purple)];
    ok('整页显示：这一页是原图（所有形状都在，包括会退出的橙色块）', e.every((x) => x > .8), e.join(',')); }
  ok('开关显示「整页」', await S(`return document.querySelector('.dzoom-steps .num')?.textContent`) === '整页');
  await press('PageUp', '1:-', '整页显示：翻页键直接翻页');
  { const e = await look(1, 4); ok('整页显示：第 2 页是完整画面', allTrue(e), JSON.stringify(e)); }
  await S(`document.querySelector('.dzoom-steps').click();return true`);
  await until(() => T(`return Q.useStore.getState().slideSteps===true`), 5000, 'toggle on');
  ok('改回分步：正在看的这页按放完算，画面不缩回开头', await state() === '1:4', await state());
  { const e = await look(1, 4); ok('改回分步：第 2 页还是完整画面', allTrue(e), JSON.stringify(e)); }
  await press('PageDown', '2:0', '改回分步：往后翻从头放', [2, 0]);
  fs.writeFileSync(path.join(out, 'teacher.png'), (await teacher.webContents.capturePage()).toPNG());

  // ── 教师浮层：分步按钮显示第几下，点了学生画面跟着变 ──
  await api.dock.ensure(); const dock = api.windows.get('dock'); const Dk = run(dock, 'dock');
  dock.setPosition(left, 30); dock.showInactive();
  const dockNum = () => Dk(`return document.querySelector('.tdock-steps .num')?.textContent??null`);
  ok('浮层上有分步按钮，显示 0/2', await until(async () => (await dockNum()) === '0/2', 8000, 'dock steps').catch(async () => false), await dockNum());
  await press('PageDown', '2:1', '学生画面按一下，浮层跟着变');
  ok('浮层显示 1/2', await until(async () => (await dockNum()) === '1/2', 5000, 'dock 1/2').catch(() => false), await dockNum());
  fs.writeFileSync(path.join(out, 'dock.png'), (await dock.webContents.capturePage()).toPNG());
  await Dk(`document.querySelector('.tdock-steps').click();return true`);
  await until(() => S(`return Q.useStore.getState().slideSteps===false`), 5000, 'dock toggle off');
  ok('浮层点「整页」：学生画面整页显示', await S(`return document.querySelector('.dzoom-steps .num')?.textContent`) === '整页');
  await Dk(`document.querySelector('.tdock-steps').click();return true`);
  await until(() => S(`return Q.useStore.getState().slideSteps===true`), 5000, 'dock toggle on');
  ok('浮层改回分步：这一页按放完算', await state() === '2:2', await state());

  // ── 重新打开：用缓存，打开就带着分步 ──
  await T(`s.setShared({pgmMat:{id:'board',kind:'board',title:'课堂黑板',pages:[{w:1600,h:900}],total:1},pgm:{materialId:'board',page:0,slide:0,fit:'page',zoom:1}});return true`);
  const t2 = Date.now();
  const steps2 = await T(`const r=await Q.host.call('slideSteps',${JSON.stringify(pptx)});return r`);
  ok('第二次直接读缓存', Date.now() - t2 < 3000 && steps2.pages.length === 3, `${Date.now() - t2}ms`);

  // ── 内置排版（macOS / 没装 Office 的电脑走这条路） ──
  fs.writeFileSync(path.join(docDir, 'manifest.json'), JSON.stringify({ ...manifest, engine: '内置排版' }));
  fs.rmSync(path.dirname(stepsFile), { recursive: true, force: true });
  const t3b = Date.now();
  const r = await T(`return await Q.host.call('slideSteps',${JSON.stringify(pptx)})`);
  const builtin = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  ok('内置排版生成分步画面', builtin.engine === '内置排版' && !builtin.error && r.pages.length === 3, `${((Date.now() - t3b) / 1000).toFixed(1)}s ${builtin.error ?? ''}`);
  const origBuiltin = builtin.pages.flatMap((s) => s.frames).filter((f) => f.path).map((f) => f.path);
  ok('内置排版：每个中间帧都有图', origBuiltin.length === 9 && origBuiltin.every((f) => fs.existsSync(f)), String(origBuiltin.length));
  // 放完的那一帧就是原课件那页的图，上面已核对过；这里只核对内置排版出的中间帧
  const mids = { pages: builtin.pages.map((s) => ({ ...s, frames: s.frames.filter((f) => f.path) })) };
  const texts = [];
  for (const s of mids.pages) {
    let sub = 0, prevClick = -1;
    for (const f of s.frames) {
      sub = f.click === prevClick ? sub + 1 : 0; prevClick = f.click;
      const e = expectFrame(probe(nativeImage.createFromPath(f.path)), s.page, f.click, sub);
      if (s.page === 1) texts.push(e.text);
      fs.copyFileSync(f.path, path.join(out, `builtin-p${s.page + 1}-c${f.click}${sub ? '-' + sub : ''}.png`));
      ok(`内置排版：第 ${s.page + 1} 页按 ${f.click} 下${sub ? '（之后一帧）' : ''}的画面对`, allTrue(e), JSON.stringify(e));
    }
  }
  ok('内置排版：文字一段一段出现', texts[0] < 80 && texts[1] > texts[0] + 300 && texts[2] > texts[1] + 300 && texts[3] > texts[2] + 300, texts.join(' → '));

  const after = { size: fs.statSync(pptx).size, mtime: fs.statSync(pptx).mtimeMs, sha: require('node:crypto').createHash('sha256').update(fs.readFileSync(pptx)).digest('hex') };
  ok('原课件一个字节都没改', JSON.stringify(after) === JSON.stringify(before));
  const bad = errors.filter((e) => !/Autofill|DevTools|net::ERR_ABORTED/.test(e));
  ok('没有界面报错', !bad.length, bad.slice(0, 3).join(' | '));
  clearTimeout(timer);
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  app.exit(0);
})().catch(async (e) => {
  console.error('FAIL', e?.stack || e);
  try { const t = globalThis.classroomStudioTest?.windows.get('student'); if (t) fs.writeFileSync(path.join(out, 'failure-student.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  app.exit(1);
});
