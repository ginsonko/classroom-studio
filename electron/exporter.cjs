'use strict';
// 把 AI 写的 Markdown 排版成老师常用的格式：PDF（直接打印）、Word（.docx，公式为清晰图片）、PPT（每页一张排好的幻灯片）。
// 排版在隐藏的 export.html 页面里完成（KaTeX 渲染公式），这里负责截图并直接打包 docx / pptx，不依赖本机装 Office 或 WPS。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { closeWindow } = require('./office.cjs');

// ── 最小 zip 写入器（docx / pptx 都是 zip） ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(entries) {
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), deflated = zlib.deflateRawSync(raw), nameBuf = Buffer.from(name, 'utf8'), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(deflated.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, deflated); central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const cenBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

// ── docx ──
const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const FONT = '<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>';
const EMU = 9525; // 每像素

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="40" w:after="40" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="120" w:after="200"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="38"/><w:szCs w:val="38"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="2" w:color="2F6FD6"/></w:pBdr><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1B4EA8"/><w:sz w:val="29"/><w:szCs w:val="29"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="1B4EA8"/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="6" w:color="9AA6B8"/><w:left w:val="single" w:sz="6" w:color="9AA6B8"/><w:bottom w:val="single" w:sz="6" w:color="9AA6B8"/><w:right w:val="single" w:sz="6" w:color="9AA6B8"/><w:insideH w:val="single" w:sz="6" w:color="9AA6B8"/><w:insideV w:val="single" w:sz="6" w:color="9AA6B8"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** 题图：Markdown 里的本地图片路径换成 data URL（相对路径按 md 所在目录；只收 png/jpg，单张 ≤ 8 MB） */
function inlineImages(md, dir) {
  return md.replace(/^(\s*)!\[([^\]]*)\]\(([^)\s]+)\)\s*$/gm, (all, sp, alt, src) => {
    if (/^data:/.test(src)) return all;
    try {
      const file = path.resolve(dir, decodeURI(src.replace(/^file:\/\/\//, '')));
      const ext = path.extname(file).toLowerCase(), type = ext === '.png' ? 'png' : /^\.jpe?g$/.test(ext) ? 'jpeg' : '';
      if (!type || fs.statSync(file).size > 8 * 1024 * 1024) return `${sp}![${alt}](missing)`;
      return `${sp}![${alt}](data:image/${type};base64,${fs.readFileSync(file).toString('base64')})`;
    } catch { return `${sp}![${alt}](missing)`; }
  });
}

function buildDocx(parsed, pics) {
  const media = []; let rid = 10, docPr = 1;
  const pic = (id, scale) => {
    const p = pics.get(id); if (!p) return '';
    const r = 'rId' + rid++, name = `image${media.length + 1}.png`;
    media.push({ r, name, data: p.png });
    const w = Math.round(p.w * scale * EMU), h = Math.round(p.h * scale * EMU), down = Math.round(p.depth * scale * 0.75 * 2);
    return `<w:r><w:rPr>${down ? `<w:position w:val="-${down}"/>` : ''}</w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${docPr}" name="公式 ${docPr++}"/>`
      + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
      + `<pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${r}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  // 截图时公式字号 48px，正文 11pt（≈14.7px）
  const INLINE = 14.67 / 48;
  const runs = (rs, extra = '') => rs.map((r) => {
    if (r.t === 'math') return pic(r.id, INLINE);
    const pr = `${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F3F6"/>' : ''}${extra}`;
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`;
  }).join('');
  const para = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
  const body = parsed.blocks.map((b) => {
    switch (b.type) {
      case 'h': return para(runs(b.runs), `<w:pStyle w:val="Heading${Math.min(3, b.level)}"/>`);
      case 'p': return para(runs(b.runs), b.quote ? '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="9DB8E8"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F3F7FD"/><w:ind w:left="240"/>' : '');
      case 'li': { const left = 420 * (b.depth + 1); return para(`<w:r><w:rPr><w:b/><w:color w:val="2F6FD6"/></w:rPr><w:t xml:space="preserve">${b.ordered ? b.n + '.' : '•'}</w:t></w:r><w:r><w:tab/></w:r>${runs(b.runs)}`, `<w:tabs><w:tab w:val="left" w:pos="${left}"/></w:tabs><w:ind w:left="${left}" w:hanging="360"/>`); }
      case 'math': return para(pic(b.id, INLINE), '<w:jc w:val="center"/><w:spacing w:before="80" w:after="80"/>');
      case 'code': return b.text.split('\n').map((l) => para(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${x(l)}</w:t></w:r>`, '<w:shd w:val="clear" w:color="auto" w:fill="F5F6F8"/><w:spacing w:before="0" w:after="0"/>')).join('');
      case 'break': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case 'gap': return para('') + para('') + para('') + para('');
      case 'img': {
        const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(b.src || ''); if (!m) return para(`<w:r><w:t>[图片缺失]</w:t></w:r>`);
        const data = Buffer.from(m[2], 'base64'), size = imageSize(data); if (!size) return '';
        const r = 'rId' + rid++, name = `image${media.length + 1}.${m[1] === 'png' ? 'png' : 'jpeg'}`;
        media.push({ r, name, data });
        // 正文宽 ≈ 16.5 cm；题图按 96 dpi 放，太宽就缩到正文宽
        const k = Math.min(1, (16.5 / 2.54 * 96) / size.w), w = Math.round(size.w * k * EMU), h = Math.round(size.h * k * EMU);
        return para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${docPr}" name="图片 ${docPr++}"/>`
          + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
          + `<pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${r}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
          + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, '<w:jc w:val="center"/>');
      }
      case 'hr': return para('', '<w:pBdr><w:bottom w:val="dashed" w:sz="6" w:space="1" w:color="B7C0CC"/></w:pBdr>');
      case 'table': {
        // 列宽按每列最长内容分配（题号、层次这类短列不该和说明列一样宽）
        const cols = Math.max(...b.rows.map((r) => r.length));
        const len = (rs) => (rs || []).reduce((s, r) => s + (r.t === 'math' ? 4 : [...r.text].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)), 0);
        const want = Array.from({ length: cols }, (_, k) => Math.min(60, Math.max(4, ...b.rows.map((r) => len(r[k])))));
        const total = want.reduce((a, v) => a + v, 0), ws = want.map((v) => Math.floor((9900 * v) / total));
        return `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="9900" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
          + b.rows.map((r, i) => `<w:tr>${Array.from({ length: cols }, (_, k) => `<w:tc><w:tcPr><w:tcW w:w="${ws[k]}" w:type="dxa"/>${i === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF3FB"/>' : ''}</w:tcPr>${para(runs(r[k] || [], i === 0 ? '<w:b/>' : ''), '<w:spacing w:before="20" w:after="20"/>')}</w:tc>`).join('')}</w:tr>`).join('')
          + '</w:tbl>' + para('');
      }
      default: return '';
    }
  }).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="964" w:bottom="1020" w:left="964" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map((m) => `<Relationship Id="${m.r}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(parsed.title || '')}</dc:title><dc:creator>最强网课教辅系统</dc:creator></cp:coreProperties>` },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/_rels/document.xml.rels', data: rels },
    ...media.map((m) => ({ name: 'word/media/' + m.name, data: m.data })),
  ]);
}

