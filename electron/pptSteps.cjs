'use strict';
// PPT 分步：读 PPTX 里每页的「单击出现」动画顺序，算出每按一下翻页笔后画面上该有哪些东西，
// 再生成一份「分步副本」：每个中间状态一页（还没出现的形状删掉、还没出现的段落文字变透明），
// 交给转换这份课件的同一种方式出图。整个过程只读原文件，不依赖 Office / WPS。
const { entries } = require('./zipkit.cjs');
const { zip } = require('./exporter.cjs');

const MAX_FRAMES_PER_SLIDE = 60, MAX_FRAMES = 600;

// ── 极简 XML 树：只记标签名、属性原文和在字符串里的起止位置，改写时按位置拼接 ──
function parse(xml) {
  const root = { name: '#root', attrs: '', children: [], start: 0, end: xml.length, open: 0, parent: null };
  let cur = root, i = 0;
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
  for (let m; (m = re.exec(xml));) {
    i = m.index;
    if (!m[2]) continue;
    if (m[1]) {
      // 闭合标签：一直退到同名元素（容错：坏掉的嵌套不至于整份失败）
      let n = cur;
      while (n !== root && n.name !== m[2]) n = n.parent;
      if (n === root) continue;
      n.end = re.lastIndex; n.inner = i;
      cur = n.parent;
      continue;
    }
    const el = { name: m[2], attrs: m[3], children: [], start: i, open: re.lastIndex, end: re.lastIndex, inner: re.lastIndex, parent: cur };
    cur.children.push(el);
    if (!m[4]) cur = el;
  }
  return root;
}
const attr = (el, k) => { const m = new RegExp('(?:^|\\s)' + k.replace(':', '\\:') + '\\s*=\\s*"([^"]*)"').exec(el.attrs); return m ? m[1] : undefined; };
const kids = (el, name) => el.children.filter((c) => c.name === name);
const kid = (el, name) => el?.children.find((c) => c.name === name);
function* walk(el) { for (const c of el.children) { yield c; yield* walk(c); } }
const find = (el, name) => { for (const c of walk(el)) if (c.name === name) return c; return undefined; };

// ── 动画时间线 → 每一下之后的可见状态 ──
const key = (spid, p) => (p === undefined ? spid : spid + '#' + p);

/** 一个效果：目标形状（可带段落范围）、进入还是退出 */
function effectOf(ctn) {
  const cls = attr(ctn, 'presetClass');
  if (cls !== 'entr' && cls !== 'exit') return null;
  for (const t of walk(ctn)) {
    if (t.name !== 'p:spTgt') continue;
    const spid = attr(t, 'spid');
    if (!spid) continue;
    const rg = find(t, 'p:pRg');
    const paras = [];
    if (rg) { const a = Number(attr(rg, 'st')), b = Number(attr(rg, 'end')); if (Number.isInteger(a) && Number.isInteger(b) && b >= a && b - a < 200) for (let k = a; k <= b; k++) paras.push(k); }
    return { spid, paras, show: cls === 'entr', node: attr(ctn, 'nodeType') || '' };
  }
  return null;
}

const delayOf = (ctn) => { const c = kid(kid(ctn, 'p:stCondLst'), 'p:cond'); const d = Number(c && attr(c, 'delay')); return Number.isFinite(d) ? d : 0; };

/**
 * 读一页的主动画序列。返回 groups：每组是「一下」，组里是按时间先后的若干批效果（同一批同时出现）。
 * auto=true 的组不用按：第一组在进入这一页时自动播放，其余的接在上一下后面自动播放。
 */
