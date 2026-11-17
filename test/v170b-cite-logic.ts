import { parseBank, parseCite, citeText } from '../src/lib/agentBankLogic';
import assert from 'node:assert/strict';
const d = parseBank({ questions: [{ stem: '电梯题目一二三', answer: 'C', source: { kind: '真题', title: '2024 顺义期末', no: '第 11 题', year: 2024, url: 'https://x', check: { status: 'verified' } } }, { stem: '原创题目四五六', answer: '1', source: { kind: '原创' } }, { stem: '没核对的改编', answer: '2', source: { kind: '改编', title: '改编自 x' } }] }, 'physics' as never);
assert.equal(d[0].cite?.label, '来源已核对'); assert.equal(d[0].cite?.year, '2024');
assert.equal(d[1].cite?.kind, '原创'); assert.equal(d[2].cite?.label, '来源未核实');
assert.match(citeText(d[0].cite!), /真题 · 2024 顺义期末 第 11 题 · 来源已核对/);
assert.equal(parseCite(undefined), undefined);
console.log('cite logic ok');
