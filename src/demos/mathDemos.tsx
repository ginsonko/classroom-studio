// 高中数学课堂演示：函数图像、三角函数、导数、圆锥曲线、直线与圆、数列、三角形四心、立体几何、概率分布、平面向量。
import { AngleArc, Arrow, Axes, Clip, Dot, Label, X, Y, ease, fnPath, frame, linePath, num, square, term, texNum, unX, unY, type DemoDef, type Frame, type P, type Theme } from './kit';

const PI = Math.PI;
/** 播放前（t=0）直接显示最终结果；播放时从 0 走到 1 */
const prog = (t: number, d: number) => (t <= 0 ? 1 : Math.min(1, t / d));
const sweep = (t: number, d: number) => Math.min(1, Math.max(0, t / d));
/** 乘在括号前的系数：1 不写，−1 只写负号 */
const coef = (a: number) => (Math.abs(a - 1) < 1e-9 ? '' : Math.abs(a + 1) < 1e-9 ? '-' : texNum(a));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const piFrac = (k: number, den = 12) => {
  if (k === 0) return '0';
  const g = gcd(Math.abs(k), den), n = k / g, d = den / g;
  const s = n < 0 ? '-' : '', a = Math.abs(n);
  return d === 1 ? `${s}${a === 1 ? '' : a}\\pi` : `${s}\\frac{${a === 1 ? '' : a}\\pi}{${d}}`;
};
const piText = (k: number, den = 12) => piFrac(k, den).replace(/\\frac\{(.*?)\}\{(\d+)\}/, '$1/$2').replace('\\pi', 'π').replace('-', '−');

// ── 1. 函数图像变换 ───────────────────────────────────────
const BASES: { label: string; tex: string; f: (x: number) => number; key: [number, number][]; vas?: number; has?: number; trig?: boolean }[] = [
  { label: 'x²', tex: 'x^2', f: (x) => x * x, key: [[0, 0]] },
  { label: 'x³', tex: 'x^3', f: (x) => x ** 3, key: [[0, 0]] },
  { label: '√x', tex: '\\sqrt{x}', f: (x) => (x < 0 ? NaN : Math.sqrt(x)), key: [[0, 0]] },
  { label: '1/x', tex: '\\frac{1}{x}', f: (x) => 1 / x, key: [], vas: 0, has: 0 },
  { label: '2ˣ', tex: '2^{x}', f: (x) => 2 ** x, key: [[0, 1]], has: 0 },
  { label: 'log₂x', tex: '\\log_2 x', f: (x) => (x <= 0 ? NaN : Math.log2(x)), key: [[1, 0]], vas: 0 },
  { label: 'sin x', tex: '\\sin x', f: Math.sin, key: [[0, 0]], trig: true },
  { label: '|x|', tex: '|x|', f: Math.abs, key: [[0, 0]] },
];
const inner = (w: number, h: number, v = 'x') => {
  const sh = Math.abs(h) < 1e-9 ? v : `${v}${h > 0 ? '-' : '+'}${texNum(Math.abs(h))}`;
  if (Math.abs(w - 1) < 1e-9) return sh;
  return `${texNum(w)}${Math.abs(h) < 1e-9 ? v : `(${sh})`}`;
};
/** 变换步骤说明，跳过不起作用的步骤（平移 0、伸缩 1 倍） */
const steps = (p: P) => {
  // f(x) → f(ωx) → f(ω(x−h))：先伸缩再平移，平移量才是 h
  const s1 = [Math.abs(p.w - 1) > 1e-9 ? `横坐标变为原来的 ${num(1 / p.w, 3)} 倍` : '', Math.abs(p.h) > 1e-9 ? `${Math.abs(p.w - 1) > 1e-9 ? '再' : ''}${p.h > 0 ? '向右' : '向左'}平移 ${num(Math.abs(p.h))}` : ''].filter(Boolean).join('，');
  const s2 = Math.abs(p.A - 1) > 1e-9 ? `纵坐标乘 ${num(p.A)}` : '';
  const s3 = Math.abs(p.k) > 1e-9 ? `${p.k > 0 ? '向上' : '向下'}平移 ${num(Math.abs(p.k))}` : '';
  const all = [s1, s2, s3].filter(Boolean);
  return all.length ? all.map((x, i) => '①②③'[i] + x).join('　') : '没有变换';
};
const transform: DemoDef = {
  id: 'm.transform', subject: 'math', group: '函数', title: '函数图像变换', summary: '平移、伸缩：y = A·f(ω(x−h)) + k',
  keywords: ['平移', '伸缩', '图像变换', '向左平移', '向右平移', '横坐标', '纵坐标'],
  params: [
    { key: 'base', label: '原函数', min: 1, max: 8, step: 1, def: 1, options: BASES.map((b, i) => ({ v: i + 1, label: b.label })) },
    { key: 'A', label: '纵向伸缩 A', min: -3, max: 3, step: 0.1, def: 2 },
    { key: 'w', label: '横向伸缩 ω', min: 0.25, max: 4, step: 0.05, def: 1 },
    { key: 'h', label: '左右平移 h', min: -5, max: 5, step: 0.1, def: 1 },
    { key: 'k', label: '上下平移 k', min: -4, max: 4, step: 0.1, def: 1 },
  ],
  duration: 9, play: '分三步演示：先左右平移和横向伸缩，再纵向伸缩，最后上下平移',
  view: (p, t, { th }) => {
    const b = BASES[p.base - 1] ?? BASES[0];
    const f = b.trig ? frame(-2.2 * PI, 2.2 * PI, -4.6, 4.6) : frame(-8, 8, -4.6, 4.6);
    const s = prog(t, 9), e1 = ease(s * 3), e2 = ease(s * 3 - 1), e3 = ease(s * 3 - 2);
    const w = 1 + (p.w - 1) * e1, h = p.h * e1, A = 1 + (p.A - 1) * e2, k = p.k * e3;
    const g = (x: number) => A * b.f(w * (x - h)) + k;
    const map = ([x0, y0]: [number, number]) => [x0 / w + h, A * y0 + k] as const;
    return <>
      <Axes f={f} th={th} piX={b.trig} />
      <Clip id="tr" f={f}>
        <path d={fnPath(f, b.f)} stroke={th.sub} strokeWidth={3} strokeDasharray="10 8" fill="none" />
        {b.vas !== undefined && <line x1={X(f, b.vas / 1 + h)} x2={X(f, b.vas + h)} y1={f.T} y2={f.T + f.Ht} stroke={th.orange} strokeDasharray="6 8" strokeWidth={2} />}
        {b.has !== undefined && <line y1={Y(f, A * b.has + k)} y2={Y(f, A * b.has + k)} x1={f.L} x2={f.L + f.Wd} stroke={th.orange} strokeDasharray="6 8" strokeWidth={2} />}
        <path d={fnPath(f, g)} stroke={th.blue} strokeWidth={5} fill="none" />
        {b.key.map((kp, i) => { const [x1, y1] = map(kp); return <g key={i}>
          <Dot x={X(f, kp[0])} y={Y(f, kp[1])} color={th.sub} r={6} />
          {(Math.abs(x1 - kp[0]) > 0.05 || Math.abs(y1 - kp[1]) > 0.05) && <Arrow x1={X(f, kp[0])} y1={Y(f, kp[1])} x2={X(f, x1)} y2={Y(f, y1)} color={th.orange} w={2.5} dash="6 6" />}
          <Dot x={X(f, x1)} y={Y(f, y1)} color={th.red} r={8} />
          <Label x={X(f, x1) + 12} y={Y(f, y1) - 12} color={th.red} size={22} italic={false}>({num(x1)}, {num(y1)})</Label>
        </g>; })}
      </Clip>
      <Label x={f.L + 16} y={f.T + f.Ht - 16} color={th.sub} size={22} italic={false}>虚线：y = {b.label}　　实线：变换后</Label>
    </>;
  },
  formulas: (p) => {
    const b = BASES[p.base - 1] ?? BASES[0];
    const body = b.tex.includes('x') ? b.tex.replace(/x/g, `\\left(${inner(p.w, p.h)}\\right)`) : b.tex;
    const A = Math.abs(p.A - 1) < 1e-9 ? '' : Math.abs(p.A + 1) < 1e-9 ? '-' : texNum(p.A);
    const k = Math.abs(p.k) < 1e-9 ? '' : (p.k > 0 ? '+' : '-') + texNum(Math.abs(p.k));
    return [
      { tex: `y=${b.tex}`, note: '原函数' },
      { tex: `y=${A}${body}${k}`, note: steps(p) },
    ];
  },
  corner: 'tl',
};