function readTimeline(slideXml) {
  const tree = parse(slideXml);
  const timing = find(tree, 'p:timing');
  if (!timing) return [];
  let main;
  for (const c of walk(timing)) if (c.name === 'p:cTn' && attr(c, 'nodeType') === 'mainSeq') { main = c; break; }
  if (!main) return [];
  const groups = [];
  for (const par of kids(kid(main, 'p:childTnLst') ?? { children: [] }, 'p:par')) {
    const gctn = kid(par, 'p:cTn');
    if (!gctn) continue;
    const batches = [];
    for (const slot of kids(kid(gctn, 'p:childTnLst') ?? { children: [] }, 'p:par')) {
      const sctn = kid(slot, 'p:cTn');
      if (!sctn) continue;
      const effects = [];
      for (const ep of kids(kid(sctn, 'p:childTnLst') ?? { children: [] }, 'p:par')) {
        const ectn = kid(ep, 'p:cTn');
        const e = ectn && effectOf(ectn);
        if (e) effects.push(e);
      }
      const first = kid(kid(sctn, 'p:childTnLst') ?? { children: [] }, 'p:par');
      const node = first ? attr(kid(first, 'p:cTn') ?? { attrs: '' }, 'nodeType') || '' : '';
      const delay = delayOf(sctn), prev = batches[batches.length - 1];
      // 「与上一动画同时」或同一时刻开始的另一批：并成一批，一起出现
      if (prev && (node === 'withEffect' || delay === prev.delay)) prev.effects.push(...effects);
      else batches.push({ delay, node, effects });
    }
    if (!batches.length) continue;
    groups.push({ auto: batches[0].node !== 'clickEffect', batches });
  }
  return groups;
}

/**
 * 算出这一页的分步画面。返回 null 表示没有要分步的动画。
 * frames[i] = { click, wait, hide: { shapes: string[], paras: Record<spid, number[]> } }
 *   click：按了几下之后显示这一帧；同一下里有多帧时，后面的帧按 wait（毫秒）自动接着出。
 * clicks：一共要按几下。最后一帧如果什么都不藏，full=true（就是原来那张整页图）。
 */
