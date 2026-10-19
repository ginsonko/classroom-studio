// 高中化学课堂演示：分子与晶体结构、方程式配平、原子结构与电子排布、酸碱滴定、化学平衡移动、原电池与电解池。
import type { ReactNode } from 'react';
import { Arrow, Axes, Clip, Dot, Label, X, Y, ease, fnPath, frame, num, texNum, type DemoDef, type P, type Theme } from './kit';
import { CPK, ELEMENTS, REACTIONS, balance, boxes, configOf, configTex, formulaTex, molecules, parseEquation, placeOf, shellsOf, shortConfig, subName, tally, titrationPH, valenceOf, type Equation, type Vec } from './chemCore';

const PI = Math.PI;
const sweep = (t: number, d: number) => Math.min(1, Math.max(0, t / d));
const SANS = "'Noto Sans SC','Microsoft YaHei UI',sans-serif";
const MOLS = molecules();

// ── 1. 分子与晶体结构（球棍模型）────────────────────────────
const molecule: DemoDef = {
  id: 'c.molecule', subject: 'chem', group: '物质结构', title: '分子与晶体的空间结构', summary: '球棍模型可旋转：键角、杂化方式、分子极性、晶胞',
  keywords: ['空间构型', '键角', '杂化', '球棍模型', '分子结构', '极性分子', '晶胞', 'VSEPR', '价层电子对'],
  params: [
    { key: 'mol', label: '物质', min: 1, max: MOLS.length, step: 1, def: 1, options: MOLS.map((m, i) => ({ v: i + 1, label: m.name })) },
    { key: 'yaw', label: '水平转角', min: -180, max: 180, step: 1, def: 25, unit: '°' },
    { key: 'pitch', label: '俯仰角', min: -80, max: 80, step: 1, def: 15, unit: '°' },
    { key: 'lone', label: '孤电子对', min: 0, max: 1, step: 1, def: 1, options: [{ v: 0, label: '隐藏' }, { v: 1, label: '显示' }] },
  ],
  duration: 12, play: '绕竖直轴转一圈，从各个角度看空间结构',
  view: (p, t, { th }) => {
    const m = MOLS[p.mol - 1] ?? MOLS[0];
    const yaw = (p.yaw + 360 * sweep(t, 12)) * PI / 180, pitch = p.pitch * PI / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const rot = ([x, y, z]: Vec): Vec => { const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; return [x1, y * cp - z1 * sp, y * sp + z1 * cp]; };
    const ext = Math.max(...m.atoms.map((a) => Math.hypot(...a.p))) || 1;
    const S = Math.min(240, 330 / ext), ox = 860, oy = 470;
    const P2 = (v: Vec) => [ox + v[0] * S, oy - v[1] * S, v[2]] as const;
    const pts = m.atoms.map((a) => P2(rot(a.p)));
    type Item = { z: number; el: ReactNode };
    const items: Item[] = [];
    m.bonds.forEach(([a, b, order], i) => {
      const [x1, y1, z1] = pts[a], [x2, y2, z2] = pts[b];
      if (order === -1) { items.push({ z: (z1 + z2) / 2 - 0.01, el: <line key={'e' + i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={th.sub} strokeWidth={2} strokeDasharray="8 8" /> }); return; }
      const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, gap = 9;
      const offs = order === 2 ? [-gap / 2, gap / 2] : order === 3 ? [-gap, 0, gap] : [0];
      // 键分成两半，各自跟着所连原子排深度：后面的原子不会被键盖住
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const half = (ax: number, ay: number, k: string) => <g key={k}>{offs.map((o, j) => <line key={j} x1={ax + nx * o} y1={ay + ny * o} x2={mx + nx * o} y2={my + ny * o} stroke={th.dark ? '#c9ced6' : '#8a909a'} strokeWidth={order === 0 ? 3 : order > 1 ? 6 : 10} strokeLinecap={order > 1 ? 'butt' : 'round'} />)}</g>;
      items.push({ z: z1 - 0.002, el: half(x1, y1, 'b' + i + 'a') }, { z: z2 - 0.002, el: half(x2, y2, 'b' + i + 'b') });
    });
    m.atoms.forEach((a, i) => {
      const [x, y, z] = pts[i], c = CPK[a.el] ?? { c: '#999', r: 0.4 }, r = c.r * S * (m.crystal ? 0.7 : 0.62) * (1 + z * 0.04);
      items.push({ z: z + 0.001, el: <g key={'a' + i}>
        <circle cx={x} cy={y} r={r} fill={`url(#cpk-${a.el})`} stroke={th.dark ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.25)'} strokeWidth={1.5} />
        {(!m.crystal || a.el !== 'C') && r > 16 && <text x={x} y={y + r * 0.22} textAnchor="middle" fontSize={Math.min(30, r * 0.75)} fontWeight={700} fill={a.el === 'H' ? '#333' : '#fff'} fontFamily={SANS}>{a.el}</text>}
      </g> });
    });
    if (p.lone === 1) m.lone?.forEach((lp, i) => {
      const base = rot(m.atoms[lp.at].p), d = rot(lp.dir), tip = P2([base[0] + d[0] * 0.95, base[1] + d[1] * 0.95, base[2] + d[2] * 0.95]), [bx, by] = P2(base);
      const ang = Math.atan2(tip[1] - by, tip[0] - bx) * 180 / PI, len = Math.hypot(tip[0] - bx, tip[1] - by);
      items.push({ z: base[2] + d[2] * 0.5, el: <g key={'l' + i} transform={`translate(${bx} ${by}) rotate(${ang})`}>
        <ellipse cx={Math.max(20, len * 0.62)} cy={0} rx={Math.max(22, len * 0.55)} ry={26} fill={th.violet} fillOpacity={0.22} stroke={th.violet} strokeWidth={2} />
        <circle cx={Math.max(20, len * 0.62) + 8} cy={-7} r={4.5} fill={th.violet} /><circle cx={Math.max(20, len * 0.62) + 8} cy={7} r={4.5} fill={th.violet} />
      </g> });
    });
    items.sort((a, b) => a.z - b.z);
    return <>
      <defs>{Object.entries(CPK).map(([el, c]) => <radialGradient key={el} id={'cpk-' + el} cx="35%" cy="32%" r="70%"><stop offset="0" stopColor="#fff" stopOpacity={0.85} /><stop offset="0.25" stopColor={c.c} /><stop offset="1" stopColor={c.c} stopOpacity={0.85} /></radialGradient>)}</defs>
      {items.map((it) => it.el)}
      <g>{[...new Set(m.atoms.map((a) => a.el))].map((el, i) => <g key={el} transform={`translate(${1290} ${640 + i * 46})`}><circle r={16} fill={`url(#cpk-${el})`} /><text x={30} y={9} fontSize={24} fill={th.fg} fontFamily={SANS}>{el} {ELEMENTS.find((e) => e.sym === el)?.name ?? ''}</text></g>)}</g>
    </>;
  },
  formulas: (p) => { const m = MOLS[p.mol - 1] ?? MOLS[0]; return [{ tex: formulaTex(m.formula), note: m.name }]; },
  info: (p) => { const m = MOLS[p.mol - 1] ?? MOLS[0]; return m.crystal ? [{ k: '结构', v: m.shape }, { k: '配位', v: m.angle }, { k: '成键', v: m.hybrid }, { k: '均摊', v: m.polar }] : [{ k: '空间构型', v: m.shape }, { k: '键角', v: m.angle }, { k: '杂化', v: m.hybrid }, { k: '极性', v: m.polar }]; },
  corner: 'tl',
};

// ── 2. 化学方程式配平 ──────────────────────────────────────
const COEF = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
export function equationOf(p: P, text?: string): { eq: Equation | null; cond?: string; note: string } {
  if (p.rx === 0 && text) return { eq: parseEquation(text), note: '自定义方程式' };
  const r = REACTIONS[(p.rx || 1) - 1] ?? REACTIONS[0];
  return { eq: parseEquation(r.eq), cond: r.cond, note: r.note };
}
const balanceDemo: DemoDef = {
  id: 'c.balance', subject: 'chem', group: '化学反应', title: '化学方程式配平', summary: '调系数，看两边各元素的原子个数是否守恒',
  keywords: ['配平', '化学方程式', '离子方程式', '原子守恒', '质量守恒', '电荷守恒', '氧化还原'],
  params: [
    { key: 'rx', label: '反应', min: 0, max: REACTIONS.length, step: 1, def: 11, options: [...REACTIONS.map((r, i) => ({ v: i + 1, label: r.note })), { v: 0, label: '自定义方程式' }] },
    ...COEF.map((k, i) => ({ key: k, label: `系数 ${i + 1}`, min: 0, max: 30, step: 1, def: 1, hidden: true })),
    { key: 'show', label: '揭晓', min: 0, max: 1, step: 1, def: 0, hidden: true },
  ],
  duration: 6, play: '揭晓正确系数',
  view: (p, t, { th, mat }) => {
    const { eq, cond, note } = equationOf(p, mat.scene?.text);
    if (!eq) return <Label x={800} y={450} anchor="middle" color={th.red} size={30} italic={false}>没有读懂这个方程式。离子请写成 Fe^3+、MnO4^- 这样的形式</Label>;
    const ans = balance(eq), n = eq.left.length + eq.right.length;
    const reveal = (p.show === 1 || t > 0) && ans;
    const coef = Array.from({ length: n }, (_, i) => (reveal ? ans![i] : p[COEF[i]] ?? 1));
    const rows = tally(eq, coef), ok = rows.every((r) => r.left === r.right);
    const max = Math.max(1, ...rows.flatMap((r) => [r.left, r.right]));
    const rowH = Math.min(70, 470 / Math.max(1, rows.length)), top = 330, bw = 520;
    return <>
      <text x={800} y={120} textAnchor="middle" fontSize={26} fill={th.sub} fontFamily={SANS}>{note}{cond ? `（条件：${cond}）` : ''}</text>
      <rect x={80} y={top - 50} width={1440} height={rows.length * rowH + 80} rx={18} fill={th.card} stroke={ok ? th.green : th.grid} strokeWidth={ok ? 4 : 2} />
      <text x={330} y={top - 14} textAnchor="middle" fontSize={24} fill={th.sub} fontFamily={SANS}>反应物一侧</text>
      <text x={1270} y={top - 14} textAnchor="middle" fontSize={24} fill={th.sub} fontFamily={SANS}>生成物一侧</text>
      {rows.map((r, i) => {
        const y = top + i * rowH + 10, good = r.left === r.right, h = rowH * 0.56;
        return <g key={r.el}>
          <rect x={800 - 70 - bw * Math.abs(r.left) / max} y={y} width={bw * Math.abs(r.left) / max} height={h} rx={6} fill={good ? th.green : th.orange} fillOpacity={0.65} />
          <rect x={800 + 70} y={y} width={bw * Math.abs(r.right) / max} height={h} rx={6} fill={good ? th.green : th.orange} fillOpacity={0.65} />
          <text x={800} y={y + h * 0.78} textAnchor="middle" fontSize={Math.min(30, h)} fontWeight={700} fill={th.fg} fontFamily={SANS}>{r.el}</text>
          <text x={800 - 80 - bw * Math.abs(r.left) / max - 10} y={y + h * 0.78} textAnchor="end" fontSize={Math.min(28, h)} fill={th.fg} fontFamily="'JetBrains Mono',monospace">{r.left}</text>
          <text x={800 + 80 + bw * Math.abs(r.right) / max + 10} y={y + h * 0.78} fontSize={Math.min(28, h)} fill={th.fg} fontFamily="'JetBrains Mono',monospace">{r.right}</text>
          {!good && <text x={1500} y={y + h * 0.78} textAnchor="end" fontSize={Math.min(24, h)} fill={th.orange} fontFamily={SANS}>差 {Math.abs(r.left - r.right)}</text>}
        </g>;
      })}
      <text x={800} y={top + rows.length * rowH + 74} textAnchor="middle" fontSize={34} fontWeight={700} fill={ok ? th.green : th.orange} fontFamily={SANS}>{ok ? '✓ 已配平：各元素原子个数相等' + (rows.some((r) => r.el === '电荷') ? '，电荷守恒' : '') : '还没配平：橙色的元素两边不相等'}</text>
      {!ans && <text x={800} y={860} textAnchor="middle" fontSize={22} fill={th.red} fontFamily={SANS}>这个方程式不能唯一配平（可能缺物质，或有多组系数）</text>}
    </>;
  },
  formulas: (p, t, { mat }) => {
    const { eq } = equationOf(p, mat.scene?.text);
    if (!eq) return [];
    const ans = balance(eq), reveal = (p.show === 1 || t > 0) && ans;
    const n = eq.left.length + eq.right.length, coef = Array.from({ length: n }, (_, i) => (reveal ? ans![i] : p[COEF[i]] ?? 1));
    const side = (fs: string[], off: number) => fs.map((f, i) => `${coef[off + i] === 1 ? '' : reveal ? `\\color{#d97706}{${coef[off + i]}}` : coef[off + i]}${formulaTex(f)}`).join('+');
    return [{ tex: `${side(eq.left, 0)}\\;${eq.arrow === '⇌' ? '\\rightleftharpoons' : '='}\\;${side(eq.right, eq.left.length)}` }];
  },
  corner: 'tl',
};

// ── 3. 原子结构与电子排布 ───────────────────────────────────
const electron: DemoDef = {
  id: 'c.electron', subject: 'chem', group: '物质结构', title: '原子结构与核外电子排布', summary: '1–36 号元素：电子层、电子排布式、轨道表示式、周期表位置',
  keywords: ['电子排布', '核外电子', '轨道表示式', '能级', '电子层', '价电子', '洪特规则', '泡利', '原子结构示意图'],
  params: [{ key: 'Z', label: '原子序数 Z', min: 1, max: 36, step: 1, def: 26 }, { key: 'view', label: '轨道表示式', min: 0, max: 1, step: 1, def: 1, options: [{ v: 0, label: '全部' }, { v: 1, label: '价层' }] }],
  duration: 10, play: '电子绕核运动（示意）',
  view: (p, t, { th }) => {
    const Z = p.Z, el = ELEMENTS[Z - 1], shells = shellsOf(Z), cx = 360, cy = 470;
    const subs = p.view === 1 ? valenceOf(Z) : configOf(Z);
    return <>
      <circle cx={cx} cy={cy} r={54} fill={th.red} fillOpacity={0.85} />
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize={34} fontWeight={700} fill="#fff" fontFamily={SANS}>+{Z}</text>
      {shells.map((n, i) => {
        const R = 100 + i * 64;
        return <g key={i}>
          <circle cx={cx} cy={cy} r={R} fill="none" stroke={th.sub} strokeWidth={2} strokeDasharray={'6 6'} />
          {Array.from({ length: n }, (_, k) => { const a = 2 * PI * k / n + t * (0.9 - i * 0.18) + i * 0.4; return <circle key={k} cx={cx + R * Math.cos(a)} cy={cy + R * Math.sin(a)} r={9} fill={th.blue} />; })}
          <text x={cx + R} y={cy - 8} fontSize={22} fill={th.fg} fontFamily={SANS} textAnchor="middle" style={{ paintOrder: 'stroke', stroke: 'var(--demo-halo)', strokeWidth: 5 }}>{n}</text>
        </g>;
      })}
      <text x={760} y={190} fontSize={64} fontWeight={700} fill={th.fg} fontFamily={SANS}>{el.sym}</text>
      <text x={760 + el.sym.length * 42 + 20} y={190} fontSize={40} fill={th.fg} fontFamily={SANS}>{el.name}　Z = {Z}</text>
      <text x={760} y={250} fontSize={28} fill={th.sub} fontFamily={SANS}>第 {placeOf(Z).period} 周期　{placeOf(Z).group}　{placeOf(Z).block} 区</text>
      <text x={760} y={330} fontSize={24} fill={th.sub} fontFamily={SANS}>{p.view === 1 ? '价层电子轨道表示式' : '轨道表示式'}</text>
      {(() => {
        let x = 760, y = 360; const out: ReactNode[] = [];
        subs.forEach((s, i) => {
          const b = boxes(s), w = b.length * 52;
          if (x + w > 1540) { x = 760; y += 130; }
          out.push(<g key={i}>
            {b.map((e, k) => <g key={k}>
              <rect x={x + k * 52} y={y} width={52} height={60} fill="none" stroke={th.fg} strokeWidth={2.5} />
              {e >= 1 && <Arrow x1={x + k * 52 + (e === 2 ? 17 : 26)} y1={y + 50} x2={x + k * 52 + (e === 2 ? 17 : 26)} y2={y + 10} color={th.red} w={3} head={12} />}
              {e === 2 && <Arrow x1={x + k * 52 + 35} y1={y + 10} x2={x + k * 52 + 35} y2={y + 50} color={th.blue} w={3} head={12} />}
            </g>)}
            <text x={x + w / 2} y={y + 96} textAnchor="middle" fontSize={26} fill={th.fg} fontFamily="'Times New Roman',serif">{subName(s)}</text>
          </g>);
          x += w + 30;
        });
        return out;
      })()}
      <text x={760} y={830} fontSize={22} fill={th.sub} fontFamily={SANS}>{Z === 24 || Z === 29 ? `注意：${el.name}是特例，3d 半满 / 全满更稳定，所以 4s 只有 1 个电子` : '能量最低原理 · 泡利原理 · 洪特规则'}</text>
    </>;
  },
  formulas: (p) => [{ tex: configTex(configOf(p.Z)), note: '电子排布式' }, { tex: shortConfig(p.Z).replace(/([spd])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, l: string, e: string) => `${l}^{${[...e].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)).join('')}}`), note: '简化电子排布式' }],
  // 最多 4 层电子，原子图从 y≈178 开始，左上角放得下两行排布式
  corner: 'tl',
};

// ── 4. 酸碱中和滴定 ───────────────────────────────────────
const INDICATORS = [{ name: '酚酞', lo: 8.2, hi: 10.0, c0: 'rgba(255,255,255,.18)', c1: '#e84393' }, { name: '甲基橙', lo: 3.1, hi: 4.4, c0: '#e8452c', c1: '#f2b632' }];
const titration: DemoDef = {
  id: 'c.titration', subject: 'chem', group: '水溶液中的离子平衡', title: '酸碱中和滴定曲线', summary: '用 NaOH 滴定盐酸或醋酸：pH 突变与指示剂选择',
  keywords: ['滴定', '中和', '指示剂', '酚酞', '甲基橙', '突变', '滴定终点', 'pH'],
  params: [
    { key: 'acid', label: '被滴定的酸', min: 1, max: 2, step: 1, def: 1, options: [{ v: 1, label: '盐酸（强酸）' }, { v: 2, label: '醋酸（弱酸）' }] },
    { key: 'ca', label: 'c(酸)', min: 0.01, max: 0.2, step: 0.01, def: 0.1, unit: 'mol/L' },
    { key: 'va', label: 'V(酸)', min: 10, max: 25, step: 1, def: 20, unit: 'mL' },
    { key: 'cb', label: 'c(NaOH)', min: 0.01, max: 0.2, step: 0.01, def: 0.1, unit: 'mol/L' },
    { key: 'ind', label: '指示剂', min: 1, max: 2, step: 1, def: 1, options: [{ v: 1, label: '酚酞' }, { v: 2, label: '甲基橙' }] },
  ],
  duration: 14, play: '逐滴加入 NaOH，画出 pH 曲线',
  view: (p, t, { th }) => {
    const Ka = p.acid === 1 ? 1e8 : 1.75e-5, Veq = p.ca * p.va / p.cb, Vmax = Math.min(60, Veq * 2);
    const f = frame(0, Vmax, 0, 14, 560, 70, 900, 740), V = t > 0 ? Vmax * sweep(t, 14) : Veq;
    const ph = (v: number) => titrationPH(p.va, p.ca, v, p.cb, Ka), cur = ph(V), ind = INDICATORS[p.ind - 1];
    const a = ph(Veq * 0.999), b = ph(Veq * 1.001);
    const mix = Math.max(0, Math.min(1, (cur - ind.lo) / (ind.hi - ind.lo)));
    const flask = p.ind === 1 ? (mix > 0 ? `rgba(232,67,147,${0.15 + mix * 0.75})` : th.dark ? 'rgba(255,255,255,.12)' : 'rgba(120,160,200,.18)') : (mix >= 1 ? ind.c1 : mix <= 0 ? ind.c0 : '#f07d2e');
    const level = 0.35 + 0.35 * (V / Vmax);
    return <>
      <Axes f={f} th={th} xl="V(NaOH)/mL" yl="pH" step={Vmax > 30 ? 10 : 5} ystep={2} />
      <Clip id="ti" f={f}>
        <rect x={f.L} y={Y(f, ind.hi)} width={f.Wd} height={Y(f, ind.lo) - Y(f, ind.hi)} fill={p.ind === 1 ? '#e84393' : '#f2b632'} fillOpacity={0.16} />
        <path d={fnPath(f, ph, 0, Vmax, 500)} stroke={th.blue} strokeWidth={3} opacity={0.3} fill="none" />
        <path d={fnPath(f, ph, 0, Math.max(0.01, V), 500)} stroke={th.blue} strokeWidth={5} fill="none" />
        <line x1={X(f, Veq)} x2={X(f, Veq)} y1={f.T} y2={f.T + f.Ht} stroke={th.violet} strokeWidth={2} strokeDasharray="8 6" />
        <line x1={X(f, Veq) - 30} x2={X(f, Veq) + 30} y1={Y(f, a)} y2={Y(f, a)} stroke={th.red} strokeWidth={3} />
        <line x1={X(f, Veq) - 30} x2={X(f, Veq) + 30} y1={Y(f, b)} y2={Y(f, b)} stroke={th.red} strokeWidth={3} />
        <Dot x={X(f, V)} y={Y(f, cur)} color={th.red} r={10} ring={th.bg} />
      </Clip>
      <Label x={X(f, Veq) + 10} y={f.T + 26} color={th.violet} size={22} italic={false}>恰好中和 V = {num(Veq)} mL</Label>
      <Label x={f.L + f.Wd - 10} y={Y(f, (ind.lo + ind.hi) / 2) + 8} anchor="end" color={th.sub} size={22} italic={false}>{ind.name}变色范围 {ind.lo}–{ind.hi}</Label>
      {/* 滴定管与锥形瓶 */}
      <rect x={230} y={70} width={36} height={360} rx={6} fill="none" stroke={th.fg} strokeWidth={3} />
      <rect x={233} y={73 + 354 * (V / 60)} width={30} height={Math.max(0, 354 * (1 - V / 60))} fill={th.blue} fillOpacity={0.25} />
      {[0, 10, 20, 30, 40, 50].map((v) => <g key={v}><line x1={266} x2={282} y1={73 + 354 * v / 60} y2={73 + 354 * v / 60} stroke={th.sub} strokeWidth={2} /><text x={290} y={80 + 354 * v / 60} fontSize={18} fill={th.sub} fontFamily="'JetBrains Mono',monospace">{v}</text></g>)}
      <path d="M240 430 h16 l-4 40 h-8 z" fill={th.fg} />
      {t > 0 && V < Vmax && <circle cx={248} cy={490 + ((t * 3) % 1) * 60} r={6} fill={th.blue} />}
      <path d="M200 560 L200 620 L120 800 Q115 830 145 830 L351 830 Q381 830 376 800 L296 620 L296 560" fill="none" stroke={th.fg} strokeWidth={4} />
      <path d={`M${120 + (1 - level) * 0} ${830 - 210 * level} L${376} ${830 - 210 * level} L376 800 Q381 830 351 830 L145 830 Q115 830 120 800 Z`} fill={flask} clipPath="url(#flask)" />
      <defs><clipPath id="flask"><path d="M200 560 L200 620 L120 800 Q115 830 145 830 L351 830 Q381 830 376 800 L296 620 L296 560 Z" /></clipPath></defs>
      <text x={248} y={880} textAnchor="middle" fontSize={26} fontWeight={700} fill={th.fg} fontFamily={SANS}>pH = {num(cur, 2)}</text>
    </>;
  },
  formulas: (p) => {
    const Ka = p.acid === 1 ? 1e8 : 1.75e-5, Veq = p.ca * p.va / p.cb;
    const a = titrationPH(p.va, p.ca, Veq * 0.999, p.cb, Ka), b = titrationPH(p.va, p.ca, Veq * 1.001, p.cb, Ka), e = titrationPH(p.va, p.ca, Veq, p.cb, Ka);
    return [
      { tex: p.acid === 1 ? '\\mathrm{H^+ + OH^- = H_2O}' : '\\mathrm{CH_3COOH + OH^- = CH_3COO^- + H_2O}' },
      { tex: `V_{\\text{碱}}=\\frac{c_{\\text{酸}}V_{\\text{酸}}}{c_{\\text{碱}}}=${texNum(Veq)}\\,\\mathrm{mL}` },
      { tex: `\\text{突变 pH}\\;${texNum(a, 1)}\\sim${texNum(b, 1)}`, note: `恰好中和 pH = ${num(e, 2)}${p.acid === 2 ? '\n醋酸钠水解显碱性，选酚酞' : '\n酚酞、甲基橙都可以'}` },
    ];
  },
  // 曲线在突变后贴着上方走，右侧中下方一直是空的
  corner: 'mr',
};

// ── 5. 化学平衡的移动（c–t 图与 v–t 图）────────────────────────
const CONDS = ['增大 c(A)', '减小 c(B)', '升高温度（正反应放热）', '加入催化剂'];
export function equilibriumAt(p: P, time: number) {
  const T1 = 10, kf0 = p.kf, kb0 = p.kb;
  const run = (A0: number, B0: number, kf: number, kb: number, tt: number) => { const S = A0 + B0, Ae = S * kb / (kf + kb); const A = Ae + (A0 - Ae) * Math.exp(-(kf + kb) * tt); return { A, B: S - A }; };
  if (time <= T1) { const r = run(1, 0, kf0, kb0, time); return { ...r, kf: kf0, kb: kb0 }; }
  let { A, B } = run(1, 0, kf0, kb0, T1), kf = kf0, kb = kb0;
  if (p.cond === 1) A += 0.5; else if (p.cond === 2) B *= 0.5; else if (p.cond === 3) { kf *= 1.5; kb *= 3; } else { kf *= 3; kb *= 3; }
  const r = run(A, B, kf, kb, time - T1);
  return { ...r, kf, kb };
}
const equilibrium: DemoDef = {
  id: 'c.equilibrium', subject: 'chem', group: '化学反应原理', title: '化学平衡的移动', summary: 'A ⇌ B：改变条件后浓度和正逆反应速率怎样变化',
  keywords: ['化学平衡', '平衡移动', '勒夏特列', '速率-时间', 'v-t', '催化剂', '平衡常数'],
  params: [
    { key: 'kf', label: 'k正', min: 0.1, max: 1, step: 0.05, def: 0.4 },
    { key: 'kb', label: 'k逆', min: 0.1, max: 1, step: 0.05, def: 0.2 },
    { key: 'cond', label: '第 10 分钟改变', min: 1, max: 4, step: 1, def: 1, options: CONDS.map((c, i) => ({ v: i + 1, label: c })) },
  ],
  duration: 12, play: '时间从 0 走到 20 分钟，第 10 分钟改变条件',
  view: (p, t, { th }) => {
    const tm = t > 0 ? 20 * sweep(t, 12) : 20;
    const fc = frame(0, 20, 0, 1.6, 110, 140, 600, 620), fv = frame(0, 20, 0, Math.max(0.6, p.kf * 1.6, p.kf * 3), 860, 140, 600, 620);
    const A = (x: number) => equilibriumAt(p, x).A, B = (x: number) => equilibriumAt(p, x).B;
    const vf = (x: number) => { const s = equilibriumAt(p, x); return s.kf * s.A; }, vb = (x: number) => { const s = equilibriumAt(p, x); return s.kb * s.B; };
    const seg = (f: typeof fc, fn: (x: number) => number, a: number, b: number) => fnPath(f, fn, a, b, 300);
    const both = (f: typeof fc, fn: (x: number) => number, col: string, dash?: string) => <>
      <path d={seg(f, fn, 0, Math.min(tm, 10 - 1e-6))} stroke={col} strokeWidth={5} fill="none" strokeDasharray={dash} />
      {tm > 10 && <path d={seg(f, fn, 10 + 1e-6, tm)} stroke={col} strokeWidth={5} fill="none" strokeDasharray={dash} />}
    </>;
    const shift = p.cond === 4 ? '平衡不移动（正、逆反应速率同等增大）' : p.cond === 3 ? '平衡向逆反应方向移动' : '平衡向正反应方向移动';
    return <>
      <Axes f={fc} th={th} xl="t/min" yl="c/(mol·L⁻¹)" step={5} />
      <Axes f={fv} th={th} xl="t/min" yl="v" step={5} labels={false} />
      <Clip id="eqc" f={fc}>{both(fc, A, th.blue)}{both(fc, B, th.red)}</Clip>
      <Clip id="eqv" f={fv}>{both(fv, vf, th.green)}{both(fv, vb, th.orange, '10 6')}</Clip>
      {tm > 10 && [fc, fv].map((f, i) => <line key={i} x1={X(f, 10)} x2={X(f, 10)} y1={f.T} y2={f.T + f.Ht} stroke={th.violet} strokeWidth={2} strokeDasharray="6 6" />)}
      <Label x={X(fc, Math.min(tm, 19)) - 6} y={Y(fc, A(Math.min(tm, 19))) - 14} anchor="end" color={th.blue} size={26}>c(A)</Label>
      <Label x={X(fc, Math.min(tm, 19)) - 6} y={Y(fc, B(Math.min(tm, 19))) + 34} anchor="end" color={th.red} size={26}>c(B)</Label>
      <Label x={X(fv, 1.2)} y={Y(fv, vf(0.3)) + 6} color={th.green} size={26}>v正</Label>
      <Label x={X(fv, 1.2)} y={Y(fv, 0) - 14} color={th.orange} size={26}>v逆</Label>
      <text x={110} y={70} fontSize={28} fill={th.fg} fontFamily={SANS} fontWeight={700}>浓度–时间</text>
      <text x={860} y={70} fontSize={28} fill={th.fg} fontFamily={SANS} fontWeight={700}>速率–时间</text>
      {tm > 10 && <text x={800} y={860} textAnchor="middle" fontSize={30} fontWeight={700} fill={th.violet} fontFamily={SANS}>第 10 分钟{CONDS[p.cond - 1]}：{shift}</text>}
    </>;
  },
  formulas: () => [{ tex: '\\mathrm{A(g)}\\rightleftharpoons\\mathrm{B(g)}', note: 'K = k正 / k逆' }],
  info: (p, t) => {
    const tm = t > 0 ? 20 * sweep(t, 12) : 20, now = equilibriumAt(p, tm), K0 = p.kf / p.kb, K1 = now.kf / now.kb;
    return tm > 10 && p.cond === 3 ? [{ k: '原来 K', v: num(K0, 2) }, { k: '升温后 K', v: num(K1, 2) + '（减小）' }] : [{ k: 'K', v: num(K0, 2) + (tm > 10 ? '（不变）' : '') }];
  },
  corner: 'tr',
};

// ── 6. 原电池与电解池（粒子动画）────────────────────────────
const cell: DemoDef = {
  id: 'c.cell', subject: 'chem', group: '电化学', title: '原电池与电解池', summary: '电子在导线中、离子在溶液中怎样移动',
  keywords: ['原电池', '电解池', '盐桥', '负极', '正极', '阴极', '阳极', '电极反应', '铜锌'],
  params: [{ key: 'kind', label: '装置', min: 1, max: 3, step: 1, def: 2, options: [{ v: 1, label: '单液原电池' }, { v: 2, label: '双液原电池（盐桥）' }, { v: 3, label: '电解 CuCl₂ 溶液' }] }],
  duration: 16, play: '电子沿导线流动、离子在溶液中迁移',
  view: (p, t, { th }) => {
    const k = p.kind, two = k === 2, lx = two ? 330 : 560, rx = two ? 1170 : 1040, top = 330, y0 = 450, y1 = 820;
    const beaker = (cx: number, w: number, col: string) => <g>
      <rect x={cx - w / 2} y={y0} width={w} height={y1 - y0} fill={col} fillOpacity={0.22} />
      <path d={`M${cx - w / 2} ${y0 - 60} V${y1} H${cx + w / 2} V${y0 - 60}`} fill="none" stroke={th.fg} strokeWidth={4} />
    </g>;
    const elA = k === 3 ? '石墨' : 'Zn', elB = k === 3 ? '石墨' : 'Cu';
    const anodeX = lx, cathX = rx;
    // 电子路径：原电池 Zn → 导线 → Cu；电解池 阳极 → 电源正极 … 电源负极 → 阴极
    const path = [[anodeX, top + 40], [anodeX, 200], [cathX, 200], [cathX, top + 40]];
    const segL = path.slice(1).map((q, i) => Math.hypot(q[0] - path[i][0], q[1] - path[i][1])), tot = segL.reduce((a, b) => a + b, 0);
    const along = (s: number) => { s = ((s % tot) + tot) % tot; for (let i = 0; i < segL.length; i++) { if (s <= segL[i]) { const r = s / segL[i]; return [path[i][0] + (path[i + 1][0] - path[i][0]) * r, path[i][1] + (path[i + 1][1] - path[i][1]) * r]; } s -= segL[i]; } return path[0]; };
    const run = t > 0;
    const ions = (n: number, fn: (i: number) => ReactNode) => Array.from({ length: n }, (_, i) => fn(i));
    const frac = (i: number, speed: number) => ((t * speed + i * 0.137) % 1 + 1) % 1;
    const solL = k === 3 ? '#3a8fd8' : two ? '#9aa6b2' : '#3a8fd8', solR = '#3a8fd8';
    return <>
      {two ? <>{beaker(lx, 360, solL)}{beaker(rx, 360, solR)}
        <path d={`M${lx + 90} ${y0 + 160} V${y0 - 30} H${rx - 90} V${y0 + 160}`} fill="none" stroke={th.sub} strokeWidth={46} strokeLinejoin="round" opacity={0.35} />
        <text x={800} y={y0 - 50} textAnchor="middle" fontSize={24} fill={th.sub} fontFamily={SANS}>盐桥（KCl）</text>
        {run && ions(6, (i) => { const s = frac(i, 0.05); return <g key={'k' + i}><circle cx={lx + 90 + (rx - lx - 180) * s} cy={y0 - 30 + (i % 2 ? 8 : -8)} r={11} fill={th.orange} /><text x={lx + 90 + (rx - lx - 180) * s} y={y0 - 24 + (i % 2 ? 8 : -8)} textAnchor="middle" fontSize={14} fill="#fff">K⁺</text></g>; })}
        {run && ions(6, (i) => { const s = frac(i + 0.5, 0.05); return <g key={'c' + i}><circle cx={rx - 90 - (rx - lx - 180) * s} cy={y0 - 30 + (i % 2 ? -8 : 8)} r={11} fill={th.green} /><text x={rx - 90 - (rx - lx - 180) * s} y={y0 - 24 + (i % 2 ? -8 : 8)} textAnchor="middle" fontSize={14} fill="#fff">Cl⁻</text></g>; })}
        <text x={lx} y={y1 + 40} textAnchor="middle" fontSize={24} fill={th.fg} fontFamily={SANS}>ZnSO₄ 溶液</text>
        <text x={rx} y={y1 + 40} textAnchor="middle" fontSize={24} fill={th.fg} fontFamily={SANS}>CuSO₄ 溶液</text>
      </> : <>{beaker(800, 760, solR)}<text x={800} y={y1 + 40} textAnchor="middle" fontSize={24} fill={th.fg} fontFamily={SANS}>{k === 3 ? 'CuCl₂ 溶液' : 'CuSO₄ 溶液'}</text></>}
      {/* 电极 */}
      <rect x={anodeX - 22} y={top} width={44} height={420} fill={k === 3 ? '#555' : '#9aa3ad'} stroke={th.fg} strokeWidth={2} />
      <rect x={cathX - 22} y={top} width={44} height={420} fill={k === 3 ? '#555' : '#c8773a'} stroke={th.fg} strokeWidth={2} />
      {run && k !== 3 && <rect x={cathX - 26} y={top + 140} width={52} height={280 * Math.min(1, t / 16)} fill="#c8773a" opacity={0.8} />}
      {run && k === 3 && <rect x={cathX - 26} y={top + 140} width={52} height={280 * Math.min(1, t / 16)} fill="#c8773a" opacity={0.9} />}
      <text x={anodeX} y={top - 14} textAnchor="middle" fontSize={26} fontWeight={700} fill={th.fg} fontFamily={SANS}>{elA}</text>
      <text x={cathX} y={top - 14} textAnchor="middle" fontSize={26} fontWeight={700} fill={th.fg} fontFamily={SANS}>{elB}</text>
      <text x={anodeX - 40} y={top + 90} textAnchor="end" fontSize={26} fontWeight={700} fill={th.blue} fontFamily={SANS}>{k === 3 ? '阳极' : '负极'}</text>
      <text x={cathX + 40} y={top + 90} fontSize={26} fontWeight={700} fill={th.red} fontFamily={SANS}>{k === 3 ? '阴极' : '正极'}</text>
      {/* 导线 + 电流表 / 电源 */}
      <path d={`M${anodeX} ${top} V200 H${cathX} V${top}`} fill="none" stroke={th.fg} strokeWidth={4} />
      {k === 3 ? <g><rect x={760} y={170} width={80} height={60} fill={th.bg} stroke={th.fg} strokeWidth={3} /><line x1={785} x2={785} y1={180} y2={220} stroke={th.fg} strokeWidth={4} /><line x1={815} x2={815} y1={190} y2={210} stroke={th.fg} strokeWidth={8} />
        <text x={760} y={158} fontSize={22} fill={th.fg} fontFamily={SANS}>+</text><text x={835} y={158} fontSize={22} fill={th.fg} fontFamily={SANS}>−</text><text x={800} y={270} textAnchor="middle" fontSize={22} fill={th.sub} fontFamily={SANS}>直流电源</text></g>
        : <g><circle cx={800} cy={200} r={36} fill={th.bg} stroke={th.fg} strokeWidth={3} /><text x={800} y={210} textAnchor="middle" fontSize={30} fontWeight={700} fill={th.fg} fontFamily={SANS}>A</text>
          <line x1={800} y1={200} x2={800 + 26 * Math.sin(run ? 0.6 : 0)} y2={200 - 26 * Math.cos(run ? 0.6 : 0)} stroke={th.red} strokeWidth={3} /></g>}
      {run && ions(10, (i) => { const [x, y] = along(frac(i, 0.12) * tot); return <g key={'e' + i}><circle cx={x} cy={y} r={10} fill={th.blue} /><text x={x} y={y + 5} textAnchor="middle" fontSize={14} fill="#fff">e⁻</text></g>; })}
      <Arrow x1={(cathX + 840) / 2 - 60} y1={160} x2={(cathX + 840) / 2 + 60} y2={160} color={th.blue} w={3} />
      <text x={(cathX + 840) / 2} y={142} textAnchor="middle" fontSize={22} fill={th.blue} fontFamily={SANS}>电子流向</text>
      {/* 溶液中的离子 */}
      {run && k !== 3 && ions(5, (i) => { const s = frac(i, 0.08); const x = anodeX + 30 + 120 * s, y = top + 180 + i * 50; return <g key={'z' + i} opacity={1 - s * 0.6}><circle cx={x} cy={y} r={15} fill="#8e99a6" /><text x={x} y={y + 5} textAnchor="middle" fontSize={13} fill="#fff">Zn²⁺</text></g>; })}
      {run && ions(5, (i) => { const s = frac(i + 0.3, 0.08); const x = cathX - 30 - 140 * (1 - s), y = top + 200 + i * 48; return <g key={'u' + i} opacity={1 - s * 0.8}><circle cx={x} cy={y} r={15} fill="#2f7fd0" /><text x={x} y={y + 5} textAnchor="middle" fontSize={13} fill="#fff">Cu²⁺</text></g>; })}
      {run && k === 3 && ions(6, (i) => { const s = frac(i * 1.7, 0.18); return <circle key={'g' + i} cx={anodeX + (i % 3 - 1) * 12} cy={top + 400 - s * 380} r={6 + (i % 2) * 3} fill="none" stroke="#c9e86a" strokeWidth={2.5} />; })}
      {run && k === 3 && ions(4, (i) => { const s = frac(i + 0.6, 0.08); const x = anodeX + 30 + 140 * (1 - s), y = top + 220 + i * 50; return <g key={'cl' + i} opacity={1 - s * 0.8}><circle cx={x} cy={y} r={14} fill={th.green} /><text x={x} y={y + 5} textAnchor="middle" fontSize={13} fill="#fff">Cl⁻</text></g>; })}
    </>;
  },
  formulas: (p) => p.kind === 3
    ? [{ tex: '\\text{阳极：}2\\mathrm{Cl^-}-2e^-=\\mathrm{Cl_2}\\uparrow' }, { tex: '\\text{阴极：}\\mathrm{Cu^{2+}}+2e^-=\\mathrm{Cu}' }, { tex: '\\mathrm{CuCl_2}\\xlongequal{\\text{通电}}\\mathrm{Cu}+\\mathrm{Cl_2}\\uparrow' }]
    : [{ tex: '\\text{负极：}\\mathrm{Zn}-2e^-=\\mathrm{Zn^{2+}}' }, { tex: '\\text{正极：}\\mathrm{Cu^{2+}}+2e^-=\\mathrm{Cu}' }, { tex: '\\mathrm{Zn}+\\mathrm{Cu^{2+}}=\\mathrm{Zn^{2+}}+\\mathrm{Cu}', note: p.kind === 2 ? '盐桥：K⁺ 移向正极，Cl⁻ 移向负极\n保持两边溶液电中性' : '单液：部分 Zn 直接与 Cu²⁺ 反应\n电流不稳定、会衰减' }],
  // 导线在 y=200，左上角留给电极反应式
  corner: 'tl',
};

export const CHEM_DEMOS: DemoDef[] = [molecule, electron, balanceDemo, equilibrium, titration, cell];
export { ease, type Theme };