// ── 2. 二次函数 ──────────────────────────────────────────
const quad: DemoDef = {
  id: 'm.quad', subject: 'math', group: '函数', title: '二次函数的图像与性质', summary: '开口、顶点、对称轴、判别式与零点',
  keywords: ['二次函数', '抛物线', '顶点', '对称轴', '判别式', 'ax²', 'ax^2'],
  params: [
    { key: 'a', label: 'a', min: -3, max: 3, step: 0.1, def: 1 },
    { key: 'b', label: 'b', min: -8, max: 8, step: 0.1, def: -2 },
    { key: 'c', label: 'c', min: -8, max: 8, step: 0.1, def: -3 },
  ],
  fix: (p) => ({ ...p, a: Math.abs(p.a) < 0.1 ? (p.a < 0 ? -0.1 : 0.1) : p.a }),
  duration: 8, play: '点 P 沿抛物线从左往右走，看函数的增减',
  view: (p, t, { th }) => {
    const { a, b, c } = p, xv = -b / (2 * a), yv = (4 * a * c - b * b) / (4 * a), D = b * b - 4 * a * c;
    const f = frame(-8, 8, -9, 9);
    const fn = (x: number) => a * x * x + b * x + c;
    const xp = f.x0 + 0.5 + (f.x1 - f.x0 - 1) * sweep(t, 8), yp = fn(xp), up = 2 * a * xp + b > 0;
    const roots = D >= 0 ? [(-b - Math.sqrt(D)) / (2 * a), (-b + Math.sqrt(D)) / (2 * a)] : [];
    return <>
      <Axes f={f} th={th} />
      <Clip id="qd" f={f}>
        <line x1={X(f, xv)} x2={X(f, xv)} y1={f.T} y2={f.T + f.Ht} stroke={th.violet} strokeWidth={2.5} strokeDasharray="10 8" />
        <path d={fnPath(f, fn)} stroke={th.blue} strokeWidth={5} fill="none" />
        <Dot x={X(f, xv)} y={Y(f, yv)} color={th.red} r={9} />
        <Label x={X(f, xv) + 14} y={Y(f, yv) + (a > 0 ? 34 : -16)} color={th.red} size={24} italic={false}>顶点 ({num(xv)}, {num(yv)})</Label>
        <Label x={X(f, xv) + 10} y={f.T + 30} color={th.violet} size={22} italic={false}>x = {num(xv)}</Label>
        {roots.map((r, i) => <g key={i}><Dot x={X(f, r)} y={Y(f, 0)} color={th.green} r={8} /><Label x={X(f, r)} y={Y(f, 0) + (a > 0 ? -16 : 36)} anchor="middle" color={th.green} size={22} italic={false}>{num(r)}</Label></g>)}
        <Dot x={X(f, 0)} y={Y(f, c)} color={th.orange} r={7} />
        {t > 0 && <g>
          <Dot x={X(f, xp)} y={Y(f, yp)} color={th.ink} r={10} ring={up ? th.green : th.red} />
          <Label x={X(f, xp) + 16} y={Y(f, yp) - 14} color={up ? th.green : th.red} size={24} italic={false}>{up ? 'y 随 x 增大而增大' : 'y 随 x 增大而减小'}</Label>
        </g>}
      </Clip>
    </>;
  },
  formulas: (p) => {
    const { a, b, c } = p, h = -b / (2 * a), k = (4 * a * c - b * b) / (4 * a);
    const poly = `y=${term(a, 'x^2', true)}${term(b, 'x')}${term(c, '')}`.replace(/−/g, '-');
    return [
      { tex: poly || 'y=0' },
      { tex: `y=${coef(a)}${Math.abs(h) < 1e-9 ? 'x^2' : `\\left(x${h > 0 ? '-' : '+'}${texNum(Math.abs(h))}\\right)^2`}${Math.abs(k) < 1e-9 ? '' : (k > 0 ? '+' : '-') + texNum(Math.abs(k))}`, note: '配方得顶点式' },
      { tex: `\\Delta=b^2-4ac=${texNum(b * b - 4 * a * c)}`, note: b * b - 4 * a * c > 1e-9 ? '两个不同零点' : Math.abs(b * b - 4 * a * c) <= 1e-9 ? '一个零点（相切）' : '没有零点' },
    ];
  },
  info: (p) => [{ k: '开口', v: p.a > 0 ? '向上' : '向下' }, { k: p.a > 0 ? '最小值' : '最大值', v: num((4 * p.a * p.c - p.b * p.b) / (4 * p.a)) }, { k: 'y 轴交点', v: `(0, ${num(p.c)})` }],
  corner: 'tl',
};

// ── 3. 三角函数 y = A sin(ωx + φ) + B（单位圆展开）────────────────
const trig: DemoDef = {
  id: 'm.trig', subject: 'math', group: '三角函数', title: '正弦型函数 y = A sin(ωx+φ) + B', summary: '单位圆上的点转动，展开成正弦曲线',
  keywords: ['sin', 'cos', '正弦', '余弦', '三角函数', '周期', '振幅', '初相', 'ω', 'φ'],
  params: [
    { key: 'A', label: '振幅 A', min: 0.5, max: 3, step: 0.1, def: 2 },
    { key: 'w', label: 'ω', min: 0.5, max: 4, step: 0.1, def: 2 },
    { key: 'phi', label: 'φ（×π/12）', min: -12, max: 12, step: 1, def: 4 },
    { key: 'B', label: '上下平移 B', min: -1.5, max: 1.5, step: 0.1, def: 0 },
  ],
  duration: 12, play: '圆上的点按 ωx+φ 转动，同步画出曲线',
  view: (p, t, { th }) => {
    const f = frame(-PI / 2, 2.5 * PI, -5, 5, 560, 60, 960, 780);
    const phi = p.phi * PI / 12, fn = (x: number) => p.A * Math.sin(p.w * x + phi) + p.B;
    const xt = t > 0 ? f.x0 + (f.x1 - f.x0) * sweep(t, 12) : 0;
    const th0 = p.w * xt + phi, ppu = f.Ht / (f.y1 - f.y0), R = p.A * ppu, cx = 260, cy = Y(f, p.B);
    const px = cx + R * Math.cos(th0), py = cy - R * Math.sin(th0), gx = X(f, xt), gy = Y(f, fn(xt));
    const T = 2 * PI / p.w;
    return <>
      <Axes f={f} th={th} piX />
      <line x1={cx - R - 30} x2={cx + R + 30} y1={cy} y2={cy} stroke={th.axis} strokeWidth={1.5} />
      <line x1={cx} x2={cx} y1={cy - R - 30} y2={cy + R + 30} stroke={th.axis} strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={th.sub} strokeWidth={2.5} />
      <line x1={cx} y1={cy} x2={px} y2={py} stroke={th.orange} strokeWidth={4} />
      <AngleArc cx={cx} cy={cy} a0={-th0} a1={0} r={36} color={th.orange} />
      <line x1={px} y1={py} x2={gx} y2={gy} stroke={th.violet} strokeWidth={2} strokeDasharray="6 6" />
      <Dot x={px} y={py} color={th.red} r={9} />
      <Clip id="tg" f={f}>
        <path d={fnPath(f, fn)} stroke={th.blue} strokeWidth={3} opacity={0.35} fill="none" />
        <path d={fnPath(f, fn, f.x0, Math.max(f.x0 + 1e-3, t > 0 ? xt : f.x1))} stroke={th.blue} strokeWidth={5} fill="none" />
        <line x1={X(f, -phi / p.w)} x2={X(f, -phi / p.w + T)} y1={Y(f, p.B - p.A) + 26} y2={Y(f, p.B - p.A) + 26} stroke={th.green} strokeWidth={3} />
        <Label x={X(f, -phi / p.w + T / 2)} y={Y(f, p.B - p.A) + 56} anchor="middle" color={th.green} size={22} italic={false}>一个周期 T = {num(T)}</Label>
        <Dot x={gx} y={gy} color={th.red} r={9} />
      </Clip>
      <Label x={cx} y={cy + R + 64} anchor="middle" color={th.sub} size={22} italic={false}>半径 = 振幅 A</Label>
    </>;
  },
  formulas: (p) => {
    // T = 2π/ω：能写成 kπ/12 的就写成 π 的分数，否则给小数
    const k = 24 / p.w, Tt = Math.abs(k - Math.round(k)) < 1e-6 ? piFrac(Math.round(k)) + '\\approx' + texNum(2 * PI / p.w) : texNum(2 * PI / p.w);
    return [{ tex: `y=${coef(p.A)}\\sin\\left(${coef(p.w)}x${p.phi > 0 ? '+' : p.phi < 0 ? '-' : ''}${p.phi ? piFrac(Math.abs(p.phi)) : ''}\\right)${p.B ? (p.B > 0 ? '+' : '-') + texNum(Math.abs(p.B)) : ''}` },
      { tex: `T=\\frac{2\\pi}{\\omega}=${Tt}`, note: `振幅 ${num(p.A)}，初相 ${piText(p.phi)}` }];
  },
  info: (p) => [{ k: '最大值', v: num(p.A + p.B) }, { k: '最小值', v: num(p.B - p.A) }],
  corner: 'tr',
};

