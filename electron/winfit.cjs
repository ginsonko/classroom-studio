'use strict';
// 窗口放进屏幕：小屏笔记本（1366×768、缩放 125% 只剩约 1093×574）放不下默认尺寸和最小尺寸；
// 拔掉第二块显示器、改分辨率以后，窗口可能整个留在屏幕外面。纯计算，主进程和测试共用。

const DEFAULTS = {
  teacher: { width: 1600, height: 960, minWidth: 1050, minHeight: 640 },
  student: { width: 1280, height: 760, minWidth: 640, minHeight: 400 },
};

/** 按工作区收紧的创建参数（尺寸、最小尺寸都不超过工作区） */
function createSize(role, wa) {
  const d = DEFAULTS[role];
  if (!d || !wa) return d ? { ...d } : {};
  const width = Math.min(d.width, wa.width), height = Math.min(d.height, wa.height);
  return { width, height, minWidth: Math.min(d.minWidth, width), minHeight: Math.min(d.minHeight, height) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * 窗口该挪到哪里。force：恢复默认（默认尺寸、居中）；否则只在超出工作区时收进来。
 * 返回 null 表示不用动。
 */
function fitRect(rect, wa, role, force = false) {
  const d = DEFAULTS[role];
  if (!d || !rect || !wa) return null;
  if (force) {
    const width = Math.min(d.width, wa.width), height = Math.min(d.height, wa.height);
    return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
  }
  const width = Math.min(rect.width, wa.width), height = Math.min(rect.height, wa.height);
  // 标题栏必须在屏幕里，否则拖都拖不回来
  const x = clamp(rect.x, wa.x, wa.x + wa.width - width), y = clamp(rect.y, wa.y, wa.y + wa.height - height);
  if (x === rect.x && y === rect.y && width === rect.width && height === rect.height) return null;
  return { x, y, width, height };
}

/** 最小尺寸也要放得进当前屏幕 */
function minSize(role, wa) {
  const d = DEFAULTS[role];
  if (!d || !wa) return null;
  return [Math.min(d.minWidth, wa.width), Math.min(d.minHeight, wa.height)];
}

module.exports = { DEFAULTS, createSize, fitRect, minSize };
