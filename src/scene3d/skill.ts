// 立体演示的「技能」：给模型的说明书（规格文档 + 规则）和按学科挑选的完整示例。
// 写给能力一般的模型：只讲必要字段，规则直白，示例可以直接照抄改数字。
import type { SubjectId } from '../lib/subjects';

export const S3D_DOC = `## 立体演示规格（JSON）
顶层字段（除 objects 外都可省略）：
- title 标题；subject 学科（physics/math/chemistry/biology/geography/…）
- mode："motion"（东西在动）或 "static"（静态题：受力分析、几何、结构；用 steps 分步出现，不要硬让物体动）
- duration 时长秒（1~60，按真实时间：物体落地 / 到达终点就结束，别留一大段静止；static 一般 4 秒×步数）
- up：竖直向上的轴。"y"（物理/化学/生物/地理，默认）或 "z"（数学立体几何、曲面，默认）
- camera 默认机位：iso 斜视（默认）/ front 正视 / side 侧视 / top 俯视
- params 可调参数 [{"key":"theta","label":"倾角","min":10,"max":60,"value":37,"unit":"°"}]（≤8 个）
- vars 中间量 {"G":"m*g","a":"g*(sind(theta)-mu*cosd(theta))"}（可以用参数、t、其它中间量、物体指标）
- objects 对象列表（每个都有 id 和 type）
- charts 图表（右上角，最多 2 个）：{"title":"v-t 图像","series":[{"y":"A.v","name":"v"}],"yLabel":"v/(m/s)"}；柱状图 {"type":"bars","title":"能量","bars":[{"name":"动能","value":"0.5*m*A.v^2"}]}
- steps 讲解步骤（底部字幕，按时间均分，也可写 at 秒）：[{"say":"第一步：画重力","camera":"front"}]
- notes 给老师的说明（比例、近似等）

## 数和公式
任何数字字段都可以写公式字符串："2*t"、"v0*cosd(theta)"、"if(t<2, 3*t, 6)"。
可用：+ - * / ^ 比较 && || 三元 a?b:c；sin cos tan（弧度）、sind cosd tand asind acosd atand（角度）、sqrt abs exp ln log min max clamp(x,a,b) lerp step smooth floor round hypot atan2 pi。
物体指标：A.x A.y A.z（位置）A.vx A.vy A.v（速度）A.a（加速度）A.s（路程/沿面位移）A.angle；地球 E.lat（直射点纬度）E.day。
文字里嵌数值："v = {A.v:1} m/s"（{公式:小数位}）。下标写 F_N、v_0，上标 m/s^2。

## 坐标
- up=y：x 向右，y 向上，z 朝向观众。物理题 1 单位 = 1 米，场景整体控制在 2~20 个单位；题目数字太大就按比例缩小并写进 notes。
- up=z：x 向右，y 向纸里，z 向上（课本立体几何的画法）。

## 对象类型（字段都可省略，有默认值）
力学器材（up=y）：
- ground 地面 {pos:[x,y,z] 顶面中心, size:[长,深], rough}
- incline 斜面 {pos 底角, angle 度, length 或 height, dir:"right"(向右上升)|"left", rough, showAngle}
- conveyor 传送带 {pos 顶面中心, length, speed（正=向右）}
- wall {pos, height, side:"left"|"right"}；ceiling {pos, size}
- box 物块 {pos 中心, size:[宽,高,深], on, s, motion, material:"wood"|"metal"|"plastic"}；cart 小车（同 box）；ball {pos, r}；cylinder {pos, r, h, axis}
  放在表面上：写 "on":"斜面或地面或传送带id" 和 "s":沿表面离起点的距离（斜面从底角量），物体自动贴着表面、跟着斜面转。
- pulley 滑轮 {pos, r, support:"post"|"ceiling"|"wall"|"none"}
- rope 绳 {from:"A", to:"B", via:["滑轮id"]}（绳绕过滑轮自动走切线）；spring {from, to, coils}；rod {from, to}
- pendulum 单摆 {pivot:[x,y,z], length, angle0 摆幅度（自动摆动）或 angle（固定角度/公式）}
- arrow 矢量 {at:"物体id" 或 from:点, dir, len 长度(可写公式，按大小成比例), kind:"force"|"velocity"|"accel"|"field"|"other", label, dashed, offset:[dx,dy,dz]}
  dir 可写 "up" "down" "left" "right" "in" "out" "normal"（垂直所在斜面向外）"-normal" "along"（沿斜面向上）"-along"、角度数字（从 +x 逆时针）、或向量 ["A.vx","A.vy",0]；也可以写 to:点 代替 dir。
- angle 角度标注 {at:点, from:起始角, to:终止角}（度，从 +x 逆时针）或 {between:[点1,顶点,点2]}
- trail 轨迹 {of:"物体id"}；measure 尺寸标注 {from, to, label}
- field 场区域 {kind:"B"|"E"|"g", dir:"in"|"out"|"up"…, pos 中心, size:[宽,高,深]}；charge 带电粒子 {pos, q, r, motion}
- wave 机械波 {pos 左端, length, amp, lambda, speed, kind:"transverse"|"longitudinal"}
运动配方 motion（写在物体上，导播台按公式算每一帧，不用自己逐帧写）：
- {"type":"accel","v0":[vx,vy,0],"a":[ax,ay,0]}（放在表面上时 v0、a 写一个数，表示沿表面）；{"type":"linear","v0":…}
- {"type":"projectile","v0":速度,"angle":抛射角度,"g":10}（自动落在地面上停住）
- {"type":"circle","center":[x,y,z],"r":半径,"period":周期,"dir":"ccw"|"cw","plane":"xy"|"xz"}
- {"type":"shm","amp":振幅,"period":周期,"axis":"x"}
- {"type":"phases","v0":初速,"phases":[{"dur":2,"a":1},{"dur":1,"a":-2}]}（分段匀变速，先加速后匀速等）
- {"type":"keys","keys":[{"t":0,"pos":[0,0,0]},{"t":2,"pos":[3,1,0]}]}（关键帧）；{"type":"spin","period":4}
- 也可以直接把 pos 写成含 t 的公式：["2*t","5-5*t^2",0]
数学（up=z）：
- solid 立体图形 {shape:"cube"|"cuboid"|"tetra"(正三棱锥 P-ABC)|"pyramid"(四棱锥 P-ABCD)|"prism"(三棱柱)|"cylinder"|"cone"|"sphere", pos 底面顶点 A 的位置, size 棱长 或 [长,宽,高], names:"ABCD-A1B1C1D1", labels:true, section:[三个点]（自动画截面）, circumsphere:true（外接球）}
  顶点名可以直接当点用："A1"、"mid(A,B1)"、"lerp(A,B,0.25)"。
- point {pos:点或坐标, label}；segment {from, to, dashed}；polygon {points:[…], opacity}；plane {points:[三个点], size}；sphere {center, r, wire}
- axes 坐标轴 {x:[-4,4], y:[-3,3], z:[-1,3]（有 z 才是三维）, grid}
- curve 曲线：{fn:"x^2-2*x", x:[-1,3]}（y=f(x)，up=z 时画在 xz 平面）或参数方程 {x:"cos(u)", y:"sin(u)", z:"u/4", u:[0,12.6]}，draw:"t/4"（0→1 逐渐画出）
- surface 曲面 {f:"x^2-y^2" (z=f(x,y)), x:[-2,2], y:[-2,2], wire}
化学：molecule 分子 {name:"CH4"（内置 H2O CO2 CH4 NH3 C2H4 C2H2 C6H6 C2H5OH CH3COOH CH3OH H2 O2 N2 Cl2 HCl SO2 C2H6）或 atoms:[["C",0,0,0],["H",0.6,0.6,0.6]…] + bonds:[[0,1,1]…], pos, scale, angles:true（标键角）, style:"ballstick"|"space"}；crystal 晶胞 {name:"NaCl"|"CsCl"|"diamond"|"bcc"|"fcc"|"graphite"}；atom 原子结构 {symbol:"Na", shells:[2,8,1]}
地理/天文：earth {r, tilt:23.44, orbit:{r:6,center:[0,0,0]}（绕太阳公转一周=时长）, spin 自转周期秒, marks:[{lat,lon,text}]}；sun {pos, r}；moon {around:"地球id", dist, period}；orbit {center, r}
生物：cell {kind:"animal"|"plant", r}（剖开显示细胞器）；dna {length, turns, unzip:"clamp(t/6,0,1)"（解旋程度 0~1）}
通用：label 文字 {pos:点, text, size:"small"|"normal"|"big"}；timeline 时间轴 {events:[{at:年份,text,sub}]}
所有对象通用：label 文字、color（blue red green orange yellow purple pink cyan gray white 或 #RRGGBB）、step（从第几步开始出现）、show（公式 >0.5 才显示）、opacity、highlight（0~1 发光）。`;

