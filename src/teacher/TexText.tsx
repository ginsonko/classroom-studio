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

export type FileRender = (path: string, label: string, key: string) => ReactNode;
// 回复里的本机文件：Markdown 链接 [教案](H:/x/教案.pdf)，或者直接写出来的完整路径（Windows 盘符 / macOS 的 /Users 等）
const SEG = String.raw`[^\s<>"'|?*()（）\[\]{}，。；、：！？` + '`' + String.raw`]`;
// 盘符前面不能紧挨字母（排除 http://），/Users 前面不能是路径或网址的一部分
const ROOT = String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|(?<![\w:/.])\/(?:Users|Volumes|home|tmp|private)\/)`;
const FILE_PATH = String.raw`${ROOT}(?:${SEG}+[\\/])*${SEG}+\.[A-Za-z0-9]{1,6}`;
// 链接里的路径可以带空格
const LINK_PATH = String.raw`${ROOT}[^<>"|?*()\n]+?\.[A-Za-z0-9]{1,6}`;
const FILE_RE = new RegExp(String.raw`\[([^\]\n]+)\]\(\s*<?(${LINK_PATH})>?\s*\)|(${FILE_PATH})`, 'g');
export const filePathsIn = (s: string) => [...new Set([...s.matchAll(FILE_RE)].map((m) => (m[2] ?? m[3]).replace(/\\/g, '/')))];

function files(s: string, key: string, file?: FileRender): ReactNode[] {
  if (!file) return [<TexText key={key} text={s} as="span" />];
  const out: ReactNode[] = []; let at = 0, n = 0;
  for (const m of s.matchAll(FILE_RE)) {
    if (m.index! > at) out.push(<TexText key={key + 't' + n} text={s.slice(at, m.index)} as="span" />);
    const p = (m[2] ?? m[3]).replace(/\\/g, '/');
    out.push(file(p, m[1] ?? '', key + 'f' + n++));
    at = m.index! + m[0].length;
  }
  if (at < s.length) out.push(<TexText key={key + 't' + n} text={s.slice(at)} as="span" />);
  return out;
}

function inlineMd(s: string, key: string, file?: FileRender) {
  return s.split(/(\*\*[^*\n]+?\*\*)/g).map((b, j) => b.startsWith('**') && b.length > 4
    ? <b key={key + j}>{files(b.slice(2, -2), key + j, file)}</b>
    : <span key={key + j}>{files(b, key + j, file)}</span>);
}

/**
 * 问答回答：模型常写的简单 Markdown（标题、列表、**加粗**、分隔线）＋ $…$ 公式。不认识的写法原样显示。
 * 给了 file 时，回复里的本机文件路径换成可以点的文件按钮
 */
export function MdText({ text, className, file }: { text: string; className?: string; file?: FileRender }) {
  const inline = (s: string, k: string) => inlineMd(s, k, file);
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
