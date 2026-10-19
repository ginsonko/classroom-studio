// 生成浏览器预览用的样稿（public/mock）：原创的「追及相遇」练习题（题目版 + 答案版各 10 页）和一棵示例资料库目录树。
//   npx electron scripts/make-sample-mock.cjs [输出目录，默认 public/mock]
// 题目里的数字都由公式算出答案，换参数也不会出错。
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const OUT = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.cjs')) || path.join(__dirname, '../public/mock'));
const TITLE = '追及相遇问题（示例）';
const W = 1190, H = 1684;
const n = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100));

const T1 = ([v, a]) => ({
  fig: { gap: 0, front: '甲', back: '乙', note: `v = ${v} m/s` },
  stem: `甲车以 ${v} m/s 的速度匀速行驶，经过路口时，停在路口的乙车恰好以 ${a} m/s² 的加速度由静止启动，与甲车同向行驶。<br>(1) 乙车追上甲车之前，两车间的最大距离是多少？<br>(2) 乙车启动后经多长时间追上甲车？此时乙车速度多大？`,
  ans: `(1) 两车速度相等时相距最远：t₁ = v/a = ${n(v / a)} s，Δx = v·t₁ − ½a·t₁² = ${n(v * v / (2 * a))} m。<br>(2) 位移相等时追上：v·t = ½a·t²，t = 2v/a = ${n(2 * v / a)} s，此时乙车速度 a·t = ${n(2 * v)} m/s。`,
});
const T2 = ([v1, a, d]) => {
  const t = (v1 + Math.sqrt(v1 * v1 + 2 * a * d)) / a;
  return {
    fig: { gap: d, front: '甲', back: '乙', note: `${d} m` },
    stem: `乙车在甲车后方 ${d} m 处。甲车以 ${v1} m/s 的速度匀速前进，同时乙车由静止开始以 ${a} m/s² 的加速度做匀加速直线运动追赶甲车。<br>(1) 追上之前两车的最大距离是多少？<br>(2) 乙车经多长时间追上甲车？`,
    ans: `(1) 速度相等时（t = ${n(v1 / a)} s）距离最大：Δx = ${d} + ${v1}²/(2×${a}) = ${n(d + v1 * v1 / (2 * a))} m。<br>(2) ½·${a}·t² = ${d} + ${v1}t，解得 t = ${n(t)} s（舍去负根）。`,
  };
};
const T3 = ([v0, a, v, d]) => {
  const ts = v0 / a, xs = v0 * v0 / (2 * a);
  const trap = v * ts < xs + d;
  const t = trap ? (xs + d) / v : ((v0 - v) + Math.sqrt((v0 - v) ** 2 + 2 * a * d)) / a;
  return {
    fig: { gap: d, front: '甲', back: '乙', note: `${d} m`, brake: true },
    stem: `甲车在前、乙车在后同向行驶，两车相距 ${d} m 时，速度为 ${v0} m/s 的甲车开始以 ${a} m/s² 的加速度刹车，乙车始终以 ${v} m/s 的速度匀速行驶。<br>求乙车经多长时间追上甲车。`,
    ans: trap
      ? `甲车刹车 ${n(ts)} s 后停下，滑行 ${n(xs)} m；这时乙车只走了 ${n(v * ts)} m &lt; ${n(xs + d)} m，还没追上。<br>所以追上时甲车已停止：t = (${n(xs)} + ${d}) / ${v} = ${n(t)} s。（直接列匀变速方程会得到错误答案）`
      : `甲车停下前已被追上：${v}t = ${d} + ${v0}t − ½·${a}·t²，解得 t = ${n(t)} s。`,
  };
};
const T4 = ([v1, v2, d]) => ({
  fig: { gap: d, front: '货车', back: '轿车', note: `${d} m`, brake: true },
  stem: `轿车以 ${v1} m/s 的速度行驶，司机发现正前方 ${d} m 处有一辆货车正以 ${v2} m/s 的速度同向匀速行驶，立即刹车（不计反应时间）。<br>为避免两车相撞，轿车刹车的加速度至少多大？`,
  ans: `临界情况：两车速度相等时恰好相遇。相对速度从 ${v1 - v2} m/s 减到 0，相对位移为 ${d} m：<br>(${v1} − ${v2})² = 2a·${d}，a = ${n((v1 - v2) ** 2 / (2 * d))} m/s²。`,
});