// ── 4. 指数函数与对数函数 ─────────────────────────────────
const explog: DemoDef = {
  id: 'm.explog', subject: 'math', group: '函数', title: '指数函数与对数函数', summary: 'y = aˣ 与 y = logₐx 关于 y = x 对称',
  keywords: ['指数函数', '对数函数', 'log', '反函数', '互为反函数'],
  params: [{ key: 'a', label: '底数 a', min: 0.2, max: 4, step: 0.05, def: 2 }],
  fix: (p) => ({ ...p, a: Math.abs(p.a - 1) < 0.05 ? 1.05 : p.a }),
  duration: 8, play: '点 P 在 y=aˣ 上移动，对称点 Q 同步在 y=logₐx 上',
  view: (p, t, { th }) => {
    const f = square(0.8, 1.2, 6.2), a = p.a;
    const ex = (x: number) => a ** x, lg = (x: number) => (x <= 0 ? NaN : Math.log(x) / Math.log(a));
    const xp = -3 + 6 * (t > 0 ? sweep(t, 8) : 0.75), yp = ex(xp);
    return <>
      <Axes f={f} th={th} step={1} />
      <Clip id="el" f={f}>
        <line x1={X(f, -10)} y1={Y(f, -10)} x2={X(f, 10)} y2={Y(f, 10)} stroke={th.sub} strokeWidth={2} strokeDasharray="8 8" />
        <path d={fnPath(f, ex)} stroke={th.blue} strokeWidth={5} fill="none" />
        <path d={fnPath(f, lg, 0.0005, f.x1, 1600)} stroke={th.red} strokeWidth={5} fill="none" />
        <Dot x={X(f, 0)} y={Y(f, 1)} color={th.blue} r={8} /><Label x={X(f, 0) - 12} y={Y(f, 1) - 10} anchor="end" color={th.blue} size={22} italic={false}>(0,1)</Label>
        <Dot x={X(f, 1)} y={Y(f, 0)} color={th.red} r={8} /><Label x={X(f, 1) + 8} y={Y(f, 0) + 30} color={th.red} size={22} italic={false}>(1,0)</Label>
        <line x1={X(f, xp)} y1={Y(f, yp)} x2={X(f, yp)} y2={Y(f, xp)} stroke={th.violet} strokeWidth={2.5} strokeDasharray="6 6" />
        <Dot x={X(f, xp)} y={Y(f, yp)} color={th.blue} r={10} ring={th.bg} /><Label x={X(f, xp) - 14} y={Y(f, yp) - 14} anchor="end" color={th.blue}>P</Label>
        <Dot x={X(f, yp)} y={Y(f, xp)} color={th.red} r={10} ring={th.bg} /><Label x={X(f, yp) + 14} y={Y(f, xp) + 28} color={th.red}>Q</Label>
        <Label x={X(f, 4.6)} y={Y(f, 4.6) + 34} color={th.sub} size={22}>y = x</Label>
      </Clip>
    </>;
  },
  formulas: (p) => [{ tex: `y=${texNum(p.a)}^{x}`, note: '蓝线' }, { tex: `y=\\log_{${texNum(p.a)}}x`, note: '红线' }],
  info: (p) => [{ k: '单调性', v: p.a > 1 ? 'a > 1：都是增函数' : '0 < a < 1：都是减函数' }, { k: '指数函数', v: '定义域 R，值域 (0,+∞)' }, { k: '对数函数', v: '定义域 (0,+∞)，值域 R' }],
  corner: 'tl',
};

// ── 5. 导数与切线 ──────────────────────────────────────
const FNS: { label: string; tex: string; d: string; f: (x: number) => number; df: (x: number) => number; pos?: boolean; nz?: boolean }[] = [
  { label: 'x³−3x', tex: 'x^3-3x', d: '3x^2-3', f: (x) => x ** 3 - 3 * x, df: (x) => 3 * x * x - 3 },
  { label: 'x²−2x', tex: 'x^2-2x', d: '2x-2', f: (x) => x * x - 2 * x, df: (x) => 2 * x - 2 },
  { label: 'sin x', tex: '\\sin x', d: '\\cos x', f: Math.sin, df: Math.cos },
  { label: 'eˣ', tex: 'e^{x}', d: 'e^{x}', f: Math.exp, df: Math.exp },
  { label: 'ln x', tex: '\\ln x', d: '\\frac{1}{x}', f: (x) => (x <= 0 ? NaN : Math.log(x)), df: (x) => 1 / x, pos: true },
  { label: '1/x', tex: '\\frac{1}{x}', d: '-\\frac{1}{x^2}', f: (x) => 1 / x, df: (x) => -1 / (x * x), nz: true },
];
const deriv: DemoDef = {
  id: 'm.deriv', subject: 'math', group: '导数', title: '导数的几何意义：切线斜率', summary: '割线逼近切线；切线斜率就是 f′(x₀)',
  keywords: ['导数', '切线', '斜率', "f'(x", '割线', '单调', '极值'],
  params: [
    { key: 'fn', label: '函数', min: 1, max: 6, step: 1, def: 1, options: FNS.map((g, i) => ({ v: i + 1, label: g.label })) },
    { key: 'x0', label: '切点 x₀', min: -3, max: 3, step: 0.05, def: 1.5 },
    { key: 'mode', label: '播放内容', min: 0, max: 1, step: 1, def: 0, options: [{ v: 0, label: '切点移动' }, { v: 1, label: '割线逼近' }] },
    { key: 'showD', label: '导函数', min: 0, max: 1, step: 1, def: 0, options: [{ v: 0, label: '隐藏' }, { v: 1, label: '显示' }] },
  ],
  fix: (p) => { const g = FNS[p.fn - 1] ?? FNS[0]; let x0 = p.x0; if (g.pos && x0 < 0.2) x0 = 0.2; if (g.nz && Math.abs(x0) < 0.2) x0 = x0 < 0 ? -0.2 : 0.2; return { ...p, x0 }; },
  duration: 10, play: '切点移动：看切线斜率的正负；割线逼近：Q 向 P 靠拢',
  view: (p, t, { th }) => {
    const g = FNS[p.fn - 1] ?? FNS[0], f = frame(-4.5, 4.5, -4.5, 4.5);
    const s = sweep(t, 10);
    let x0 = p.x0;
    if (t > 0 && p.mode === 0) { x0 = (g.pos ? 0.25 : -3) + (g.pos ? 3.75 : 6) * s; if (g.nz && Math.abs(x0) < 0.15) x0 = 0.15; }
    const y0 = g.f(x0), k = g.df(x0), hh = p.mode === 1 ? 2.5 * (1 - (t > 0 ? s : 0)) + 0.02 : 0;
    const xq = x0 + hh, yq = g.f(xq), ks = hh ? (yq - y0) / hh : k;
    const lineY = (kk: number) => (x: number) => y0 + kk * (x - x0);
    return <>
      <Axes f={f} th={th} step={1} />
      <Clip id="dv" f={f}>
        {p.showD === 1 && <path d={fnPath(f, g.df)} stroke={th.violet} strokeWidth={3} strokeDasharray="10 6" fill="none" />}
        <path d={fnPath(f, g.f)} stroke={th.blue} strokeWidth={5} fill="none" />
        {p.mode === 1 && hh > 0.03 && <path d={linePath(f, lineY(ks))} stroke={th.orange} strokeWidth={3} fill="none" />}
        <path d={linePath(f, lineY(k))} stroke={k > 1e-6 ? th.green : k < -1e-6 ? th.red : th.ink} strokeWidth={4} fill="none" opacity={p.mode === 1 && hh > 0.03 ? 0.5 : 1} />
        <Dot x={X(f, x0)} y={Y(f, y0)} color={th.red} r={10} ring={th.bg} />
        <Label x={X(f, x0) - 14} y={Y(f, y0) - 16} anchor="end" color={th.red}>P</Label>
        {p.mode === 1 && hh > 0.03 && <><Dot x={X(f, xq)} y={Y(f, yq)} color={th.orange} r={9} ring={th.bg} /><Label x={X(f, xq) + 14} y={Y(f, yq) - 14} color={th.orange}>Q</Label></>}
        {p.showD === 1 && <Dot x={X(f, x0)} y={Y(f, k)} color={th.violet} r={7} />}
      </Clip>
    </>;
  },
  formulas: (p, t) => {
    const g = FNS[p.fn - 1] ?? FNS[0];
    let x0 = p.x0; if (t > 0 && p.mode === 0) x0 = (g.pos ? 0.25 : -3) + (g.pos ? 3.75 : 6) * sweep(t, 10);
    const k = g.df(x0), hh = p.mode === 1 ? 2.5 * (1 - (t > 0 ? sweep(t, 10) : 0)) + 0.02 : 0;
    const rows = [{ tex: `f(x)=${g.tex},\\quad f'(x)=${g.d}` }, { tex: `f'(${texNum(x0)})=${texNum(k, 3)}`, note: k > 1e-6 ? '切线向上倾斜：函数在这里递增' : k < -1e-6 ? '切线向下倾斜：函数在这里递减' : '切线水平：可能是极值点' }];
    if (p.mode === 1) rows.push({ tex: `\\frac{f(x_0+\\Delta x)-f(x_0)}{\\Delta x}=${texNum((g.f(x0 + hh) - g.f(x0)) / hh, 3)}\\;(\\Delta x=${texNum(hh, 2)})`, note: 'Δx → 0 时，割线斜率 → 切线斜率' });
    return rows;
  },
  corner: 'tl',
};

