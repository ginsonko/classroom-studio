// 上课彩排的步骤表：每步写清场景、要做的动作、要点亮的按钮、怎么算做到了。
// 「做到了」只看软件里真实发生的变化（笔迹、学生、整理记录、浮层发来的事件），老师亲手做了才往下走。
// 这里不碰窗口和主进程，Node 里可以直接测试；准备动作（开彩排黑板、贴倒着的照片）在 guide.ts。
import type { Stroke } from '../lib/types';

export const GUIDE_STUDENT = 'guide-xiaoming';
export type RouteId = 'quick' | 'full';
export type StepStatus = 'done' | 'skipped';

export interface GuideCtx {
  since: number;
  studentId: string; skin: string; preset: string;
  pvw: boolean; pgmId: string; pgmKind: string; pgmLong: boolean;
  /** 彩排里新开的黑板上的笔迹（键 = 材料id#页） */
  boards: Record<string, Stroke[]>;
  /** 长黑板第一屏的高度（以页宽为单位） */
  screen: number;
  photoId: string;
  hits: { name: string; at: number }[];
  ai: boolean; dock: boolean;
  lessons: number; homework: number;
  sorts: { id: string; at: string; undone?: string }[];
  plugins: { installedAt: number; updatedAt: number }[];
  base: GuideBase;
}
/** 进入这一步时的样子，用来判断「之后有没有变」 */
export interface GuideBase { strokes: Record<string, string>; texts: Record<string, string>; pgmId: string; lessons: number; homework: number; preset: string; skin: string }

export interface TodoOpts { subject: string; family: string; ai: boolean; canDemo: boolean }
export interface Step {
  id: string; chapter: string; title: string;
  /** 为什么要会这一步（一句话场景） */
  scene: string;
  todo: (o: TodoOpts) => string;
  /** 做到以后的一句小结 */
  tip: string;
  /** 要点亮的按钮：teacher = 导播台窗口，dock = 学生窗口上的浮层 */
  spot?: { win: 'teacher' | 'dock'; sel: string };
  help: string;
  quick?: boolean;
  /** 软件判断不了（比如在腾讯会议里共享）：老师点这个按钮确认 */
  ack?: string;
  done?: (c: GuideCtx, mem: Record<string, string>) => boolean;
}

const allStrokes = (c: GuideCtx) => Object.values(c.boards).flat();
const fresh = (c: GuideCtx) => allStrokes(c).filter((s) => !(s.id in c.base.strokes));
const hit = (c: GuideCtx, name: string) => c.hits.some((h) => h.name === name && h.at >= c.since);
const ms = (iso: string) => Date.parse(iso) || 0;
/** 角度换到 (-π, π] */
export const normAngle = (a: number) => { const t = 2 * Math.PI; let x = ((a % t) + t) % t; if (x > Math.PI) x -= t; return x; };

