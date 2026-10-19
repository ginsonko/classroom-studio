// 0.9.2 纯逻辑：AI 工作室写的题库 JSON → 待导入的题。
// 用法：npx tsx test/v092-logic.ts
import assert from 'node:assert/strict';
import { parseBank } from '../src/lib/agentBankLogic';
import { packOf } from '../src/lib/subjects';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

ok('按技能约定的格式读题：题型、难度、自检标记', () => {
  const d = parseBank({ version: 1, questions: [
    { stem: '质量为 $2\\,\\mathrm{kg}$ 的物块静止在倾角 $30^\\circ$ 的斜面上，求摩擦力。', answer: '10 N', analysis: '沿斜面平衡', qtype: '计算', difficulty: 2, verified: true },
    { stem: '下列说法正确的是\nA. 1\nB. 2', answer: 'B', qtype: '选择', difficulty: 9 },
  ] }, 'physics');
  assert.equal(d.length, 2);
  assert.deepEqual([d[0].qtype, d[0].difficulty, d[0].verified], ['计算', 2, true]);
  assert.equal(d[1].difficulty, 3, '超出 1～5 的难度按中档');
  assert.equal(d[1].verified, false, '没写 verified 就当没自检');
  assert.ok(d[0].stem.includes('\\mathrm'), '公式里的反斜杠原样保留');
});

ok('题型不在本学科清单里时按题干猜；空题和太短的题跳过；顶层直接是数组也行', () => {
  const d = parseBank([{ stem: '用一句话概括本文的中心思想。', qtype: '主观题' }, { stem: '' }, { stem: 'ab' }, null], 'j-chinese');
  assert.equal(d.length, 1);
  assert.ok(packOf('j-chinese').qtypes.includes(d[0].qtype), d[0].qtype);
});

ok('没有 questions 列表时给出明确错误', () => {
  assert.throws(() => parseBank({ items: [] }, 'physics'), /questions/);
  assert.throws(() => parseBank(null, 'physics'), /questions/);
});

ok('最多读 200 题，超长字段截断', () => {
  const many = Array.from({ length: 260 }, (_, i) => ({ stem: `第 ${i} 题：计算 ${i} + 1 等于多少？`, answer: 'x'.repeat(5000) }));
  const d = parseBank({ questions: many }, 'p-math');
  assert.equal(d.length, 200);
  assert.equal(d[0].answer.length, 2000);
});

console.log(`v092-logic: ${n} pass`);
