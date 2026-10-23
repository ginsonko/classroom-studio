// 1.4.0 布局修复的纯逻辑测试：窗口放进屏幕（winfit.cjs）+ 浮层 / 学生工具条自动缩小（ui/fit.ts）
// 用法：npx tsx test/v140-layout-logic.ts
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require_ = createRequire(import.meta.url);
const { createSize, fitRect, minSize } = require_('../electron/winfit.cjs') as {
  createSize: (role: string, wa: Rect) => Rect & { minWidth: number; minHeight: number };
  fitRect: (rect: Rect, wa: Rect, role: string, force?: boolean) => Rect | null;
  minSize: (role: string, wa: Rect) => [number, number] | null;
};
import { fitZoom, barRoom } from '../src/ui/fit';

type Rect = { x: number; y: number; width: number; height: number };
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };

const BIG: Rect = { x: 0, y: 0, width: 1920, height: 1040 };      // 1080p 工作区（有任务栏）
const SMALL: Rect = { x: 0, y: 0, width: 1093, height: 574 };     // 1366×768 @125%
const SECOND: Rect = { x: 1920, y: 0, width: 1280, height: 720 }; // 已拔掉的第二块显示器

ok('普通屏幕：默认尺寸和最小尺寸原样', () => {
  assert.deepEqual(createSize('teacher', BIG), { width: 1600, height: 960, minWidth: 1050, minHeight: 640 });
  assert.deepEqual(createSize('student', BIG), { width: 1280, height: 760, minWidth: 640, minHeight: 400 });
});
ok('小屏笔记本：默认尺寸和最小尺寸都收进工作区', () => {
  assert.deepEqual(createSize('teacher', SMALL), { width: 1093, height: 574, minWidth: 1050, minHeight: 574 });
  assert.deepEqual(createSize('student', SMALL), { width: 1093, height: 574, minWidth: 640, minHeight: 400 });
  assert.deepEqual(minSize('teacher', SMALL), [1050, 574]);
});
ok('窗口在工作区里：不动（返回 null）', () => {
  assert.equal(fitRect({ x: 100, y: 100, width: 1200, height: 800 }, BIG, 'teacher'), null);
});
ok('窗口拖出屏幕右边：拉回屏幕里', () => {
  const r = fitRect({ x: 1800, y: 100, width: 1200, height: 800 }, BIG, 'teacher')!;
  assert.equal(r.x, 1920 - 1200);
  assert.equal(r.y, 100);
});
ok('窗口整个留在已拔掉的显示器上：拉回主屏', () => {
  const r = fitRect({ x: 2000, y: 100, width: 1200, height: 800 }, BIG, 'teacher')!;
  assert.equal(r.x + r.width <= BIG.width, true);
  assert.equal(r.y, 100);
});
ok('窗口比工作区还大：收到工作区大小', () => {
  const r = fitRect({ x: -50, y: -20, width: 1600, height: 960 }, SMALL, 'teacher')!;
  assert.deepEqual(r, { x: 0, y: 0, width: 1093, height: 574 });
});
ok('标题栏看不见（顶到屏幕上方）：拉回', () => {
  const r = fitRect({ x: 100, y: -400, width: 1200, height: 800 }, BIG, 'teacher')!;
  assert.equal(r.y, 0);
});
ok('恢复默认：默认尺寸、居中', () => {
  const r = fitRect({ x: 5, y: 5, width: 900, height: 500 }, BIG, 'teacher', true)!;
  assert.deepEqual(r, { x: 160, y: 40, width: 1600, height: 960 });
  const s = fitRect({ x: 0, y: 0, width: 1093, height: 574 }, SMALL, 'student', true)!;
  assert.deepEqual(s, { x: 0, y: 0, width: 1093, height: 574 });
});
ok('未知角色：不动', () => {
  assert.equal(fitRect({ x: -999, y: -999, width: 300, height: 200 }, BIG, 'recorder'), null);
});

ok('浮层：放得下就用老师选的大小', () => {
  assert.equal(fitZoom(1.4, 1.4, 700, 1000), 1.4);
});
ok('浮层：140% 比屏幕高 → 自动缩到放得下（老师反馈的情形）', () => {
  // 100% 时高 600，空间只有 620：140%（840）放不下 → 缩到 1.0
  assert.equal(fitZoom(1.4, 1.4, 840, 620), 1);
});
ok('浮层：差一点放得下 → 按 0.05 一档缩，且不低于 50%', () => {
  assert.equal(fitZoom(1.4, 1.4, 840, 648), 1.05); // 648/600=1.08 → 1.05
  assert.equal(fitZoom(1.4, 1.4, 840, 200), 0.5);
});
ok('浮层：空间变大后恢复老师选的 140%', () => {
  // 正在用 1.0（高 600），空间 1000 → 1.4
  assert.equal(fitZoom(1.4, 1.0, 600, 1000), 1.4);
});
ok('浮层：还没有空间信息或没量到高度时不动', () => {
  assert.equal(fitZoom(1.4, 1.4, 840, 0), 1.4);
  assert.equal(fitZoom(1.4, 1.4, 0, 620), 1.4);
});
ok('学生工具条：朝右展开时用右边剩下的宽度', () => {
  assert.equal(barRoom(1280, 100, 22, false), 1280 - 100 - 22 - 8 - 8);
  assert.equal(barRoom(1280, 1000, 22, true), 1000 - 22 - 8 - 8);
});
ok('学生工具条：再窄也留 120px 下限', () => {
  assert.equal(barRoom(300, 290, 22, false), 120);
});

console.log(`RESULT ${n}/${n} pass`);
