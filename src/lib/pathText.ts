// AI 回复、Markdown 链接里的本机路径常被写成 file:///…、带 %20 等网址编码（mac 的「Application Support」带空格是常态）。
// 界面这边只做不需要读磁盘的清理：去掉 <> 和引号、file:// 转成普通路径；%XX 留给主进程按「原样找不到再解码」处理，
// 显示文件名时才解码。纯函数，Node 里可以直接测试。

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** 去掉包裹的 <> / 引号；file:// 网址转成路径（file:///C:/x → C:/x，file:///Users/x → /Users/x），反斜杠统一成 / */
export function cleanPath(raw: string): string {
  let p = String(raw ?? '').trim().replace(/^<(.*)>$/, '$1').replace(/^["'“”‘’](.*)["'“”‘’]$/, '$1').trim();
  if (/^file:\/\//i.test(p)) {
    p = decode(p.replace(/^file:\/\/(localhost)?/i, ''));
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);
  }
  return p.replace(/\\/g, '/');
}

/** 给老师看的路径：%20 之类解码成原字 */
export const shownPath = (p: string) => (/%[0-9A-Fa-f]{2}/.test(p) ? decode(cleanPath(p)) : cleanPath(p));

/** 文件名（显示用，已解码） */
export const baseName = (p: string) => shownPath(p).split('/').pop() || p;
