// 1.2.2 PPT 分步（主进程部分）：读单击动画顺序 → 每一下之后的画面状态 → 改写出的每一帧幻灯片 XML → 分步副本 PPTX。
// 用法：node test/v122-steps-logic.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const S = require('../electron/pptSteps.cjs');
const { entries } = require('../electron/zipkit.cjs');
const D = require('./steps-deck.cjs');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok ' + name); };
/** 标签严格配对（改写后的 XML 不能坏） */
function wellFormed(xml) {
  const st = [], re = /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  for (let m; (m = re.exec(xml));) { if (!m[2]) continue; if (m[1]) { if (st.pop() !== m[2]) return false; } else if (!m[4]) st.push(m[2]); }
  return st.length === 0;
}
const paraXml = (xml, spid) => { const at = xml.indexOf(`<p:cNvPr id="${spid}"`); const end = xml.indexOf('</p:sp>', at); return [...xml.slice(at, end).matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => m[0]); };
const ALPHA0 = /<a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="0"\/><\/a:srgbClr><\/a:solidFill>/;
const hasShape = (xml, id) => new RegExp(`<p:cNvPr id="${id}"`).test(xml);

ok('每页的分步计划和 PowerPoint 放映一致', () => {
  D.SLIDES.forEach((s, i) => assert.deepEqual(S.plan(s.xml), D.EXPECT[i], '第 ' + (i + 1) + ' 页'));
});

ok('时间线：单击组、批次、自动开始', () => {
  const g = S.readTimeline(D.SLIDES[2].xml);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map((x) => x.auto), [false, false, false]);
  assert.deepEqual(g[1].batches.map((b) => [b.delay, b.effects.map((e) => [e.spid, e.show])]), [[0, [['8', false]]], [500, [['9', true]]]]);
  assert.deepEqual(g[2].batches[0].effects, [], '强调效果不算出现 / 消失');
  const a = S.readTimeline(D.SLIDES[3].xml);
  assert.equal(a[0].auto, true);
  assert.equal(a[1].batches.length, 1, '「与上一动画同时」放在另一个时间槽里也并成一批');
  assert.deepEqual(a[1].batches[0].effects.map((e) => e.spid), ['4', '5']);
  assert.deepEqual(S.readTimeline(D.SLIDES[0].xml), []);
});

ok('分段出现：没出现的段落文字和项目符号透明，形状删掉，动画去掉', () => {
  const p = S.plan(D.SLIDES[1].xml), x0 = S.frameXml(D.SLIDES[1].xml, p.frames[0].hide), x2 = S.frameXml(D.SLIDES[1].xml, p.frames[2].hide);
  for (const x of [x0, x2]) { assert.ok(wellFormed(x)); assert.ok(!/<p:timing/.test(x)); assert.ok(!hasShape(x, 4) && !/r:embed="rId2"/.test(x), '图片删掉'); assert.ok(hasShape(x, 2) && hasShape(x, 3)); }
  const ps0 = paraXml(x0, 3), ps2 = paraXml(x2, 3);
  assert.equal(ps0.length, 3);
  assert.ok(ps0.every((q) => ALPHA0.test(q) && !/val="202020"/.test(q) && /<a:buClr><a:srgbClr val="FFFFFF"><a:alpha val="0"\/><\/a:srgbClr><\/a:buClr>/.test(q)), '三段都透明');
  assert.ok(ps0.every((q) => /<a:spcBef>[\s\S]*<\/a:spcBef><a:buClr>/.test(q)), 'buClr 在 spcBef 后面（顺序合规）');
  assert.ok(ps0.every((q) => /<a:t>第.段：/.test(q)), '文字还在（版面不变）');
  assert.ok(!ALPHA0.test(ps2[0]) && !ALPHA0.test(ps2[1]) && ALPHA0.test(ps2[2]), '按了两下：前两段正常');
  assert.ok(/val="1F3864"/.test(x0) && /hlinkClick/.test(x0), '标题原样');
});

