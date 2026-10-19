// AI 演示智能体的离线验收（假模型）：npx rolldown test/demo-agent.ts -o .out/demo-agent.mjs -p node && node .out/demo-agent.mjs
import assert from 'node:assert/strict';
import { demoAgent, type AgentChat, type AgentMsg } from '../src/lib/aiDemo';
import { presetSceneTool, validateSceneJSON } from '../src/physics/sim/aiSchema';
import { trial } from '../src/physics/sim/preview';

let n = 0;
const ok = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log('ok', name); };

/** 按顺序回放脚本里的回复，并记录模型每次看到的对话 */
function scripted(replies: (string | ((msgs: AgentMsg[]) => string))[]) {
  const seen: AgentMsg[][] = [];
  const flags: boolean[] = [];
  let i = 0;
  const chat: AgentChat = async (msgs, o) => {
    seen.push(msgs.map((m) => ({ ...m })));
    flags.push(o.images);
    const r = replies[Math.min(i++, replies.length - 1)];
    return { content: typeof r === 'function' ? r(msgs) : r, model: 'fake', ms: 10 };
  };
  return { chat, seen, flags, calls: () => i };
}
const text = (m: AgentMsg) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '[img]')).join('\n'));
const lastUser = (msgs: AgentMsg[]) => text([...msgs].reverse().find((m) => m.role === 'user')!);

const ground = { id: 'g', kind: 'ground', x: 0.5, y: 0.5, w: 1, h: 0.02, props: { fixed: true } };
const cart = (vx: number) => ({ id: 'A', kind: 'block', x: 0.15, y: 0.47, w: 0.06, h: 0.04, label: 'A', props: { m: 1, vx, mu: 0 } });
const plan = (vx: number) => JSON.stringify({ understand: '小车在光滑水平面上匀速运动', expect: '小车 A 向右匀速运动', plan: { preset: 'none', title: '匀速小车', world: { g: 10, ppm: 0.1 }, duration: 4, objs: [ground, cart(vx)] } });

// 微观粒子：质子 v=1e6 m/s 垂直射入 B=0.1 T，R = mv/(qB) ≈ 0.104 m，T = 2πm/(qB) ≈ 6.6e-7 s
const proton = { preset: 'none', title: '质子在磁场中偏转', world: { g: 0, ppm: 2 }, duration: 8, params: { timeScale: 1e-7, substeps: 8 }, objs: [
  { id: 'F', kind: 'field-b-in', x: 0.5, y: 0.28, w: 1, h: 0.56, props: { B: 0.1 } },
  { id: 'p', kind: 'charge-pos', x: 0.5, y: 0.45, w: 0.02, h: 0.02, label: 'p', props: { q: 1.6e-19, m: 1.67e-27, vx: 1e6 } },
] };

async function main() {
  await ok('静止方案被发现 → 模型修正 → 确认', async () => {
    const f = scripted([plan(0), plan(2), '{"accept":true,"why":"小车向右匀速"}']);
    const live: string[] = [];
    const r = await demoAgent('光滑水平面上小车以 2 m/s 匀速运动', undefined, f.chat, (t) => live.push(t));
    assert.equal(r.accepted, true);
    assert.equal(r.calls, 3);
    assert.ok(r.best && r.best.trial.ok && r.best.round === 2, 'best should be the moving 2nd plan');
    // 第 1 次试播的摘要里必须告诉模型「静止」
    const report1 = lastUser(f.seen[1]);
    assert.match(report1, /静止检查不通过|几乎不动|没有/);
    assert.match(report1, /第 1 版/);
    const report2 = lastUser(f.seen[2]);
    assert.match(report2, /初速度 2 m\/s/);
    assert.deepEqual(r.steps, live, 'onStep mirrors steps');
    assert.ok(r.steps.some((s) => s.includes('试播发现问题')));
    assert.ok(f.flags.every((x) => x === false), 'no image → text model');
  });

  await ok('静止方案不能被确认', async () => {
    const f = scripted([plan(0), '{"accept":true}', plan(1.5), '{"accept":true}']);
    const r = await demoAgent('小车', undefined, f.chat);
    assert.match(lastUser(f.seen[2]), /不能确认/);
    assert.equal(r.accepted, true);
    assert.equal(r.best!.round, 2);
  });

  await ok('preset_scene 工具：取模板器材再改成自由场景', async () => {
    const f = scripted([
      '{"tool":"preset_scene","preset":"magnetic","params":{"B":0.5}}',
      (msgs) => {
        const t = lastUser(msgs);
        const j = JSON.parse(t.slice(t.indexOf('{')));
        assert.equal(j.preset, 'none');
        assert.ok(j.objs.some((o: { kind: string }) => o.kind === 'field-b-in'));
        return JSON.stringify({ understand: '粒子在磁场中偏转', expect: '粒子做圆周运动后离开磁场', plan: j });
      },
      '{"accept":true}',
    ]);
    const r = await demoAgent('带电粒子垂直射入匀强磁场', undefined, f.chat);
    assert.ok(r.steps.some((s) => s.includes('查看模板')));
    assert.equal(r.accepted, true, r.steps.join(' | '));
    assert.ok(r.best!.trial.ok, r.best!.trial.text);
  });

  await ok('微观粒子：真实 SI 数值 + timeScale 能校验并且会动', async () => {
    const v = validateSceneJSON(proton);
    assert.ok(v.ok, v.issues.join(';'));
    assert.equal(v.scene!.objs[1].props.vx, 1e6);
    assert.equal(v.scene!.params!.timeScale, 1e-7);
    const t = trial(v.scene!);
    assert.ok(t.ok, t.text);
    assert.match(t.text, /真实/);
    // 半个周期后粒子应在起点正上方约 2R ≈ 0.21 m 处（正电荷、磁场向里、向右射入 → 向上偏）
    assert.match(t.text, /竖直范围/);
  });

  await ok('校验不通过时把问题发回模型；格式错误重来；最多 5 次调用', async () => {
    const f = scripted(['我不会', '{"plan":{"preset":"rocket"}}', '{"plan":{"preset":"rocket"}}', '{"plan":{"preset":"rocket"}}', '{"plan":{"preset":"rocket"}}', plan(2)]);
    const r = await demoAgent('题目', undefined, f.chat);
    assert.equal(r.best, null);
    assert.ok(f.calls() <= 5, 'calls ' + f.calls());
    assert.match(lastUser(f.seen[1]), /JSON/);
    assert.match(lastUser(f.seen[2]), /没通过导播台的校验/);
    assert.ok(r.issues.some((x) => x.includes('rocket')));
  });

  await ok('题目截图发给视觉模型；没确认时仍给出会动的那一版', async () => {
    const img = 'data:image/png;base64,AAAA';
    const f = scripted([plan(2), plan(3), plan(4), plan(5), plan(6)]);
    const r = await demoAgent('', img, f.chat);
    const first = f.seen[0][1];
    assert.ok(Array.isArray(first.content) && first.content.some((p) => p.type === 'image_url' && p.image_url.url === img));
    assert.ok(f.flags[0]);
    assert.equal(r.accepted, false);
    assert.ok(r.best && r.best.trial.ok);
    assert.ok(r.best!.round <= 3, 'at most 3 plans run');
  });

  await ok('preset_scene 未知模板给出可用列表', () => {
    assert.match(presetSceneTool('nope', {}), /可用/);
  });

  console.log(`\n${n} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
