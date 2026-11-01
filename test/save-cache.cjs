// 存档按对象缓存 JSON：结果必须和 JSON.stringify 逐字相同，换了对象就用新内容，原地不改的对象才复用。
// 用法：node test/save-cache.cjs
const assert = require('node:assert/strict');
const core = require('../electron/core.cjs');
const workspaceJSON = (v) => core.workspaceJSON(v).toString('utf8');

const stroke = (id, n = 40) => ({ id, tool: 'pen', color: 'ink', size: 3, pts: Array.from({ length: n * 3 }, (_, i) => (i % 3 === 2 ? 0.5 : Math.sin(i + id.length) * 0.4 + 0.5)), author: 'teacher', layer: 'public' });
const page = (p, n) => Array.from({ length: n }, (_, i) => stroke(p + '-' + i));
const entry = (s) => ({ before: [], after: [s], beforeOrder: ['a', 'b'], afterOrder: ['a', 'b', s.id] });
const ws = {
  migrated030: true,
  shared: { pgm: { materialId: 'board', page: 0 }, boardSkin: 'chalk', curtain: null, spotlight: undefined, ink: { 'board#0': page('b', 30), 'doc#1': page('d', 5), 'empty#0': [] }, desk: [{ id: 'board', rect: [0, 0, 1, 1] }] },
  local: { students: [], fn: () => 1, notes: {} },
  history: { 'board#0|teacher': { undo: page('h', 3).map(entry), redo: [] }, odd: null },
  settings: { recordings: 'D:\\录课', bitrate: 3000000 },
  weird: [1, undefined, null, NaN, Infinity, 'x', () => 0],
  nothing: undefined,
};
assert.equal(workspaceJSON(ws), JSON.stringify(ws), '初次序列化');
// 同一批对象再存一次：结果不变
assert.equal(workspaceJSON(ws), JSON.stringify(ws), '缓存命中');
// 换掉一页（新数组、新笔迹）：新内容要出现
ws.shared.ink = { ...ws.shared.ink, 'board#0': [...ws.shared.ink['board#0'].slice(0, 10), stroke('new')] };
assert.equal(workspaceJSON(ws), JSON.stringify(ws), '换页后');
// 撤销记录就地 push / shift：每条记录是新对象，数组本身就地改
const h = ws.history['board#0|teacher'];
h.undo.push(entry(stroke('u1'))); h.undo.shift(); h.redo = [entry(stroke('r1'))];
assert.equal(workspaceJSON(ws), JSON.stringify(ws), '撤销记录变化后');
// 删掉一页、增加一页
delete ws.shared.ink['doc#1']; ws.shared.ink['doc#2'] = page('e', 2);
assert.equal(workspaceJSON(ws), JSON.stringify(ws), '增删页面后');
// 非常规形状（旧存档里可能出现）也要和 JSON.stringify 一致
for (const odd of [{}, { shared: null }, { shared: { ink: null } }, { shared: { ink: [] } }, { history: [] }, { history: { k: [] } }, { shared: { ink: { k: null, j: 'x' } } }])
  assert.equal(workspaceJSON(odd), JSON.stringify(odd), JSON.stringify(odd));

// 速度：2000 笔、2000 条撤销记录，第二次存盘应该远快于整份 JSON.stringify
const big = { shared: { ink: Object.fromEntries(Array.from({ length: 40 }, (_, p) => ['p' + p, page('p' + p, 50)])) }, history: Object.fromEntries(Array.from({ length: 40 }, (_, p) => ['p' + p + '|teacher', { undo: page('q' + p, 50).map(entry), redo: [] }])) };
const t0 = performance.now(); const plain = Buffer.from(JSON.stringify(big)); const t1 = performance.now();
core.workspaceJSON(big); const t2 = performance.now(); const again = core.workspaceJSON(big); const t3 = performance.now();
assert.ok(again.equals(plain), '缓存命中时内容一致');
console.log(`大小 ${(plain.length / 1e6).toFixed(1)} MB · JSON.stringify+编码 ${(t1 - t0).toFixed(0)} ms · 首次 ${(t2 - t1).toFixed(0)} ms · 缓存命中 ${(t3 - t2).toFixed(0)} ms`);
assert.ok(t3 - t2 < (t1 - t0) / 2, '缓存命中时应明显更快');
console.log('SAVE CACHE OK');