export const STEPS: Step[] = [
  {
    id: 'ai', chapter: '准备', title: '配置 AI', quick: true, help: 'import',
    scene: 'AI 讲题、AI 整理、拍照拆题都要先配好模型。不配也能上课，这一步可以跳过。',
    todo: () => '在银子 API 网站新建一把密钥，点「一键导入到软件」→ 选本软件，回到这里点「导入并测试」。也可以点下面的「打开 AI 设置」手动填。配好后这里自动打勾。',
    tip: 'AI 配好了。花了多少钱都记在 AI 账本里。',
    spot: { win: 'teacher', sel: '.rail-b[aria-label="AI"]' },
    done: (c) => c.ai,
  },
  {
    id: 'student', chapter: '课前', title: '选学生', quick: true, help: 'students',
    scene: '上课记录、学情、录像都会归到选中的学生名下。彩排用的是练习学生「小明」，退出时会删掉。',
    todo: () => '点顶上的学生名字，在列表里选「小明」。',
    tip: '以后每节课开始前先选学生，录像和学情就不会记错人。',
    spot: { win: 'teacher', sel: '.tb-stu' },
    done: (c) => c.studentId === GUIDE_STUDENT,
  },
  {
    id: 'open', chapter: '课前', title: '把课件放进预监', quick: true, help: 'onair',
    scene: '预监只有你看得到，确认没问题再给学生看。',
    todo: () => '在左边资料库里点一份课件，在阅读器里点「放预监」，或者直接把课件拖到「预监」框里。手边没有课件就点下面的「用自带演示」。',
    tip: '课件先进预监，学生那边不会看到你翻找的过程。',
    spot: { win: 'teacher', sel: '.lib' },
    done: (c) => c.pvw || (c.pgmKind !== 'board' && c.pgmId !== c.base.pgmId),
  },
  {
    id: 'take', chapter: '课前', title: '切给学生', quick: true, help: 'onair',
    scene: '学生只看得到「学生画面」，切过去之前他看不到预监里的东西。',
    todo: () => '按回车，或点预监下面的「切给学生」。',
    tip: '回车 = 切给学生，← → 翻页。上课时手不用离开键盘。',
    spot: { win: 'teacher', sel: '.take-btn' },
    done: (c) => c.pgmKind !== 'board',
  },
  {
    id: 'share', chapter: '上屏', title: '在会议里共享学生窗口', quick: true, help: 'start', ack: '共享好了',
    scene: '腾讯会议、ClassIn 里共享的是「学生画面」这个窗口，窗口上贴着的浮层工具栏学生看不到。',
    todo: () => '点右上角的「打开学生窗口」。在腾讯会议里点「共享屏幕」→ 选「窗口」→ 选「学生画面」。共享好了点下面的按钮。',
    tip: '共享窗口、不共享整个屏幕：你切别的软件、看备注，学生都看不到。',
    spot: { win: 'teacher', sel: '[data-guide="student-window"]' },
  },
  {
    id: 'slides', chapter: '讲课件', title: 'PPT 分步和答案遮挡', help: 'pptsteps', ack: '知道了',
    scene: '用 PPT 讲题时，动画一步步出来，答案先遮着。',
    todo: () => 'PPT 里的单击动画按一下出一步（← → 或翻页笔）。课件里认出来的答案页对学生先遮着，讲完点「揭晓答案」再给学生看。手边有 PPT 的话现在可以试试。',
    tip: '不想分步时，在「窗口、录课与回放」里关掉「PPT 分步」就整页显示。',
  },
  {
    id: 'pen', chapter: '板书', title: '用笔写几个字', quick: true, help: 'ink',
    scene: '现在学生画面是一块「彩排黑板」，随便写，退出时会清掉。',
    todo: () => '在学生窗口上用浮层工具栏里的笔写几个字。手写板、鼠标都行。',
    tip: '笔的颜色和粗细在工具栏上点一下笔就能换。',
    spot: { win: 'dock', sel: '.tdock .tp' },
    done: (c) => fresh(c).some((s) => s.tool === 'pen' || s.tool === 'marker' || s.tool === 'highlighter'),
  },
  {
    id: 'lines', chapter: '板书', title: '直线和虚线', help: 'ink',
    scene: '画图题离不开直线、虚线。',
    todo: () => '在工具栏的线条组里选「直线」画一条，再选「虚线」画一条。在工具栏上点右键，可以把常用的按钮留下、不用的藏起来。',
    tip: '线条组会记住你上次用的那种线，下次一点就是。',
    spot: { win: 'dock', sel: '.tdock .tp' },
    done: (c) => { const f = fresh(c); return f.some((s) => s.tool === 'line') && f.some((s) => s.tool === 'dashed'); },
  },
  {
    id: 'text', chapter: '板书', title: '打字，再双击改字', help: 'ink',
    scene: '打错的字不用删了重打，双击就能接着改。',
    todo: () => '选「文字」工具，在黑板上点一下打一行字，点空白处结束。然后双击这行字，改一个字。',
    tip: '笔和选择工具下都能双击改字；把字全删掉就是删除这行。',
    spot: { win: 'dock', sel: '.tdock .tp' },
    done: (c, mem) => {
      let changed = false;
      for (const s of allStrokes(c)) {
        if (s.tool !== 'text' || s.tex || !s.text) continue;
        const was = mem['t:' + s.id] ?? c.base.texts[s.id];
        if (was === undefined) mem['t:' + s.id] = s.text;
        else if (was !== s.text) changed = true;
      }
      return changed;
    },
  },
  {
    id: 'photo', chapter: '板书', title: '把倒着的照片转正', help: 'ink',
    scene: '学生拍来的题常常是倒着的。黑板上已经贴了一张倒着的照片。',
    todo: () => '照片已经帮你选中了。点浮层上亮起来的「编辑选中内容」，再点「倒转」（或者点两次「右转」），把它转正。',
    tip: '选中图片后拖角上的点能放大缩小，Shift + 拖旋转手柄每次转 15°。',
    spot: { win: 'dock', sel: '.obj-turns || [aria-label="编辑选中内容"]' },
    done: (c) => { const s = allStrokes(c).find((x) => x.id === c.photoId); return !!s && Math.abs(normAngle(s.rot ?? 0)) < 0.05; },
  },
  {
    id: 'shape', chapter: '板书', title: '从绘图库放一个图形', help: 'ink',
    scene: '常用的几何体、器材不用手画，绘图库里都有，放上去还能调参数。',
    todo: (o) => o.family === 'math' ? '点工具栏上的「绘图库」，在「立体几何」里选「正棱台」，在黑板上拖一下放上去。'
      : o.family === 'physics' ? '点工具栏上的「绘图库」，选一个器材（比如小车、斜面），在黑板上拖一下放上去。'
        : '点工具栏上的「绘图库」，选一个图形，在黑板上拖一下放上去。',
    tip: '装了带图形的插件，它的图形也会出现在绘图库里。',
    spot: { win: 'dock', sel: '.tdock .tp' },
    done: (c) => fresh(c).some((s) => s.tool === 'obj' || (s.tool === 'image' && !!s.tint)),
  },
  {
    id: 'move', chapter: '板书', title: '选中、移动、缩放', help: 'ink',
    scene: '写好的东西随时能挪位置、调大小。',
    todo: () => '用「选择」工具点一下刚放的图形（或刚写的字），拖着它换个位置，再拖角上的点调大小。',
    tip: '按住 Shift 点可以多选，一起挪。',
    spot: { win: 'dock', sel: '.tdock .tp' },
    done: (c) => allStrokes(c).some((s) => s.id in c.base.strokes && JSON.stringify(s.pts) !== c.base.strokes[s.id]),
  },
  {
    id: 'long', chapter: '长黑板', title: '长黑板往下续写', help: 'longboard',
    scene: '一道大题写不下时，用长黑板一直往下写，不用翻页。',
    todo: () => '在导播台「学生画面」上方点「长黑板」，写几笔，然后用滚轮往下滚，接着写。',
    tip: '写到底会自动加长。存成 PDF 时会在两行字之间的空白处分页。',
    spot: { win: 'teacher', sel: '[data-guide="long-board"]' },
    done: (c) => c.pgmLong && (c.boards[c.pgmId + '#0'] ?? []).some((s) => s.pts.some((v, i) => i % 3 === 1 && v > c.screen)),
  },
  {
    id: 'save', chapter: '长黑板', title: '把板书存成 PDF', quick: true, help: 'longboard',
    scene: '课后把板书发给学生或家长。',
    todo: () => '点浮层工具栏上的「保存板书」，选「存成 PDF」。要打印的话选「PDF · 打印省墨」，深色黑板会变成白底。',
    tip: '多页黑板会合成一个 PDF，A4 纸每页两块板面。',
    spot: { win: 'dock', sel: '.tdock .tp-b[data-tip^="保存板书"]' },
    done: (c) => hit(c, 'board.save'),
  },
  {
    id: 'ask', chapter: 'AI 讲题', title: '让 AI 帮你讲一道题', help: 'ai',
    scene: '学生问到你没准备的题，让 AI 先读一遍、写成板书。',
    todo: (o) => o.ai ? '点左边的「AI」，粘贴一道题（留空就让 AI 直接看学生画面），按回车。讲完可以点「写成板书」。'
      : o.canDemo ? '还没配 AI 也能试：点左边的「AI」→「填入示例题」→ 按回车「做成演示」。这是按规则识别，不花钱。'
        : '这一步要先配好 AI。可以先跳过，配好后在完成清单里补做。',
    tip: 'AI 回答过的内容都在 AI 面板的历史记录里，可以按学生找。',
    spot: { win: 'teacher', sel: '.rail-b[aria-label="AI"]' },
    done: (c) => hit(c, 'ai'),
  },
  {
    id: 'sortIn', chapter: 'AI 整理', title: '把资料交给 AI 整理', help: 'sort',
    scene: '卷子照片、Word / PDF、微信里家长的消息，丢进来 AI 认出是谁的、是什么，你确认后再归档。',
    todo: (o) => '点下面的「放进样例资料」（一张批改过的月考照片和一段家长消息），然后点「开始整理」→ 看整理单 →「全部归档」。'
      + (o.ai ? '配着 AI 时会真的让 AI 看一遍，对话框底下写着大约花多少钱；不想花就跳过这一章。' : '没配 AI 时照片原样保存、消息存进档案，不花钱；配好 AI 再拆题。'),
    tip: '以后直接把文件拖到软件里任何地方，或者打开 AI 整理后按 Ctrl+V。',
    spot: { win: 'teacher', sel: '.tb-sort' },
    done: (c) => c.sorts.some((r) => ms(r.at) >= c.since),
  },
  {
    id: 'sortUndo', chapter: 'AI 整理', title: '撤销一次整理', help: 'sort',
    scene: '整理错了不用一条条删，整批撤销。',
    todo: () => '在 AI 整理的「整理记录」里，点刚才那一条的「撤销这次整理」。',
    tip: '撤销会拿掉这次放进题库的题、记下的作答和档案记录。',
    spot: { win: 'teacher', sel: '.tb-sort' },
    done: (c) => c.sorts.some((r) => !!r.undone && ms(r.undone) >= c.since),
  },
  {
    id: 'lesson', chapter: '课后', title: '写课后总结', help: 'students',
    scene: '每节课后给家长一份总结，学情页也会记下来。',
    todo: (o) => '点左边的「学情」→「课后总结」，给小明写一条，点保存。' + (o.ai ? '可以让 AI 先起草。' : ''),
    tip: '课后总结可以导出成长图、Word、PDF 发给家长。',
    spot: { win: 'teacher', sel: '.rail-b[aria-label="学情"]' },
    done: (c) => c.lessons > c.base.lessons,
  },
  {
    id: 'paper', chapter: '课后', title: '组一份作业', help: 'paper',
    scene: '从题库挑题，导出成 Word / PDF。',
    todo: () => '在「学情」→「组作业」里挑几道题，点导出。题库还是空的话先跳过，导入过题再来补做。',
    tip: '学生版不带答案，另外会出一份答案版。',
    spot: { win: 'teacher', sel: '.rail-b[aria-label="学情"]' },
    done: (c) => c.homework > c.base.homework,
  },
  {
    id: 'plugin', chapter: '插件', title: '装一个示例插件', help: 'plugins',
    scene: '插件给导播台加小工具和新图形，装上就能用。',
    todo: () => '点左边的「插件」，在「示例插件」里挑一个点「安装」。带图形的插件装好后，图形出现在绘图库里。',
    tip: '想要新图形、新工具，可以在「备课」→「AI 工坊」里让 AI 做一个。',
    spot: { win: 'teacher', sel: '.rail-b[aria-label="插件"]' },
    done: (c) => c.plugins.some((p) => Math.max(p.installedAt || 0, p.updatedAt || 0) >= c.since),
  },
  {
    id: 'toolbar', chapter: '个性化', title: '选一套工具栏', help: 'ink',
    scene: '工具栏按钮太多？留下常用的就好。',
    todo: () => '在浮层工具栏上点右键，选「讲题常用」或「作图为主」。也可以一个个点按钮决定显示还是藏起来。',
    tip: '各个窗口的工具栏会一起变，下次打开也记得。',
    spot: { win: 'dock', sel: '.tdock .tp' },
    done: (c) => c.preset !== c.base.preset,
  },
  {
    id: 'skin', chapter: '个性化', title: '换个皮肤', help: 'skin',
    scene: '晚上上课换个暗一点的，白天换亮一点的。',
    todo: () => '点左边的「皮肤」，挑一个顺眼的。',
    tip: '黑板的颜色在浮层工具栏的「黑板」里单独换。',
    spot: { win: 'teacher', sel: '.rail-b[aria-label="皮肤"]' },
    done: (c) => c.skin !== c.base.skin,
  },
];

