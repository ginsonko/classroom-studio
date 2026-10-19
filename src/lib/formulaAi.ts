// 手写公式识别：板书笔迹截图 → 视觉模型 → LaTeX。模型回复当不可信输入：只取字符串、限长、去掉 $ 包裹。
import { ai, type AiConfig } from './ai';
import { looseJSON } from './studyLogic';
import { familyOf, packOf, type SubjectId } from './subjects';
import { cleanLatex, texPlain } from './formulaText';

export { cleanLatex, texPlain };

export interface FormulaResult { latex: string; text: string; note: string; model: string }

export async function recognizeInk(cfg: AiConfig | null, image: string, subject: SubjectId): Promise<FormulaResult> {
  if (!cfg?.hasKey || !(cfg.visionModel || cfg.model)) throw new Error('还没有配置模型。可以直接在下面输入 LaTeX。');
  const name = packOf(subject).name;
  const prompt = [
    `图片是老师在${name}课上手写的板书（公式、方程式、算式，也可能夹几个汉字）。请逐字准确识别，不要解题、不要补全、不要改写。`,
    '输出 JSON：{"latex":"…","text":"…","note":""}',
    'latex：标准 LaTeX，不要用 $ 包裹；分数用 \\frac，根号用 \\sqrt；多行用 \\begin{aligned} … \\end{aligned}，行尾写 \\\\；汉字放进 \\text{}。' + (familyOf(subject) === 'chem' ? '化学式和化学方程式用 \\ce{…}（例如 \\ce{2H2 + O2 ->[点燃] 2H2O}）。' : ''),
    'text：同样内容的一行纯文本写法（例如 x^2+2x+1=0）。note：看不清或有两种可能的地方，简短说明；没有就留空。',
  ].join('\n');
  const r = await ai.chat([{ role: 'user', content: prompt }], { image, json: true, maxTokens: 1500, temperature: 0, feature: '手写公式识别', ...(cfg.visionModel ? { model: cfg.visionModel } : {}) });
  if (!r.sawImage) throw new Error('图片没有发给模型，请重试');
  const j = looseJSON(r.content) as Record<string, unknown> | null;
  const latex = cleanLatex(j?.latex ?? (j ? '' : r.content));
  if (!latex) throw new Error('模型没有认出公式。可以把笔迹写大一点再试，或直接在下面输入 LaTeX。');
  const text = typeof j?.text === 'string' && j.text.trim() ? j.text.trim().slice(0, 400) : texPlain(latex);
  return { latex, text, note: typeof j?.note === 'string' ? j.note.trim().slice(0, 200) : '', model: r.model };
}