const QUESTIONS = [
  T1([10, 2]), T3([10, 2, 4, 7]), T2([4, 2, 12]), T4([20, 8, 36]),
  T1([8, 2]), T3([12, 3, 4, 8]), T2([6, 2, 16]), T4([30, 10, 50]),
  T1([12, 3]), T3([20, 4, 5, 10]), T2([3, 1, 8]), T4([16, 4, 24]),
  T1([6, 1]), T3([16, 4, 8, 8]), T2([5, 1, 12]), T4([25, 5, 40]),
  T1([15, 3]), T3([18, 3, 6, 9]), T2([8, 2, 9]), T4([12, 6, 9]),
];

const figure = ({ front, back, note, brake }) => `
<svg viewBox="0 0 360 120" width="360" height="120">
  <line x1="10" y1="96" x2="350" y2="96" stroke="#555" stroke-width="2"/>
  <line x1="10" y1="104" x2="350" y2="104" stroke="#bbb" stroke-dasharray="10 8"/>
  <rect x="40" y="64" width="64" height="28" rx="6" fill="#dbe7fb" stroke="#3b6fd8" stroke-width="2"/>
  <text x="72" y="84" text-anchor="middle" font-size="16">${back}</text>
  <rect x="240" y="64" width="${front.length > 1 ? 84 : 64}" height="28" rx="6" fill="#fde2d8" stroke="#d8603b" stroke-width="2"/>
  <text x="${front.length > 1 ? 282 : 272}" y="84" text-anchor="middle" font-size="16">${front}</text>
  <line x1="104" y1="40" x2="240" y2="40" stroke="#333" marker-start="url(#a)" marker-end="url(#a)"/>
  <text x="172" y="32" text-anchor="middle" font-size="15">${note}</text>
  ${brake ? '<text x="282" y="56" text-anchor="middle" font-size="13" fill="#d8603b">刹车</text>' : ''}
  <defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#333"/></marker></defs>
</svg>`;

function pageHtml(page, answer) {
  const qs = QUESTIONS.slice(page * 2, page * 2 + 2);
  const block = (q, i) => `
  <section>
    <h3>例题 ${page * 2 + i + 1}</h3>
    <div class="row"><p>${q.stem}</p><div class="fig">${figure(q.fig)}</div></div>
    ${answer ? `<div class="ans"><b>【答案与解析】</b><br>${q.ans}</div>` : '<div class="blank">解：</div>'}
  </section>`;
  return `<!doctype html><meta charset="utf-8"><style>
  html{zoom:.5;overflow:hidden}
  html,body{margin:0;width:${W}px;height:${H}px;background:#fff;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#222}
  header{height:${H * 0.04}px;display:flex;align-items:center;justify-content:space-between;padding:0 80px;border-bottom:2px solid #3b6fd8;font-size:22px;color:#3b6fd8}
  section{height:${H * 0.46 - 1}px;box-sizing:border-box;padding:36px 80px 0;border-bottom:1px dashed #ccc;display:flex;flex-direction:column}
  h3{margin:0 0 18px;font-size:30px}
  .row{display:flex;gap:30px;align-items:flex-start}
  p{flex:1;margin:0;font-size:27px;line-height:1.75}
  .fig{flex:none;margin-top:8px}
  .ans{margin-top:24px;padding:20px 26px;border-radius:12px;background:#fff4f0;color:#b2401f;font-size:25px;line-height:1.7}
  .blank{margin-top:24px;flex:1;margin-bottom:30px;border-radius:12px;border:2px dashed #ddd;padding:16px 22px;font-size:25px;color:#aaa}
  footer{height:${H * 0.04}px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#999}
  </style><header><span>${TITLE}${answer ? '' : ' · 无答案'}</span><span>第 ${page + 1} 页</span></header>
  ${qs.map(block).join('')}
  <footer>软件自带的原创示例题，可自由使用</footer>`;
}

