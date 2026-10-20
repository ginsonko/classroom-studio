import type { DrawCtx } from '../ink/draw';
import type { PhysObj } from './model';
import { fillTextPx } from '../ink/pxText';
import { drawMath } from './drawMath';
import { drawChem } from './drawChem';

/** Shared vector renderer. All coordinates are in page-width units. */
export function drawObj(d: DrawCtx, o: PhysObj, opts: { ghost?: boolean; selected?: boolean; color?: string } = {}) {
  if (![o.x, o.y, o.w, o.h, o.rot].every(Number.isFinite) || o.w <= 0 || o.h <= 0) return;
  const { ctx } = d, w = o.w, h = o.h, x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  const col = opts.color ?? d.color('ink'), accent = d.color('blue');
  const n = (key: string, fallback: number) => typeof o.props[key] === 'number' && Number.isFinite(o.props[key]) ? Number(o.props[key]) : fallback;
  ctx.save();
  ctx.translate(o.x, o.y); ctx.rotate(o.rot); ctx.globalAlpha *= opts.ghost ? .5 : 1;
  ctx.lineWidth = Math.max(.0012, Math.min(.0025, Math.min(w, h) * .055));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = col; ctx.fillStyle = col;
  const line = (ax: number, ay: number, bx: number, by: number) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
  const path = (points: number[][], close = false, fill = false) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath();
    if (fill) { ctx.save(); ctx.globalAlpha *= .12; ctx.fill(); ctx.restore(); }
    ctx.stroke();
  };
  const rect = (x: number, y: number, rw: number, rh: number, radius = .003, filled = true) => {
    ctx.beginPath(); ctx.roundRect(x, y, rw, rh, Math.min(radius, rw / 2, rh / 2));
    if (filled) { ctx.save(); ctx.globalAlpha *= .10; ctx.fill(); ctx.restore(); }
    ctx.stroke();
  };
  const circle = (x: number, y: number, r: number, filled = false) => { ctx.beginPath(); ctx.arc(x, y, Math.max(.0001, r), 0, Math.PI * 2); if (filled) ctx.fill(); else ctx.stroke(); };
  const text = (str: string, x: number, y: number, fs = Math.min(.024, h * .4)) => {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; fillTextPx(ctx, str, x, y, fs, (px) => `500 ${px}px "Inter Variable", "Microsoft YaHei UI", sans-serif`); ctx.restore();
  };
  const arrow = (ax: number, ay: number, bx: number, by: number, length = .009) => {
    line(ax, ay, bx, by); const a = Math.atan2(by - ay, bx - ax);
    path([[bx - Math.cos(a - .5) * length, by - Math.sin(a - .5) * length], [bx, by], [bx - Math.cos(a + .5) * length, by - Math.sin(a + .5) * length]]);
  };
  const hatch = (ay: number, sign = 1) => {
    const count = Math.max(3, Math.min(40, Math.ceil(w / .018)));
    ctx.save(); ctx.lineWidth *= .65; ctx.globalAlpha *= .65;
    for (let i = 0; i <= count; i++) { const x = x0 + i * w / count; line(x, ay, x - .009, ay + sign * .009); }
    ctx.restore();
  };
  const terminals = (gap: number) => { line(x0, 0, -gap, 0); line(gap, 0, x1, 0); };
  let labelInside = false, noLabel = false;
  switch (o.kind) {
    case 'block': case 'plank': rect(x0, y0, w, h, .003); labelInside = true; break;
    case 'cart': case 'car': {
      const wr = Math.min(w * .12, h * .2), bodyY = y0 + h * .18, bottom = y1 - wr * 1.35;
      if (o.kind === 'car' && o.props.look === 'bike') {
        const r = Math.min(h * .27, w * .2), yw = y1 - r, ax = -w * .3, bx = w * .3;
        const seat = [-w * .06, yw - h * .48], bar = [w * .2, yw - h * .55], sh = [w * .02, yw - h * .88];
        circle(ax, yw, r); circle(bx, yw, r); circle(ax, yw, r * .16, true); circle(bx, yw, r * .16, true);
        path([[ax, yw], seat, [0, yw], [ax, yw]]);
        path([[0, yw], [bar[0] - w * .03, bar[1] + h * .08], seat]);
        path([[bx, yw], bar, [bar[0] + w * .07, bar[1] - h * .02]]);
        path([[seat[0], seat[1] - h * .03], sh, [bar[0] + w * .05, bar[1]]]);
        path([[seat[0], seat[1]], [w * .05, yw - h * .22], [0, yw]]);
        ctx.save(); ctx.beginPath(); ctx.arc(sh[0] + w * .03, sh[1] - h * .14, h * .11, 0, Math.PI * 2); ctx.globalAlpha *= .12; ctx.fill(); ctx.restore();
        circle(sh[0] + w * .03, sh[1] - h * .14, h * .11);
        noLabel = true; break;
      }
      if (o.kind === 'car') {
        path([[x0, bottom], [x0, -h * .02], [-w * .27, -h * .10], [-w * .15, y0], [w * .21, y0], [w * .35, -h * .07], [x1, h * .02], [x1, bottom]], true, true);
        path([[-w * .12, -h * .35], [-w * .21, -h * .10], [w * .27, -h * .10], [w * .16, -h * .35]], true);
      } else { rect(x0, bodyY, w, bottom - bodyY, .006); line(x0 - .015, 0, x0, 0); }
      for (const x of [-w * .3, w * .3]) { circle(x, y1 - wr, wr); circle(x, y1 - wr, wr * .3, true); }
      labelInside = true; break;
    }
    case 'ball': case 'charge-pos': case 'charge-neg': {
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.save(); ctx.globalAlpha *= .12; ctx.fill(); ctx.restore(); ctx.stroke();
      if (o.kind !== 'ball') text(o.kind === 'charge-pos' ? '+' : '−', 0, 0, Math.min(w, h) * .58);
      else { circle(-w * .12, -h * .13, Math.min(w, h) * .045, true); labelInside = true; }
      break;
    }
    case 'incline':
      path([[x0, y1], [x1, y1], [x1, y0]], true, true); hatch(y1);
      ctx.beginPath(); ctx.arc(x0, y1, Math.min(w * .20, h * .45), -Math.atan2(h, w), 0); ctx.stroke();
      text(`${Math.round(Math.atan2(h, w) * 180 / Math.PI)}°`, x0 + w * .28, y1 - Math.min(h * .12, .02), .014); break;
    case 'ground': line(x0, y0, x1, y0); hatch(y0); break;
    case 'ceiling': line(x0, y1, x1, y1); hatch(y1, -1); break;
    case 'wall': {
      line(x1, y0, x1, y1); const count = Math.max(3, Math.min(40, Math.ceil(h / .018)));
      for (let i = 0; i <= count; i++) { const y = y0 + i * h / count; line(x1, y, x1 - .01, y + .009); }
      break;
    }
    case 'conveyor': {
      const r = Math.min(h / 2, w / 3); rect(x0, y0, w, h, r, false);
      circle(x0 + r, 0, r * .7); circle(x1 - r, 0, r * .7); circle(x0 + r, 0, .003, true); circle(x1 - r, 0, .003, true);
      const direction = n('speed', 2) < 0 ? -1 : 1;
      arrow(-w * .15 * direction, -h * .23, w * .15 * direction, -h * .23); arrow(w * .15 * direction, h * .23, -w * .15 * direction, h * .23);
      line(x0 + r, y1, x0 + r, y1 + .012); line(x1 - r, y1, x1 - r, y1 + .012); break;
    }
    case 'spring': {
      const count = 9, lead = w * .12, pts = [[x0, 0], [x0 + lead, 0]];
      for (let i = 0; i <= count * 2; i++) pts.push([x0 + lead + (w - 2 * lead) * i / (count * 2), i === 0 || i === count * 2 ? 0 : (i % 2 ? y0 : y1)]);
      pts.push([x1, 0]); path(pts); break;
    }
    case 'rope': case 'rod': case 'wire': case 'conductor-rod':
      if (o.kind === 'conductor-rod') { rect(x0, y0, w, h, w / 2); line(0, y0, 0, y1); }
      else if (o.kind === 'rod') { rect(x0, y0, w, h, h / 2); circle(x0 + h / 2, 0, h * .16, true); circle(x1 - h / 2, 0, h * .16, true); }
      else { line(x0, 0, x1, 0); if (o.kind === 'wire') { circle(x0, 0, .002, true); circle(x1, 0, .002, true); } }
      break;
    case 'pulley':
      circle(0, 0, Math.min(w, h) / 2); circle(0, 0, Math.min(w, h) * .38); circle(0, 0, .004, true);
      line(0, 0, 0, y0 - .025); line(-w * .2, y0 - .025, w * .2, y0 - .025); break;
    case 'track-circle': case 'track-arc': {
      const start = o.kind === 'track-circle' ? 0 : n('a0', 0) * Math.PI / 180, end = o.kind === 'track-circle' ? Math.PI * 2 : n('a1', 180) * Math.PI / 180;
      for (const inset of [0, .006]) { ctx.beginPath(); ctx.ellipse(0, 0, Math.max(.003, w / 2 - inset), Math.max(.003, h / 2 - inset), 0, start, end); ctx.stroke(); }
      ctx.save(); ctx.setLineDash([.003, .005]); ctx.globalAlpha *= .35; line(-w * .12, 0, w * .12, 0); line(0, -h * .12, 0, h * .12); ctx.restore(); break;
    }
    case 'hinge': path([[0, y0], [x0, y1], [x1, y1]], true); circle(0, y0, .004); hatch(y1); break;
    case 'weight': circle(0, y0 + h * .12, w * .12); path([[-w * .25, y0 + h * .2], [w * .25, y0 + h * .2], [x1, y1], [x0, y1]], true, true); labelInside = true; break;
    case 'person': {
      const r = Math.min(w * .22, h * .13); circle(0, y0 + r, r); line(0, y0 + r * 2, 0, h * .1);
      path([[x0, 0], [0, -h * .2], [x1, -h * .02]]); path([[x0, y1], [0, h * .1], [x1, y1]]); break;
    }
    case 'boat':
      path([[x0, h * .05], [x1, h * .05], [w * .32, y1], [-w * .32, y1]], true, true); line(0, h * .05, 0, y0);
      path([[0, y0], [0, -h * .02], [w * .32, -h * .02]], true, true);
      ctx.save(); ctx.globalAlpha *= .45; path([[x0 - .02, y1], [x0, y1 + .006], [0, y1], [x1, y1 + .006], [x1 + .02, y1]]); ctx.restore(); break;
    case 'rocket':
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.quadraticCurveTo(x1, y0 + h * .2, w * .28, h * .3); ctx.lineTo(-w * .28, h * .3); ctx.quadraticCurveTo(x0, y0 + h * .2, 0, y0); ctx.closePath(); ctx.stroke();
      circle(0, -h * .13, w * .15); path([[-w * .28, h * .1], [x0, h * .35], [-w * .28, h * .3]]); path([[w * .28, h * .1], [x1, h * .35], [w * .28, h * .3]]);
      ctx.strokeStyle = d.color('orange'); path([[-w * .17, h * .32], [0, y1], [w * .17, h * .32]]); ctx.strokeStyle = col; break;
    case 'field-b-in': case 'field-b-out': {
      const space = Math.max(.015, n('spacing', .035)), cols = Math.max(1, Math.min(24, Math.floor(w / space))), rows = Math.max(1, Math.min(24, Math.floor(h / space)));
      ctx.save(); ctx.globalAlpha *= .65; ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = .0014;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x = x0 + w * (i + .5) / cols, y = y0 + h * (j + .5) / rows, r = Math.min(.006, w / cols * .18, h / rows * .18); circle(x, y, r);
        if (o.kind === 'field-b-in') { const a = r * .55; line(x - a, y - a, x + a, y + a); line(x - a, y + a, x + a, y - a); }
        else circle(x, y, r * .22, true);
      }
      ctx.restore(); break;
    }
    case 'field-e': {
      // Direction must match the engine: props.angle is the math angle of E (counter-clockwise, y up), default → (0°).
      const ang = n('angle', 0) * Math.PI / 180, sgn = n('E', 100) < 0 ? -1 : 1;
      const ex = Math.cos(ang) * sgn, ey = -Math.sin(ang) * sgn, vertical = Math.abs(ey) > Math.abs(ex);
      const span = vertical ? w : h, count = Math.max(2, Math.min(24, Math.floor(span / Math.max(.015, n('spacing', .04)))));
      ctx.save(); ctx.globalAlpha *= .7; ctx.strokeStyle = accent;
      for (let j = 0; j < count; j++) {
        const f = (j + .5) / count;
        if (vertical) { const x = x0 + w * f; ey > 0 ? arrow(x, y0, x, y1) : arrow(x, y1, x, y0); }
        else { const y = y0 + h * f; ex > 0 ? arrow(x0, y, x1, y) : arrow(x1, y, x0, y); }
      }
      ctx.restore();
      if (o.props.plates === true || o.props.plates === 'true') {
        const plus = d.color('red'), minus = d.color('blue');
        ctx.save(); ctx.fillStyle = col;
        const signs = (a: [number, number], b: [number, number], sign: string, c: string) => {
          for (let i = 0; i < 6; i++) { const f = (i + .5) / 6; ctx.fillStyle = c; text(sign, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, .016); }
        };
        if (vertical) {
          ctx.fillRect(x0, y0 - .006, w, .006); ctx.fillRect(x0, y1, w, .006);
          signs([x0, y0 - .018], [x1, y0 - .018], ey > 0 ? '+' : '−', ey > 0 ? plus : minus);
          signs([x0, y1 + .018], [x1, y1 + .018], ey > 0 ? '−' : '+', ey > 0 ? minus : plus);
        } else {
          ctx.fillRect(x0 - .006, y0, .006, h); ctx.fillRect(x1, y0, .006, h);
          signs([x0 - .018, y0], [x0 - .018, y1], ex > 0 ? '+' : '−', ex > 0 ? plus : minus);
          signs([x1 + .018, y0], [x1 + .018, y1], ex > 0 ? '−' : '+', ex > 0 ? minus : plus);
        }
        ctx.restore();
      }
      break;
    }
    case 'bar-magnet':
      ctx.save(); ctx.fillStyle = d.color('red'); ctx.globalAlpha *= .25; ctx.fillRect(x0, y0, w / 2, h); ctx.fillStyle = accent; ctx.fillRect(0, y0, w / 2, h); ctx.restore();
      rect(x0, y0, w, h, .003, false); line(0, y0, 0, y1); text('N', -w / 4, 0); text('S', w / 4, 0); break;
    case 'coil': {
      const loops = Math.max(3, Math.min(16, Math.round(n('N', 10))));
      for (let i = 0; i < loops; i++) { ctx.beginPath(); ctx.ellipse(x0 + w * (i + .5) / loops, 0, w / loops * .68, h / 2, -.12, 0, Math.PI * 2); ctx.stroke(); } break;
    }
    case 'rail': line(x0, y0, x1, y0); line(x0, y1, x1, y1); line(x0, y0, x0, y1); break;
    case 'battery': terminals(w * .12); line(-w * .12, y0, -w * .12, y1); line(w * .12, y0 * .55, w * .12, y1 * .55); text('+', -w * .28, -h * .38, .013); break;
    case 'resistor': case 'rheostat': {
      const top = o.kind === 'rheostat' ? -h * .05 : y0;
      terminals(w * .32); rect(-w * .32, top, w * .64, o.kind === 'rheostat' ? h * .45 : h, 0, false);
      if (o.kind === 'rheostat') { const x = -w * .28 + w * .56 * Math.max(0, Math.min(1, n('fraction', .5))); line(x1, y0, x, y0); arrow(x, y0, x, top, .007); }
      labelInside = o.kind === 'resistor'; break;
    }
    case 'bulb': case 'ammeter': case 'voltmeter': case 'galvanometer': case 'motor': case 'power-ac': {
      const r = Math.min(h / 2, w * .34); terminals(r); circle(0, 0, r);
      if (o.kind === 'bulb') { const q = r * .64; line(-q, -q, q, q); line(-q, q, q, -q); }
      else if (o.kind === 'power-ac') { ctx.beginPath(); ctx.moveTo(-r * .65, 0); ctx.bezierCurveTo(-r * .35, -r * .7, -r * .1, -r * .7, 0, 0); ctx.bezierCurveTo(r * .2, r * .7, r * .45, r * .7, r * .65, 0); ctx.stroke(); }
      else text(({ ammeter: 'A', voltmeter: 'V', galvanometer: 'G', motor: 'M' } as Record<string, string>)[o.kind], 0, 0, r * 1.12);
      break;
    }
    case 'switch': terminals(w * .25); circle(-w * .25, 0, .003); circle(w * .25, 0, .003); line(-w * .25, 0, w * .25, o.props.on ? 0 : y0); break;
    case 'capacitor': terminals(w * .10); line(-w * .10, y0, -w * .10, y1); line(w * .10, y0, w * .10, y1); break;
    case 'inductor': {
      const loops = 5, span = w * .7, r = span / loops / 2; terminals(span / 2); ctx.beginPath(); ctx.moveTo(-span / 2, 0);
      for (let i = 0; i < loops; i++) ctx.ellipse(-span / 2 + r + i * 2 * r, 0, r, h * .5, 0, Math.PI, 0); ctx.stroke(); break;
    }
    case 'diode': terminals(w * .22); path([[-w * .22, y0], [w * .22, 0], [-w * .22, y1]], true); line(w * .22, y0, w * .22, y1); break;
    case 'junction': circle(0, 0, Math.min(w, h) / 2, true); break;
    default:
      if (o.kind.startsWith('m-')) drawMath(d, o, col);
      else if (o.kind.startsWith('c-')) drawChem(d, o, col);
  }
  if (o.label && !noLabel) text(o.label, 0, labelInside ? 0 : y1 + .017, Math.max(.012, Math.min(.024, labelInside ? h * .42 : .018)));
  if (opts.selected) { ctx.save(); ctx.lineWidth = .001; ctx.strokeStyle = '#3dd9eb'; ctx.setLineDash([.004, .004]); ctx.strokeRect(x0 - .005, y0 - .005, w + .01, h + .01); ctx.restore(); }
  ctx.restore();
}
