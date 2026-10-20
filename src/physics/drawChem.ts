import type { DrawCtx } from '../ink/draw';
import type { PhysObj } from './model';
import { fillTextPx } from '../ink/pxText';

// 化学仪器：每种仪器在自己的模型坐标（y 向下，原点居中）里按教材剖面画法绘制，再等比放进外框。
/** 模型宽高；导管可以随意拉伸，其余保持比例 */
export const CHEM_SIZE: Record<string, [number, number]> = {
  'c-test-tube': [1.4, 6.8], 'c-beaker': [4.8, 4.8], 'c-conical': [4.6, 5.8], 'c-round-flask': [4, 5.8], 'c-cylinder': [2.6, 7.2],
  'c-burette': [1.6, 9.2], 'c-funnel': [3.6, 5.6], 'c-sep-funnel': [2.8, 7.6], 'c-lamp': [3.4, 5.6], 'c-stand': [5.2, 9.2],
  'c-tube': [4, 4], 'c-gas-bottle': [3.4, 4.9], 'c-trough': [8.4, 3.4], 'c-condenser': [10.4, 3.2], 'c-dropper': [1.3, 6.2],
  'c-dish': [4.6, 1.9], 'c-thermometer': [.9, 8.2], 'c-u-tube': [3.2, 4.6],
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function drawChem(d: DrawCtx, o: PhysObj, col: string) {
  const size = CHEM_SIZE[o.kind]; if (!size) return;
  const { ctx } = d, accent = d.color('blue'), warm = d.color('orange'), red = d.color('red');
  const num = (k: string, fb: number) => { const v = o.props[k]; return typeof v === 'number' && Number.isFinite(v) ? v : fb; };
  const flag = (k: string, fb = false) => { const v = o.props[k]; return v === undefined ? fb : v === true || v === 'true'; };
  const lwPage = clamp(Math.min(o.w, o.h) * .02, .0012, .0021);
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (o.kind === 'c-tube') {
    const x0 = -o.w / 2, x1 = o.w / 2, y0 = -o.h / 2, y1 = o.h / 2, r = Math.min(o.w, o.h) * .14, shape = Math.round(num('shape', 0));
    ctx.lineWidth = lwPage * 1.6; ctx.beginPath();
    if (shape === 1) { ctx.moveTo(x0, y0); ctx.arcTo(x0, y1, x1, y1, r); ctx.lineTo(x1, y1); }
    else if (shape === 2) { ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); }
    else { ctx.moveTo(x0, y1); ctx.arcTo(x0, y0, x1, y0, r); ctx.arcTo(x1, y0, x1, y1, r); ctx.lineTo(x1, y1); }
    ctx.stroke(); ctx.restore(); return;
  }

  const [mw, mh] = size, s = Math.min(o.w / mw, o.h / mh), lw = lwPage / s;
  ctx.scale(s, s); ctx.lineWidth = lw;
  const stroke = (p: Path2D, width = 1) => { ctx.save(); ctx.lineWidth = lw * width; ctx.stroke(p); ctx.restore(); };
  const tint = (p: Path2D, c: string, a: number) => { ctx.save(); ctx.fillStyle = c; ctx.globalAlpha *= a; ctx.fill(p); ctx.restore(); };
  const line = (ax: number, ay: number, bx: number, by: number, width = 1) => { const p = new Path2D(); p.moveTo(ax, ay); p.lineTo(bx, by); stroke(p, width); };
  /** 液体：裁在容器内腔里，从底往上填到 level（0..1） */
  const liquid = (inner: Path2D, top: number, bottom: number, level: number, bands?: { at: number; color: string }[]) => {
    if (level <= 0) return;
    const y = bottom - (bottom - top) * clamp(level, 0, 1);
    ctx.save(); ctx.clip(inner);
    const fills = bands ?? [{ at: 0, color: accent }];
    fills.forEach((b, i) => { const from = y + (bottom - y) * b.at, to = i + 1 < fills.length ? y + (bottom - y) * fills[i + 1].at : bottom + 1; ctx.save(); ctx.fillStyle = b.color; ctx.globalAlpha *= .24; ctx.fillRect(-mw, from, mw * 2, to - from); ctx.restore(); });
    ctx.strokeStyle = fills[0].color; ctx.globalAlpha *= .85; ctx.beginPath(); ctx.moveTo(-mw, y); ctx.lineTo(mw, y); ctx.stroke();
    ctx.restore();
  };
  const ticks = (x: number, from: number, to: number, step: number, len: number, dir = 1) => { for (let y = from, i = 0; y >= to && i < 80; y -= step, i++) line(x, y, x + dir * (i % 5 === 0 ? len : len * .55), y, .7); };
  const stopper = (half: number, top: number, bottom: number) => { const p = new Path2D(); p.moveTo(-half, top); p.lineTo(half, top); p.lineTo(half * .8, bottom); p.lineTo(-half * .8, bottom); p.closePath(); tint(p, col, .2); stroke(p); };
  const text = (str: string, x: number, y: number, fs: number, align: CanvasTextAlign = 'center') => { ctx.save(); ctx.textAlign = align; ctx.textBaseline = 'middle'; fillTextPx(ctx, str, x, y, fs, (px) => `500 ${px}px "Microsoft YaHei UI", "PingFang SC", sans-serif`); ctx.restore(); };
  const level = num('liquid', 0);

  switch (o.kind) {
    case 'c-test-tube': {
      const out = new Path2D(), inner = new Path2D();
      out.moveTo(-.62, -3); out.lineTo(-.5, -2.85); out.lineTo(-.5, 2.4); out.arc(0, 2.4, .5, Math.PI, 0, true); out.lineTo(.5, -2.85); out.lineTo(.62, -3);
      inner.moveTo(-.5, -2.85); inner.lineTo(-.5, 2.4); inner.arc(0, 2.4, .5, Math.PI, 0, true); inner.lineTo(.5, -2.85); inner.closePath();
      liquid(inner, -2.85, 2.9, level); stroke(out);
      if (flag('stopper')) stopper(.6, -3.4, -2.55);
      break;
    }
    case 'c-beaker': {
      const out = new Path2D(), inner = new Path2D();
      out.moveTo(-2.35, -2.4); out.quadraticCurveTo(-2, -2.3, -2, -1.9); out.lineTo(-2, 1.95); out.quadraticCurveTo(-2, 2.2, -1.75, 2.2); out.lineTo(1.75, 2.2); out.quadraticCurveTo(2, 2.2, 2, 1.95); out.lineTo(2, -2.1); out.lineTo(2.12, -2.22);
      inner.moveTo(-2, -2.1); inner.lineTo(-2, 1.95); inner.quadraticCurveTo(-2, 2.2, -1.75, 2.2); inner.lineTo(1.75, 2.2); inner.quadraticCurveTo(2, 2.2, 2, 1.95); inner.lineTo(2, -2.1); inner.closePath();
      liquid(inner, -2.1, 2.2, level); stroke(out);
      for (let i = 1; i <= 4; i++) line(-1.45, 2.2 - i * .8, -.95, 2.2 - i * .8, .7);
      break;
    }
    case 'c-conical': {
      const out = new Path2D(), inner = new Path2D();
      const body = (p: Path2D) => { p.lineTo(-.55, -1.3); p.lineTo(-2.05, 2.25); p.quadraticCurveTo(-2.2, 2.6, -1.8, 2.6); p.lineTo(1.8, 2.6); p.quadraticCurveTo(2.2, 2.6, 2.05, 2.25); p.lineTo(.55, -1.3); };
      out.moveTo(-.68, -2.7); out.lineTo(-.55, -2.6); body(out); out.lineTo(.55, -2.6); out.lineTo(.68, -2.7);
      inner.moveTo(-.55, -2.6); body(inner); inner.lineTo(.55, -2.6); inner.closePath();
      liquid(inner, -2.6, 2.6, level); stroke(out);
      if (flag('stopper')) stopper(.66, -3.05, -2.25);
      break;
    }
    case 'c-round-flask': {
      const cy = 1.05, r = 1.75, a = Math.atan2(-Math.sqrt(r * r - .42 * .42), .42), left = -Math.PI - a;
      const out = new Path2D(), inner = new Path2D();
      out.moveTo(-.55, -2.85); out.lineTo(-.42, -2.75); out.arc(0, cy, r, left, a, true); out.lineTo(.42, -2.75); out.lineTo(.55, -2.85);
      inner.moveTo(-.42, -2.75); inner.arc(0, cy, r, left, a, true); inner.lineTo(.42, -2.75); inner.closePath();
      liquid(inner, -2.75, cy + r, level); stroke(out);
      if (flag('stopper')) stopper(.56, -3.15, -2.4);
      break;
    }
    case 'c-cylinder': {
      const out = new Path2D(), inner = new Path2D(), base = new Path2D();
      out.moveTo(-.85, -3.55); out.quadraticCurveTo(-.55, -3.45, -.55, -3.15); out.lineTo(-.55, 2.95); out.lineTo(.55, 2.95); out.lineTo(.55, -3.3); out.lineTo(.63, -3.4);
      inner.rect(-.55, -3.3, 1.1, 6.25);
      base.roundRect(-1.25, 2.95, 2.5, .5, .1);
      liquid(inner, -3.3, 2.95, level); stroke(out); tint(base, col, .15); stroke(base);
      ticks(.55, 2.6, -2.8, .27, -.32);
      break;
    }
    case 'c-burette': {
      const tube = new Path2D(), inner = new Path2D(), tip = new Path2D(), cock = new Path2D();
      tube.moveTo(-.28, -4.5); tube.lineTo(-.28, 2.5); tube.lineTo(-.16, 2.62); tube.moveTo(.28, -4.5); tube.lineTo(.28, 2.5); tube.lineTo(.16, 2.62);
      inner.rect(-.28, -4.5, .56, 7.05);
      cock.arc(0, 2.88, .28, 0, Math.PI * 2);
      tip.moveTo(-.16, 3.14); tip.lineTo(-.16, 3.45); tip.lineTo(-.05, 4.55); tip.lineTo(.05, 4.55); tip.lineTo(.16, 3.45); tip.lineTo(.16, 3.14);
      liquid(inner, -4.5, 2.55, num('liquid', .85)); stroke(tube); stroke(cock); stroke(tip);
      line(-.75, 2.88, .75, 2.88, 1.8);
      ticks(-.28, 2.3, -4.2, .26, .3);
      break;
    }
    case 'c-funnel': {
      const out = new Path2D();
      out.moveTo(-1.7, -2.7); out.lineTo(-.2, -.3); out.lineTo(-.2, 2.8); out.lineTo(.2, 2.55); out.lineTo(.2, -.3); out.lineTo(1.7, -2.7);
      stroke(out);
      if (flag('paper')) { ctx.save(); ctx.setLineDash([lw * 3, lw * 2.4]); const p = new Path2D(); p.moveTo(-1.45, -2.6); p.lineTo(0, -.55); p.lineTo(1.45, -2.6); stroke(p, .8); ctx.restore(); }
      break;
    }
    case 'c-sep-funnel': {
      const out = new Path2D(), inner = new Path2D(), cap = new Path2D(), cock = new Path2D(), stem = new Path2D();
      const body = (p: Path2D) => { p.moveTo(-.28, -2.9); p.bezierCurveTo(-1.65, -2.35, -1.55, -.2, -.2, .95); p.lineTo(.2, .95); p.bezierCurveTo(1.55, -.2, 1.65, -2.35, .28, -2.9); };
      body(inner); inner.closePath();
      out.moveTo(-.28, -3.3); out.lineTo(-.28, -2.9); body(out); out.lineTo(.28, -3.3);
      cap.roundRect(-.34, -3.75, .68, .45, .12);
      cock.arc(0, 1.2, .25, 0, Math.PI * 2);
      stem.moveTo(-.12, 1.45); stem.lineTo(-.12, 3.75); stem.lineTo(.12, 3.5); stem.lineTo(.12, 1.45);
      const lv = num('liquid', .5);
      liquid(inner, -2.9, .95, lv, flag('layers', true) ? [{ at: 0, color: warm }, { at: .5, color: accent }] : undefined);
      stroke(out); tint(cap, col, .2); stroke(cap); stroke(cock); stroke(stem); line(-.7, 1.2, .7, 1.2, 1.8);
      break;
    }
    case 'c-lamp': {
      const body = new Path2D(), neck = new Path2D();
      body.moveTo(-.5, .4); body.quadraticCurveTo(-1.6, .55, -1.6, 1.5); body.lineTo(-1.6, 2.4); body.quadraticCurveTo(-1.6, 2.6, -1.4, 2.6); body.lineTo(1.4, 2.6); body.quadraticCurveTo(1.6, 2.6, 1.6, 2.4); body.lineTo(1.6, 1.5); body.quadraticCurveTo(1.6, .55, .5, .4); body.closePath();
      neck.rect(-.42, -.05, .84, .45);
      liquid(body, .45, 2.6, num('liquid', .5)); stroke(body); stroke(neck); line(0, -.05, 0, -.6, 2.2);
      if (flag('flame', true)) {
        const f = new Path2D(), core = new Path2D();
        f.moveTo(0, -2.75); f.quadraticCurveTo(.78, -1.5, .38, -.78); f.quadraticCurveTo(0, -.45, -.38, -.78); f.quadraticCurveTo(-.78, -1.5, 0, -2.75); f.closePath();
        core.moveTo(0, -1.75); core.quadraticCurveTo(.36, -1.1, .17, -.78); core.quadraticCurveTo(0, -.62, -.17, -.78); core.quadraticCurveTo(-.36, -1.1, 0, -1.75); core.closePath();
        ctx.save(); ctx.strokeStyle = warm; tint(f, warm, .28); stroke(f); ctx.strokeStyle = accent; tint(core, accent, .25); stroke(core, .8); ctx.restore();
      }
      break;
    }
    case 'c-stand': {
      const base = new Path2D(), rod = new Path2D();
      base.roundRect(-2.6, 4.05, 5.2, .5, .08); rod.rect(-1.75, -4.6, .18, 8.65);
      tint(base, col, .15); stroke(base); tint(rod, col, .1); stroke(rod);
      const clampAt = (y: number, jaw: boolean) => {
        const boss = new Path2D(); boss.rect(-1.9, y - .22, .48, .44); tint(boss, col, .2); stroke(boss);
        line(-1.42, y - .07, jaw ? 1.1 : .25, y - .07); line(-1.42, y + .07, jaw ? 1.1 : .25, y + .07);
        if (jaw) { const j = new Path2D(); j.moveTo(1.1, y - .07); j.quadraticCurveTo(1.7, y - .55, 1.78, y - .06); j.moveTo(1.1, y + .07); j.quadraticCurveTo(1.7, y + .55, 1.78, y + .06); stroke(j); }
      };
      const yc = 3.6 - clamp(num('clamp', .62), 0, 1) * 7.6;
      clampAt(yc, true);
      if (flag('ring')) { const yr = Math.min(3.4, yc + 2.2); clampAt(yr, false); const ring = new Path2D(); ring.ellipse(1.1, yr, .85, .2, 0, 0, Math.PI * 2); stroke(ring, 1.3); }
      break;
    }
    case 'c-gas-bottle': {
      const out = new Path2D(), inner = new Path2D();
      const body = (p: Path2D) => { p.lineTo(-1, -1.85); p.quadraticCurveTo(-1.45, -1.75, -1.45, -1.3); p.lineTo(-1.45, 1.95); p.quadraticCurveTo(-1.45, 2.25, -1.15, 2.25); p.lineTo(1.15, 2.25); p.quadraticCurveTo(1.45, 2.25, 1.45, 1.95); p.lineTo(1.45, -1.3); p.quadraticCurveTo(1.45, -1.75, 1, -1.85); };
      out.moveTo(-1, -2.15); body(out); out.lineTo(1, -2.15);
      inner.moveTo(-1, -2.15); body(inner); inner.lineTo(1, -2.15); inner.closePath();
      liquid(inner, -2.15, 2.25, level); stroke(out); line(-1.12, -2.15, -1, -2.15, 1.4); line(1, -2.15, 1.12, -2.15, 1.4);
      if (flag('plate', true)) { const p = new Path2D(); p.rect(-1.5, -2.38, 3, .2); tint(p, accent, .15); stroke(p); }
      break;
    }
    case 'c-trough': {
      const out = new Path2D(), inner = new Path2D();
      const body = (p: Path2D) => { p.lineTo(-3.85, 1.3); p.quadraticCurveTo(-3.85, 1.6, -3.55, 1.6); p.lineTo(3.55, 1.6); p.quadraticCurveTo(3.85, 1.6, 3.85, 1.3); p.lineTo(3.85, -1.4); };
      out.moveTo(-4, -1.55); out.lineTo(-3.85, -1.4); body(out); out.lineTo(4, -1.55);
      inner.moveTo(-3.85, -1.4); body(inner); inner.closePath();
      liquid(inner, -1.4, 1.6, num('liquid', .7)); stroke(out);
      break;
    }
    case 'c-condenser': {
      line(-5.1, -.17, 5.1, -.17); line(-5.1, .17, 5.1, .17);
      const j = new Path2D();
      j.moveTo(-3.9, -.17); j.lineTo(-3.4, -.72); j.lineTo(3.4, -.72); j.lineTo(3.9, -.17);
      j.moveTo(-3.9, .17); j.lineTo(-3.4, .72); j.lineTo(3.4, .72); j.lineTo(3.9, .17);
      j.moveTo(-2.85, -.72); j.lineTo(-2.85, -1.35); j.moveTo(-2.55, -.72); j.lineTo(-2.55, -1.35);
      j.moveTo(2.55, .72); j.lineTo(2.55, 1.35); j.moveTo(2.85, .72); j.lineTo(2.85, 1.35);
      stroke(j);
      if (flag('labels', true)) { text('出水', -2.35, -1.2, .42, 'left'); text('进水', 3.05, 1.2, .42, 'left'); }
      break;
    }
    case 'c-dropper': {
      const bulb = new Path2D(), collar = new Path2D(), tube = new Path2D();
      bulb.ellipse(0, -2.25, .55, .85, 0, 0, Math.PI * 2); collar.rect(-.38, -1.45, .76, .3);
      tube.moveTo(-.22, -1.15); tube.lineTo(-.22, 1.9); tube.lineTo(-.06, 3.05); tube.lineTo(.06, 3.05); tube.lineTo(.22, 1.9); tube.lineTo(.22, -1.15);
      tint(bulb, col, .22); stroke(bulb); tint(collar, col, .15); stroke(collar); stroke(tube);
      break;
    }
    case 'c-dish': {
      const out = new Path2D(), inner = new Path2D();
      const body = (p: Path2D) => { p.bezierCurveTo(-1.7, .6, -.9, .85, 0, .85); p.bezierCurveTo(.9, .85, 1.7, .6, 2, -.62); };
      out.moveTo(-2.2, -.75); out.lineTo(-2, -.62); body(out);
      inner.moveTo(-2, -.62); body(inner); inner.closePath();
      liquid(inner, -.62, .85, level); stroke(out);
      break;
    }
    case 'c-thermometer': {
      const out = new Path2D(), a = Math.atan2(-.35, .15), b = Math.atan2(-.35, -.15);
      out.moveTo(-.15, 3); out.lineTo(-.15, -3.75); out.arc(0, -3.75, .15, Math.PI, 0, false); out.lineTo(.15, 3); out.arc(0, 3.35, .38, a, b, false); out.closePath();
      const col0 = 2.95 - clamp(num('liquid', .45), 0, 1) * 6.6, bead = new Path2D(), bar = new Path2D();
      bead.arc(0, 3.35, .29, 0, Math.PI * 2); bar.rect(-.07, col0, .14, 3.35 - col0);
      tint(bead, red, .75); tint(bar, red, .75); stroke(out);
      ticks(.15, 2.55, -3.4, .3, .2);
      break;
    }
    case 'c-u-tube': {
      const out = new Path2D(), inner = new Path2D(), region = new Path2D();
      out.moveTo(-1.35, -2.2); out.lineTo(-1.35, .85); out.arc(0, .85, 1.35, Math.PI, 0, true); out.lineTo(1.35, -2.2);
      inner.moveTo(-.75, -2.2); inner.lineTo(-.75, .85); inner.arc(0, .85, .75, Math.PI, 0, true); inner.lineTo(.75, -2.2);
      region.moveTo(-1.35, -2.2); region.lineTo(-1.35, .85); region.arc(0, .85, 1.35, Math.PI, 0, true); region.lineTo(1.35, -2.2); region.lineTo(.75, -2.2); region.lineTo(.75, .85); region.arc(0, .85, .75, 0, Math.PI, false); region.lineTo(-.75, -2.2); region.closePath();
      liquid(region, -2.2, 2.2, num('liquid', .55)); stroke(out); stroke(inner);
      break;
    }
  }
  ctx.restore();
}