ok('组合整组删、AlternateContent 整块删、先退出的形状一开始在', () => {
  const s = D.SLIDES[2].xml, p = S.plan(s);
  const f0 = S.frameXml(s, p.frames[0].hide), f2 = S.frameXml(s, p.frames[2].hide);
  assert.ok(wellFormed(f0) && wellFormed(f2));
  assert.ok(!/<p:grpSp>/.test(f0) && !hasShape(f0, 5) && !hasShape(f0, 6) && !hasShape(f0, 7) && !hasShape(f0, 9) && hasShape(f0, 8));
  assert.ok(/<p:grpSp>/.test(f2) && hasShape(f2, 6) && !hasShape(f2, 8) && !hasShape(f2, 9));
  const a = D.SLIDES[3].xml, q = S.plan(a), g0 = S.frameXml(a, q.frames[0].hide);
  assert.ok(wellFormed(g0) && !/mc:AlternateContent/.test(g0) && !hasShape(g0, 4) && hasShape(g0, 3));
});

ok('各种写法的段落都能变透明', () => {
  const sp = (body) => D.slide(`<p:sp><p:nvSpPr><p:cNvPr id="3" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`);
  const cases = [
    ['<a:p><a:r><a:t>无 rPr</a:t></a:r></a:p>', (q) => /<a:r><a:rPr><a:solidFill>/.test(q)],
    ['<a:p><a:r><a:rPr lang="zh-CN"/><a:t>自闭合</a:t></a:r></a:p>', (q) => /<a:rPr lang="zh-CN"><a:solidFill>/.test(q)],
    ['<a:p><a:r><a:rPr lang="zh-CN"><a:ln w="12700"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst><a:outerShdw/></a:effectLst><a:highlight><a:srgbClr val="FFFF00"/></a:highlight><a:latin typeface="Arial"/></a:rPr><a:t>描边阴影高亮</a:t></a:r></a:p>',
      (q) => /<a:ln><a:noFill\/><\/a:ln><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="0"\/>/.test(q) && !/FF0000|00FF00|FFFF00|outerShdw/.test(q) && /<a:latin typeface="Arial"\/>/.test(q)],
    ['<a:p><a:pPr algn="ctr"/><a:r><a:rPr><a:gradFill><a:gsLst/></a:gradFill></a:rPr><a:t>渐变</a:t></a:r><a:br><a:rPr/></a:br><a:fld id="{1}" type="slidenum"><a:rPr/><a:t>1</a:t></a:fld></a:p>',
      (q) => /<a:pPr algn="ctr"><a:buClr>/.test(q) && !/gradFill/.test(q) && (q.match(/<a:alpha val="0"\/><\/a:srgbClr><\/a:solidFill>/g) || []).length === 3],
    ['<a:p><a:pPr><a:buClr><a:schemeClr val="accent1"/></a:buClr><a:buChar char="•"/></a:pPr><a:r><a:t>原有符号颜色</a:t></a:r></a:p>', (q) => !/accent1/.test(q) && /<a:pPr><a:buClr><a:srgbClr val="FFFFFF"><a:alpha val="0"\/><\/a:srgbClr><\/a:buClr><a:buChar/.test(q)],
  ];
  for (const [body, check] of cases) {
    const x = S.frameXml(sp(body), { shapes: [], paras: { 3: [0] } });
    assert.ok(wellFormed(x), body);
    assert.ok(check(paraXml(x, 3)[0]), body + '\n→ ' + paraXml(x, 3)[0]);
  }
  // 段落范围 st..end 一次出现多段；超出段数的序号忽略
  const multi = sp('<a:p><a:r><a:t>a</a:t></a:r></a:p><a:p><a:r><a:t>b</a:t></a:r></a:p><a:p><a:r><a:t>c</a:t></a:r></a:p>');
  const tm = D.timing([{ slots: [{ delay: 0, effects: [{ spid: 3, cls: 'entr', node: 'clickEffect', paras: [0, 1] }] }] }, { slots: [{ delay: 0, effects: [{ spid: 3, cls: 'entr', node: 'clickEffect', paras: [2, 5] }] }] }]);
  const p = S.plan(multi.replace('</p:sld>', tm + '</p:sld>'));
  assert.deepEqual(p.frames.map((f) => f.hide.paras[3] ?? []), [[0, 1, 2, 3, 4, 5], [2, 3, 4, 5], []]);
  assert.ok(wellFormed(S.frameXml(multi, p.frames[0].hide)));
});

