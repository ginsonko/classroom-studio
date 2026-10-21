// 1.2.1 长黑板：新建、位置限制、滚动、自动加长（下面始终留一屏空白，最长 20 屏）、屏数显示
import assert from 'node:assert/strict';
import { MAX_SCREENS, SCREEN, atEnd, clampY, grownFor, isLong, longMaterial, longRatio, screenLabel, scrollView } from '../src/lib/longBoard';
import type { Material, View } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-3, `${what}: ${a} ≠ ${b}`);
const view = (y: number): View => ({ materialId: 'x', page: 0, slide: 0, fit: 'page', zoom: 1, y });

ok('新建：一页、三屏高、宽 1600、标题带编号', () => {
  const m = longMaterial(1), m2 = longMaterial(2);
  assert.equal(m.kind, 'board'); assert.equal(m.long, true); assert.equal(m.pages.length, 1); assert.equal(m.total, 1);
  assert.equal(m.pages[0].w, 1600); near(longRatio(m), SCREEN * 3, '高度');
  assert.equal(m.title, '长黑板'); assert.equal(m2.title, '长黑板 2');
  assert.ok(m.id.startsWith('board-long-'));
  assert.ok(isLong(m)); assert.ok(!isLong({ ...m, long: undefined })); assert.ok(!isLong({ ...m, kind: 'pdf' } as Material)); assert.ok(!isLong(null));
});

ok('位置限制在页面里：最上 0，最下露出最后一屏', () => {
  const m = longMaterial(1);
  assert.equal(clampY(m, -1), 0); near(clampY(m, 99), SCREEN * 2, '到底'); near(clampY(m, .3), .3, '中间');
  assert.equal(clampY(m, NaN), 0);
});

ok('滚动：只改 y，翻页 / 放大状态清掉', () => {
  const m = longMaterial(1);
  const v = scrollView(m, { ...view(.2), page: 3, fit: 'region', region: [0, 0, .5, .5] }, SCREEN / 2);
  near(v.y!, .2 + SCREEN / 2, 'y'); assert.equal(v.page, 0); assert.equal(v.fit, 'page'); assert.equal(v.region, undefined);
  assert.equal(scrollView(m, view(0), -1).y, 0);
  near(scrollView(m, view(0), 99).y!, SCREEN * 2, '滚过头停在底');
});

ok('自动加长：离底不到一屏空白才加，按整屏加', () => {
  const m = longMaterial(1);
  assert.equal(grownFor(m, 0), null, '在顶上不加');
  assert.equal(grownFor(m, SCREEN), null, '下面正好还有一屏空白');
  const g = grownFor(m, SCREEN * 1.5)!;
  assert.ok(g); near(longRatio(g), SCREEN * 4, '加到四屏'); assert.equal(g.pages[0].w, 1600); assert.equal(g.id, m.id);
  const g2 = grownFor(m, SCREEN * 2)!; near(longRatio(g2), SCREEN * 4, '到底也是加一屏');
});

ok('一直往下滚：每次到底都加长，最多 20 屏', () => {
  let m = longMaterial(1), v = view(0), steps = 0;
  while (steps++ < 200) {
    v = scrollView(m, v, SCREEN / 2);
    const g = grownFor(m, v.y!); if (g) m = g;
  }
  near(longRatio(m), SCREEN * MAX_SCREENS, '最长');
  near(v.y!, SCREEN * (MAX_SCREENS - 1), '停在最后一屏');
  assert.equal(grownFor(m, v.y!), null, '到上限不再加');
  assert.ok(atEnd(m, v)); assert.ok(!atEnd(m, view(0))); assert.ok(!atEnd(longMaterial(1), view(SCREEN * 2)), '没到上限不算到头');
});

ok('屏数显示：画面中线所在那一屏 / 共几屏', () => {
  const m = longMaterial(1);
  assert.equal(screenLabel(m, view(0)), '1 / 3 屏');
  assert.equal(screenLabel(m, view(SCREEN * .49)), '1 / 3 屏');
  assert.equal(screenLabel(m, view(SCREEN * .51)), '2 / 3 屏');
  assert.equal(screenLabel(m, view(SCREEN * 2)), '3 / 3 屏');
  assert.equal(screenLabel(grownFor(m, SCREEN * 2)!, view(SCREEN * 2)), '3 / 4 屏');
});

ok('老存档里高度不对的页面也能用', () => {
  const m = { ...longMaterial(1), pages: [{ w: 0, h: 0 }] };
  near(longRatio(m), SCREEN * 3, '缺省三屏');
});

console.log(`v121-long-logic: ${n} PASS`);
