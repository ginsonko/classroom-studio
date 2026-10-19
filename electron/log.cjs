'use strict';
// 本地诊断日志：<数据目录>\logs\app.log，超过 2 MB 轮换为 app.log.1。
// 只记录窗口异常、脚本报错、浮层输入与形状变化等排错信息，不记录课件内容、笔迹或密钥。
const fs = require('node:fs');
const path = require('node:path');

const MAX = 2 * 1024 * 1024;

function createLog(dir) {
  const file = path.join(dir, 'app.log');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 日志不可写时静默降级 */ }
  const text = (v) => (typeof v === 'string' ? v : v instanceof Error ? (v.stack || v.message) : JSON.stringify(v));
  function write(level, parts) {
    try {
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (st && st.size > MAX) fs.renameSync(file, file + '.1');
      const line = parts.map(text).join(' ').replace(/[\r\n]+/g, ' ⏎ ').slice(0, 2000);
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${line}\n`);
    } catch { /* 磁盘满或无权限：不影响上课 */ }
  }
  return {
    file,
    info: (...a) => write('INFO ', a),
    warn: (...a) => write('WARN ', a),
    error: (...a) => write('ERROR', a),
  };
}

module.exports = { createLog };
