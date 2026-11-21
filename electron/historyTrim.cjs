'use strict';
/**
 * 1.8.0 课堂存档（workspace.json）陈旧撤销栈无损瘦身模块。
 *
 * 背景：
 * 实测长期使用后 workspace.json 可涨至 47 MB，其中约 73% 是数周前早已关闭的旧课件、旧黑板留下的
 * history（Ctrl+Z 撤销重做栈，每步含完整笔迹点阵副本）。
 *
 * 瘦身原则（100% 零损笔迹）：
 * 1. shared.ink（所有黑板与历史课件上的真实笔迹）一笔不动、100% 完整保留！下次重新打开旧课件批注依然在。
 * 2. 仅针对 history（撤销/重做栈）：
 *    - 当前活跃项（正在学生桌面 desk 打开的项、当前主画面 pgmMat、老师阅读器 reader、预监 pvw）
 *      全部保留撤销栈，每页最多保留最近 MAX_ACTIVE_UNDO（60）步，当堂课照常自由 Ctrl+Z；
 *    - 早已关闭、不在任何当前窗口或面板中的陈旧课件/旧临时黑板，清理其僵尸撤销栈，大幅降低内存与存盘开销。
 */

const MAX_ACTIVE_UNDO = 60;
const MAX_ACTIVE_REDO = 30;
// 近期刚关闭但仍有笔迹的课件页保留少量最近撤销栈，方便老师当堂临时切回黑板再重开讲义时仍能 Ctrl+Z；
// 超出近期水位的陈年旧课件撤销栈与无笔迹孤儿栈全部清理，将数十 MB 大存档无损瘦身
const MAX_INACTIVE_KEYS = 8;
const MAX_INACTIVE_UNDO = 10;
const MAX_INACTIVE_REDO = 5;
const MAX_INACTIVE_ENTRY_BYTES = 128 * 1024;

/** 从 history 键 "${materialId}#${page}|${actor}" 提取 inkKey ("${materialId}#${page}") */
function inkKeyFromHistoryKey(hKey) {
  const s = String(hKey || '');
  const pipe = s.lastIndexOf('|');
  return pipe >= 0 ? s.slice(0, pipe) : s;
}

/** 从 history 键 "${materialId}#${page}|${actor}" 提取课件/黑板 ID */
function matIdFromHistoryKey(hKey) {
  const inkKey = inkKeyFromHistoryKey(hKey);
  const hash = inkKey.lastIndexOf('#');
  return hash >= 0 ? inkKey.slice(0, hash) : inkKey;
}

/** 收集当前存档中仍然处于打开/活跃状态的全部课件与黑板 ID */
function collectActiveMaterialIds(ws) {
  const ids = new Set(['board']);
  const shared = ws?.shared;
  const local = ws?.local;
  if (shared?.pgmMat?.id) ids.add(String(shared.pgmMat.id));
  if (Array.isArray(shared?.desk)) {
    for (const w of shared.desk) {
      if (w?.id) ids.add(String(w.id));
      if (w?.mat?.id) ids.add(String(w.mat.id));
    }
  }
  if (local?.reader?.mat?.id) ids.add(String(local.reader.mat.id));
  if (local?.reader?.split?.id) ids.add(String(local.reader.split.id));
  if (local?.pvw?.mat?.id) ids.add(String(local.pvw.mat.id));
  return ids;
}

/**
 * 对 workspace 对象中的 history 执行无损瘦身（不修改 shared.ink）。
 * @returns {{history: Record<string, any>, removedKeys: number, trimmedSteps: number}}
 */
function trimWorkspaceHistory(ws, {
  maxUndo = MAX_ACTIVE_UNDO,
  maxRedo = MAX_ACTIVE_REDO,
  maxInactiveKeys = MAX_INACTIVE_KEYS,
  maxInactiveUndo = MAX_INACTIVE_UNDO,
  maxInactiveRedo = MAX_INACTIVE_REDO,
} = {}) {
  const rawHistory = ws?.history;
  if (!rawHistory || typeof rawHistory !== 'object' || Array.isArray(rawHistory)) {
    return { history: {}, removedKeys: 0, trimmedSteps: 0 };
  }
  const activeIds = collectActiveMaterialIds(ws);
  const sharedInk = ws?.shared?.ink && typeof ws.shared.ink === 'object' ? ws.shared.ink : {};
  const nextHistory = {};
  const inactiveCandidates = [];
  let removedKeys = 0;
  let trimmedSteps = 0;

  for (const [k, h] of Object.entries(rawHistory)) {
    if (!h || typeof h !== 'object') { removedKeys++; continue; }
    const undoArr = Array.isArray(h.undo) ? h.undo : [];
    const redoArr = Array.isArray(h.redo) ? h.redo : [];
    if (!undoArr.length && !redoArr.length) {
      removedKeys++;
      continue;
    }
    const inkK = inkKeyFromHistoryKey(k);
    const matId = matIdFromHistoryKey(k);
    if (activeIds.has(matId)) {
      const undo = undoArr.length > maxUndo ? undoArr.slice(-maxUndo) : undoArr;
      const redo = redoArr.length > maxRedo ? redoArr.slice(-maxRedo) : redoArr;
      if (undo.length !== undoArr.length) trimmedSteps += undoArr.length - undo.length;
      if (redo.length !== redoArr.length) trimmedSteps += redoArr.length - redo.length;
      nextHistory[k] = (undo === undoArr && redo === redoArr) ? h : { undo, redo };
      continue;
    }
    // 非活跃页面：若该页在 shared.ink 中已无任何笔迹（孤儿僵尸撤销栈），直接清理
    const pageStrokes = sharedInk[inkK];
    if (!Array.isArray(pageStrokes) || pageStrokes.length === 0) {
      removedKeys++;
      continue;
    }
    inactiveCandidates.push([k, h, undoArr, redoArr]);
  }

  // 仅保留最近最多 maxInactiveKeys 个有笔迹的非活跃页面，其余陈年历史撤销栈清理
  const dropCount = Math.max(0, inactiveCandidates.length - maxInactiveKeys);
  removedKeys += dropCount;
  for (const [k, h, undoArr, redoArr] of inactiveCandidates.slice(dropCount)) {
    const undo = undoArr.length > maxInactiveUndo ? undoArr.slice(-maxInactiveUndo) : undoArr;
    const redo = redoArr.length > maxInactiveRedo ? redoArr.slice(-maxInactiveRedo) : redoArr;
    const candidate = (undo === undoArr && redo === redoArr) ? h : { undo, redo };
    // 防御单步含巨型图元的异常旧页撑大存档
    if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_INACTIVE_ENTRY_BYTES) {
      removedKeys++;
      continue;
    }
    if (undo.length !== undoArr.length) trimmedSteps += undoArr.length - undo.length;
    if (redo.length !== redoArr.length) trimmedSteps += redoArr.length - redo.length;
    nextHistory[k] = candidate;
  }

  return { history: nextHistory, removedKeys, trimmedSteps };
}

module.exports = {
  MAX_ACTIVE_UNDO,
  MAX_ACTIVE_REDO,
  MAX_INACTIVE_KEYS,
  MAX_INACTIVE_UNDO,
  inkKeyFromHistoryKey,
  matIdFromHistoryKey,
  collectActiveMaterialIds,
  trimWorkspaceHistory,
};
