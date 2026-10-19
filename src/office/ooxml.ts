// Office 文件 XML 的预处理：让网页渲染库也能显示 MathType 公式、Office 公式等“嵌入对象”。
// 这两类东西在文件里都带一张预览图（OLE 预览 / AlternateContent 的 Fallback），这里把它们换成普通图片。

const EMU: Record<string, number> = { pt: 12700, in: 914400, cm: 360000, mm: 36000, px: 9525 };

function length(style: string, key: string) {
  const m = new RegExp('(?:^|;)\\s*' + key + '\\s*:\\s*([\\d.]+)\\s*(pt|in|cm|mm|px)?', 'i').exec(style);
  return m ? Math.round(Number(m[1]) * EMU[(m[2] || 'pt').toLowerCase()]) : 0;
}

let seq = 9000;
function inlinePicture(rid: string, cx: number, cy: number) {
  const id = ++seq;
  return '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="object${id}"/>`
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="object${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

/** 精简生成的 PPTX（比如本软件自己导出的）没有默认文字样式，渲染库会直接报错，补一个空的 */
export function fixPresentationXml(xml: string) {
  if (/<p:defaultTextStyle\b/.test(xml)) return xml;
  return xml.replace('</p:presentation>', '<p:defaultTextStyle><a:defPPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></p:defaultTextStyle></p:presentation>');
}

/** Word：<w:object>（MathType 公式、嵌入的图表等）换成同尺寸的内嵌图片，图片就是对象自带的预览图 */
export function fixDocxXml(xml: string) {
  return xml.replace(/<w:object\b[^>]*>([\s\S]*?)<\/w:object>/g, (all, inner: string) => {
    const data = /<v:imagedata\b[^>]*>/.exec(inner)?.[0];
    const rid = data && /\br:id="([^"]+)"/.exec(data)?.[1];
    const style = /<v:shape\b[^>]*\bstyle="([^"]*)"/.exec(inner)?.[1] ?? '';
    const cx = length(style, 'width'), cy = length(style, 'height');
    return rid && cx > 0 && cy > 0 ? inlinePicture(rid, cx, cy) : all;
  });
}

/**
 * PPT：AlternateContent 取 Fallback（Office 公式、新式形状都会在这里放一份老格式的副本或图片）；
 * 嵌入对象（<p:graphicFrame> 里的 <p:oleObj>）换成它自带的预览图片 <p:pic>，位置大小沿用对象框。
 */
export function fixSlideXml(xml: string) {
  let out = xml.replace(/<mc:AlternateContent\b[^>]*>([\s\S]*?)<\/mc:AlternateContent>/g, (_all, inner: string) => {
    const pick = /<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/.exec(inner) ?? /<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>/.exec(inner);
    return pick ? pick[1] : '';
  });
  out = out.replace(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g, (frame) => {
    if (!frame.includes('oleObj')) return frame;
    let pic = /<p:pic\b[\s\S]*?<\/p:pic>/.exec(frame)?.[0];
    if (!pic) return frame;
    const xfrm = /<p:xfrm\b[^>]*>([\s\S]*?)<\/p:xfrm>/.exec(frame)?.[1];
    if (xfrm && !/<a:xfrm\b/.test(pic)) {
      pic = /<p:spPr\s*\/>/.test(pic) ? pic.replace(/<p:spPr\s*\/>/, `<p:spPr><a:xfrm>${xfrm}</a:xfrm></p:spPr>`) : pic.replace(/<p:spPr\b([^>]*)>/, `<p:spPr$1><a:xfrm>${xfrm}</a:xfrm>`);
    }
    return pic;
  });
  return out;
}
