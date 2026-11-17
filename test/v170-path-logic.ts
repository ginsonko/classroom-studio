// 1.7.0 第 1 项：mac 路径 %20 / file:// / ~、对话里的 json 文件、AI 报错翻译、默认模型不落到 gpt-6.1-sol
import assert from 'node:assert/strict';
import { baseName, cleanPath, shownPath } from '../src/lib/pathText';
import { filePathsIn } from '../src/teacher/TexText';
import { agentProbeText, explainAiError } from '../src/lib/aiErrors';
import { pickDefaultModel } from '../src/lib/models';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const MAC = '/Users/mima0000/Library/Application%20Support/ClassroomStudioData/assistant/workspace/2026北京海淀高三上期中物理-试卷分析.docx';

ok('cleanPath 去掉 file:// 并解码；普通路径原样保留 %20 交给主进程', () => {
  assert.equal(cleanPath('file:///Users/a/Application%20Support/x.docx'), '/Users/a/Application Support/x.docx');
  assert.equal(cleanPath('file:///C:/Users/x/%E6%95%99%E6%A1%88.pdf'), 'C:/Users/x/教案.pdf');
  assert.equal(cleanPath('file://localhost/Users/a/b.pdf'), '/Users/a/b.pdf');
  assert.equal(cleanPath('<C:\\x\\y.docx>'), 'C:/x/y.docx');
  assert.equal(cleanPath('"/Users/a/b c.pdf"'), '/Users/a/b c.pdf');
  assert.equal(cleanPath(MAC), MAC);
});
ok('显示名解码（截图 3 的文件名不再带 %20）', () => {
  assert.equal(baseName(MAC), '2026北京海淀高三上期中物理-试卷分析.docx');
  assert.match(shownPath(MAC), /Application Support/);
  assert.equal(baseName('C:/a/100%.txt'), '100%.txt');
});
ok('回复里的 Markdown 链接、file:// 网址、带空格的 mac 路径都认成文件', () => {
  assert.deepEqual(filePathsIn(`[下载试卷分析文档](${MAC})`), [MAC]);
  assert.deepEqual(filePathsIn('[教案](file:///Users/a/Application%20Support/w/教案.pdf)'), ['/Users/a/Application Support/w/教案.pdf']);
  assert.deepEqual(filePathsIn('[教案](</Users/a/Application Support/w/教案.pdf>)'), ['/Users/a/Application Support/w/教案.pdf']);
  assert.deepEqual(filePathsIn('写好了 file:///C:/work/讲义.pdf 请查看'), ['C:/work/讲义.pdf']);
  assert.deepEqual(filePathsIn('[练习](~/Desktop/练习.pdf)'), ['~/Desktop/练习.pdf']);
  assert.deepEqual(filePathsIn('见 https://x.com/Users/a.pdf'), []);
  assert.deepEqual(filePathsIn('H:\\资料\\海淀\\题库.json 和 /Users/a/b.md'), ['H:/资料/海淀/题库.json', '/Users/a/b.md']);
});
ok('截图 1 的 503 no eligible route 翻成人话 + 一键导入按钮', () => {
  const raw = 'unexpected status 503 Service Unavailable: smartrouter: no eligible automatic route（原因：当前参数下没有可计价线路；此 Key 的分组或线路设置未包含可用线路。', t = explainAiError(raw)!;
  assert.equal(t.action, 'import'); assert.match(t.text, /responses/); assert.match(t.label, /一键导入/);
  assert.equal(explainAiError('401 Unauthorized: invalid api key')!.action, 'import');
  assert.equal(explainAiError('insufficient_quota: 余额不足')!.action, 'recharge');
  assert.equal(explainAiError('model_not_found: gpt-x')!.action, 'settings');
  assert.equal(explainAiError('stream disconnected before completion: ECONNRESET')!.action, 'retry');
  assert.equal(explainAiError('写到第三题了'), null);
  assert.equal(explainAiError(''), null);
});
ok('连接测试：聊天通、responses 不通时明确说「能聊天但不能给小羽/AI 工坊干活」', () => {
  assert.equal(agentProbeText(null), '');
  assert.equal(agentProbeText({ ok: true, model: 'gpt-6-astra' }), '');
  const t = agentProbeText({ ok: false, model: 'gpt-6.1-sol', message: '这把 Key 的分组里没有这个模型能用的线路（服务返回：no eligible automatic route）' });
  assert.match(t, /能聊天、不能给小羽和 AI 工坊干活/); assert.match(t, /勾上对应分组|一键导入/);
});
ok('默认模型：推荐 gpt-6-astra；gpt-6.1-sol 只在别无选择时才选', () => {
  assert.equal(pickDefaultModel(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.4']), 'gpt-6-astra');
  assert.equal(pickDefaultModel(['gpt-6.1-sol', 'gpt-5.4', 'claude-sonnet-4']), 'gpt-5.4');
  assert.equal(pickDefaultModel(['gpt-6.1-sol', 'gpt-4o-mini']), 'gpt-6.1-sol');
});
console.log(`PASS ${n}/${n} v170-path-logic`);
