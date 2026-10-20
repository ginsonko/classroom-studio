// 部件目录：给 AI 看的说明（提示词）和本机校验共用。改了 draw2d.ts / three3d.ts 的部件，这里要同步（测试会核对名单）。
import type { ItemSpec } from './core';

export interface PartDoc { type: string; dim: '2d' | '3d'; use: string; params: string; example: ItemSpec }

export const PARTS: PartDoc[] = [
  // ── 2D：画在 1920×1080 像素的画面上，左上角是 (0,0) ──
  { type: 'title', dim: '2d', use: '大标题：逐字飞入、扫光、下划线展开', params: 'text, sub(副标题), size(128), color, accent(光晕色), x, y(默认画面中央)', example: { type: 'title', text: '光的折射', sub: '光从一种介质斜射入另一种介质', at: 0.3 } },
  { type: 'text', dim: '2d', use: '普通文字，可多行（\\n 换行）', params: 'text, x, y(文字中心), size(48), color, weight(400~900), align(left|center|right), anim(rise|blur|pop|type), font(sans|kai|serif|latin|mono), glow(0~30), lineHeight(1.35), tracking(字距像素)', example: { type: 'text', text: '入射角越大\n折射角也越大', x: 1480, y: 420, size: 46, weight: 800, align: 'left', at: 1.2 } },
  { type: 'badge', dim: '2d', use: '左上角的学科徽标（每个镜头放一个，固定在左上角）', params: 'subject(学科名，如 物理), title(本镜头标题), index(如 "02 / 05"), color, dark(宣纸背景时 true)', example: { type: 'badge', subject: '物理', title: '光的折射', index: '01 / 04', at: 0.2 } },
  { type: 'caption', dim: '2d', use: '底部字幕（固定在画面底部居中）', params: 'text(不超过 28 个字), size(38), light(宣纸背景时 true)', example: { type: 'caption', text: '光从空气斜射入水中，折射角小于入射角', at: 1.0 } },
  { type: 'formula', dim: '2d', use: 'TeX 公式：先描边「写」出来再填充发光', params: 'tex(LaTeX；化学方程式用 \\ce{...}), x, y(公式中心), size(84，约等于字高像素), color, align(center|left|right，x 是左端/右端/中心), write(书写秒数 1.6), glow(18)', example: { type: 'formula', tex: 'n=\\dfrac{\\sin i}{\\sin r}', x: 1540, y: 260, size: 76, at: 2 } },
  { type: 'plot', dim: '2d', use: '函数图像：坐标轴展开，曲线依次画出，可变形', params: 'x, y(图的中心), w(900), h(520), xr([xmin,xmax]), yr([ymin,ymax]), fns([{expr, color, label, to(变形目标表达式)}]), morphAt(开始变形的秒数), dot(true：小球沿第一条曲线滑动并画切线)。表达式变量 x 和 t(秒)，可用 sin cos tan sqrt abs exp log pi ^', example: { type: 'plot', x: 720, y: 560, w: 1000, h: 560, xr: [-4, 4], yr: [-2, 6], fns: [{ expr: 'x^2/2', color: '#4cc9ff', label: 'y=x²/2' }] } },
  { type: 'field', dim: '2d', use: '点电荷的电场线（自动积分画出，带流动）', params: 'x, y(中心), charges([{x,y,q}]，x、y 是相对中心的像素，q 正负表示电性), lines(每个电荷的线数 18)', example: { type: 'field', charges: [{ x: -300, y: 0, q: 1 }, { x: 300, y: 0, q: -1 }], lines: 18 } },
  { type: 'pythagoras', dim: '2d', use: '勾股定理拼图证明（固定动画）', params: 'a, b(直角边比例), size(560), x, y', example: { type: 'pythagoras', a: 3, b: 4, x: 700, y: 560 } },
  { type: 'timeline', dim: '2d', use: '历史时间轴：镜头沿轴平移，节点依次亮起', params: 'items([{year(数字，公元前用负数), name, note}]，3~10 个), gap(节点间距 540), y, color', example: { type: 'timeline', items: [{ year: 1840, name: '鸦片战争', note: '近代史开端' }, { year: 1911, name: '辛亥革命', note: '推翻帝制' }, { year: 1949, name: '新中国成立', note: '' }] } },
  { type: 'poem', dim: '2d', use: '竖排古诗：从右往左，墨迹晕开显字，最后盖印（配 bg:"paper"）', params: 'lines(每句一项), title, author, size(92), x(最右一列的 x，1290), y(顶端 250), per(每字间隔秒 0.2), seal(印章文字)', example: { type: 'poem', lines: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'], title: '静夜思', author: '李白' } },
  { type: 'mountains', dim: '2d', use: '水墨远山 + 红日（配 bg:"paper"，放在古诗后面当背景）', params: 'base(山脚高度比例 0.7), sun(false 不要太阳), sunX, sunY', example: { type: 'mountains', sunX: 360, sunY: 300 } },
  { type: 'kinetic', dim: '2d', use: '英文句子：字母从四面飞入组成句子，高亮一个词，下面一行中文释义', params: 'text, highlight(要高亮的词), sub(中文释义), size(150), y', example: { type: 'kinetic', text: 'Practice makes perfect.', highlight: 'perfect', sub: '熟能生巧' } },
  { type: 'label', dim: '2d', use: '标注：一条折线指向目标 + 文字。可以钉在 3D 物体上', params: 'text, sub(小字), anchor([x,y,z] 3D 坐标) 或 x, y(像素), dx, dy(文字相对锚点的偏移像素，默认 140,-90), color, size(34)', example: { type: 'label', text: '近日点', sub: '速度最快', anchor: [2.5, 0, 0], dx: -130, dy: -120, color: '#ffd166', at: 1 } },
  { type: 'hud', dim: '2d', use: '科技感取景框（四角括号 + 扫描线，装饰用）', params: 'tag(左下角小字), color', example: { type: 'hud', tag: 'PHYSICS · OPTICS' } },
  { type: 'endcard', dim: '2d', use: '片尾大字：一句总结 + 小字', params: 'brand(大字), line(一行小字), url(更小的一行，可留空)', example: { type: 'endcard', brand: '本节小结', line: '入射角增大，折射角随之增大', url: '' } },
  { type: 'shape', dim: '2d', use: '通用图形，线条按顺序「画」出来：光路、受力箭头、几何图形、示意图', params: 'kind(line|arrow|polyline|polygon|circle|rect|dot), points([[x,y],...]，line/arrow/polyline/polygon 用), x, y, r(circle/dot), x, y, w, h(rect，x、y 是中心), color, width(线宽 4), fill(填充色，可省), dash(true 虚线), glow(12), draw(画出来用几秒 1), move([dx,dy] 画完后整体平移), moveAt, moveDur, spin(画完后每秒转多少度), text(标注文字：线/箭头标在终点，图形标在中心), size(文字字号 34), textColor', example: { type: 'shape', kind: 'arrow', points: [[400, 300], [960, 540]], color: '#ffd166', width: 5, text: '入射光线', at: 0.8 } },
  { type: 'tracer', dim: '2d', use: '沿路径运动的光点（带拖尾）：光的传播、粒子轨迹、洋流、路线', params: 'points([[x,y],...]), t0, t1(出发、到达的镜头内秒数), color, size(11), trail(拖尾占路径比例 0.22), path(false 不画虚线路径), loop(true 循环)', example: { type: 'tracer', points: [[400, 300], [960, 540], [1300, 900]], t0: 1, t1: 4, color: '#ffd166' } },
  { type: 'bars', dim: '2d', use: '柱状图：柱子依次长高、数字滚动', params: 'data([{label, value, color}]，2~8 项), x, y(中心), w(1200), h(560), unit, max, color', example: { type: 'bars', data: [{ label: '水', value: 4.2 }, { label: '砂石', value: 0.92 }], unit: '', x: 760, y: 560 } },
  { type: 'counter', dim: '2d', use: '大数字从 from 滚动到 to（常数、数据冲击感）', params: 'from(0), to, unit, label(下方说明), x, y, size(140), decimals, t0, t1, color, accent', example: { type: 'counter', to: 300000, unit: 'km/s', label: '真空中的光速', at: 0.5 } },
  // ── 3D：three.js 场景，单位是「米」；相机默认在 [0,0,14] 看向原点，此时画面大约看到 x∈[-9,9]、y∈[-5,5] ──
  { type: 'stars', dim: '3d', use: '星空背景', params: 'count(4000), size', example: { type: 'stars' } },
  { type: 'nebula', dim: '3d', use: '彩色星云背景（配 stars 用）', params: 'colors([#hex...])', example: { type: 'nebula' } },
  { type: 'warp', dim: '3d', use: '光速穿梭（开场用，dur 3~4 秒）', params: 'count, speed(110)', example: { type: 'warp', dur: 3.5 } },
  { type: 'grid', dim: '3d', use: '发光地面网格', params: 'y(高度 -2.6), size, step, color, flow', example: { type: 'grid', y: -2.6, color: '#5b3cff' } },
  { type: 'sun', dim: '3d', use: '发光的太阳', params: 'radius(1.2), color, pos', example: { type: 'sun', radius: 1.2 } },
  { type: 'orbit', dim: '3d', use: '行星沿椭圆轨道运动（太阳在原点焦点处），可显示速度箭头和等时扫过的面积', params: 'a(半长轴 6.5), e(偏心率 0~0.9), period(周期秒), phase(初始平近点角), velocity(true 显示速度箭头), sweep(扇形时间宽度，0 不画), color, planet(行星颜色), pos, tilt(轨道倾角度)', example: { type: 'orbit', a: 6, e: 0.5, period: 8, velocity: true, sweep: 0.1 } },
  { type: 'molecule', dim: '3d', use: '分子球棍模型（逐个原子长出来，缓慢旋转）', params: 'name(化学式或中文名，见下方可用分子), 或 atoms([[元素,x,y,z],...]) + bonds([[i,j,键级],...]), scale(1.4), pos, spin, tilt', example: { type: 'molecule', name: 'H2O', pos: [0, 0, 0] } },
  { type: 'reaction', dim: '3d', use: '化学反应：原子从反应物位置移到生成物位置，旧键断开、新键生成，中间闪光', params: 'from([[元素,x,y,z],...]), to(同样顺序、同样元素的新位置), bondsFrom([[i,j],...]), bondsTo, t0, t1(重组的时间段), scale(1.2), pos, spin', example: { type: 'reaction', from: [['H', -2, 0.4, 0], ['H', -2, -0.4, 0], ['Cl', 2, 0.6, 0], ['Cl', 2, -0.6, 0]], to: [['H', -1, 0.9, 0], ['H', 1, -0.9, 0], ['Cl', -1, -0.4, 0], ['Cl', 1, 0.4, 0]], bondsFrom: [[0, 1], [2, 3]], bondsTo: [[0, 2], [1, 3]], t0: 2, t1: 4 } },
  { type: 'dna', dim: '3d', use: 'DNA 双螺旋（从下往上长出，碱基配对发光）', params: 'pairs(30), lean(倾斜弧度 0.38), spin, grow(生长秒数), pos', example: { type: 'dna', pairs: 30 } },
  { type: 'surface', dim: '3d', use: '数学曲面 z=f(x,y)，可以在两个函数之间变形', params: 'f(表达式，变量 x y t), to(变形目标), morphAt, range(3), height(1), scale(1.15), spin, pos', example: { type: 'surface', f: 'sin(x)*cos(y)', to: '(x^2-y^2)/4', morphAt: 3 } },
  { type: 'earth', dim: '3d', use: '地球（大陆、云层、大气辉光、地轴、赤道），镜头用 light:"sun" 能看到昼夜', params: 'radius(2.7), tilt(地轴倾角 23.5), spin(自转快慢), lon(初始经度弧度), axis(false 不画地轴和赤道), glow, pos', example: { type: 'earth', radius: 2.7, tilt: 23.5 } },
  { type: 'atom', dim: '3d', use: '玻尔原子模型（原子核 + 三条电子轨道）', params: 'pos, scale', example: { type: 'atom' } },
  { type: 'particleText', dim: '3d', use: '上万个光点从四面八方汇聚成一行字（开场、片尾的大字）', params: 'text(不超过 12 个字), width(文字总宽，3D 单位，不超过 13), pos, from, to(渐变色), t0, t1, size', example: { type: 'particleText', text: '光的折射', width: 9, pos: [0, 0.8, 0] } },
  { type: 'rings', dim: '3d', use: '旋转的发光圆环（装饰）', params: 'pos, color', example: { type: 'rings', pos: [0, 0, -3] } },
  { type: 'body', dim: '3d', use: '通用 3D 物体：球、方块、圆柱、圆锥、圆环；可以移动、沿路径运动、留轨迹、自转（小球、木块、行星、粒子）', params: 'shape(sphere|box|cylinder|cone|torus), size(数字，或 box 用 [长,高,宽]), color, glow(0~2，>0.5 有光晕), metal(true 金属感), pos(起点), to(终点) 或 path([[x,y,z],...] 依次经过), moveAt(开始移动的秒数 0.6), moveDur, ease(linear|in|out|inOut), trail(true 画轨迹), spin(每秒转多少弧度), rot([度,度,度])', example: { type: 'body', shape: 'sphere', size: 0.6, color: '#ff8a3d', pos: [-6, 3, 0], path: [[-3, 1.8, 0], [0, 0, 0], [3, -3, 0]], trail: true } },
];

export const TYPES_2D = PARTS.filter((p) => p.dim === '2d').map((p) => p.type);
export const TYPES_3D = PARTS.filter((p) => p.dim === '3d').map((p) => p.type);
export const PART_OF = new Map(PARTS.map((p) => [p.type, p]));

export const BACKDROPS = ['space', 'deep', 'blueprint', 'paper', 'aurora', 'dark'] as const;
export const CUTS = ['none', 'fade', 'flash', 'zoom', 'glitch', 'wipe'] as const;
export const MOODS = ['calm', 'drive', 'epic'] as const;
export const EASES = ['linear', 'in', 'out', 'inOut', 'outBack', 'outExpo', 'inExpo', 'inOutExpo', 'outElastic'] as const;