export const S3D_RULES = `## 规则
1. 只输出一个 JSON 对象，不要任何解释文字，不要代码块。
2. 数值必须和题目一致（角度、质量、速度、长度…），能用参数的写进 params 方便老师调；派生量写进 vars。
3. 运动题让东西真的动：用 motion 配方或含 t 的公式；duration 覆盖整个过程。静态题 mode 写 "static"，用 steps + 对象的 step 字段分步出现（如先画物体，再逐个画力），不要编造运动。
4. 受力分析：每个力一个 arrow，at 写受力物体 id，长度 len 与力的大小成比例（如 "0.15*G"），label 写力的名字（G、F_N、f、T）。
5. 物体放在斜面 / 地面上一律用 on + s，不要自己算坐标；绳子用 rope + via 绕过滑轮。
6. 画面要清楚：主体放在原点附近，尺寸 2~20 单位；label 简短（≤12 字）；不要堆砌无关对象（≤40 个）。
7. 只用上面列出的类型和字段，拼写要完全一致。`;

export const S3D_SYSTEM = `你是高中课堂的立体演示设计师。老师给你一道题（文字或截图），你写一份「立体演示规格」JSON，导播台用 three.js 渲染成三维动画，投到学生的大屏幕上。
目标：三维、好看、准确，帮助学生看懂题目里的物理过程 / 空间关系 / 结构。

${S3D_DOC}

${S3D_RULES}`;

