import type { Scene } from '../model';

export const SUPPORTED = new Set(['block', 'cart', 'ball', 'incline', 'ground', 'wall', 'ceiling', 'conveyor', 'spring', 'rope', 'pulley', 'rod', 'plank', 'track-circle', 'track-arc', 'hinge', 'weight', 'person', 'car', 'boat', 'rocket', 'field-b-in', 'field-b-out', 'field-e', 'charge-pos', 'charge-neg']);
export const ELEMENTARY_CHARGE = 1.602176634e-19;
export const ASSUMPTIONS = '二维、非相对论；刚体碰撞与理想连接；忽略空气阻力。电路与粒子间作用未求解；电场/磁场仅在均匀场预设中计算。';

export function sceneErrors(scene: Scene): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(scene.world?.ppm) || scene.world.ppm <= 0) errors.push('比例尺必须为正数。');
  if (!Number.isFinite(scene.world?.g) || Math.abs(scene.world.g) > 100) errors.push('重力加速度须在 −100 到 100 m/s²。');
  const duration = scene.duration ?? 8;
  if (!Number.isFinite(duration) || duration < .5 || duration > 40) errors.push('演示时长须在 0.5 到 40 秒。');
  const timeScale = Number(scene.params?.timeScale);
  const microscopic = Number.isFinite(timeScale) && timeScale > 0 && timeScale < 1;
  if (!Array.isArray(scene.objs) || !scene.objs.length) return [...errors, '当前页没有可仿真的物理器材。'];
  if (scene.objs.length > 48 || scene.objs.length * duration * 240 > 240000) errors.push('当前场景超过预计算容量，请缩短时长或减少器材。');
  const ids = new Set<string>();
  for (const o of scene.objs) {
    const name = o.label || o.kind;
    if (!SUPPORTED.has(o.kind)) errors.push(`${name} 可绘制，但本版未实现它的物理求解。`);
    if (!o.id || ids.has(o.id)) errors.push(`${name} 的对象标识为空或重复。`);
    ids.add(o.id);
    if (![o.x, o.y, o.w, o.h, o.rot].every(Number.isFinite) || o.w <= 0 || o.h <= 0) errors.push(`${name} 的位置、尺寸或旋转无效。`);
    if ([o.x, o.y, o.w, o.h].some(v => Math.abs(v / scene.world.ppm) > 10000)) errors.push(`${name} 超出本版 10 km 的几何尺度。`);
    for (const [key, value] of Object.entries(o.props ?? {})) {
      if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${name} 的 ${key} 必须为有限数值。`);
    }
    const n = (k: string, d: number) => o.props?.[k] === undefined ? d : Number(o.props[k]);
    for (const key of ['m', 'mu', 'e', 'vx', 'vy', 'ax', 'ay', 'k', 'L0', 'L', 'q', 'B', 'E', 'angle']) if (o.props?.[key] !== undefined && !Number.isFinite(n(key, 0))) errors.push(`${name} 的 ${key} 不是有效数值。`);
    if (n('m', 1) <= 0 || !Number.isFinite(n('m', 1))) errors.push(`${name} 的质量必须为正数。`);
    if (!o.kind.startsWith('charge') && n('m', 1) < .001) errors.push(`${name} 的刚体质量小于本版 0.001 kg 的分辨率。`);
    if (n('mu', 0) < 0 || n('e', 0) < 0 || n('e', 0) > 1 || n('k', 1) < 0) errors.push(`${name} 的摩擦、恢复系数或劲度系数不在物理范围内。`);
    if (n('L0', 1) < 0 || n('L', 1) <= 0) errors.push(`${name} 的连接长度无效。`);
    const microCharge = microscopic && o.kind.startsWith('charge');
    if (!microCharge && (Math.hypot(n('vx', 0), n('vy', 0)) > 100 || Math.hypot(n('ax', 0), n('ay', 0)) > 100)) errors.push(`${name} 超过本版 100 m/s 或 100 m/s² 的教学尺度。`);
    if (o.props?.qUnit !== undefined && !['C', 'e'].includes(String(o.props.qUnit))) errors.push(`${name} 的电荷单位只支持 C 或 e。`);
    if (o.kind.startsWith('charge')) {
      if (o.props?.rigid) errors.push(`${name} 暂不支持带电刚体接触。`);
      const q = Math.abs(n('q', 1)) * (o.props?.qUnit === 'e' ? ELEMENTARY_CHARGE : 1);
      const B = scene.objs.reduce((sum, f) => sum + (f.kind.startsWith('field-b') ? Math.abs(Number(f.props?.B ?? 1)) : 0), 0);
      const E = scene.objs.reduce((sum, f) => sum + (f.kind === 'field-e' ? Math.abs(Number(f.props?.E ?? 1)) : 0), 0);
      if (!microCharge && q * B / n('m', 1) > 2400) errors.push(`${name} 的回旋频率超过秒级演示分辨率，本版不输出该轨迹。`);
      if (!microCharge && q * E / n('m', 1) > 100) errors.push(`${name} 的电场加速度超出本版 100 m/s² 的教学尺度。`);
    }
  }
  for (const o of scene.objs) if (['spring', 'rope', 'rod'].includes(o.kind)) {
    if (!ids.has(String(o.props?.a)) || !ids.has(String(o.props?.b)) || o.props.a === o.props.b) errors.push(`${o.label || o.kind} 需要明确连接两个不同的已存在对象。`);
    if (o.kind === 'spring') {
      const inverseMass = [o.props?.a, o.props?.b].reduce((sum: number, id) => {
        const b = scene.objs.find(x => x.id === id);
        if (!b || b.props?.fixed || ['hinge', 'ground', 'wall', 'ceiling', 'incline', 'pulley'].includes(b.kind)) return sum;
        return sum + 1 / Number(b.props?.m ?? 1);
      }, 0);
      if (Math.sqrt(Number(o.props.k ?? 50) * inverseMass) > 48) errors.push(`${o.label || o.kind} 的固有频率超过固定步长的支持范围。`);
    }
  }
  return [...new Set(errors)];
}

/** Exact motion during one interval in a spatially uniform field, in screen coordinates (y down). */
export function uniformParticleStep(x: number, y: number, vx: number, vy: number, ax: number, ay: number, omega: number, dt: number) {
  const z = omega * dt;
  const c = Math.cos(z), s = Math.sin(z);
  // Stable limits near zero field; no divisions by a vanishing cyclotron frequency.
  const sinc = Math.abs(z) < 1e-4 ? 1 - z * z / 6 + z ** 4 / 120 : s / z;
  const cosc = Math.abs(z) < 1e-4 ? z / 2 - z ** 3 / 24 + z ** 5 / 720 : (1 - c) / z;
  const s2 = Math.abs(z) < 1e-4 ? .5 - z * z / 24 + z ** 4 / 720 : (1 - c) / (z * z);
  const s3 = Math.abs(z) < 1e-4 ? z / 6 - z ** 3 / 120 + z ** 5 / 5040 : (1 - sinc) / z;
  return {
    x: x + dt * (sinc * vx - cosc * vy) + dt * dt * (s2 * ax - s3 * ay),
    y: y + dt * (cosc * vx + sinc * vy) + dt * dt * (s3 * ax + s2 * ay),
    vx: c * vx - s * vy + dt * (sinc * ax - cosc * ay),
    vy: s * vx + c * vy + dt * (cosc * ax + sinc * ay),
  };
}