// 示例资料库：只用来演示资料库的分类、配对和各种格式的图标
const f = (name, kind, size) => [name, kind, size];
const TREE = {
  n: '示例资料库',
  d: [
    { n: '高一物理', d: [
      { n: '第1章 匀变速直线运动', f: [
        f(`${TITLE}.pdf`, 'pdf', 1834201), f(`${TITLE}无答案.pdf`, 'pdf', 1520117),
        f('1.1 位移与速度（课件）.pptx', 'slides', 5320448), f('1.2 加速度（课件）.pptx', 'slides', 6110233),
        f('1.3 匀变速直线运动的规律（讲义）.docx', 'word', 482113), f('1.3 匀变速直线运动的规律（讲义）答案.docx', 'word', 503981),
        f('打点计时器实验.mp4', 'video', 48211340), f('v-t 图像小结.png', 'image', 412004),
      ] },
      { n: '第2章 相互作用', f: [
        f('2.1 重力 弹力（课件）.pptx', 'slides', 4920117), f('2.2 摩擦力（练习）原卷版.pdf', 'pdf', 702111),
        f('2.2 摩擦力（练习）解析版.pdf', 'pdf', 911204), f('力的合成与分解 互动演示.html', 'html', 32012),
      ] },
      { n: '第3章 牛顿运动定律', f: [
        f('3.1 牛顿第一定律.pdf', 'pdf', 1203321), f('3.2 牛顿第二定律（讲义）.docx', 'word', 610222),
        f('超重与失重 实验视频.mp4', 'video', 36110220), f('牛顿定律 单元测试 学生版.pdf', 'pdf', 820117), f('牛顿定律 单元测试 教师版.pdf', 'pdf', 1102244),
      ] },
    ] },
    { n: '高二物理', d: [
      { n: '静电场', f: [
        f('库仑定律（课件）.pptx', 'slides', 7210033), f('电场强度 题目版.pdf', 'pdf', 640112), f('电场强度 答案版.pdf', 'pdf', 802331),
        f('电场线演示.swf', 'flash', 220113),
      ] },
      { n: '电磁感应', f: [
        f('楞次定律 来拒去留.pptx', 'slides', 8120554), f('法拉第电磁感应定律（练习）无答案.docx', 'word', 402001),
        f('法拉第电磁感应定律（练习）.docx', 'word', 450118), f('电磁阻尼实验.mp4', 'video', 52001332),
      ] },
    ] },
    { n: '复习与测验', d: [
      { n: '期中复习', f: [f('期中复习提纲.pdf', 'pdf', 920113), f('期中模拟卷 原卷.pdf', 'pdf', 1320223), f('期中模拟卷 解析.pdf', 'pdf', 1820554)] },
      { n: '听力与音频', f: [f('物理学史小故事.mp3', 'audio', 6120334)] },
    ], f: [f('高考物理公式汇总.pdf', 'pdf', 520113), f('课件素材合集.zip', 'archive', 120554331)] },
    { n: '学生资料', d: [
      { n: '小林同学', d: [{ n: '错题', f: [f('9.17-1.jpg', 'image', 802113), f('9.17-2.jpg', 'image', 760221), f('10.08 周测.pdf', 'pdf', 650113)] }] },
      { n: '小周同学', f: [f('暑期预习计划.docx', 'word', 80113)] },
    ] },
  ],
};

// 窗口高度会被限制在屏幕以内：窗口只开一半大，按 2 倍像素截图，页面 CSS 再缩一半
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });
    const win = new BrowserWindow({ show: false, width: W / 2, height: H / 2, useContentSize: true, webPreferences: { offscreen: true } });
    const docs = {};
    for (const [key, answer] of [['answer', true], ['blank', false]]) {
      const pages = [];
      for (let p = 0; p < 10; p++) {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml(p, answer)));
        await new Promise((r) => setTimeout(r, 150));
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: W / 2, height: H / 2 });
        const name = `${key}-${String(p + 1).padStart(2, '0')}.png`;
        fs.writeFileSync(path.join(OUT, 'pages', name), img.resize({ width: W, height: H }).toPNG());
        pages.push({ src: 'mock/pages/' + name, w: 595.28, h: 841.89, slides: [[0, 0.04, 1, 0.46], [0, 0.5, 1, 0.46]] });
      }
      docs[key] = { title: answer ? TITLE : TITLE + '无答案', total: pages.length, pages };
    }
    fs.writeFileSync(path.join(OUT, 'docs.json'), JSON.stringify(docs, null, 1));
    fs.writeFileSync(path.join(OUT, 'tree.json'), JSON.stringify(TREE));
    console.log('样稿已生成：', OUT);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