ok('不分步的情况：没有动画、只有触发器动画、动画太多、坏 XML', () => {
  assert.equal(S.plan(D.slide('')), null);
  const trig = D.SLIDES[1].xml.replace('nodeType="mainSeq"', 'nodeType="interactiveSeq"');
  assert.equal(S.plan(trig), null, '触发器动画（点某个形状才放）不分步');
  const many = D.timing(Array.from({ length: 70 }, (_, i) => ({ slots: [{ delay: 0, effects: [{ spid: 10 + i, cls: 'entr', node: 'clickEffect' }] }] })));
  assert.equal(S.plan(D.slide('').replace('</p:sld>', many + '</p:sld>')), null, '一页超过 60 帧不分步');
  assert.doesNotThrow(() => S.plan('<p:sld><p:timing><p:tnLst><p:par><p:cTn nodeType="mainSeq"><p:childTnLst><p:par><p:cTn>'));
  // 第一下只有退出：一开始全显示，按一下消失
  const exitOnly = D.slide(D.rect(3, [0, 0, 10, 10], 'FF0000')).replace('</p:sld>', D.timing([{ slots: [{ delay: 0, effects: [{ spid: 3, cls: 'exit', node: 'clickEffect' }] }] }]) + '</p:sld>');
  assert.deepEqual(S.plan(exitOnly), { clicks: 1, frames: [{ click: 0, wait: 0, hide: { shapes: [], paras: {} }, full: true }, { click: 1, wait: 0, hide: { shapes: ['3'], paras: {} }, full: false }] });
});

ok('分步副本：只含要单独出图的帧，引用都在，没用到的图片去掉', () => {
  const file = path.join(os.tmpdir(), 'cs-steps-deck-' + process.pid + '.pptx');
  D.write(file);
  try {
    const a = S.analyze(fs.readFileSync(file));
    assert.equal(a.pages, 5);
    assert.deepEqual(a.slides.map((s) => [s.page, s.clicks]), [[1, 4], [2, 2], [3, 1]]);
    const { deck, frames, index } = a.build();
    assert.equal(frames, 4 + 4 + 1);
    assert.deepEqual(index.map((s) => s.frames.map((f) => f.at)), [[0, 1, 2, 3, -1], [4, 5, 6, 7], [8, -1]]);
    assert.deepEqual(index[1].frames.map((f) => [f.click, f.wait]), [[0, 0], [1, 0], [2, 0], [2, 500]]);
    const files = new Map(entries(deck).map((e) => [e.name, e.data]));
    const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort();
    assert.equal(slides.length, 9);
    const pres = files.get('ppt/presentation.xml').toString();
    assert.equal(S.slideOrder(files).length, 9, 'sldIdLst 九页且都能找到');
    assert.ok(!/custShowLst/.test(pres), '引用原幻灯片的自定义放映去掉');
    const ct = files.get('[Content_Types].xml').toString();
    for (const s of slides) assert.ok(ct.includes(`PartName="/${s}"`), s);
    assert.equal((ct.match(/presentationml\.slide\+xml/g) || []).length, 9);
    assert.ok(files.has('ppt/media/image1.png') && !files.has('ppt/media/image2.png'), '只有第 1 页用的图片去掉');
    for (const [name, data] of files) {
      if (name.endsWith('.xml') || name.endsWith('.rels')) assert.ok(wellFormed(data.toString()), name);
      if (!name.endsWith('.rels')) continue;
      const owner = name.replace(/(^|\/)_rels\/([^/]*)\.rels$/, '$1$2');
      for (const m of data.toString().matchAll(/Target="([^"]+)"/g)) {
        const parts = owner.split('/'); parts.pop();
        for (const seg of m[1].split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
        const t = m[1].startsWith('/') ? m[1].slice(1) : parts.join('/');
        assert.ok(files.has(t), `${name} → ${m[1]}`);
      }
    }
    // 第 2 页的帧：标题里链接到第 1 页的地址改成指向自己
    const r1 = files.get('ppt/slides/_rels/slide1.xml.rels').toString();
    assert.ok(/Type="[^"]*\/slide" Target="slide1\.xml"/.test(r1), r1);
    assert.ok(!/<p:timing/.test(files.get('ppt/slides/slide1.xml').toString()));
    // 不分步的课件：没有要出的帧
    const plain = S.analyze(fs.readFileSync(file)).slides.filter((s) => s.page === 4);
    assert.equal(plain.length, 0);
  } finally { fs.rmSync(file, { force: true }); }
});

ok('不是 PPTX：报错而不是崩溃', () => {
  assert.throws(() => S.analyze(Buffer.from('not a zip')));
});

console.log(`PASS ${n}/${n}`);
