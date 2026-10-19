// manim 讲解动画的纯逻辑：脚本安全检查、从模型回复取代码、提示词。用法：npx tsx test/manim-logic.ts
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { extractCode, fixScene, lintScript, manimPrompt, manimSystem, parseReview, reviewPrompt } from '../src/lib/manimText';

const { checkScript } = createRequire(import.meta.url)('../electron/manim.cjs') as { checkScript: (s: string) => string };
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const head = 'from manim import *\nimport numpy as np\nimport math\n\n';
const body = 'class Explain(Scene):\n    def construct(self):\n        t = Text("cos 和 os、open(x)", font="Microsoft YaHei")\n        self.play(Write(t))\n        self.wait(1)\n';

ok('正常脚本通过（字符串里的词不算，np.cos 不算 os）', () => {
  assert.equal(checkScript('\uFEFF' + head + body.replace(/\n/g, '\r\n')), head + body);
  assert.doesNotThrow(() => checkScript(head + body + '        x = np.cos(1) + math.sqrt(2)  # import os\n'));
  assert.doesNotThrow(() => checkScript(head + 'class Foo(VGroup):\n    def __init__(self):\n        super().__init__()\n' + body));
});

ok('挡住越界写法，并说清第几行', () => {
  const bad: [string, RegExp][] = [
    ['import os', /第 1 行导入了不允许的模块/],
    ['from subprocess import run', /导入了不允许的模块/],
    ['x = __import__("os")', /不允许的写法/],
    ['open("a.txt","w").write("x")', /文件读写或动态执行/],
    ['eval("1+1")', /文件读写或动态执行/],
    ['print(self.__class__.__bases__)', /双下划线属性/],
    ['img = ImageMobject("a.png")', /外部文件/],
    ['config.output_file = "x"', /修改渲染配置/],
  ];
  for (const [line, re] of bad) assert.throws(() => checkScript(line + '\n' + head + body), re, line);
  assert.throws(() => checkScript(head + 'class Other(Scene):\n    pass\n'), /没有 class Explain/);
  assert.throws(() => checkScript('  \n'), /脚本是空的/);
  assert.throws(() => checkScript(head + body + '#'.repeat(30001)), /脚本太长/);
});

ok('从模型回复里取出带 Explain 的代码块', () => {
  assert.equal(extractCode('说明\n```python\nprint(1)\n```\n然后\n```py\n' + head + body + '```'), head + body);
  assert.equal(extractCode('```\r\nfrom manim import *\r\n```'), 'from manim import *\n');
  assert.equal(extractCode(head + body), head + body, '没有代码块就整段当代码');
});

ok('模型把脚本包成 JSON、代码块没闭合、类名不对也能取出来', () => {
  const code = head + body;
  assert.equal(extractCode(JSON.stringify({ code })), code, '整段是 {"code": …}');
  assert.equal(extractCode('好的：\n' + JSON.stringify({ title: 'x', code })), code, '前面有说明文字的 JSON');
  assert.equal(extractCode('```json\n' + JSON.stringify({ code }) + '\n```'), code, 'json 代码块里包着脚本');
  assert.equal(extractCode('好的，脚本如下：\n```Python\n' + code), code, '代码块没闭合（被截断）');
  assert.equal(extractCode('下面是脚本\n' + code), code, '前面有说明文字、没有代码块');
  const renamed = extractCode('```python\n' + code.replace(/Explain/g, 'Projectile') + '```');
  assert.ok(/^class Explain\(Scene\)/m.test(renamed), '唯一的场景类改名为 Explain');
  const two = head + 'class A(Scene):\n    pass\nclass B(Scene):\n    pass\n';
  assert.equal(fixScene(two), two, '两个场景类不乱改');
});

ok('渲染前快速检查：公式里的中文、已删除的写法、没有 LaTeX', () => {
  const p = lintScript(head + 'class Explain(Scene):\n    def construct(self):\n        a = MathTex(r"F_{\\rm 向} = ma")\n        self.play(ShowCreation(a))\n', true);
  assert.equal(p.length, 2); assert.match(p[0], /第 7 行：MathTex 里有中文/); assert.match(p[1], /ShowCreation，改用 Create/);
  assert.deepEqual(lintScript(head + body + '        m = MathTex(r"v^2 = 2ax", font_size=40)\n', true), []);
  assert.match(lintScript(head + body + '        m = MathTex(r"x")\n', false)[0], /没有 LaTeX/);
});

ok('审片结果：带代码块、问题列表、坏 JSON', () => {
  assert.deepEqual(parseReview('```json\n{"ok": true, "problems": []}\n```'), { ok: true, problems: [] });
  assert.deepEqual(parseReview('{"ok": true, "problems": ["第2帧：重叠"]}'), { ok: false, problems: ['第2帧：重叠'] }, '有问题就不算 ok');
  assert.equal(parseReview('看起来不错'), null);
  assert.ok(manimSystem('physics').includes('不要 JSON') && reviewPrompt({ title: 't', problem: 'p', idea: '', steps: [], answer: '', pitfalls: [] } as never).includes('"problems"'));
});

ok('提示词带上讲解内容，并按有没有 LaTeX 换规则', () => {
  const e = { title: '追及', problem: '甲乙两车…', idea: '画 v-t 图', steps: [{ t: '列方程', tex: 'x=vt', plain: '' }, { t: '算结果', tex: '', plain: 't=4 s' }], answer: '4 s', pitfalls: ['单位'] };
  const p = manimPrompt(e as never, 'math', true);
  assert.ok(p.includes('数学题') && p.includes('甲乙两车') && p.includes('公式：x=vt') && p.includes('t=4 s') && p.includes('易错：单位'));
  assert.ok(p.includes('MathTex(r"…")') && !p.includes('没有 LaTeX'));
  const q = manimPrompt(e as never, 'chem', false);
  assert.ok(q.includes('化学题') && q.includes('本机没有 LaTeX'));
  // 讲题公式里的 \text{中文} 标出来，免得模型照抄进 MathTex
  const r = manimPrompt({ ...e, steps: [{ t: '临界点', tex: "f'(x)=0\\Longleftrightarrow x=-1\\ \\text{或}\\ x=1,\\ \\text{m}", plain: '' }] } as never, 'math', true);
  assert.ok(r.includes('x=-1\\ 〔或〕\\ x=1,\\ \\text{m}') && r.includes('〔…〕是中文说明'), r);
  assert.ok(!p.includes('〔…〕'), 'no note when there is nothing to mark');
});

console.log(`manim logic ${n}/${n}`);