function plan(slideXml) {
  const groups = readTimeline(slideXml);
  if (!groups.length) return null;
  // 每个目标第一次出现的效果决定一开始是否可见：先「进入」的开始时藏着，先「退出」的开始时在
  const firstShow = new Map();
  for (const g of groups) for (const b of g.batches) for (const e of b.effects) {
    const ks = e.paras.length ? e.paras.map((p) => key(e.spid, p)) : [key(e.spid)];
    for (const k of ks) if (!firstShow.has(k)) firstShow.set(k, e.show);
  }
  const hidden = new Set([...firstShow].filter(([, show]) => show).map(([k]) => k));
  const snap = () => {
    const shapes = [], paras = {};
    for (const k of hidden) {
      const [spid, p] = k.split('#');
      if (p === undefined) shapes.push(spid);
      else (paras[spid] ??= []).push(Number(p));
    }
    for (const s of shapes) delete paras[s];
    shapes.sort(); for (const s in paras) paras[s].sort((a, b) => a - b);
    return { shapes, paras };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const apply = (b) => { for (const e of b.effects) { const ks = e.paras.length ? e.paras.map((p) => key(e.spid, p)) : [key(e.spid)]; for (const k of ks) (e.show ? hidden.delete(k) : hidden.add(k)); } };
  const frames = [{ click: 0, wait: 0, hide: snap() }];
  let click = 0;
  for (const g of groups) {
    let pending = !g.auto, last = 0;
    for (const [bi, b] of g.batches.entries()) {
      apply(b);
      const hide = snap();
      const wait = bi === 0 ? 500 : Math.max(250, Math.min(1500, b.delay - last));
      last = b.delay;
      if (same(hide, frames[frames.length - 1].hide)) continue;
      // 画面真有变化才算一下：只有强调、路径动画的「一下」跳过，免得老师按了没反应
      if (pending) { click++; pending = false; frames.push({ click, wait: 0, hide }); }
      else frames.push({ click, wait, hide });
    }
  }
  // 进入这一页时自动播放的部分（click 0 的后续帧）直接并入第一帧：翻到这一页就是自动播完的样子
  while (frames.length > 1 && frames[1].click === 0) frames.splice(0, 1);
  frames[0].wait = 0;
  if (frames.length < 2) return null;
  for (const f of frames) f.full = !f.hide.shapes.length && !Object.keys(f.hide.paras).length;
  if (frames.length > MAX_FRAMES_PER_SLIDE) return null;
  return { clicks: click, frames };
}

// ── 生成分步画面的页 ──
const CLEAR = '<a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:solidFill>';
const FILLS = new Set(['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill']);

/** 把一段 rPr（可能不存在）改成「文字透明、没有描边阴影高亮」 */
function clearRun(xml, run) {
  const rpr = kid(run, 'a:rPr');
  if (!rpr) return [{ at: run.open, cut: 0, text: '<a:rPr>' + CLEAR + '</a:rPr>' }];
  const edits = [];
  if (rpr.open === rpr.end) {
    // <a:rPr .../> → <a:rPr ...>透明</a:rPr>
    return [{ at: rpr.start, cut: rpr.end - rpr.start, text: '<a:rPr' + rpr.attrs.replace(/\/\s*$/, '') + '>' + CLEAR + '</a:rPr>' }];
  }
  let ln = null;
  for (const c of rpr.children) {
    if (c.name === 'a:ln') ln = c;
    if (FILLS.has(c.name) || ['a:effectLst', 'a:effectDag', 'a:highlight', 'a:uLn', 'a:uFill', 'a:uFillTx', 'a:uLnTx'].includes(c.name)) edits.push({ at: c.start, cut: c.end - c.start, text: '' });
  }
  if (ln) edits.push({ at: ln.start, cut: ln.end - ln.start, text: '<a:ln><a:noFill/></a:ln>' + CLEAR });
  else edits.push({ at: rpr.open, cut: 0, text: CLEAR });
  return edits;
}

const PPR_BEFORE = new Set(['a:lnSpc', 'a:spcBef', 'a:spcAft']);
function clearBullet(p) {
  const ppr = kid(p, 'a:pPr'), bu = '<a:buClr><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:buClr>';
  if (!ppr) return [{ at: p.open, cut: 0, text: '<a:pPr>' + bu + '</a:pPr>' }];
  if (ppr.open === ppr.end) return [{ at: ppr.start, cut: ppr.end - ppr.start, text: '<a:pPr' + ppr.attrs.replace(/\/\s*$/, '') + '>' + bu + '</a:pPr>' }];
  const edits = [];
  let after = ppr.open;
  for (const c of ppr.children) {
    if (PPR_BEFORE.has(c.name)) after = c.end;
    if (c.name === 'a:buClr' || c.name === 'a:buClrTx') edits.push({ at: c.start, cut: c.end - c.start, text: '' });
  }
  edits.push({ at: after, cut: 0, text: bu });
  return edits;
}

function applyEdits(xml, edits) {
  // 落在别的删除区间里的改动没有意义（插入只算严格在里面的），去掉后从后往前拼；
  // 同一位置先插入后删除排序，倒着拼时先删原文再插入，插入的内容不会被删掉
  const inside = (e, d) => d !== e && d.cut > 0 && (e.cut > 0 ? d.at <= e.at && e.at + e.cut <= d.at + d.cut && d.cut > e.cut : d.at < e.at && e.at < d.at + d.cut);
  const kept = edits.filter((e) => !edits.some((d) => inside(e, d))).sort((a, b) => a.at - b.at || a.cut - b.cut);
  let out = xml;
  for (let i = kept.length - 1; i >= 0; i--) { const e = kept[i]; out = out.slice(0, e.at) + e.text + out.slice(e.at + e.cut); }
  return out;
}

/** 形状元素：cNvPr 往上找到直接挂在 spTree / grpSp 下的那个元素（mc:AlternateContent 整块） */
function shapesById(tree) {
  const map = new Map();
  for (const c of walk(tree)) {
    if (c.name !== 'p:cNvPr') continue;
    const id = attr(c, 'id');
    let n = c;
    while (n.parent && n.parent.name !== 'p:spTree' && n.parent.name !== 'p:grpSp' && n.parent.name !== '#root') n = n.parent;
    if (!id || !n.parent || n.parent.name === '#root') continue;
    // 组合自己的 cNvPr 在 nvGrpSpPr 里：要删的是整个组合；spTree 根节点自己的 cNvPr 不算
    if (n.name === 'p:nvGrpSpPr') { if (n.parent.name !== 'p:grpSp') continue; n = n.parent; }
    if (!map.has(id)) map.set(id, []);
    if (!map.get(id).includes(n)) map.get(id).push(n);
  }
  return map;
}

/** 生成某个状态下的这一页：藏起来的形状删掉，藏起来的段落文字和项目符号变透明，去掉动画和切换 */
function frameXml(slideXml, hide) {
  const tree = parse(slideXml), byId = shapesById(tree), edits = [];
  const timing = find(tree, 'p:timing');
  if (timing) edits.push({ at: timing.start, cut: timing.end - timing.start, text: '' });
  for (const id of hide.shapes) for (const el of byId.get(id) ?? []) edits.push({ at: el.start, cut: el.end - el.start, text: '' });
  for (const [id, list] of Object.entries(hide.paras)) {
    for (const el of byId.get(id) ?? []) {
      const body = find(el, 'p:txBody');
      if (!body) continue;
      const ps = kids(body, 'a:p');
      for (const i of list) {
        const p = ps[i];
        if (!p) continue;
        for (const r of p.children) if (r.name === 'a:r' || r.name === 'a:fld' || r.name === 'a:br') edits.push(...clearRun(slideXml, r));
        edits.push(...clearBullet(p));
      }
    }
  }
  return applyEdits(slideXml, edits);
}

// ── 整份课件 ──
const relsOf = (xml) => [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({ raw: m[0], id: /\bId="([^"]+)"/.exec(m[0])?.[1], type: /\bType="([^"]+)"/.exec(m[0])?.[1] ?? '', target: /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? '', external: /TargetMode="External"/.test(m[0]) }));
const resolve = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const s of target.split('/')) { if (s === '..') parts.pop(); else if (s !== '.') parts.push(s); }
  return parts.join('/');
};
const relsPath = (part) => { const i = part.lastIndexOf('/'); return part.slice(0, i) + '/_rels/' + part.slice(i + 1) + '.rels'; };