// ── 示例（会在测试里逐个校验） ────────────────────────────
export const EXAMPLES: Record<string, { subject: SubjectId | 'any'; brief: string; spec: Record<string, unknown> }> = {
  inclineForces: {
    subject: 'physics', brief: '静态受力分析：物块静止在粗糙斜面上',
    spec: {
      title: '斜面上物块的受力分析', subject: 'physics', mode: 'static', duration: 16, camera: 'iso',
      params: [{ key: 'theta', label: '斜面倾角', min: 10, max: 50, value: 37, unit: '°' }, { key: 'm', label: '质量', min: 0.5, max: 5, value: 2, unit: 'kg' }],
      vars: { G: 'm*g', N: 'G*cosd(theta)', f: 'G*sind(theta)' },
      objects: [
        { id: 'floor', type: 'ground', pos: [1, 0, 0], size: [10, 3] },
        { id: 'slope', type: 'incline', pos: [-2.5, 0, 0], angle: 'theta', length: 6.5, rough: true, showAngle: true },
        { id: 'A', type: 'box', on: 'slope', s: 3.6, size: [1, 0.7, 0.9], label: 'A', color: 'blue' },
        { id: 'Fg', type: 'arrow', at: 'A', dir: 'down', len: '0.12*G', kind: 'force', label: 'G = {G:1} N', step: 1 },
        { id: 'Fn', type: 'arrow', at: 'A', dir: 'normal', len: '0.12*N', kind: 'force', color: 'cyan', label: 'F_N = {N:1} N', step: 2 },
        { id: 'Ff', type: 'arrow', at: 'A', dir: 'along', len: '0.12*f', kind: 'force', color: 'orange', label: 'f = {f:1} N', step: 3 },
        { id: 'G1', type: 'arrow', at: 'A', dir: '-along', len: '0.12*f', kind: 'other', dashed: true, label: 'Gsinθ', step: 4 },
        { id: 'G2', type: 'arrow', at: 'A', dir: '-normal', len: '0.12*N', kind: 'other', dashed: true, label: 'Gcosθ', step: 4 },
      ],
      steps: [
        { say: '物块 A 静止在倾角 θ 的粗糙斜面上，先画重力 G，竖直向下' },
        { say: '斜面对 A 的支持力 F_N 垂直斜面向上' },
        { say: 'A 有沿斜面下滑的趋势，静摩擦力 f 沿斜面向上' },
        { say: '把 G 沿斜面和垂直斜面分解：f = Gsinθ，F_N = Gcosθ', camera: 'front' },
      ],
      notes: ['拖动「斜面倾角」可以看到 f 变大、F_N 变小'],
    },
  },
  projectile: {
    subject: 'physics', brief: '运动过程：平抛运动，带轨迹、速度分解和 v-t 图',
    spec: {
      title: '平抛运动的分解', subject: 'physics', mode: 'motion', duration: 1.2, camera: 'iso',
      params: [{ key: 'v0', label: '初速度', min: 1, max: 6, value: 3, unit: 'm/s' }],
      objects: [
        { id: 'floor', type: 'ground', pos: [3, 0, 0], size: [10, 3] },
        { id: 'table', type: 'box', pos: [-1, 2.5, 0], size: [2, 5, 1.5], material: 'wood', color: '#b07a4f' },
        { id: 'A', type: 'ball', pos: [0, 5.2, 0], r: 0.2, color: 'red', label: 'v = {A.v:1} m/s', motion: { type: 'projectile', v0: 'v0', angle: 0 } },
        { id: 'tr', type: 'trail', of: 'A' },
        { id: 'v', type: 'arrow', at: 'A', dir: ['A.vx', 'A.vy', 0], len: '0.3*A.v', kind: 'velocity', label: 'v' },
        { id: 'vx', type: 'arrow', at: 'A', dir: 'right', len: '0.3*A.vx', kind: 'velocity', dashed: true, label: 'v_x' },
        { id: 'vy', type: 'arrow', at: 'A', dir: 'down', len: '0.3*abs(A.vy)', kind: 'velocity', dashed: true, label: 'v_y' },
        { id: 'h', type: 'measure', from: [0.3, 0, 1], to: [0.3, 5, 1], label: 'h = 5 m' },
      ],
      charts: [{ title: '速度分量', series: [{ y: 'A.vx', name: 'v_x' }, { y: 'abs(A.vy)', name: 'v_y' }], yLabel: 'v/(m/s)' }],
      notes: ['水平方向匀速、竖直方向自由落体；下落 5 m 用时 1 s'],
    },
  },
  cubeSection: {
    subject: 'math', brief: '立体几何：正方体截面，分步出现 + 机位切换',
    spec: {
      title: '正方体的截面', subject: 'math', mode: 'static', up: 'z', duration: 12,
      objects: [
        { id: 'C', type: 'solid', shape: 'cube', size: 4, names: 'ABCD-A1B1C1D1', labels: true },
        { id: 'M', type: 'point', pos: 'mid(A1,B1)', label: 'M', step: 2 },
        { id: 'N', type: 'point', pos: 'mid(B1,C1)', label: 'N', step: 2 },
        { id: 'cut', type: 'polygon', points: ['A', 'C', 'N', 'M'], color: 'orange', opacity: 0.55, step: 3 },
        { id: 'AC', type: 'segment', from: 'A', to: 'C', color: 'orange', step: 3 },
        { id: 'MN', type: 'segment', from: 'M', to: 'N', color: 'orange', step: 3 },
      ],
      steps: [
        { say: '正方体 ABCD-A_1B_1C_1D_1 的棱长为 4' },
        { say: 'M、N 分别是 A_1B_1、B_1C_1 的中点' },
        { say: '过 A、C、M 的截面就是梯形 ACNM（MN ∥ AC）' },
        { say: '从正上方看：MN 是 AC 的一半，截面是等腰梯形', camera: 'top' },
      ],
    },
  },
  surface: {
    subject: 'math', brief: '函数图像：曲面 + 截线（三维函数）',
    spec: {
      title: '马鞍面 z = x² − y²', subject: 'math', mode: 'static', up: 'z', duration: 10,
      params: [{ key: 'a', label: '系数 a', min: 0.2, max: 1.5, value: 0.5 }],
      objects: [
        { id: 'ax', type: 'axes', x: [-3, 3], y: [-3, 3], z: [-3, 3] },
        { id: 'S', type: 'surface', f: 'a*(x^2-y^2)', x: [-2.5, 2.5], y: [-2.5, 2.5], opacity: 0.85, label: 'z = a(x²−y²)' },
        { id: 'c1', type: 'curve', x: 'u', y: '0', z: 'a*u^2', u: [-2.5, 2.5], color: 'red', label: 'y=0 时开口向上', step: 2 },
        { id: 'c2', type: 'curve', x: '0', y: 'u', z: '-a*u^2', u: [-2.5, 2.5], color: 'cyan', label: 'x=0 时开口向下', step: 3 },
      ],
      steps: [{ say: '曲面 z = a(x² − y²) 形如马鞍' }, { say: '沿 x 轴截：z = ax²，开口向上', camera: 'front' }, { say: '沿 y 轴截：z = −ay²，开口向下', camera: 'side' }],
    },
  },
  molecules: {
    subject: 'chemistry', brief: '分子结构对比：甲烷和乙烯，标键角',
    spec: {
      title: '甲烷与乙烯的空间结构', subject: 'chemistry', mode: 'static', duration: 10,
      objects: [
        { id: 'm1', type: 'molecule', name: 'CH4', pos: [-2.6, 0, 0], angles: true, spin: true, label: '甲烷 CH_4：正四面体' },
        { id: 'm2', type: 'molecule', name: 'C2H4', pos: [2.6, 0, 0], angles: true, spin: true, label: '乙烯 C_2H_4：平面形', step: 2 },
      ],
      steps: [{ say: '甲烷：碳原子在正四面体中心，键角 109°28′' }, { say: '乙烯：6 个原子共平面，碳碳双键，键角约 120°' }],
    },
  },
  earth: {
    subject: 'geography', brief: '地球公转：二分二至 + 直射点纬度曲线',
    spec: {
      title: '地球公转与太阳直射点的移动', subject: 'geography', mode: 'motion', duration: 24, camera: 'iso',
      objects: [
        { id: 'S', type: 'sun', pos: [0, 0, 0], r: 1, label: '太阳' },
        { id: 'E', type: 'earth', r: 0.95, tilt: 23.44, orbit: { r: 5.2, center: [0, 0, 0] } },
      ],
      charts: [{ title: '太阳直射点纬度', series: [{ y: 'E.lat', name: '纬度' }], yLabel: '°（北正南负）', ymin: -30, ymax: 30 }],
      steps: [{ say: '春分：直射赤道，全球昼夜等长', at: 0 }, { say: '夏至：直射北回归线，北半球昼最长', at: 6 }, { say: '秋分：直射点回到赤道', at: 12 }, { say: '冬至：直射南回归线', at: 18 }],
    },
  },
  dna: {
    subject: 'biology', brief: '生物结构：DNA 双螺旋解旋',
    spec: {
      title: 'DNA 的双螺旋结构与解旋', subject: 'biology', mode: 'motion', duration: 10,
      objects: [{ id: 'D', type: 'dna', length: 7, turns: 2.5, unzip: 'clamp((t-4)/5,0,1)', label: 'DNA 双螺旋' }],
      steps: [{ say: '两条链反向平行，碱基互补配对：A—T、G≡C' }, { say: '解旋酶打开氢键，双链逐渐分开', at: 4 }],
    },
  },
};

