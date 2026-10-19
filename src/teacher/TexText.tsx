import katex from 'katex';
import type { ReactNode } from 'react';

const tex = (s: string, display = false) => ({ __html: katex.renderToString(s, { throwOnError: false, displayMode: display }) });

/** 截短时不能把 $...$ 从中间切开，否则后半个公式会原样露出来 */
export function clipTex(s: string, n: number): string {
  if (s.length <= n) return s;
  let t = s.slice(0, n);
  if ((t.match(/\$/g) ?? []).length % 2) t = t.slice(0, t.lastIndexOf('$'));
  return t.trimEnd() + '…';
}

function inline(s: string, key: string) {
  return s.split(/(\*\*[^*\n]+?\*\*)/g).map((b, j) => b.startsWith('**') && b.length > 4
    ? <b key={key + j}><TexText text={b.slice(2, -2)} as="span" /></b>
    : <TexText key={key + j} text={b} as="span" />);
}

/** 问答回答：模型常写的简单 Markdown（标题、列表、**加粗**、分隔线）＋ $…$ 公式。不认识的写法原样显示 */
export function MdText({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = [];
  text.replace(/\r/g, '').split(/(\$\$[\s\S]+?\$\$)/g).forEach((chunk, ci) => {
    if (chunk.startsWith('$$') && chunk.length > 4) { out.push(<span key={ci} className="ai-tex-block" dangerouslySetInnerHTML={tex(chunk.slice(2, -2).trim(), true)} />); return; }
    chunk.split('\n').forEach((line, li) => {
      const k = `${ci}-${li}`;
      let m: RegExpMatchArray | null;
      if (!line.trim()) { if (li && li < chunk.split('\n').length - 1) out.push(<div key={k} className="md-gap" />); }
      else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) out.push(<hr key={k} className="md-hr" />);
      else if ((m = line.match(/^\s*>\s?(.*)$/))) out.push(<div key={k} className="md-q">{inline(m[1], k)}</div>);
      else if ((m = line.match(/^\s*#{1,6}\s+(.*)$/))) out.push(<div key={k} className="md-h">{inline(m[1].replace(/\*\*/g, ''), k)}</div>);
      else if ((m = line.match(/^(\s*)[-*•]\s+(.*)$/))) out.push(<div key={k} className="md-li" style={{ paddingLeft: 14 + Math.min(m[1].length, 6) * 4 }}><i>•</i>{inline(m[2], k)}</div>);
      else if ((m = line.match(/^(\s*)(\d+)[.)、]\s+(.*)$/))) out.push(<div key={k} className="md-li" style={{ paddingLeft: 18 + Math.min(m[1].length, 6) * 4 }}><i>{m[2]}.</i>{inline(m[3], k)}</div>);
      else out.push(<div key={k}>{inline(line, k)}</div>);
    });
  });
  return <div className={className ? className + ' md' : 'md'}>{out}</div>;
}

/** 文本里的 $...$ / $$...$$ 渲染为公式 */
export function TexText({ text, className, as = 'div' }: { text: string; className?: string; as?: 'div' | 'p' | 'span' }) {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  const Tag = as;
  return <Tag className={className}>{parts.map((p, i) => p.startsWith('$$') ? <span key={i} className="ai-tex-block" dangerouslySetInnerHTML={tex(p.slice(2, -2), true)} />
    : p.startsWith('$') && p.length > 2 ? <span key={i} dangerouslySetInnerHTML={tex(p.slice(1, -1))} /> : <span key={i}>{p}</span>)}</Tag>;
}