// ── 6. 圆锥曲线 ────────────────────────────────────────
const conic: DemoDef = {
  id: 'm.conic', subject: 'math', group: '解析几何', title: '圆锥曲线的定义', summary: '椭圆、双曲线、抛物线上动点到焦点（准线）的距离关系',
  keywords: ['椭圆', '双曲线', '抛物线', '焦点', '离心率', '准线', '圆锥曲线'],
  params: [
    { key: 'type', label: '曲线', min: 1, max: 3, step: 1, def: 1, options: [{ v: 1, label: '椭圆' }, { v: 2, label: '双曲线' }, { v: 3, label: '抛物线' }] },
    { key: 'a', label: 'a', min: 1, max: 6, step: 0.1, def: 5, when: (p) => p.type !== 3 },
    { key: 'b', label: 'b', min: 0.5, max: 5, step: 0.1, def: 3, when: (p) => p.type !== 3 },
    { key: 'p', label: 'p', min: 0.5, max: 4, step: 0.1, def: 2, when: (p) => p.type === 3 },
  ],
  fix: (p) => ({ ...p, b: p.type === 1 && p.b >= p.a ? Math.max(0.5, +(p.a - 0.1).toFixed(2)) : p.b }),
  duration: 12, play: '动点 P 沿曲线运动，距离关系保持不变',
  view: (p, t, { th }) => {
    const f = square(0, 0, 9), ang = PI / 3 + 2 * PI * sweep(t, 12);
    let P: [number, number], F1: [number, number], F2: [number, number] | null = null, curve = '', extra = null;
    if (p.type === 1) {
      const c = Math.sqrt(p.a * p.a - p.b * p.b); F1 = [-c, 0]; F2 = [c, 0];
      P = [p.a * Math.cos(ang), p.b * Math.sin(ang)];
      curve = `M${X(f, p.a)} ${Y(f, 0)} A${(X(f, p.a) - X(f, 0))} ${(Y(f, 0) - Y(f, p.b))} 0 1 0 ${X(f, -p.a)} ${Y(f, 0)} A${(X(f, p.a) - X(f, 0))} ${(Y(f, 0) - Y(f, p.b))} 0 1 0 ${X(f, p.a)} ${Y(f, 0)}`;
    } else if (p.type === 2) {
      const c = Math.sqrt(p.a * p.a + p.b * p.b); F1 = [-c, 0]; F2 = [c, 0];
      const u = 1.7 * Math.sin(ang - PI / 3 + 0.5);
      P = [p.a * Math.cosh(u), p.b * Math.sinh(u)];
      const br = (sg: number) => { let d = ''; for (let i = 0; i <= 200; i++) { const v = -3 + 6 * i / 200; d += (i ? 'L' : 'M') + X(f, sg * p.a * Math.cosh(v)).toFixed(1) + ' ' + Y(f, p.b * Math.sinh(v)).toFixed(1); } return d; };
      curve = br(1) + br(-1);
      extra = <g>{[1, -1].map((s) => <line key={s} x1={X(f, -10)} y1={Y(f, s * -10 * p.b / p.a)} x2={X(f, 10)} y2={Y(f, s * 10 * p.b / p.a)} stroke={th.sub} strokeWidth={2} strokeDasharray="8 8" />)}</g>;
    } else {
      F1 = [p.p / 2, 0];
      const yy = 5 * Math.sin(ang - PI / 3 + 0.6); P = [yy * yy / (2 * p.p), yy];
      let d = ''; for (let i = 0; i <= 200; i++) { const v = -8 + 16 * i / 200; d += (i ? 'L' : 'M') + X(f, v * v / (2 * p.p)).toFixed(1) + ' ' + Y(f, v).toFixed(1); }
      curve = d;
      extra = <g><line x1={X(f, -p.p / 2)} x2={X(f, -p.p / 2)} y1={f.T} y2={f.T + f.Ht} stroke={th.violet} strokeWidth={3} strokeDasharray="10 8" />
        <Label x={X(f, -p.p / 2) - 10} y={f.T + 34} anchor="end" color={th.violet} size={22} italic={false}>准线 x = {num(-p.p / 2)}</Label>
        <line x1={X(f, P[0])} y1={Y(f, P[1])} x2={X(f, -p.p / 2)} y2={Y(f, P[1])} stroke={th.green} strokeWidth={4} />
        <Label x={(X(f, P[0]) + X(f, -p.p / 2)) / 2} y={Y(f, P[1]) - 12} anchor="middle" color={th.green} size={22}>d = {num(P[0] + p.p / 2)}</Label></g>;
    }
    const d1 = Math.hypot(P[0] - F1[0], P[1] - F1[1]), d2 = F2 ? Math.hypot(P[0] - F2[0], P[1] - F2[1]) : 0;
    const mid = (A: [number, number], B: [number, number]) => [(X(f, A[0]) + X(f, B[0])) / 2, (Y(f, A[1]) + Y(f, B[1])) / 2];
    const m1 = mid(P, F1), m2 = F2 ? mid(P, F2) : [0, 0];
    return <>
      <Axes f={f} th={th} step={1} />
      <Clip id="cn" f={f}>
        {extra}
        <path d={curve} stroke={th.blue} strokeWidth={5} fill="none" />
        <line x1={X(f, P[0])} y1={Y(f, P[1])} x2={X(f, F1[0])} y2={Y(f, F1[1])} stroke={th.red} strokeWidth={4} />
        {F2 && <line x1={X(f, P[0])} y1={Y(f, P[1])} x2={X(f, F2[0])} y2={Y(f, F2[1])} stroke={th.orange} strokeWidth={4} />}
        <Label x={m1[0]} y={m1[1] - 10} anchor="middle" color={th.red} size={22}>{num(d1)}</Label>
        {F2 && <Label x={m2[0]} y={m2[1] - 10} anchor="middle" color={th.orange} size={22}>{num(d2)}</Label>}
        <Dot x={X(f, F1[0])} y={Y(f, F1[1])} color={th.red} r={8} /><Label x={X(f, F1[0])} y={Y(f, F1[1]) + 34} anchor="middle" color={th.red}>{F2 ? 'F₁' : 'F'}</Label>
        {F2 && <><Dot x={X(f, F2[0])} y={Y(f, F2[1])} color={th.orange} r={8} /><Label x={X(f, F2[0])} y={Y(f, F2[1]) + 34} anchor="middle" color={th.orange}>F₂</Label></>}
        <Dot x={X(f, P[0])} y={Y(f, P[1])} color={th.ink} r={10} ring={th.blue} /><Label x={X(f, P[0]) + 14} y={Y(f, P[1]) - 14} color={th.fg}>P</Label>
      </Clip>
    </>;
  },
  formulas: (p) => {
    if (p.type === 1) { const c = Math.sqrt(p.a * p.a - p.b * p.b); return [{ tex: `\\frac{x^2}{${texNum(p.a * p.a)}}+\\frac{y^2}{${texNum(p.b * p.b)}}=1` }, { tex: `|PF_1|+|PF_2|=2a=${texNum(2 * p.a)}`, note: `c = ${num(c)}，离心率 e = c/a = ${num(c / p.a, 3)}` }]; }
    if (p.type === 2) { const c = Math.sqrt(p.a * p.a + p.b * p.b); return [{ tex: `\\frac{x^2}{${texNum(p.a * p.a)}}-\\frac{y^2}{${texNum(p.b * p.b)}}=1` }, { tex: `\\big||PF_1|-|PF_2|\\big|=2a=${texNum(2 * p.a)}`, note: `c = ${num(c)}，e = ${num(c / p.a, 3)}，渐近线 y = ±${num(p.b / p.a, 3)}x` }]; }
    return [{ tex: `y^2=${texNum(2 * p.p)}x` }, { tex: `|PF|=d=x_P+\\frac{p}{2}`, note: `焦点 (${num(p.p / 2)}, 0)，准线 x = ${num(-p.p / 2)}，e = 1` }];
  },
  corner: 'tl',
};

// ── 7. 直线与圆的位置关系 ─────────────────────────────────
const lineCircle: DemoDef = {
  id: 'm.lineCircle', subject: 'math', group: '解析几何', title: '直线与圆的位置关系', summary: '比较圆心到直线的距离 d 与半径 r',
  keywords: ['直线与圆', '相切', '相交', '相离', '弦长', '圆心到直线的距离'],
  params: [
    { key: 'r', label: '半径 r', min: 0.5, max: 5, step: 0.1, def: 3 },
    { key: 'cx', label: '圆心 a', min: -3, max: 3, step: 0.1, def: 0 },
    { key: 'cy', label: '圆心 b', min: -3, max: 3, step: 0.1, def: 0 },
    { key: 'k', label: '斜率 k', min: -3, max: 3, step: 0.1, def: 0.5 },
    { key: 'm', label: '截距 m', min: -9, max: 9, step: 0.1, def: 2 },
  ],
  duration: 10, play: '直线平移扫过圆：相离 → 相切 → 相交 → 相切 → 相离',
  view: (p, t, { th }) => {
    const f = square(0, 0, 9), q = Math.sqrt(1 + p.k * p.k), base = p.cy - p.k * p.cx;
    const m = t > 0 ? base - (p.r * q + 2) + 2 * (p.r * q + 2) * sweep(t, 10) : p.m;
    const d = Math.abs(p.k * p.cx - p.cy + m) / q;
    const foot = [p.cx - p.k * (p.k * p.cx - p.cy + m) / (q * q), p.cy + (p.k * p.cx - p.cy + m) / (q * q)];
    const rel = Math.abs(d - p.r) < 0.03 ? '相切' : d < p.r ? '相交' : '相离', col = rel === '相交' ? th.green : rel === '相切' ? th.orange : th.red;
    const half = d < p.r ? Math.sqrt(p.r * p.r - d * d) : 0, ux = 1 / q, uy = p.k / q;
    const R = (X(f, p.r) - X(f, 0));
    return <>
      <Axes f={f} th={th} step={1} />
      <Clip id="lc" f={f}>
        <circle cx={X(f, p.cx)} cy={Y(f, p.cy)} r={R} fill={th.blue} fillOpacity={0.06} stroke={th.blue} strokeWidth={5} />
        <path d={linePath(f, (x) => p.k * x + m)} stroke={col} strokeWidth={5} fill="none" />
        <line x1={X(f, p.cx)} y1={Y(f, p.cy)} x2={X(f, foot[0])} y2={Y(f, foot[1])} stroke={th.violet} strokeWidth={3} strokeDasharray="8 6" />
        <Label x={(X(f, p.cx) + X(f, foot[0])) / 2 + 12} y={(Y(f, p.cy) + Y(f, foot[1])) / 2} color={th.violet}>d</Label>
        <line x1={X(f, p.cx)} y1={Y(f, p.cy)} x2={X(f, p.cx - p.r * 0.6)} y2={Y(f, p.cy - p.r * 0.8)} stroke={th.blue} strokeWidth={2.5} />
        <Label x={X(f, p.cx - p.r * 0.3) - 14} y={Y(f, p.cy - p.r * 0.4)} anchor="end" color={th.blue}>r</Label>
        {half > 0 && [1, -1].map((s) => <Dot key={s} x={X(f, foot[0] + s * half * ux)} y={Y(f, foot[1] + s * half * uy)} color={th.green} r={9} />)}
        {half > 0 && <line x1={X(f, foot[0] + half * ux)} y1={Y(f, foot[1] + half * uy)} x2={X(f, foot[0] - half * ux)} y2={Y(f, foot[1] - half * uy)} stroke={th.green} strokeWidth={8} opacity={0.5} />}
        {rel === '相切' && <Dot x={X(f, foot[0])} y={Y(f, foot[1])} color={th.orange} r={10} />}
        <Dot x={X(f, p.cx)} y={Y(f, p.cy)} color={th.ink} r={7} />
        <Label x={X(f, foot[0]) + 20} y={Y(f, foot[1]) - 24} color={col} size={34} italic={false} bold>{rel}</Label>
      </Clip>
    </>;
  },
  formulas: (p, t) => {
    const q = Math.sqrt(1 + p.k * p.k), base = p.cy - p.k * p.cx;
    const m = t > 0 ? base - (p.r * q + 2) + 2 * (p.r * q + 2) * sweep(t, 10) : p.m, d = Math.abs(p.k * p.cx - p.cy + m) / q;
    const sq = (v: string, c: number) => (Math.abs(c) < 1e-9 ? `${v}^2` : `(${v}${c > 0 ? '-' : '+'}${texNum(Math.abs(c))})^2`);
    const kx = Math.abs(p.k) < 1e-9 ? '' : coef(p.k) + 'x', mm = Math.abs(m) < 1e-9 ? (kx ? '' : '0') : (kx && m > 0 ? '+' : m < 0 ? '-' : '') + texNum(Math.abs(m));
    return [{ tex: `${sq('x', p.cx)}+${sq('y', p.cy)}=${texNum(p.r * p.r)}`, note: `圆心 (${num(p.cx)}, ${num(p.cy)})，半径 ${num(p.r)}` }, { tex: `l:\\;y=${kx}${mm}` },
      { tex: `d=\\frac{|ka-b+m|}{\\sqrt{1+k^2}}=${texNum(d)}`, note: d < p.r - 0.03 ? `d < r，相交，弦长 2√(r²−d²) = ${num(2 * Math.sqrt(p.r * p.r - d * d))}` : Math.abs(d - p.r) <= 0.03 ? 'd = r，相切' : 'd > r，相离' }];
  },
  corner: 'tl',
};