export const ROUTE_NAME: Record<RouteId, string> = { quick: '5 分钟会上课', full: '完整走一遍' };
export const stepsOf = (route: RouteId) => STEPS.filter((s) => route === 'full' || s.quick);
export const BOARD_STEPS = new Set(['pen', 'lines', 'text', 'photo', 'shape', 'move']);

/** 完成清单：按章节分组，做到了几步 */
export function summary(route: RouteId, status: Record<string, StepStatus>) {
  const steps = stepsOf(route);
  const chapters: { name: string; steps: { id: string; title: string; status?: StepStatus }[] }[] = [];
  for (const s of steps) {
    let ch = chapters.find((c) => c.name === s.chapter);
    if (!ch) chapters.push(ch = { name: s.chapter, steps: [] });
    ch.steps.push({ id: s.id, title: s.title, status: status[s.id] });
  }
  return { total: steps.length, done: steps.filter((s) => status[s.id] === 'done').length, chapters };
}

/** 从第 i 步往后找第一个还没做到的（跳过的也算没做到）；都做完了返回 -1 */
export function nextOpen(route: RouteId, status: Record<string, StepStatus>, from = 0) {
  const steps = stepsOf(route);
  for (let i = from; i < steps.length; i++) if (status[steps[i].id] !== 'done') return i;
  return -1;
}