/** 幻灯片按放映顺序的文件名（presentation.xml 的 sldIdLst） */
function slideOrder(files) {
  const pres = files.get('ppt/presentation.xml')?.toString('utf8');
  const rels = files.get('ppt/_rels/presentation.xml.rels')?.toString('utf8');
  if (!pres || !rels) throw new Error('这不是有效的 PPTX 文件');
  const byId = new Map(relsOf(rels).map((r) => [r.id, resolve('ppt/presentation.xml', r.target)]));
  const lst = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1] ?? '';
  return [...lst.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => byId.get(m[1])).filter(Boolean);
}

/**
 * 读 PPTX，算出每页的分步计划。返回 { slides: [{ page, clicks, frames }] }（只列有分步的页），
 * 以及 build()：生成分步副本（只含需要单独出图的帧），并返回每帧在副本里的页序号。
 */
function analyze(buf) {
  const files = new Map(entries(buf, { maxFiles: 20000, maxBytes: 4 * 1024 * 1024 * 1024 }).map((e) => [e.name, e.data]));
  const order = slideOrder(files);
  const slides = [];
  let total = 0;
  for (const [page, part] of order.entries()) {
    const xml = files.get(part)?.toString('utf8');
    if (!xml || !xml.includes('<p:timing')) continue;
    let p = null;
    try { p = plan(xml); } catch { p = null; }
    if (!p) continue;
    const need = p.frames.filter((f) => !f.full).length;
    if (total + need > MAX_FRAMES) break;
    total += need;
    slides.push({ page, part, ...p });
  }
  return { pages: order.length, slides, build: () => buildDeck(files, slides) };
}

