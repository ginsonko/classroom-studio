// manim 讲解动画的纯文本逻辑（不依赖 AI 客户端，便于单独测试）。
import type { Explain } from '../physics/sim/aiSchema';
import { packOf, type SubjectId } from './subjects';

const SCENES = '(?:Scene|MovingCameraScene|ThreeDScene|ZoomedScene)';

/** 写脚本用的 system：学科包的 persona 要求「只输出 JSON」，不能拿来写代码 */
export function manimSystem(subject: SubjectId): string {
  return `你是中国${packOf(subject).stage}老师，也是熟练的 manim Community v0.18 动画作者，做过很多${{ senior: '高考', junior: '中考', primary: '小学' }[packOf(subject).level]}讲题动画。按要求只输出一个 \`\`\`python 代码块：不要 JSON，不要其它说明文字。`;
}

/** {"code": "..."}（模型偶尔这样包一层） */
function jsonCode(s: string): string | null {
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a || !/"(?:code|script|python)"\s*:/.test(s)) return null;
  try { const j = JSON.parse(s.slice(a, b + 1)); const c = j.code ?? j.script ?? j.python; return typeof c === 'string' ? c : null; } catch { return null; }
}

/** 场景类名不是 Explain 但只有一个场景类时，改名为 Explain */
export function fixScene(code: string): string {
  if (new RegExp(`^class\\s+Explain\\s*\\(\\s*${SCENES}\\s*\\)`, 'm').test(code)) return code;
  const found = [...code.matchAll(new RegExp(`^class\\s+(\\w+)\\s*\\(\\s*${SCENES}\\s*\\)`, 'gm'))];
  if (found.length !== 1) return code;
  return code.replace(new RegExp(`\\b${found[0][1]}\\b`, 'g'), 'Explain');
}

/** 从模型回复里取出 Python 脚本：代码块（不分大小写、允许没闭合）、JSON 包装、前面带说明文字都能处理 */
export function extractCode(content: string): string {
  let s = content.replace(/\r\n?/g, '\n').trim();
  s = jsonCode(s) ?? s;
  const blocks = [...s.matchAll(/```[ \t]*([\w+-]*)[ \t]*\n([\s\S]*?)```/g)].map((m) => jsonCode(m[2]) ?? m[2]);
  let code = blocks.find((b) => /^class\s+\w+\s*\(/m.test(b)) ?? blocks.find((b) => /manim/.test(b));
  if (!code) {
    const open = /```[ \t]*[\w+-]*[ \t]*\n/.exec(s);   // 回答被截断，代码块没闭合
    code = open ? s.slice(open.index + open[0].length) : s;
  }
  const start = code.search(/^(?:from|import)\s/m);
  if (start > 0) code = code.slice(start);
  return fixScene(code.replace(/```\s*$/, '').trim()) + '\n';
}

const GONE: Record<string, string> = { ShowCreation: 'Create', TextMobject: 'Text', TexMobject: 'MathTex', get_graph: 'axes.plot', GraphScene: 'Scene + Axes', ShowCreationThenDestruction: 'ShowPassingFlash', ParametricSurface: 'Surface', CONFIG: '__init__ 参数' };

