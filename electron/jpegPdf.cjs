// 把若干张 JPEG 排成 A4 竖版 PDF（每张一页、铺满整页）。不依赖第三方库：JPEG 直接以 DCTDecode 嵌入。
'use strict';

const A4 = [595.28, 841.89];

/** 读 JPEG 的宽、高、通道数（SOF0/1/2 段） */
function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw Error('不是 JPEG 图片');
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1], len = buf.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7), comps: buf[p + 9] };
    p += 2 + len;
  }
  throw Error('JPEG 缺少尺寸信息');
}

/** PDF 文本串：中文标题用 UTF-16BE 十六进制 */
const pdfText = (s) => '<FEFF' + Buffer.from(String(s), 'utf16le').swap16().toString('hex').toUpperCase() + '>';

/** jpegs：Buffer 数组；返回 PDF Buffer */
function jpegsToPdf(jpegs, title = '') {
  const parts = [], offsets = [];
  let size = 0;
  const push = (b) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(x); size += x.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const n = jpegs.length, first = 4;
  // 1 目录、2 页面树、3 文档信息；之后每页 3 个对象：页、内容、图片
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${jpegs.map((_, i) => `${first + i * 3} 0 R`).join(' ')}] >>`);
  obj(3, `<< /Title ${pdfText(title || '课堂板书')} /Producer (Classroom Studio) >>`);
  jpegs.forEach((jpg, i) => {
    const info = jpegInfo(jpg), pg = first + i * 3, [W, H] = A4;
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${pg + 2} 0 R >> >> /Contents ${pg + 1} 0 R >>`);
    obj(pg + 1, [`<< /Length ${draw.length} >>\nstream\n`, draw, '\nendstream']);
    const cs = info.comps === 1 ? '/DeviceGray' : info.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    obj(pg + 2, [`<< /Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
  });
  const xref = size, total = first + n * 3;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

module.exports = { jpegsToPdf, jpegInfo };