// ── 8. 等差与等比数列 ─────────────────────────────────────
const seq: DemoDef = {
  id: 'm.seq', subject: 'math', group: '数列', title: '等差数列与等比数列', summary: '每一项画成柱子，看通项和前 n 项和',
  keywords: ['数列', '等差', '等比', '公差', '公比', '前n项和', 'Sn', 'aₙ', 'a_n'],
  params: [
    { key: 'type', label: '类型', min: 1, max: 2, step: 1, def: 1, options: [{ v: 1, label: '等差' }, { v: 2, label: '等比' }] },
    { key: 'a1', label: '首项 a₁', min: -5, max: 5, step: 0.5, def: 1 },
    { key: 'd', label: '公差 d', min: -3, max: 3, step: 0.5, def: 2, when: (p) => p.type === 1 },
    { key: 'q', label: '公比 q', min: -2, max: 3, step: 0.1, def: 2, when: (p) => p.type === 2 },
    { key: 'n', label: '项数 n', min: 3, max: 12, step: 1, def: 8 },
    { key: 'pair', label: '倒序相加', min: 0, max: 1, step: 1, def: 0, options: [{ v: 0, label: '不显示' }, { v: 1, label: '显示' }], when: (p) => p.type === 1 },
  ],
  fix: (p) => ({ ...p, q: Math.abs(p.q) < 0.1 ? 0.1 : p.q }),
  duration: 8, play: '一项一项出现，同时累加前 n 项和',
  view: (p, t, { th }) => {
    const n = p.n, a = Array.from({ length: n }, (_, i) => (p.type === 1 ? p.a1 + i * p.d : p.a1 * p.q ** i));
    const shown = t > 0 ? Math.min(n, Math.floor(sweep(t, 8) * n * 1.0001) + 1) : n;
    const pair = p.type === 1 && p.pair === 1 && a.every((v) => v >= 0);
    const top = Math.max(1, ...a.map((v, i) => (pair ? v + a[n - 1 - i] : v))), bot = Math.min(0, ...a);
    const f = frame(0, n + 1, bot - (top - bot) * 0.1, top + (top - bot) * 0.12, 120, 110, 1380, 700);
    const bw = (f.Wd / (n + 1)) * 0.62;
    return <>
      <line x1={f.L} x2={f.L + f.Wd} y1={Y(f, 0)} y2={Y(f, 0)} stroke={th.axis} strokeWidth={2} />
      {a.slice(0, shown).map((v, i) => {
        const x = X(f, i + 1) - bw / 2, y = Y(f, Math.max(0, v)), h = Math.abs(Y(f, v) - Y(f, 0));
        return <g key={i}>
          <rect x={x} y={y} width={bw} height={Math.max(1, h)} rx={6} fill={v >= 0 ? th.blue : th.red} fillOpacity={0.8} />
          {pair && <rect x={x} y={Y(f, v + a[n - 1 - i])} width={bw} height={Y(f, v) - Y(f, v + a[n - 1 - i])} rx={6} fill={th.orange} fillOpacity={0.45} />}
          <Label x={X(f, i + 1)} y={v >= 0 ? y - 10 : Y(f, v) + 28} anchor="middle" color={th.fg} size={n > 9 ? 18 : 22} italic={false}>{num(v, 2)}</Label>
          <Label x={X(f, i + 1)} y={Math.max(Y(f, 0), Y(f, bot)) + 34} anchor="middle" color={th.sub} size={20}>a{String(i + 1).split('').map((c) => '₀₁₂₃₄₅₆₇₈₉'[+c]).join('')}</Label>
        </g>;
      })}
      {pair && shown === n && <Label x={f.L + 10} y={f.T - 20} color={th.orange} size={24} italic={false}>每一列 = a₁ + aₙ = {num(a[0] + a[n - 1])}，共 n 列，所以 2Sₙ = n(a₁ + aₙ)</Label>}
      <Label x={f.L + f.Wd} y={f.T - 60} anchor="end" color={th.green} size={30} italic={false} bold>S{String(shown).split('').map((c) => '₀₁₂₃₄₅₆₇₈₉'[+c]).join('')} = {num(a.slice(0, shown).reduce((s, v) => s + v, 0), 3)}</Label>
    </>;
  },
  formulas: (p) => p.type === 1
    ? [{ tex: `a_n=a_1+(n-1)d=${texNum(p.a1)}+(n-1)\\cdot${texNum(p.d)}` }, { tex: `S_n=\\frac{n(a_1+a_n)}{2}=na_1+\\frac{n(n-1)}{2}d` }]
    : [{ tex: `a_n=a_1q^{n-1}=${texNum(p.a1)}\\cdot${p.q < 0 ? `(${texNum(p.q)})` : texNum(p.q)}^{n-1}` }, { tex: `S_n=\\frac{a_1(1-q^n)}{1-q}\\;(q\\ne1)` }],
  corner: 'tl',
};