/** 渲染前的快速检查（几毫秒，省掉一次注定失败的渲染）：公式里的中文、v0.18 已删除的写法、没有 LaTeX 时用公式 */
export function lintScript(code: string, latex: boolean): string[] {
  const out: string[] = [];
  const lineOf = (i: number) => code.slice(0, i).split('\n').length;
  for (const m of code.matchAll(/\b(MathTex|Tex)\s*\(((?:\s*r?(?:"[^"\n]*"|'[^'\n]*')\s*,?)+)/g)) {
    if (!latex) { out.push(`第 ${lineOf(m.index!)} 行：本机没有 LaTeX，不能用 ${m[1]}，改用 Text`); continue; }
    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.exec(m[2]);
    if (cjk) out.push(`第 ${lineOf(m.index!)} 行：${m[1]} 里有中文「${m[2].trim().slice(0, 40)}」，LaTeX 编译不了。中文改用 Text(…, font="Microsoft YaHei")，和公式用 VGroup 拼在一起`);
  }
  // 实测模型常把推导公式写成 font_size=24~30，投屏后后排看不清
  if (latex) for (const m of code.matchAll(/\b(?:MathTex|Tex)\s*\([^\n]*?\bfont_size\s*=\s*(\d+(?:\.\d+)?)/g)) {
    if (+m[1] < 32) { out.push(`第 ${lineOf(m.index!)} 行：公式 font_size=${m[1]} 太小，投屏看不清，推导公式用 44~52、标注不小于 40`); break; }
  }
  for (const [old, now] of Object.entries(GONE)) {
    const i = code.search(new RegExp(`\\b${old}\\b`));
    if (i >= 0) out.push(`第 ${lineOf(i)} 行：manim v0.18 已经没有 ${old}，改用 ${now}`);
  }
  return out.slice(0, 8);
}

export function manimPrompt(e: Explain, subject: SubjectId, latex: boolean): string {
  // 讲题公式里的 \text{中文} 照抄进 MathTex 会编译失败（实测每次都要多修一版）：标成〔中文〕，提示词里说明要用 Text
  const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
  const texOf = (t: string) => t.replace(/\\(?:text|mathrm|textbf|mbox)\s*\{([^{}]*)\}/g, (m, x: string) => (cjk.test(x) ? `〔${x.trim()}〕` : m));
  const steps = e.steps.map((s, i) => `${i + 1}. ${s.t}${s.tex ? `　公式：${texOf(s.tex)}` : s.plain ? `　${s.plain}` : ''}`).join('\n');
  const marked = latex && e.steps.some((s) => texOf(s.tex).includes('〔'));
  return [
    `把下面这道${packOf(subject).name}题的讲解做成一段 manim（Community v0.18）动画，给${packOf(subject).stage.slice(0, 2)}学生上课时播放。老师会边放边讲，所以画面要清楚、节奏要稳。`,
    `题目：${e.problem || e.title}`,
    e.idea ? `突破口：${e.idea}` : '',
    `讲解步骤：\n${steps}`,
    marked ? '（公式里〔…〕是中文说明，不能写进 MathTex，要拆成 Text。）' : '',
    e.answer ? `答案：${e.answer}` : '',
    e.pitfalls.length ? `易错：${e.pitfalls.join('；')}` : '',
    '',
    '要求：',
    '1. 只输出一个 ```python 代码块，不要 JSON、不要其它说明。第一行 from manim import *，另外只能 import numpy as np / import math / import random。',
    '2. 只定义一个场景 class Explain(Scene)（需要镜头移动可用 MovingCameraScene），写在 construct 里，可以有辅助函数。总时长 40~80 秒，关键结论出现后 self.wait(1.5)。',
    '3. 中文一律用 Text("…", font="Microsoft YaHei")，正文字号 30~34，标题 40。' + (latex
      ? '公式用 MathTex(r"…")，MathTex 里绝对不能有中文（中文另用 Text，和公式 VGroup(...).arrange(RIGHT) 拼在一起）。推导公式 MathTex 的 font_size 用 44~52（同样字号下公式看起来比中文小一圈，投到屏幕上要让后排也看得清），不要小于 40；一屏放不下就分屏，不要把公式缩小。'
      : '本机没有 LaTeX，不能用 MathTex / Tex，公式也用 Text 写（可用 ² ³ √ π θ 等 Unicode），字号不小于 32。'),
    '4. 画面布局（16:9，x 约 −7~7，y 约 −4~4）：标题 to_edge(UP, buff=0.4) 独占顶部一条，其它所有内容（包括图名、小标题）的上沿都要在 y=2.6 以下，不要和标题挤在一起。图放左半边（x −6.6~−0.3）、公式和文字放右半边（x 0.3~6.6），两边不能重叠；图要画大，占满自己那一半，不要缩在角落；每屏文字公式合计不超过 5 行；放不下就 FadeOut 旧内容再出新内容；所有东西离画面边缘至少 0.4。',
    '   在 construct 开头定义并使用这个放置函数，图和文字组都用它放进各自的区域（太大会等比缩小，不会出界、不会压到标题）：\n' +
    '   def place(m, x0, x1, y0=-3.6, y1=2.6, corner=None):\n' +
    '       k = min(1, (x1 - x0) / max(m.width, 0.01), (y1 - y0) / max(m.height, 0.01)); m.scale(k)\n' +
    '       if corner is None: m.move_to([(x0 + x1) / 2, (y0 + y1) / 2, 0])\n' +
    '       else: m.move_to([x0, y1, 0], aligned_edge=UL)\n' +
    '       return m\n' +
    '   例如 place(figure, -6.6, -0.3)、place(VGroup(...).arrange(DOWN, aligned_edge=LEFT, buff=0.35), 0.3, 6.6, corner=UL)。',
    '5. 图上的标注（物理量、点名、角）要清楚：MathTex 标注 font_size 不小于 40，放在线条外侧 next_to(…, buff=0.15)，不要压在别的图形或文字上；随运动变化的标注用 always_redraw 跟着走。',
    '6. 能画图就画图，让学生看见过程：运动用 ValueTracker + always_redraw 或 MoveAlongPath，受力用 Arrow 并标注，函数用 Axes + axes.plot（不要用已删除的 get_graph），几何用 Polygon / Circle / Line / Angle，关键量用颜色区分（YELLOW 重点、BLUE 已知、RED 易错）。图里的角度、方向、长度比例必须和题目一致：先定好关键点，再按题目给的角度用 np.cos / np.sin 算出端点（例如与水平成 37° 的绳更平、53° 的更陡），不要凭感觉摆位置。',
    '7. 只用 v0.18 还存在的写法：Create（不是 ShowCreation）、Text / MathTex（不是 TextMobject / TexMobject）、axes.plot、axes.c2p。不要读写文件，不要图片和声音（ImageMobject、SVGMobject、add_sound），不要改 config。',
    '8. 讲解顺序：题目条件（简短）→ 图示和过程 → 关键公式推导 → 结论。最后一屏停在答案上 self.wait(2)。',
  ].filter((x) => x !== '').join('\n');
}

export function repairPrompt(log: string): string {
  return ['上面这段脚本渲染失败了。请找出原因修正后输出完整脚本（同样只输出一个 ```python 代码块，规则不变）。', '报错（最后几行）：', log.slice(-2500)].join('\n');
}

export function reviewPrompt(e: Explain): string {
  return [
    `这是一段 manim 讲题动画按时间顺序截的 6 帧（从左到右、从上到下）。题目：${e.problem || e.title}`,
    '请像审片的老师一样检查画面，只看会影响学生看懂的问题：',
    '- 文字、公式、图形互相重叠或遮挡（特别是小标题、图名压到顶部大标题上）；',
    '- 内容超出画面或被切掉；',
    '- 字太小看不清、颜色看不清（这张拼图里公式小到读不出就算太小，要求放大）；',
    '- 画面大半是空的、只有一两行小字（应把图和公式放大）；',
    '- 图示和题目明显不符（例如方向、受力、图像形状画错）；',
    '- 公式或结论写错。',
    '截帧可能正好落在淡入淡出、换屏的过渡瞬间：半透明或只剩标题的过渡画面不算问题。',
    '只输出 JSON：{"ok": true 或 false, "problems": ["第几帧：什么问题，怎么改", ...]}。没有明显问题就 ok=true、problems 为空。',
  ].join('\n');
}

export function parseReview(content: string): { ok: boolean; problems: string[] } | null {
  try {
    const j = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    const problems = Array.isArray(j.problems) ? j.problems.map(String).filter(Boolean).slice(0, 6) : [];
    return { ok: !!j.ok && !problems.length, problems };
  } catch { return null; }
}