/** 按学科挑 2~3 个示例：同学科优先，再补一个物理静态示例（覆盖分步讲解的写法） */
export function examplesFor(subject: string): string {
  const all = Object.values(EXAMPLES);
  const same = all.filter((e) => e.subject === subject);
  const pick = [...same.slice(0, 2)];
  for (const k of ['inclineForces', 'projectile', 'cubeSection']) if (pick.length < 3 && !pick.includes(EXAMPLES[k])) pick.push(EXAMPLES[k]);
  return pick.map((e) => `### 示例：${e.brief}\n${JSON.stringify(e.spec)}`).join('\n\n');
}

export function s3dFirst(problem: string, subject: string, hasImage: boolean): string {
  return `${examplesFor(subject)}

## 任务
学科：${subject}
${hasImage ? '题目见附图（学生画面截图）' + (problem.trim() ? '，老师补充：' + problem.trim() : '') : '题目：' + problem.trim()}

先想清楚：题目在问什么？学生最需要看到什么（受力、运动过程、空间关系、结构）？是运动题还是静态题？
输出格式：{"understand":"一句话说明题意和演示重点","expect":"学生会看到什么（关键数值）","spec":{…规格…}}`;
}

/** 渲染 / 校验后的反馈 */
export function s3dReview(round: number, summary: string, hasImage: boolean): string {
  return `导播台渲染了你的第 ${round} 版规格。
${summary}
${hasImage ? '附图是 2×2 联系表：每格左上角黄色角标写着时刻 / 机位。' : ''}
请对照题目逐项检查：数值对不对？物体位置、力的方向、运动过程对不对？画面有没有穿模、太小、标签挤在一起、东西跑出画面？
- 完全正确就回复 {"accept":true,"why":"一句话"}
- 有问题就回复 {"understand":"…","expect":"…","spec":{…修改后的完整规格…}}`;
}
