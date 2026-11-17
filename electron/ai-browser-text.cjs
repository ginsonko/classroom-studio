'use strict';
// 搬自万能创作终端 0.7.0（electron/ai-browser-text.cjs），只改了提示里的软件名；要改行为先同步上游。
// Pure helpers for what the agent reads from the AI browser: element refs across frames, frame
// outlines merged into their parent, readable text as Markdown with paging, links and tables.
// No Electron here.

/** "e12" / "12" / "[e12]" -> {frame: 0, id: 12}; "f2e5" -> {frame: 2, id: 5}; null when malformed. */
function parseRef(input) {
  const s = String(input ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  let m = /^e?(\d{1,7})$/.exec(s);
  if (m) return Number(m[1]) > 0 ? { frame: 0, id: Number(m[1]) } : null;
  m = /^f(\d{1,4})e(\d{1,7})$/.exec(s);
  if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return { frame: Number(m[1]), id: Number(m[2]) };
  return null;
}

/**
 * Puts each frame's outline where its <iframe> sits in the parent.
 * @param {{items: object[]}} main the main frame's snapshot (its frame items carry `key`)
 * @param {Map<number, {items: object[], url?: string, error?: string}>} children by frame key
 */
function mergeFrames(main, children) {
  const used = new Set();
  const expand = (items, depth) => {
    const out = [];
    for (const it of items || []) {
      if (it.t !== 'frame') {
        out.push(it);
        continue;
      }
      const child = it.key != null ? children.get(it.key) : null;
      const label = `内嵌框架${it.key != null ? ` f${it.key}` : ''}${it.name ? `「${it.name}」` : ''}`;
      if (!child || used.has(it.key) || depth > 3) {
        out.push({ t: 'text', text: `【${label}：${child?.error || '没有读取'}${it.src ? ` ${it.src}` : ''}】` });
        continue;
      }
      used.add(it.key);
      if (child.error) {
        out.push({ t: 'text', text: `【${label}：${child.error}】` });
        continue;
      }
      out.push({ t: 'text', text: `【${label} 开始${child.url ? ` ${child.url}` : ''}】` });
      out.push(...expand(child.items, depth + 1));
      out.push({ t: 'text', text: `【${label} 结束】` });
    }
    return out;
  };
  const items = expand(main.items, 0);
  // Frames whose owner element was not placed (hidden owners, timing) still get read at the end.
  for (const [key, child] of children) {
    if (used.has(key) || child.error || !child.items?.length || child.hidden) continue;
    items.push({ t: 'text', text: `【内嵌框架 f${key}${child.url ? ` ${child.url}` : ''}】` }, ...expand(child.items, 1));
  }
  return { ...main, items, frames: 0 };
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/** One table as Markdown; the first row is the header. */
function tableMarkdown(t, maxRows = 300) {
  const rows = (t.rows || []).filter((r) => r.some((c) => String(c ?? '').trim()));
  if (!rows.length) return '';
  const width = Math.min(30, Math.max(...rows.map((r) => r.length)));
  const pad = (r) => Array.from({ length: width }, (_, i) => cell(r[i]));
  const lines = [];
  if (t.caption) lines.push(`表格：${clip(t.caption, 120)}`);
  lines.push(`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`);
  for (const r of rows.slice(1, maxRows)) lines.push(`| ${pad(r).join(' | ')} |`);
  const more = (t.more || 0) + Math.max(0, rows.length - maxRows);
  if (more) lines.push(`…（还有 ${more} 行没列出）`);
  return lines.join('\n');
}

/** The in-page reader's blocks as Markdown. */
function blocksToMarkdown(blocks) {
  const out = [];
  let lastP = '';
  for (const b of blocks || []) {
    if (b.t === 'h') out.push(`${'#'.repeat(Math.min(Math.max(Number(b.level) || 2, 1), 6))} ${clip(b.text, 300)}`);
    else if (b.t === 'p') {
      const t = String(b.text || '').trim();
      // Sites repeat the same line (sticky headers, "展开阅读全文"); once is enough.
      if (!t || t === lastP) continue;
      lastP = t;
      out.push(t);
      continue;
    } else if (b.t === 'li') out.push(`${'  '.repeat(Math.min(Number(b.depth) || 0, 4))}- ${clip(b.text, 2000)}`);
    else if (b.t === 'quote') out.push(String(b.text || '').split('\n').map((l) => `> ${l}`).join('\n'));
    else if (b.t === 'code') out.push(`\`\`\`\n${String(b.text || '').replace(/```/g, "'''")}\n\`\`\``);
    else if (b.t === 'table') {
      const md = tableMarkdown(b);
      if (md) out.push(md);
    }
    lastP = '';
  }
  return out.join('\n\n');
}

/**
 * A window of a long text, cut at a line break when one is near.
 * @returns {{text: string, start: number, end: number, total: number, next: number | null}}
 */
function paginate(text, start = 0, max = 8000) {
  const s = String(text ?? '');
  const total = s.length;
  const from = Math.min(Math.max(0, Math.floor(Number(start) || 0)), total);
  const size = Math.min(Math.max(500, Math.floor(Number(max) || 8000)), 40000);
  let end = Math.min(total, from + size);
  if (end < total) {
    const nl = s.lastIndexOf('\n', end);
    if (nl > from + size * 0.6) end = nl + 1;
  }
  return { text: s.slice(from, end), start: from, end, total, next: end < total ? end : null };
}

/** Links as numbered lines; `find` keeps those whose text or address contains it. */
function formatLinks(list, { find = '', max = 300 } = {}) {
  const f = String(find || '').toLowerCase();
  const hit = (list || []).filter((l) => !f || `${l.text} ${l.href}`.toLowerCase().includes(f));
  const lines = hit.slice(0, max).map((l) => `[${l.ref}] ${clip(l.text, 100) || '（无文字）'}${l.href ? ` → ${clip(l.href, 200)}` : ''}`);
  if (hit.length > max) lines.push(`…还有 ${hit.length - max} 个链接，用 find 缩小范围`);
  return { text: lines.join('\n') || (f ? `没有包含「${clip(find, 40)}」的链接` : '这个页面没有链接'), count: hit.length };
}

function formatTables(tables, { maxRows = 300 } = {}) {
  const md = (tables || []).map((t, i) => {
    const body = tableMarkdown(t, maxRows);
    return body ? `表格 ${i + 1}${t.frame ? `（内嵌框架 ${t.frame}）` : ''}：\n${body}` : '';
  });
  const text = md.filter(Boolean).join('\n\n');
  return text || '这个页面没有读到表格（有的网站用 div 摆成表格样子，可以用 browser_read 读正文）';
}

module.exports = { parseRef, mergeFrames, blocksToMarkdown, tableMarkdown, paginate, formatLinks, formatTables };