// ── 9. 三角形的四心（可拖动顶点）──────────────────────────
type V2 = [number, number];
export function centers(A: V2, B: V2, C: V2) {
  const a = Math.hypot(B[0] - C[0], B[1] - C[1]), b = Math.hypot(A[0] - C[0], A[1] - C[1]), c = Math.hypot(A[0] - B[0], A[1] - B[1]);
  const G: V2 = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
  const D = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  const s2 = (P: V2) => P[0] * P[0] + P[1] * P[1];
  const O: V2 = [(s2(A) * (B[1] - C[1]) + s2(B) * (C[1] - A[1]) + s2(C) * (A[1] - B[1])) / D, (s2(A) * (C[0] - B[0]) + s2(B) * (A[0] - C[0]) + s2(C) * (B[0] - A[0])) / D];
  const per = a + b + c, I: V2 = [(a * A[0] + b * B[0] + c * C[0]) / per, (a * A[1] + b * B[1] + c * C[1]) / per];
  const Hh: V2 = [A[0] + B[0] + C[0] - 2 * O[0], A[1] + B[1] + C[1] - 2 * O[1]];
  const area = Math.abs(D) / 4, R = Math.hypot(A[0] - O[0], A[1] - O[1]), r = 2 * area / per;
  const ang = (x: number, y: number, z: number) => Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z))));
  return { a, b, c, G, O, I, H: Hh, area, R, r, A: ang(a, b, c), B: ang(b, a, c), C: ang(c, a, b), degenerate: area < 1e-6 };
}
const triangle: DemoDef = {
  id: 'm.triangle', subject: 'math', group: '平面几何', title: '三角形的四心（几何画板）', summary: '拖动顶点，看重心、外心、内心、垂心和欧拉线',
  keywords: ['重心', '外心', '内心', '垂心', '外接圆', '内切圆', '欧拉线', '三角形'],
  params: [
    { key: 'show', label: '显示', min: 1, max: 5, step: 1, def: 2, options: [{ v: 1, label: '重心' }, { v: 2, label: '外心' }, { v: 3, label: '内心' }, { v: 4, label: '垂心' }, { v: 5, label: '四心 + 欧拉线' }] },
    { key: 'ax', label: 'A.x', min: -8, max: 8, step: 0.01, def: -5, hidden: true }, { key: 'ay', label: 'A.y', min: -4, max: 4, step: 0.01, def: -2.6, hidden: true },
    { key: 'bx', label: 'B.x', min: -8, max: 8, step: 0.01, def: 5, hidden: true }, { key: 'by', label: 'B.y', min: -4, max: 4, step: 0.01, def: -2.6, hidden: true },
    { key: 'cx', label: 'C.x', min: -8, max: 8, step: 0.01, def: -1.2, hidden: true }, { key: 'cy', label: 'C.y', min: -4, max: 4, step: 0.01, def: 3.2, hidden: true },
  ],
  duration: 10, play: '顶点 C 左右移动，看各心的位置变化（钝角时外心、垂心跑到外面）',
  view: (p, t, { th }) => {
    const f = square(0, 0, 8);
    const C: V2 = [t > 0 ? p.cx + 5.5 * Math.sin(2 * PI * sweep(t, 10)) : p.cx, p.cy], A: V2 = [p.ax, p.ay], B: V2 = [p.bx, p.by];
    const k = centers(A, B, C), s = p.show;
    const pt = (q: V2) => [X(f, q[0]), Y(f, q[1])] as const;
    const L = (P1: V2, P2: V2, col: string, dash?: string, w = 2.5) => <line x1={X(f, P1[0])} y1={Y(f, P1[1])} x2={X(f, P2[0])} y2={Y(f, P2[1])} stroke={col} strokeWidth={w} strokeDasharray={dash} />;
    const mid = (P1: V2, P2: V2): V2 => [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2];
    const footOn = (P0: V2, P1: V2, P2: V2): V2 => { const dx = P2[0] - P1[0], dy = P2[1] - P1[1], u = ((P0[0] - P1[0]) * dx + (P0[1] - P1[1]) * dy) / (dx * dx + dy * dy); return [P1[0] + u * dx, P1[1] + u * dy]; };
    const sc = X(f, 1) - X(f, 0);
    const V = [A, B, C] as V2[], names = ['A', 'B', 'C'];
    return <>
      <rect x={0} y={0} width={1600} height={900} fill="transparent" />
      <polygon points={V.map((q) => pt(q).join(',')).join(' ')} fill={th.blue} fillOpacity={0.06} stroke={th.fg} strokeWidth={4} strokeLinejoin="round" />
      {!k.degenerate && <>
        {(s === 1 || s === 5) && <g>{V.map((q, i) => <g key={i}>{L(q, mid(V[(i + 1) % 3], V[(i + 2) % 3]), th.blue, s === 5 ? '6 6' : undefined)}</g>)}</g>}
        {(s === 2 || s === 5) && <g>
          <circle cx={X(f, k.O[0])} cy={Y(f, k.O[1])} r={k.R * sc} fill="none" stroke={th.red} strokeWidth={3} />
          {s === 2 && V.map((q, i) => <g key={i}>{L(k.O, mid(q, V[(i + 1) % 3]), th.red, '6 6')}</g>)}
        </g>}
        {(s === 3 || s === 5) && <g>
          <circle cx={X(f, k.I[0])} cy={Y(f, k.I[1])} r={k.r * sc} fill="none" stroke={th.green} strokeWidth={3} />
          {s === 3 && V.map((q, i) => <g key={i}>{L(q, k.I, th.green, '6 6')}</g>)}
        </g>}
        {(s === 4 || s === 5) && <g>{V.map((q, i) => { const ft = footOn(q, V[(i + 1) % 3], V[(i + 2) % 3]); return <g key={i}>{L(q, ft, th.violet, s === 5 ? '6 6' : undefined)}{L(ft, k.H, th.violet, '3 6', 1.5)}</g>; })}</g>}
        {s === 5 && L([k.O[0] + (k.O[0] - k.H[0]) * 0.6, k.O[1] + (k.O[1] - k.H[1]) * 0.6], [k.H[0] + (k.H[0] - k.O[0]) * 0.6, k.H[1] + (k.H[1] - k.O[1]) * 0.6], th.orange, undefined, 3.5)}
        {(s === 1 || s === 5) && <><Dot x={X(f, k.G[0])} y={Y(f, k.G[1])} color={th.blue} r={9} /><Label x={X(f, k.G[0]) + 12} y={Y(f, k.G[1]) + 30} color={th.blue}>G</Label></>}
        {(s === 2 || s === 5) && <><Dot x={X(f, k.O[0])} y={Y(f, k.O[1])} color={th.red} r={9} /><Label x={X(f, k.O[0]) + 12} y={Y(f, k.O[1]) - 12} color={th.red}>O</Label></>}
        {(s === 3 || s === 5) && <><Dot x={X(f, k.I[0])} y={Y(f, k.I[1])} color={th.green} r={9} /><Label x={X(f, k.I[0]) + 12} y={Y(f, k.I[1]) - 12} color={th.green}>I</Label></>}
        {(s === 4 || s === 5) && <><Dot x={X(f, k.H[0])} y={Y(f, k.H[1])} color={th.violet} r={9} /><Label x={X(f, k.H[0]) + 12} y={Y(f, k.H[1]) - 12} color={th.violet}>H</Label></>}
      </>}
      {V.map((q, i) => { const c0 = k.G; const dx = q[0] - c0[0], dy = q[1] - c0[1], l = Math.hypot(dx, dy) || 1; return <Label key={i} x={X(f, q[0] + dx / l * 0.5)} y={Y(f, q[1] + dy / l * 0.5) + 10} anchor="middle" color={th.fg} size={30}>{names[i]}</Label>; })}
    </>;
  },
  handles: (p, t, { th }) => {
    const f = square(0, 0, 8);
    const mk = (kx: string, ky: string, color: string) => ({ key: kx, x: X(f, p[kx]), y: Y(f, p[ky]), color, move: (sx: number, sy: number, q: P) => ({ ...q, [kx]: +Math.max(-7.8, Math.min(7.8, unX(f, sx))).toFixed(2), [ky]: +Math.max(-4.3, Math.min(4.3, unY(f, sy))).toFixed(2) }) });
    return t > 0 ? [] : [mk('ax', 'ay', th.fg), mk('bx', 'by', th.fg), mk('cx', 'cy', th.fg)];
  },
  info: (p, t) => {
    const k = centers([p.ax, p.ay], [p.bx, p.by], [t > 0 ? p.cx + 5.5 * Math.sin(2 * PI * sweep(t, 10)) : p.cx, p.cy]);
    const deg = (r: number) => num(r * 180 / PI, 1) + '°';
    const kind = Math.max(k.A, k.B, k.C) > PI / 2 + 1e-3 ? '钝角三角形' : Math.abs(Math.max(k.A, k.B, k.C) - PI / 2) <= 1e-3 ? '直角三角形' : '锐角三角形';
    return [{ k: '形状', v: kind }, { k: '三边', v: `a=${num(k.a)}　b=${num(k.b)}　c=${num(k.c)}` }, { k: '三角', v: `A=${deg(k.A)}　B=${deg(k.B)}　C=${deg(k.C)}` }, { k: '面积', v: num(k.area) }, { k: 'R / r', v: `${num(k.R)} / ${num(k.r)}` }];
  },
  formulas: (p) => p.show === 5 ? [{ tex: '\\overrightarrow{OH}=3\\overrightarrow{OG}', note: '外心 O、重心 G、垂心 H 共线（欧拉线），且 GH = 2·OG' }]
    : p.show === 1 ? [{ tex: 'G\\left(\\frac{x_A+x_B+x_C}{3},\\frac{y_A+y_B+y_C}{3}\\right)', note: '三条中线的交点，分中线 2:1' }]
    : p.show === 2 ? [{ tex: '\\frac{a}{\\sin A}=2R', note: '三边垂直平分线的交点，到三个顶点距离相等' }]
    : p.show === 3 ? [{ tex: 'r=\\frac{2S}{a+b+c}', note: '三条角平分线的交点，到三边距离相等' }]
    : [{ tex: 'AH\\perp BC,\\;BH\\perp AC', note: '三条高的交点' }],
  corner: 'tr',
};