// ── pptx：每页一张排好的整页图片（公式、版式在任何电脑上都一致，不依赖本机装 Office/WPS） ──
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Studio"><a:themeElements>
<a:clrScheme name="Studio"><a:dk1><a:srgbClr val="1C2430"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1B4EA8"/></a:dk2><a:lt2><a:srgbClr val="EEF3FB"/></a:lt2><a:accent1><a:srgbClr val="2F6FD6"/></a:accent1><a:accent2><a:srgbClr val="E07A2E"/></a:accent2><a:accent3><a:srgbClr val="2E9E6B"/></a:accent3><a:accent4><a:srgbClr val="8A5CD6"/></a:accent4><a:accent5><a:srgbClr val="D64545"/></a:accent5><a:accent6><a:srgbClr val="3AA8C1"/></a:accent6><a:hlink><a:srgbClr val="2F6FD6"/></a:hlink><a:folHlink><a:srgbClr val="8A5CD6"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Studio"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Studio"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const EMPTY_TREE = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
const REL = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;

function buildPptx(slides, title) {
  const W = 12192000, H = 6858000;
  const slideXml = (i, alt) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`
    + `<p:pic><p:nvPicPr><p:cNvPr id="2" name="第 ${i + 1} 页" descr="${x(alt).slice(0, 1500)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="${H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>`
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title || '')}</dc:title><dc:creator>最强网课教辅系统</dc:creator></cp:coreProperties>` },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${P_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: REL([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${P_NS}>${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: REL([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${P_NS} type="blank" preserve="1">${EMPTY_TREE}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: REL([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
  ];
  slides.forEach((s, i) => {
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(i, s.alt || '') });
    entries.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: REL([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/slide${i + 1}.png`]]) });
    entries.push({ name: `ppt/media/slide${i + 1}.png`, data: s.png });
  });
  return zip(entries);
}

/**
 * 导出一个 Markdown 文件。formats ⊆ ['pdf','docx','pptx']。返回生成的文件路径和失败原因。
 * makeWindow() 返回一个能加载 studio://app/export.html 的隐藏窗口（离屏渲染，不显示）。
 */
async function exportMarkdown(file, formats, makeWindow) {
  const md = inlineImages(fs.readFileSync(file, 'utf8'), path.dirname(file)), base = file.replace(/\.(md|markdown)$/i, '');
  const out = [], errors = [];
  const w = makeWindow();
  try {
    await w.loadURL('studio://app/export.html');
    const call = (fn, ...a) => w.webContents.executeJavaScript(`window.csExport.${fn}(${a.map((v) => JSON.stringify(v)).join(',')})`);
    for (let i = 0; i < 100 && !(await w.webContents.executeJavaScript('!!window.csExport')); i++) await new Promise((r) => setTimeout(r, 50));
    const frame = () => new Promise((r) => { const t = setTimeout(r, 600); w.webContents.once('paint', () => { clearTimeout(t); setTimeout(r, 30); }); w.webContents.invalidate(); });
    const parsed = await call('renderDoc', md);
    if (formats.includes('pdf')) {
      try { const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }); fs.writeFileSync(base + '.pdf', pdf); out.push(base + '.pdf'); }
      catch (e) { errors.push('PDF：' + e.message); }
    }
    if (formats.includes('docx')) {
      try {
        const pics = new Map();
        for (const m of parsed.maths.slice(0, 400)) {
          const r = await call('showMath', m.tex, m.display); await frame();
          const img = await w.webContents.capturePage({ x: r.x, y: r.y, width: r.w, height: r.h });
          const size = img.getSize(), k = size.width / r.w || 1;
          pics.set(m.id, { png: img.toPNG(), w: size.width / k, h: size.height / k, depth: r.depth });
        }
        fs.writeFileSync(base + '.docx', buildDocx(parsed, pics)); out.push(base + '.docx');
      } catch (e) { errors.push('Word：' + e.message); }
    }
    if (formats.includes('pptx')) {
      try {
        const s = await call('renderSlides', md), pages = [];
        for (let i = 0; i < Math.min(s.count, 80); i++) {
          await call('showSlide', i); await frame();
          const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 900 });
          pages.push({ png: img.toPNG(), alt: s.notes[i] || '' });
        }
        fs.writeFileSync(base + '.pptx', buildPptx(pages, s.title)); out.push(base + '.pptx');
      } catch (e) { errors.push('PPT：' + e.message); }
    }
    if (formats.includes('png')) {
      try {
        const { height } = await call('renderCard', md), h = Math.min(Math.max(height, 200), 12000);
        w.setContentSize(750, h); await new Promise((r) => setTimeout(r, 120)); await frame();
        const img = await w.webContents.capturePage({ x: 0, y: 0, width: 750, height: h });
        fs.writeFileSync(base + '.png', img.toPNG()); out.push(base + '.png');
      } catch (e) { errors.push('长图：' + e.message); }
    }
  } finally { await closeWindow(w); }
  return { out, errors };
}

module.exports = { exportMarkdown, buildDocx, buildPptx, zip, crc32, imageSize, inlineImages };
