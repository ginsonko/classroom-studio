// 课堂动画：部件目录和引擎一致、校验能改的自动改、改不了的交回 AI、智能体的「校验 → 试渲染 → 审片」循环。
// 用法：npx tsx test/v120-motion-logic.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PARTS, TYPES_2D, TYPES_3D } from '../src/motion/catalog';
import { checkFilm, summarizeFilm, textWidth, toHex } from '../src/motion/check';
import { MOTION_SYSTEM, motionFirst, motionReview } from '../src/motion/skill';
import { SHOWCASE } from '../src/motion/showcase';
import { motionAgent } from '../src/motion/agent';
import { MOLECULE_NAMES } from '../src/scene3d/data';
import type { AgentMsg } from '../src/lib/aiDemo';

let n = 0;
const ok = (name: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { n++; console.log('ok ' + name); });
const reg = (file: string, name: string) => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/motion', file), 'utf8');
  const m = src.match(new RegExp(`export const ${name}[^{]*\\{([^}]*)\\}`));
  return m![1].split(',').map((s) => s.trim()).filter(Boolean).sort();
};
const film = (shots: unknown[]) => ({ title: 't', shots });

(async () => {
  await ok('目录和引擎的部件名单一致', () => {
    assert.deepEqual([...TYPES_2D].sort(), reg('draw2d.ts', 'PARTS_2D'));
    assert.deepEqual([...TYPES_3D].sort(), reg('three3d.ts', 'PARTS_3D'));
    assert.equal(new Set(PARTS.map((p) => p.type)).size, PARTS.length);
  });

  await ok('提示词包含全部部件、分子、样片示例', () => {
    for (const p of PARTS) assert.ok(MOTION_SYSTEM.includes(`- ${p.type}（`), p.type);
    assert.ok(MOTION_SYSTEM.includes(MOLECULE_NAMES()[0]));
    assert.ok(MOTION_SYSTEM.includes('开普勒第二定律'));
    assert.match(motionFirst('光的折射', '高中物理', true), /附图/);
    assert.match(motionReview(2, 'x', ['a'], ['b'], true), /附图[\s\S]*自动做的调整[\s\S]*没画出来/);
  });

  await ok('每个部件的示例都能通过校验', () => {
    for (const p of PARTS) {
      const r = checkFilm(film([{ dur: 6, items: [p.example] }]));
      assert.deepEqual(r.errors, [], p.type + ': ' + r.errors.join('；'));
    }
  });

  await ok('样片规格本身通过校验，且不需要改动', () => {
    const r = checkFilm(SHOWCASE);
    assert.ok(r.ok, r.errors.join('；'));
    assert.deepEqual(r.fixes, []);
    assert.equal(r.spec!.shots.length, SHOWCASE.shots.length);
    assert.match(summarizeFilm(r.spec!), /^1\. 0\.0~6\.5s「开场」/);
  });

  await ok('颜色写法统一成 #hex', () => {
    assert.equal(toHex('#ABC'), '#abc'); assert.equal(toHex('#11223344'), '#112233');
    assert.equal(toHex('rgb(255, 0, 16)'), '#ff0010'); assert.equal(toHex('red'), '#ff5d5d'); assert.equal(toHex('红色'), '#ff5d5d');
    assert.equal(toHex('hsl(1,2%,3%)'), null);
    const r = checkFilm(film([{ dur: 5, tint: 'blue', items: [{ type: 'text', text: '你好', color: 'yellow' }, { type: 'shape', kind: 'circle', color: 'nope' }] }]));
    assert.ok(r.ok); assert.equal(r.spec!.shots[0].tint, '#4c9dff'); assert.equal(r.spec!.shots[0].items[0].color, '#ffd166');
    assert.equal(r.spec!.shots[0].items[1].color, undefined); assert.ok(r.fixes.some((f) => f.includes('nope')));
  });

  await ok('能自动改的：时长、出场时间、字幕重叠、字太大', () => {
    const long = '这是一句非常非常长的字幕，长到一行根本放不下，所以要缩小字号才能完整显示出来，再多写几个字让它确实超出屏幕的宽度范围';
    const r = checkFilm(film([{ dur: 60, items: [
      { type: 'caption', text: '第一条' }, { type: 'caption', at: 3, text: long }, { type: 'text', text: '标题', at: 99 },
    ] }]));
    assert.ok(r.ok, r.errors.join());
    const s = r.spec!.shots[0];
    assert.equal(s.dur, 20);
    assert.equal(s.items[0].dur, 2.85);
    assert.ok((s.items[1].size as number) < 38 && textWidth(long, s.items[1].size as number) <= 1700);
    assert.equal(s.items[2].at, 19);
    assert.ok(r.fixes.length >= 4, r.fixes.join('\n'));
  });

  await ok('改不了的交回 AI：部件名、表达式、原子不守恒、粒子字太长、坐标缺失', () => {
    const r = checkFilm(film([{ dur: 6, items: [
      { type: 'laser' },
      { type: 'plot', fns: [{ expr: 'sin(' }] },
      { type: 'surface', f: 'x*q' },
      { type: 'reaction', from: [['H', 0, 0, 0], ['O', 1, 0, 0]], to: [['O', 0, 0, 0], ['H', 1, 0, 0]] },
      { type: 'particleText', text: '这是一行超过十四个字的粒子文字会糊成一片' },
      { type: 'label', text: '无处安放' },
      { type: 'molecule', name: '不存在的分子' },
      { type: 'shape', kind: 'arrow', points: [[1, 2]] },
    ] }]));
    assert.equal(r.ok, false);
    const all = r.errors.join('\n');
    for (const k of ['laser', 'sin(', 'x*q', '原子守恒', '太长', 'anchor', '不存在的分子', 'arrow 需要 points']) assert.ok(all.includes(k), k + '\n' + all);
    assert.equal(r.spec!.shots[0].items.length, 0);
    assert.deepEqual(checkFilm({ shots: [] }).errors, ['没有 shots（镜头列表）']);
    assert.match(checkFilm(film(Array.from({ length: 12 }, () => ({ dur: 15, items: [{ type: 'stars' }] })))).errors.join(), /太长（180 秒）/);
  });

  await ok('智能体：校验失败 → 修正 → 试渲染 → 审片通过', async () => {
    const good = { understand: '讲光的折射', plan: '两个镜头', film: { title: '光的折射', shots: [
      { name: '开场', dur: 5, bg: 'deep', items: [{ type: 'title', text: '光的折射' }] },
      { name: '光路', dur: 8, bg: 'blueprint', items: [{ type: 'shape', kind: 'line', points: [[960, 160], [960, 900]], dash: true }, { type: 'tracer', points: [[500, 300], [960, 540], [1200, 900]] }, { type: 'caption', text: '折射光线偏向法线' }] },
    ] } };
    const bad = { ...good, film: { ...good.film, shots: [{ ...good.film.shots[0], items: [{ type: 'laser' }] }] } };
    const replies = [JSON.stringify(bad), '```json\n' + JSON.stringify({ ...good, fix: '去掉不存在的部件' }) + '\n```', '{"accept": true, "why": "画面清楚"}'];
    const seen: AgentMsg[][] = [];
    const steps: string[] = [];
    const r = await motionAgent('光的折射', [], '高中物理', async (msgs) => { seen.push(msgs.map((m) => ({ ...m }))); return { content: replies.shift()!, model: 'fake', ms: 10 }; }, (t) => steps.push(t));
    assert.equal(r.accepted, true); assert.equal(r.calls, 3); assert.equal(r.best!.spec.title, '光的折射'); assert.equal(r.best!.round, 2);
    assert.ok(steps.some((s) => s.includes('没通过校验')) && steps.some((s) => s.includes('AI 修改：去掉不存在的部件')) && steps.some((s) => s.includes('审片通过')), steps.join('\n'));
    const fixMsg = seen[1].at(-1)!.content as string;
    assert.match(fixMsg, /laser/);
    // node 里没有 WebGL：试渲染失败时只发文字摘要，不带图
    const review = seen[2].at(-1)!.content as { type: string; text?: string }[];
    assert.ok(Array.isArray(review) && review.every((p) => p.type === 'text') && /「光路」/.test(review[0].text!));
  });

  await ok('智能体：取消后立即停止', async () => {
    const sig = { cancelled: false };
    await assert.rejects(motionAgent('x', [], '物理', async () => { sig.cancelled = true; return { content: '{}', model: 'f', ms: 1 }; }, () => {}, sig), /已取消/);
  });

  await ok('智能体：一版都没过校验时，去掉坏部件仍给出可放的版本', async () => {
    const half = { film: { title: '半成品', shots: [{ dur: 5, items: [{ type: 'title', text: '能放' }, { type: 'laser' }] }] } };
    const r = await motionAgent('x', [], '物理', async () => ({ content: JSON.stringify(half), model: 'f', ms: 1 }), () => {});
    assert.equal(r.accepted, false); assert.equal(r.best!.spec.shots[0].items.length, 1); assert.ok(r.issues.some((x) => x.includes('laser')));
  });

  console.log(`RESULT v120-motion-logic ${n}/${n}`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