// ── 10. 立体几何（旋转观察，虚线表示看不见的棱）──────────────────
type V3 = [number, number, number];
interface Solid { v: V3[]; names: string[]; faces: number[][]; extra?: [number, number][]; extraNote?: string; note: string }
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function solidOf(kind: number): Solid {
  if (kind === 2) {
    const R = 2 / Math.sqrt(3), yb = -0.55, h = 2 * Math.sqrt(2 / 3);
    const base: V3[] = [0, 1, 2].map((i) => [R * Math.cos(PI / 2 + i * 2 * PI / 3 + PI / 6), yb, R * Math.sin(PI / 2 + i * 2 * PI / 3 + PI / 6)] as V3);
    return { v: [[0, yb + h, 0], ...base, [0, yb, 0]], names: ['A', 'B', 'C', 'D', 'O'], faces: [[1, 2, 3], [0, 1, 2], [0, 2, 3], [0, 3, 1]], extra: [[0, 4]], extraNote: '高 AO（O 是底面中心）', note: '正四面体：V = √2/12·a³' };
  }
  if (kind === 3) {
    const v: V3[] = [[0, 1.3, 0], [-1, -0.8, 1], [1, -0.8, 1], [1, -0.8, -1], [-1, -0.8, -1], [0, -0.8, 0]];
    return { v, names: ['P', 'A', 'B', 'C', 'D', 'O'], faces: [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]], extra: [[0, 5], [1, 3], [2, 4]], extraNote: '高 PO 与底面对角线', note: '正四棱锥：V = ⅓·S底·h' };
  }
  if (kind === 4) {
    const tri = (y: number): V3[] => [[-1.1, y, 0.75], [1.1, y, 0.75], [0, y, -1.15]];
    return { v: [...tri(-1), ...tri(1)], names: ['A', 'B', 'C', 'A₁', 'B₁', 'C₁'], faces: [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]], extra: [[0, 4], [1, 5]], extraNote: '侧面对角线 AB₁、BC₁', note: '三棱柱：V = S底·h' };
  }
  const v: V3[] = [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]];
  return { v, names: ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'], faces: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], extra: [[0, 6], [0, 2], [4, 6]], extraNote: '体对角线 AC₁ 与面对角线 AC、A₁C₁', note: '正方体：V = a³，体对角线 = √3·a' };
}
export function projectSolid(kind: number, yaw: number, pitch: number) {
  const s = solidOf(kind), cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const r = s.v.map(([x, y, z]) => { const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; return [x1, y * cp - z1 * sp, y * sp + z1 * cp] as V3; });
  const n = s.faces.length ? s.v.length - (kind === 2 ? 1 : kind === 3 ? 1 : 0) : 0;
  const cen: V3 = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) cen[k] += r[i][k] / n;
  const vis = s.faces.map((fc) => {
    let nn = cross(sub3(r[fc[1]], r[fc[0]]), sub3(r[fc[2]], r[fc[0]]));
    const fcen = fc.reduce<V3>((a, i) => [a[0] + r[i][0] / fc.length, a[1] + r[i][1] / fc.length, a[2] + r[i][2] / fc.length], [0, 0, 0]);
    const out = sub3(fcen, cen);
    if (nn[0] * out[0] + nn[1] * out[1] + nn[2] * out[2] < 0) nn = [-nn[0], -nn[1], -nn[2]];
    return nn[2] > 1e-9;
  });
  const edges = new Map<string, { a: number; b: number; visible: boolean }>();
  s.faces.forEach((fc, fi) => fc.forEach((a, i) => { const b = fc[(i + 1) % fc.length], key = Math.min(a, b) + '-' + Math.max(a, b); const e = edges.get(key); if (e) e.visible ||= vis[fi]; else edges.set(key, { a, b, visible: vis[fi] }); }));
  return { s, r, edges: [...edges.values()] };
}
const solid: DemoDef = {
  id: 'm.solid', subject: 'math', group: '立体几何', title: '立体几何：旋转观察', summary: '正方体、正四面体、正四棱锥、三棱柱；看不见的棱自动画成虚线',
  keywords: ['正方体', '长方体', '棱锥', '棱柱', '四面体', '立体几何', '三视图', '体对角线', '异面直线'],
  params: [
    { key: 'shape', label: '几何体', min: 1, max: 4, step: 1, def: 1, options: [{ v: 1, label: '正方体' }, { v: 2, label: '正四面体' }, { v: 3, label: '正四棱锥' }, { v: 4, label: '三棱柱' }] },
    { key: 'yaw', label: '水平转角', min: -180, max: 180, step: 1, def: 32, unit: '°' },
    { key: 'pitch', label: '俯仰角', min: -60, max: 60, step: 1, def: 18, unit: '°' },
    { key: 'extra', label: '辅助线', min: 0, max: 1, step: 1, def: 0, options: [{ v: 0, label: '隐藏' }, { v: 1, label: '显示' }] },
  ],
  duration: 12, play: '绕竖直轴转一圈',
  view: (p, t, { th }) => {
    const yaw = (p.yaw + 360 * sweep(t, 12)) * PI / 180, { s, r, edges } = projectSolid(p.shape, yaw, p.pitch * PI / 180);
    const S = 205, cx = 800, cy = 460, P2 = (v: V3) => [cx + v[0] * S, cy - v[1] * S] as const;
    const cen = r.reduce((a, v) => [a[0] + v[0] / r.length, a[1] + v[1] / r.length], [0, 0]);
    return <>
      {edges.filter((e) => !e.visible).map((e, i) => { const [x1, y1] = P2(r[e.a]), [x2, y2] = P2(r[e.b]); return <line key={'h' + i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={th.sub} strokeWidth={3} strokeDasharray="12 10" />; })}
      {edges.filter((e) => e.visible).map((e, i) => { const [x1, y1] = P2(r[e.a]), [x2, y2] = P2(r[e.b]); return <line key={'v' + i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={th.fg} strokeWidth={5} strokeLinecap="round" />; })}
      {p.extra === 1 && s.extra?.map(([a, b], i) => { const [x1, y1] = P2(r[a]), [x2, y2] = P2(r[b]); return <line key={'x' + i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={[th.red, th.blue, th.green][i % 3]} strokeWidth={3.5} strokeDasharray={i ? '10 7' : undefined} />; })}
      {r.map((v, i) => {
        if (s.names[i] === 'O' && p.extra !== 1) return null;
        const [x, y] = P2(v), dx = v[0] - cen[0], dy = v[1] - cen[1], l = Math.hypot(dx, dy) || 1;
        return <g key={i}><Dot x={x} y={y} color={th.fg} r={5} /><Label x={x + dx / l * 34} y={y - dy / l * 34 + 9} anchor="middle" color={th.fg} size={30}>{s.names[i]}</Label></g>;
      })}
      {p.extra === 1 && s.extraNote && <Label x={800} y={860} anchor="middle" color={th.sub} size={22} italic={false}>{s.extraNote}</Label>}
    </>;
  },
  info: (p) => [{ k: '公式', v: solidOf(p.shape).note }, { k: '看图', v: '实线是看得见的棱，虚线是被挡住的棱' }],
  corner: 'tl',
};

// ── 11. 正态分布与二项分布（模拟频率逼近概率）──────────────────────
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PHI = [0.6827, 0.9545, 0.9973];
export function binom(n: number, p: number) { const out: number[] = []; let c = 1; for (let k = 0; k <= n; k++) { out.push(c * p ** k * (1 - p) ** (n - k)); c = c * (n - k) / (k + 1); } return out; }
const dist: DemoDef = {
  id: 'm.dist', subject: 'math', group: '概率统计', title: '正态分布与二项分布', summary: '随机试验越做越多，频率分布逼近概率分布',
  keywords: ['正态分布', '二项分布', '3σ', 'σ', '期望', '方差', 'B(n', 'N(μ'],
  params: [
    { key: 'type', label: '分布', min: 1, max: 2, step: 1, def: 1, options: [{ v: 1, label: '正态 N(μ,σ²)' }, { v: 2, label: '二项 B(n,p)' }] },
    { key: 'mu', label: 'μ', min: -3, max: 3, step: 0.1, def: 0, when: (p) => p.type === 1 },
    { key: 'sigma', label: 'σ', min: 0.4, max: 2.5, step: 0.05, def: 1, when: (p) => p.type === 1 },
    { key: 'k', label: '区间', min: 1, max: 3, step: 1, def: 1, options: [{ v: 1, label: 'μ±σ' }, { v: 2, label: 'μ±2σ' }, { v: 3, label: 'μ±3σ' }], when: (p) => p.type === 1 },
    { key: 'n', label: 'n', min: 2, max: 30, step: 1, def: 10, when: (p) => p.type === 2 },
    { key: 'pp', label: 'p', min: 0.05, max: 0.95, step: 0.05, def: 0.5, when: (p) => p.type === 2 },
  ],
  duration: 12, play: '模拟做 2000 次试验，看频率分布逐渐贴近理论曲线',
  view: (p, t, { th }) => {
    const N = t > 0 ? Math.floor(2000 * sweep(t, 12)) : 0, R = rng(20261018);
    if (p.type === 1) {
      const f = frame(-7, 7, 0, 1 / (p.sigma * Math.sqrt(2 * PI)) * 1.3, 90, 90, 1420, 720);
      const pdf = (x: number) => Math.exp(-((x - p.mu) ** 2) / (2 * p.sigma ** 2)) / (p.sigma * Math.sqrt(2 * PI));
      const lo = p.mu - p.k * p.sigma, hi = p.mu + p.k * p.sigma, bw = 0.25;
      const bins = new Map<number, number>();
      for (let i = 0; i < N; i++) { const u = R() || 1e-9, v = R(); const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v); const b = Math.floor((p.mu + p.sigma * z) / bw); bins.set(b, (bins.get(b) ?? 0) + 1); }
      let shade = `M${X(f, lo)} ${Y(f, 0)}`; for (let i = 0; i <= 120; i++) { const x = lo + (hi - lo) * i / 120; shade += `L${X(f, x)} ${Y(f, pdf(x))}`; } shade += `L${X(f, hi)} ${Y(f, 0)}Z`;
      return <>
        <Axes f={f} th={th} step={1} labels />
        <Clip id="nd" f={f}>
          <path d={shade} fill={th.orange} fillOpacity={0.28} />
          {[...bins].map(([b, c]) => { const h = c / N / bw; return <rect key={b} x={X(f, b * bw)} y={Y(f, h)} width={X(f, bw) - X(f, 0) - 1} height={Y(f, 0) - Y(f, h)} fill={th.blue} fillOpacity={0.35} />; })}
          <path d={fnPath(f, pdf)} stroke={th.red} strokeWidth={5} fill="none" />
          <line x1={X(f, p.mu)} x2={X(f, p.mu)} y1={Y(f, 0)} y2={Y(f, pdf(p.mu))} stroke={th.violet} strokeWidth={2.5} strokeDasharray="8 6" />
          {[lo, hi].map((x, i) => <line key={i} x1={X(f, x)} x2={X(f, x)} y1={Y(f, 0)} y2={Y(f, pdf(x)) - 20} stroke={th.orange} strokeWidth={2.5} />)}
          <Label x={X(f, p.mu)} y={Y(f, pdf(p.mu) * 0.45)} anchor="middle" color={th.fg} size={30} italic={false} bold>{(PHI[p.k - 1] * 100).toFixed(2)}%</Label>
        </Clip>
        {N > 0 && <Label x={f.L + f.Wd} y={f.T - 30} anchor="end" color={th.blue} size={26} italic={false}>已模拟 {N} 次，落在区间内 {num(100 * [...bins].reduce((s, [b, c]) => s + ((b + 0.5) * bw >= lo && (b + 0.5) * bw <= hi ? c : 0), 0) / N, 1)}%</Label>}
      </>;
    }
    const P = binom(p.n, p.pp), counts = new Array(p.n + 1).fill(0);
    for (let i = 0; i < N; i++) { let k = 0; for (let j = 0; j < p.n; j++) if (R() < p.pp) k++; counts[k]++; }
    const top = Math.max(...P) * 1.3, f = frame(-0.8, p.n + 0.8, 0, top, 110, 90, 1400, 720), bw = (f.Wd / (p.n + 1.6)) * 0.7;
    const E = p.n * p.pp;
    return <>
      <line x1={f.L} x2={f.L + f.Wd} y1={Y(f, 0)} y2={Y(f, 0)} stroke={th.axis} strokeWidth={2} />
      {P.map((v, k) => <g key={k}>
        <rect x={X(f, k) - bw / 2} y={Y(f, v)} width={bw} height={Y(f, 0) - Y(f, v)} rx={4} fill={th.red} fillOpacity={0.75} />
        {N > 0 && <rect x={X(f, k) - bw / 2} y={Y(f, counts[k] / N)} width={bw} height={Y(f, 0) - Y(f, counts[k] / N)} fill="none" stroke={th.blue} strokeWidth={3} />}
        {(p.n <= 20 || k % 2 === 0) && <Label x={X(f, k)} y={Y(f, 0) + 30} anchor="middle" color={th.sub} size={20} italic={false}>{k}</Label>}
      </g>)}
      <line x1={X(f, E)} x2={X(f, E)} y1={Y(f, 0)} y2={f.T} stroke={th.violet} strokeWidth={3} strokeDasharray="8 6" />
      <Label x={X(f, E) + 10} y={f.T + 20} color={th.violet} size={24} italic={false}>E(X) = np = {num(E)}</Label>
      {N > 0 && <Label x={f.L + f.Wd} y={f.T - 30} anchor="end" color={th.blue} size={26} italic={false}>蓝框：模拟 {N} 次的频率　红柱：理论概率</Label>}
    </>;
  },
  formulas: (p) => p.type === 1
    ? [{ tex: `X\\sim N(${texNum(p.mu)},\\,${texNum(p.sigma)}^2)` }, { tex: `P(\\mu-${p.k === 1 ? '' : p.k}\\sigma\\le X\\le\\mu+${p.k === 1 ? '' : p.k}\\sigma)\\approx${PHI[p.k - 1]}` }]
    : [{ tex: `X\\sim B(${p.n},\\,${texNum(p.pp)})` }, { tex: `P(X=k)=C_{${p.n}}^{k}p^k(1-p)^{${p.n}-k}` }, { tex: `E(X)=np=${texNum(p.n * p.pp)},\\;D(X)=np(1-p)=${texNum(p.n * p.pp * (1 - p.pp))}` }],
  corner: 'tl',
};

// ── 12. 平面向量 ───────────────────────────────────────
/** 画框按 θ 扫过 0°~180° 的全部位置定，播放和拖夹角时画面不跳；底部多留一截给学生端的笔工具条 */
function vectorFrame(la: number, lb: number, mode: number, a0: number) {
  const xs = [0, la * Math.cos(a0)], ys = [0, la * Math.sin(a0)];
  for (let k = 0; k <= 18; k++) {
    const g = a0 + k * PI / 18, bx = lb * Math.cos(g), by = lb * Math.sin(g);
    xs.push(bx); ys.push(by);
    if (mode === 1) { xs.push(bx + la * Math.cos(a0)); ys.push(by + la * Math.sin(a0)); }
  }
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1.4, y0 = Math.min(...ys) - 1.6, y1 = Math.max(...ys) + 0.9;
  return square((x0 + x1) / 2, (y0 + y1) / 2, Math.max((x1 - x0) / 2, (y1 - y0) / 2 * 1420 / 780));
}

const vector: DemoDef = {
  id: 'm.vector', subject: 'math', group: '平面向量', title: '平面向量的运算', summary: '加法（平行四边形）、减法、数量积与投影',
  keywords: ['向量', '数量积', '投影', '平行四边形法则', '三角形法则', '夹角'],
  params: [
    { key: 'mode', label: '运算', min: 1, max: 3, step: 1, def: 1, options: [{ v: 1, label: 'a + b' }, { v: 2, label: 'a − b' }, { v: 3, label: 'a · b' }] },
    { key: 'la', label: '|a|', min: 1, max: 6, step: 0.1, def: 4.5 },
    { key: 'lb', label: '|b|', min: 1, max: 6, step: 0.1, def: 3 },
    { key: 'th', label: '夹角 θ', min: 0, max: 180, step: 1, def: 60, unit: '°' },
  ],
  duration: 10, play: '夹角 θ 从 0° 转到 180°',
  view: (p, t, { th }) => {
    const ang = (t > 0 ? 180 * sweep(t, 10) : p.th) * PI / 180, a0 = 0.15;
    const f = vectorFrame(p.la, p.lb, p.mode, a0);
    const O: V2 = [0, 0], A: V2 = [O[0] + p.la * Math.cos(a0), O[1] + p.la * Math.sin(a0)], B: V2 = [O[0] + p.lb * Math.cos(a0 + ang), O[1] + p.lb * Math.sin(a0 + ang)];
    const S: V2 = [A[0] + B[0] - O[0], A[1] + B[1] - O[1]];
    const ar = (P1: V2, P2: V2, col: string, w = 5, dash?: string) => <Arrow x1={X(f, P1[0])} y1={Y(f, P1[1])} x2={X(f, P2[0])} y2={Y(f, P2[1])} color={col} w={w} dash={dash} head={22} />;
    const proj = p.lb * Math.cos(ang), Pj: V2 = [O[0] + proj * Math.cos(a0), O[1] + proj * Math.sin(a0)];
    return <>
      <AngleArc cx={X(f, O[0])} cy={Y(f, O[1])} a0={-(a0 + ang)} a1={-a0} r={52} color={th.orange} />
      <Label x={X(f, O[0]) + 64 * Math.cos(a0 + ang / 2)} y={Y(f, O[1]) - 64 * Math.sin(a0 + ang / 2) + 8} color={th.orange} size={24}>θ</Label>
      {p.mode === 1 && <>
        <line x1={X(f, A[0])} y1={Y(f, A[1])} x2={X(f, S[0])} y2={Y(f, S[1])} stroke={th.sub} strokeWidth={2.5} strokeDasharray="8 7" />
        <line x1={X(f, B[0])} y1={Y(f, B[1])} x2={X(f, S[0])} y2={Y(f, S[1])} stroke={th.sub} strokeWidth={2.5} strokeDasharray="8 7" />
        {ar(O, S, th.green, 6)}
        <Label x={X(f, S[0]) + 18} y={Y(f, S[1]) - 18} color={th.green} size={30} bold>a + b</Label>
      </>}
      {p.mode === 2 && <>{ar(B, A, th.green, 6)}<Label x={(X(f, A[0]) + X(f, B[0])) / 2 + 14} y={(Y(f, A[1]) + Y(f, B[1])) / 2} color={th.green} size={30} bold>a − b</Label></>}
      {p.mode === 3 && <>
        <line x1={X(f, B[0])} y1={Y(f, B[1])} x2={X(f, Pj[0])} y2={Y(f, Pj[1])} stroke={th.sub} strokeWidth={2.5} strokeDasharray="8 7" />
        <line x1={X(f, O[0])} y1={Y(f, O[1]) + 0} x2={X(f, Pj[0])} y2={Y(f, Pj[1])} stroke={proj >= 0 ? th.green : th.red} strokeWidth={12} opacity={0.45} strokeLinecap="round" />
        <Label x={X(f, Pj[0])} y={Y(f, Pj[1]) + 44} anchor="middle" color={proj >= 0 ? th.green : th.red} size={24} italic={false}>投影 |b|cosθ = {num(proj)}</Label>
      </>}
      {ar(O, A, th.blue)}{ar(O, B, th.red)}
      <Label x={X(f, A[0]) + 14} y={Y(f, A[1]) + 8} color={th.blue} size={32} bold>a</Label>
      <Label x={X(f, B[0]) + 10} y={Y(f, B[1]) - 12} color={th.red} size={32} bold>b</Label>
      <Dot x={X(f, O[0])} y={Y(f, O[1])} color={th.fg} r={6} />
    </>;
  },
  formulas: (p, t) => {
    const ang = (t > 0 ? 180 * sweep(t, 10) : p.th) * PI / 180, dot = p.la * p.lb * Math.cos(ang);
    if (p.mode === 1) return [{ tex: `|\\vec a+\\vec b|=\\sqrt{|\\vec a|^2+|\\vec b|^2+2|\\vec a||\\vec b|\\cos\\theta}=${texNum(Math.sqrt(p.la ** 2 + p.lb ** 2 + 2 * dot))}` }];
    if (p.mode === 2) return [{ tex: `|\\vec a-\\vec b|=\\sqrt{|\\vec a|^2+|\\vec b|^2-2|\\vec a||\\vec b|\\cos\\theta}=${texNum(Math.sqrt(Math.max(0, p.la ** 2 + p.lb ** 2 - 2 * dot)))}` }];
    return [{ tex: `\\vec a\\cdot\\vec b=|\\vec a||\\vec b|\\cos\\theta=${texNum(dot)}`, note: dot > 1e-6 ? 'θ 是锐角，数量积为正' : dot < -1e-6 ? 'θ 是钝角，数量积为负' : 'θ = 90°，a ⊥ b，数量积为 0' }];
  },
  info: (p, t) => [{ k: '夹角', v: num(t > 0 ? 180 * sweep(t, 10) : p.th, 0) + '°' }],
  corner: 'tr',
};

export const MATH_DEMOS: DemoDef[] = [transform, quad, explog, trig, deriv, conic, lineCircle, seq, vector, triangle, solid, dist];
export type { Frame, Theme };
