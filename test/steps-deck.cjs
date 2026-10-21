// PPT 分步测试用课件：按 PowerPoint 保存时的 XML 结构手写（p:timing 的三层 par、bldLst、组合、图片、
// mc:AlternateContent、页内超链接）。用法：require('./steps-deck.cjs').write(file)，或 node test/steps-deck.cjs <file>
const fs = require('node:fs'), zlib = require('node:zlib');
const { zip } = require('../electron/exporter.cjs');

const E = 9525; // 1280×720 像素 = 12192000×6858000 EMU
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const THEME = fs.readFileSync(require.resolve('../electron/exporter.cjs'), 'utf8').match(/const THEME = `([\s\S]*?)`;/)[1];
const TREE0 = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/** 纯色 PNG */
function png(w, h, hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const row = Buffer.alloc(w * 3 + 1);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const T = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const xfrm = ([x, y, w, h]) => `<a:xfrm><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/></a:xfrm>`;
const rect = (id, box, color) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="矩形 ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`;
const text = (id, box, paras, { size = 3200, color = '202020', bullet = false, link } = {}) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="文本框 ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>`
  + paras.map((t) => `<a:p>${bullet ? '<a:pPr marL="457200" indent="-457200"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>' : ''}<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="${size}" b="1" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/>${link ? `<a:hlinkClick r:id="${link}"/>` : ''}</a:rPr><a:t>${t}</a:t></a:r></a:p>`).join('')
  + '</p:txBody></p:sp>';
const pic = (id, box, rid) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="图片 ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const group = (id, [x, y, w, h], inner) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="组合 ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/><a:chOff x="${x * E}" y="${y * E}"/><a:chExt cx="${w * E}" cy="${h * E}"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`;
const alt = (inner) => `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${inner}</mc:Choice><mc:Fallback>${inner}</mc:Fallback></mc:AlternateContent>`;

/** groups: [{ auto?, slots: [{ delay, effects: [{ spid, cls: 'entr'|'exit'|'emph', node, paras?: [st, end] }] }] }] */
function timing(groups, bld = '') {
  let id = 2;
  const tgt = (e) => (e.paras ? `<p:spTgt spid="${e.spid}"><p:txEl><p:pRg st="${e.paras[0]}" end="${e.paras[1]}"/></p:txEl></p:spTgt>` : `<p:spTgt spid="${e.spid}"/>`);
  const vis = (e, v, delay) => `<p:set><p:cBhvr><p:cTn id="${++id}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn><p:tgtEl>${tgt(e)}</p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${v}"/></p:to></p:set>`;
  const fade = (e, dir) => `<p:animEffect transition="${dir}" filter="fade"><p:cBhvr><p:cTn id="${++id}" dur="500"/><p:tgtEl>${tgt(e)}</p:tgtEl></p:cBhvr></p:animEffect>`;
  const body = (e) => (e.cls === 'entr' ? vis(e, 'visible', 0) + fade(e, 'in')
    : e.cls === 'exit' ? fade(e, 'out') + vis(e, 'hidden', 499)
      : `<p:animScale><p:cBhvr><p:cTn id="${++id}" dur="250" autoRev="1" fill="hold"/><p:tgtEl>${tgt(e)}</p:tgtEl></p:cBhvr><p:by x="110000" y="110000"/></p:animScale>`);
  const effect = (e) => `<p:par><p:cTn id="${++id}" presetID="${e.cls === 'emph' ? 6 : 10}" presetClass="${e.cls}" presetSubtype="0" fill="hold"${e.paras ? ' grpId="0"' : ''} nodeType="${e.node}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${body(e)}</p:childTnLst></p:cTn></p:par>`;
  const slot = (s) => `<p:par><p:cTn id="${++id}" fill="hold"><p:stCondLst><p:cond delay="${s.delay}"/></p:stCondLst><p:childTnLst>${s.effects.map(effect).join('')}</p:childTnLst></p:cTn></p:par>`;
  const grp = (g) => `<p:par><p:cTn id="${++id}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>${g.auto ? '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : ''}</p:stCondLst><p:childTnLst>${g.slots.map(slot).join('')}</p:childTnLst></p:cTn></p:par>`;
  const seq = groups.map(grp).join('');
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${seq}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${bld}</p:timing>`;
}
const click = (...effects) => ({ slots: [{ delay: 0, effects: effects.map((e, i) => ({ node: i ? 'withEffect' : 'clickEffect', ...e })) }] });
const slide = (shapes, tm = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree>${TREE0}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><p:transition spd="med"><p:fade/></p:transition>${tm}</p:sld>`;

/** 画面上用来核对的色块（1280×720 坐标） */
const C = { red: 'E02020', blue: '2060E0', green: '00A050', orange: 'FF8000', purple: '8040C0', cyan: '00C0E0', yellow: 'FFD000', magenta: 'D020B0' };
const BOX = {
  p0pic: [820, 200, 360, 300], p1pic: [820, 200, 360, 300], p1text: [80, 160, 680, 420],
  p2a: [80, 220, 220, 200], p2b: [340, 220, 220, 200], p2exit: [640, 220, 240, 200], p2after: [960, 220, 240, 200],
  p3auto: [80, 220, 300, 200], p3click: [480, 220, 300, 200], p3alt: [880, 220, 300, 200],
  p4: [480, 220, 300, 200],
};
const title = (t, link) => text(2, [60, 30, 1160, 90], [t], { size: 4000, color: '1F3864', link });

const SLIDES = [
  // 第 1 页：没有动画（图片只在这一页用，分步副本里不该带上）
  { xml: slide(title('一、没有动画') + pic(3, BOX.p0pic, 'rId2')), rels: [['rId2', 'image', '../media/image2.png']] },
  // 第 2 页：三段文字一段一段出现（带项目符号），第 4 下出现图片；标题链接到第 1 页
  {
    xml: slide(title('二、分段出现', 'rId3') + text(3, BOX.p1text, ['第一段：受力分析', '第二段：列方程', '第三段：求解'], { size: 4400, bullet: true }) + pic(4, BOX.p1pic, 'rId2'),
      timing([click({ spid: 3, cls: 'entr', paras: [0, 0] }), click({ spid: 3, cls: 'entr', paras: [1, 1] }), click({ spid: 3, cls: 'entr', paras: [2, 2] }), click({ spid: 4, cls: 'entr' })],
        '<p:bldLst><p:bldP spid="3" grpId="0" build="p"/></p:bldLst>')),
    rels: [['rId2', 'image', '../media/image1.png'], ['rId3', 'slide', 'slide1.xml']],
  },
  // 第 3 页：第 1 下出现组合；第 2 下橙色块退出，0.5 秒后紫色块接着出现；第 3 下只有强调（不算一下）
  {
    xml: slide(title('三、组合、退出、接着出现') + group(5, [80, 220, 480, 200], rect(6, BOX.p2a, C.green) + rect(7, BOX.p2b, C.green)) + rect(8, BOX.p2exit, C.orange) + rect(9, BOX.p2after, C.purple),
      timing([click({ spid: 5, cls: 'entr' }),
        { slots: [{ delay: 0, effects: [{ spid: 8, cls: 'exit', node: 'clickEffect' }] }, { delay: 500, effects: [{ spid: 9, cls: 'entr', node: 'afterEffect' }] }] },
        click({ spid: 2, cls: 'emph' })])),
  },
  // 第 4 页：青色块翻到这一页自动出现；第 1 下黄色块出现，另一个时间槽里同一时刻的红色块（AlternateContent 包着）一起出现
  {
    xml: slide(title('四、自动开始、同时出现') + rect(3, BOX.p3auto, C.cyan) + rect(4, BOX.p3click, C.yellow) + alt(rect(5, BOX.p3alt, C.red)),
      timing([{ auto: true, slots: [{ delay: 0, effects: [{ spid: 3, cls: 'entr', node: 'afterEffect' }] }] },
        { slots: [{ delay: 0, effects: [{ spid: 4, cls: 'entr', node: 'clickEffect' }] }, { delay: 0, effects: [{ spid: 5, cls: 'entr', node: 'withEffect' }] }] }])),
  },
  // 第 5 页：只有强调动画，不分步
  { xml: slide(title('五、只有强调') + rect(3, BOX.p4, C.magenta), timing([click({ spid: 3, cls: 'emph' }), click({ spid: 2, cls: 'emph' })])) },
];

/** 期望的分步结果（pptSteps.plan / analyze 应该算出来的） */
const EXPECT = [
  null,
  { clicks: 4, frames: [
    { click: 0, wait: 0, hide: { shapes: ['4'], paras: { 3: [0, 1, 2] } }, full: false },
    { click: 1, wait: 0, hide: { shapes: ['4'], paras: { 3: [1, 2] } }, full: false },
    { click: 2, wait: 0, hide: { shapes: ['4'], paras: { 3: [2] } }, full: false },
    { click: 3, wait: 0, hide: { shapes: ['4'], paras: {} }, full: false },
    { click: 4, wait: 0, hide: { shapes: [], paras: {} }, full: true }] },
  { clicks: 2, frames: [
    { click: 0, wait: 0, hide: { shapes: ['5', '9'], paras: {} }, full: false },
    { click: 1, wait: 0, hide: { shapes: ['9'], paras: {} }, full: false },
    { click: 2, wait: 0, hide: { shapes: ['8', '9'], paras: {} }, full: false },
    { click: 2, wait: 500, hide: { shapes: ['8'], paras: {} }, full: false }] },
  { clicks: 1, frames: [
    { click: 0, wait: 0, hide: { shapes: ['4', '5'], paras: {} }, full: false },
    { click: 1, wait: 0, hide: { shapes: [], paras: {} }, full: true }] },
  null,
];

function write(file) {
  const n = SLIDES.length;
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${SLIDES.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: REL([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${SLIDES.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/><p:custShowLst><p:custShow name="精简" id="0"><p:sldLst><p:sld r:id="rId4"/></p:sldLst></p:custShow></p:custShowLst></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: REL([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...SLIDES.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${TREE0}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: REL([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="空白"><p:spTree>${TREE0}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: REL([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    { name: 'ppt/media/image1.png', data: png(64, 48, C.blue) },
    { name: 'ppt/media/image2.png', data: png(64, 48, C.red) },
  ];
  SLIDES.forEach((s, i) => {
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: s.xml });
    entries.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: REL([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...(s.rels ?? [])]) });
  });
  fs.writeFileSync(file, zip(entries.map((e) => ({ name: e.name, data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8') }))));
  return n;
}

module.exports = { write, SLIDES, EXPECT, BOX, C, timing, slide, text, rect };
if (require.main === module) { write(process.argv[2] || 'steps-deck.pptx'); console.log('ok'); }
