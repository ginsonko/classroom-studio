// 立体演示截图页（vite 托管）：
//   ?ex=inclineForces&t=f0.5&cam=iso&w=1600&h=900     单帧（t 以 f 开头表示时长比例）
//   ?ex=projectile&sheet=1                             2×2 联系表（和发给模型的一样）
//   ?file=/@fs/G:/path/spec.json                        渲染文件里的规格（{spec} 或规格本身）
//   &pp=theta:30,m:3                                   覆盖参数
import '@fontsource-variable/inter';
import { EXAMPLES } from '../src/scene3d/skill';
import { checkSpec, paramDefaults } from '../src/scene3d/validate';
import { contactSheet, S3DScene } from '../src/scene3d/three/scene';
import type { CameraName } from '../src/scene3d/spec';

const q = new URLSearchParams(location.search);
const msg = document.getElementById('msg')!;
(async () => {
  let raw: unknown;
  if (q.get('file')) raw = await (await fetch(q.get('file')!)).json();
  else raw = EXAMPLES[q.get('ex') ?? 'inclineForces']?.spec;
  if (raw && typeof raw === 'object' && 'spec' in (raw as object) && !(raw as { objects?: unknown }).objects) raw = (raw as { spec: unknown }).spec;
  const r = checkSpec(raw);
  if (!r.ok || !r.spec) { msg.textContent = '校验失败：' + r.errors.join('；'); return; }
  if (r.issues.length) console.warn(r.issues);
  const spec = r.spec;
  const pp = Object.fromEntries((q.get('pp') ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split(':'); return [k, +v]; }));
  const params = { ...paramDefaults(spec), ...pp };
  await document.fonts.ready;
  if (q.get('sheet') === '1') {
    const url = contactSheet(spec, params);
    if (!url) { msg.textContent = 'WebGL 不可用'; return; }
    const img = new Image(); img.src = url; document.body.appendChild(img);
    await img.decode();
    document.title = 'ready';
    return;
  }
  const W = +(q.get('w') ?? 1600), H = +(q.get('h') ?? 900);
  const ts = q.get('t') ?? 'f0.5';
  const t = ts.startsWith('f') ? +ts.slice(1) * spec.duration : +ts;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; document.body.appendChild(cv);
  const sc = new S3DScene(spec, params);
  const cam = (q.get('cam') || null) as CameraName | null;
  const view = { az: +(q.get('az') ?? 0), el: +(q.get('el') ?? 0), zoom: +(q.get('zoom') ?? 1) };
  const ok = sc.draw(cv.getContext('2d')!, W, H, t, { camera: cam, view });
  if (!ok) msg.textContent = 'WebGL 不可用';
  document.title = 'ready';
  if (r.issues.length && q.get('issues') === '1') msg.textContent = r.issues.join('\n');
})().catch((e) => { msg.textContent = String(e?.stack ?? e); });