function buildDeck(files, slides) {
  const out = new Map(files);
  const ct = out.get('[Content_Types].xml').toString('utf8');
  const presRels = out.get('ppt/_rels/presentation.xml.rels').toString('utf8');
  const pres = out.get('ppt/presentation.xml').toString('utf8');
  // 原来的幻灯片和备注页都去掉，只留分步帧；版式、母版、主题、图片原样保留
  const drop = new Set();
  for (const name of out.keys()) if (/^ppt\/(slides|notesSlides|comments)\//.test(name) || /^ppt\/(slides|notesSlides)\/_rels\//.test(name)) drop.add(name);
  for (const name of drop) out.delete(name);
  const keepRels = relsOf(presRels).filter((r) => !/\/slide$/.test(r.type));
  const used = new Set(keepRels.map((r) => r.id));
  const newRels = [], ids = [], overrides = [];
  const index = [];
  let n = 0;
  for (const s of slides) {
    const xml = files.get(s.part).toString('utf8');
    const rels = files.get(relsPath(s.part))?.toString('utf8') ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const cleanRels = rels.replace(/<Relationship\b[^>]*Type="[^"]*\/(notesSlide|comments|commentAuthors|tags)"[^>]*\/>/g, '');
    const map = [];
    for (const f of s.frames) {
      if (f.full) { map.push(-1); continue; }
      n++;
      const name = `ppt/slides/slide${n}.xml`;
      // 相对路径的引用（../media、../slideLayouts）同在 ppt/slides 目录下，原样可用
      out.set(name, Buffer.from(frameXml(xml, f.hide), 'utf8'));
      // 页内跳转到别的幻灯片的链接：原来那页已不在副本里，指回自己，免得打开时要修复
      out.set(`ppt/slides/_rels/slide${n}.xml.rels`, Buffer.from(cleanRels.replace(/<Relationship\b[^>]*Type="[^"]*\/slide"[^>]*\/>/g, (r) => r.replace(/\bTarget="[^"]*"/, `Target="slide${n}.xml"`)), 'utf8'));
      let rid = 'rIdCs' + n; while (used.has(rid)) rid += 'x'; used.add(rid);
      newRels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`);
      ids.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
      overrides.push(`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
      map.push(n - 1);
    }
    index.push({ page: s.page, clicks: s.clicks, frames: s.frames.map((f, i) => ({ click: f.click, wait: f.wait, at: map[i] })) });
  }
  const ctOut = ct.replace(/<Override\b[^>]*PartName="\/ppt\/(slides|notesSlides|comments)\/[^"]*"[^>]*\/>/g, '').replace('</Types>', overrides.join('') + '</Types>');
  const relsOut = presRels.replace(/<Relationship\b[^>]*\/>/g, (r) => (/Type="[^"]*\/slide"/.test(r) ? '' : r)).replace('</Relationships>', newRels.join('') + '</Relationships>');
  let presOut = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, '<p:sldIdLst>' + ids.join('') + '</p:sldIdLst>');
  // 没有 sldIdLst 的空演示文稿：插在母版列表后面
  if (!/<p:sldIdLst>/.test(presOut)) presOut = presOut.replace(/(<\/p:sldMasterIdLst>)/, '$1<p:sldIdLst>' + ids.join('') + '</p:sldIdLst>');
  // 自定义放映、分节引用了原来的幻灯片编号，去掉免得打开时报错
  presOut = presOut.replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/, '').replace(/<p14:sectionLst\b[\s\S]*?<\/p14:sectionLst>/, '');
  out.set('[Content_Types].xml', Buffer.from(ctOut, 'utf8'));
  out.set('ppt/_rels/presentation.xml.rels', Buffer.from(relsOut, 'utf8'));
  out.set('ppt/presentation.xml', Buffer.from(presOut, 'utf8'));
  // 只被去掉的幻灯片用到的图片、音视频、嵌入对象不放进副本，副本小、出图快
  const refs = new Set();
  for (const [name, data] of out) {
    if (!name.endsWith('.rels')) continue;
    const owner = name.replace(/(^|\/)_rels\/([^/]*)\.rels$/, '$1$2');
    for (const r of relsOf(data.toString('utf8'))) if (!r.external) refs.add(resolve(owner, r.target));
  }
  for (const name of [...out.keys()]) if (/^ppt\/(media|embeddings)\//.test(name) && !refs.has(name)) out.delete(name);
  return { deck: zip([...out].map(([name, data]) => ({ name, data }))), frames: n, index };
}

module.exports = { parse, readTimeline, plan, frameXml, analyze, slideOrder };