export type Corner = 'br' | 'bl' | 'tr' | 'tl';
export interface Box { x: number; y: number; w: number; h: number; weight?: number }
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** 引导卡放在哪个角：别挡住要点的按钮、AI 抽屉、打开着的对话框；都挡不住时挑挡得最少的。prefer 是现在的角，同样好时不挪 */
export function pickCorner(view: { w: number; h: number }, card: { w: number; h: number }, avoid: Box[], m: { left: number; top: number; edge: number }, prefer: Corner = 'br'): Corner {
  const at = (c: Corner): Box => ({
    x: c[1] === 'r' ? view.w - m.edge - card.w : m.left, y: c[0] === 'b' ? view.h - m.edge - card.h : m.top, w: card.w, h: card.h,
  });
  const cost = (c: Corner) => avoid.reduce((s, b) => s + overlap(at(c), b) * (b.weight ?? 1), 0);
  const order: Corner[] = [prefer, ...(['br', 'bl', 'tr', 'tl'] as Corner[]).filter((c) => c !== prefer)];
  let best = order[0], bestCost = cost(best);
  for (const c of order.slice(1)) { const v = cost(c); if (v < bestCost - 1) { best = c; bestCost = v; } }
  return best;
}
export const CARD_W = 380, CARD_SLIM = 300;
/** 四个角都会挡到东西时，卡片收窄（只留标题和要做的事）再找一次 */
export function placeCard(view: { w: number; h: number }, h: number, avoid: Box[], m: { left: number; top: number; edge: number }, prefer: Corner = 'br') {
  const cost = (c: Corner, w: number) => { const x = c[1] === 'r' ? view.w - m.edge - w : m.left, y = c[0] === 'b' ? view.h - m.edge - h : m.top; return avoid.reduce((s, b) => s + overlap({ x, y, w, h }, b) * (b.weight ?? 1), 0); };
  const wide = pickCorner(view, { w: CARD_W, h }, avoid, m, prefer);
  if (cost(wide, CARD_W) < 1) return { corner: wide, slim: false };
  return { corner: pickCorner(view, { w: CARD_SLIM, h }, avoid, m, prefer), slim: true };
}

/** 跳过这一章：返回下一章第一步的序号（没有了就是步数，表示到结尾） */
export function nextChapter(route: RouteId, i: number) {
  const steps = stepsOf(route), ch = steps[i]?.chapter;
  let j = i + 1;
  while (j < steps.length && steps[j].chapter === ch) j++;
  return j;
}
