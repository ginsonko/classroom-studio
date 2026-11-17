'use strict';
// 硬盘快满提醒（设计稿 E.4）：用 fs.promises.statfs 查录像目录和数据目录所在的盘，剩余不到 5 GB 提醒（不挡操作）。
// 启动时查一次（老师今天点过「知道了」就今天不再提醒，第二天再提醒）；每次开始录课前都查。
// 原来空间极低时的硬保护（录制里的 disk 检查）不动。
const fs = require('node:fs');
const path = require('node:path');

const LIMIT = 5 * 1024 * 1024 * 1024;
const GB = 1024 ** 3;

const driveOf = (p) => { const r = path.parse(path.resolve(String(p || '.'))).root; return /^[A-Za-z]:/.test(r) ? r.slice(0, 1).toUpperCase() : r || '/'; };
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 目录不存在就往上找，查它所在盘的剩余空间（字节）；查不到返回 null */
async function freeOf(dir, statfs = fs.promises.statfs) {
  let target = path.resolve(String(dir || '.'));
  for (;;) {
    try { const v = await statfs(target); return { free: Number(v.bavail) * Number(v.bsize), total: Number(v.blocks) * Number(v.bsize) }; }
    catch { const up = path.dirname(target); if (up === target) return null; target = up; }
  }
}

const message = (drive, free) => `${/^[A-Z]$/.test(drive) ? drive + ' 盘' : drive}只剩 ${(free / GB).toFixed(1)} GB，建议及时清理或换盘，免得录课半路中断`;

/**
 * dirs: [{ role:'recordings'|'data', dir }]；同一个盘只算一次。
 * 返回 { low:[{drive, free, total, roles, message}], disks:[...] }
 */
async function check(dirs, { statfs, limit = LIMIT } = {}) {
  const byDrive = new Map();
  for (const d of dirs || []) {
    if (!d?.dir) continue;
    const drive = driveOf(d.dir);
    const hit = byDrive.get(drive);
    if (hit) { if (!hit.roles.includes(d.role)) hit.roles.push(d.role); continue; }
    const r = await freeOf(d.dir, statfs);
    byDrive.set(drive, { drive, free: r?.free ?? null, total: r?.total ?? null, roles: [d.role] });
  }
  const disks = [...byDrive.values()];
  const low = disks.filter((x) => x.free !== null && x.free < limit).map((x) => ({ ...x, message: message(x.drive, x.free) }));
  return { low, disks, at: Date.now() };
}

/** 启动时要不要提醒：今天点过「知道了」就不提醒 */
const shouldShowAtStartup = (dismissedDay, now = new Date()) => dismissedDay !== today(now);

module.exports = { LIMIT, check, freeOf, driveOf, message, today, shouldShowAtStartup };
