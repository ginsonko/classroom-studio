/* 最强网课教辅系统 · 课件设计包 cs-deck 1.0（原生 JS，无依赖；KaTeX 存在时自动渲染公式）
   用法见同目录「组件说明.md」。全部接口挂在 window.CS 上。 */
(function () {
  'use strict';
  var CS = window.CS = window.CS || {};
  var errors = CS._errors = [];
  window.addEventListener('error', function (e) { errors.push(String(e.message || e.error || '脚本出错') + (e.lineno ? '（第 ' + e.lineno + ' 行）' : '')); });
  window.addEventListener('unhandledrejection', function (e) { errors.push('Promise 出错：' + String(e.reason && e.reason.message || e.reason)); });

  var readyFns = [], isReady = false;
  CS.ready = function (fn) { if (isReady) { try { fn(); } catch (e) { errors.push(e.message); throw e; } } else readyFns.push(fn); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  CS.$ = $; CS.$$ = $$;
  CS.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  /** 数字显示：保留 d 位小数，去掉多余的 0，负号用真正的减号 */
  CS.fmt = function (v, d) { if (!isFinite(v)) return '—'; var s = Number(v).toFixed(d == null ? 2 : d); if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, ''); if (s === '-0') s = '0'; return s.replace('-', '−'); };

  // ── 公式 ──
  var TEX_OPTS = { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }], ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'canvas', 'svg'], ignoredClasses: ['no-tex'], throwOnError: false, strict: 'ignore' };
  CS.renderTex = function (root) { if (window.renderMathInElement) window.renderMathInElement(root || document.body, TEX_OPTS); };
  /** 把 tex 渲染进元素（动态读数用）：CS.tex(el, 'F_N = ' + v + '\\,\\mathrm{N}') */
  CS.tex = function (el, tex, display) {
    if (typeof el === 'string') el = $(el);
    if (!el) return;
    if (window.katex) window.katex.render(String(tex), el, { throwOnError: false, displayMode: !!display, strict: 'ignore' });
    else el.textContent = String(tex);
  };

  // ── 翻页与分步 ──
  var deck = { pages: [], i: 0, steps: [] };
  CS.deck = deck;
  function stepsOf(page) {
    var list = $$('.cs-step', page);
    return list.map(function (el, k) { return { el: el, n: Number(el.getAttribute('data-step')) || k + 1 }; }).sort(function (a, b) { return a.n - b.n; });
  }
  function shownSteps(page) { return Number(page.getAttribute('data-shown') || 0); }
  function applySteps(page, shown) {
    page.setAttribute('data-shown', String(shown));
    var groups = []; stepsOf(page).forEach(function (s) { if (groups.indexOf(s.n) < 0) groups.push(s.n); });
    stepsOf(page).forEach(function (s) { s.el.classList.toggle('cs-hidden', groups.indexOf(s.n) >= shown); });
    return groups.length;
  }
  function totalSteps(page) { var g = []; stepsOf(page).forEach(function (s) { if (g.indexOf(s.n) < 0) g.push(s.n); }); return g.length; }
  function emitPage() { var p = deck.pages[deck.i]; document.dispatchEvent(new CustomEvent('cs:page', { detail: { index: deck.i, page: p } })); if (p) p.dispatchEvent(new CustomEvent('cs:show', { detail: { index: deck.i } })); }
  CS.go = function (i, opts) {
    if (!deck.pages.length) return;
    var n = CS.clamp(i, 0, deck.pages.length - 1);
    deck.pages.forEach(function (p, k) { p.classList.toggle('on', k === n); });
    var back = opts && opts.fromEnd;
    applySteps(deck.pages[n], back ? totalSteps(deck.pages[n]) : 0);
    deck.i = n; updateNav();
    try { history.replaceState(null, '', '#p' + (n + 1)); } catch (e) { /* file:// 某些环境不让改 */ }
    emitPage();
  };
  /** 下一步：本页还有没出现的分步内容就先出现，否则翻到下一页 */
  CS.next = function () {
    var p = deck.pages[deck.i]; if (!p) return;
    var sh = shownSteps(p), tot = totalSteps(p);
    if (!document.body.classList.contains('cs-scroll') && sh < tot) { applySteps(p, sh + 1); updateNav(); p.dispatchEvent(new CustomEvent('cs:step', { detail: { shown: sh + 1 } })); return; }
    if (deck.i < deck.pages.length - 1) CS.go(deck.i + 1);
  };
  CS.prev = function () {
    var p = deck.pages[deck.i]; if (!p) return;
    var sh = shownSteps(p);
    if (!document.body.classList.contains('cs-scroll') && sh > 0) { applySteps(p, sh - 1); updateNav(); return; }
    if (deck.i > 0) CS.go(deck.i - 1, { fromEnd: true });
  };
  var nav;
  function updateNav() {
    if (!nav) return;
    var p = deck.pages[deck.i], left = p ? totalSteps(p) - shownSteps(p) : 0;
    nav.count.textContent = (deck.i + 1) + ' / ' + deck.pages.length;
    nav.prev.disabled = deck.i === 0 && (!p || shownSteps(p) === 0);
    nav.next.disabled = deck.i === deck.pages.length - 1 && left <= 0;
    nav.next.title = left > 0 ? '下一步（本页还有 ' + left + ' 步）' : '下一页';
    nav.bar.style.width = ((deck.i + 1) / deck.pages.length * 100) + '%';
  }
  function buildNav() {
    var box = document.createElement('div'); box.className = 'cs-nav';
    box.innerHTML = '<button type="button" class="cs-prev" aria-label="上一页">‹</button><span class="cs-count"></span><button type="button" class="cs-next" aria-label="下一页">›</button>';
    var bar = document.createElement('div'); bar.className = 'cs-progress';
    document.body.appendChild(box); document.body.appendChild(bar);
    nav = { box: box, bar: bar, prev: $('.cs-prev', box), next: $('.cs-next', box), count: $('.cs-count', box) };
    nav.prev.addEventListener('click', CS.prev); nav.next.addEventListener('click', CS.next);
  }

  // ── 缩放：横屏等比缩放 1280×720；竖屏窄屏改成长页滚动 ──
  var stage;
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var scroll = (w < 760 && h > w) || document.body.getAttribute('data-mode') === 'scroll';
    var was = document.body.classList.contains('cs-scroll');
    document.body.classList.toggle('cs-scroll', scroll);
    if (!scroll && stage) { var k = Math.min(w / 1280, h / 720); stage.style.transform = 'translate(' + (-640 * k) + 'px,' + (-360 * k) + 'px) scale(' + k + ')'; }
    CS.scale = scroll ? 1 : Math.min(w / 1280, h / 720);
    if (was !== scroll) { if (scroll) deck.pages.forEach(function (p) { applySteps(p, totalSteps(p)); }); else CS.go(deck.i); }
    document.dispatchEvent(new CustomEvent('cs:resize'));
  }

  function initDeck() {
    var root = $('.cs-deck'); if (!root) return;
    deck.pages = $$('.cs-page', root);
    if (!deck.pages.length) return;
    stage = $('.cs-stage', root);
    if (!stage) { stage = document.createElement('div'); stage.className = 'cs-stage'; deck.pages.forEach(function (p) { stage.appendChild(p); }); root.appendChild(stage); }
    buildNav();
    var m = /^#p(\d+)$/.exec(location.hash || '');
    fit();
    CS.go(m ? Number(m[1]) - 1 : 0);
    window.addEventListener('resize', fit);
    document.addEventListener('keydown', function (e) {
      var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].indexOf(e.key) >= 0) { e.preventDefault(); CS.next(); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].indexOf(e.key) >= 0) { e.preventDefault(); CS.prev(); }
      else if (e.key === 'Home') CS.go(0); else if (e.key === 'End') CS.go(deck.pages.length - 1);
    });
    // 触屏左右滑翻页（竖屏长页模式下不拦截）
    var sx = 0, sy = 0, st = 0;
    root.addEventListener('touchstart', function (e) { var p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = Date.now(); }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (document.body.classList.contains('cs-scroll')) return;
      var p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
      if (e.target.closest && e.target.closest('canvas, input, .cs-nodrag')) return;
      if (Date.now() - st < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) CS.next(); else CS.prev(); }
    }, { passive: true });
  }

  // ── 滑块：CS.slider(容器, { label, min, max, step, value, unit, digits, onInput }) ──
  CS.slider = function (box, o) {
    if (typeof box === 'string') box = $(box);
    var wrap = document.createElement('label'); wrap.className = 'cs-slider';
    var name = document.createElement('span'); name.className = 'cs-slider-name'; name.innerHTML = o.label || '';
    var input = document.createElement('input'); input.type = 'range';
    input.min = o.min; input.max = o.max; input.step = o.step || (o.max - o.min) / 100; input.value = o.value != null ? o.value : o.min;
    var out = document.createElement('output');
    wrap.appendChild(name); wrap.appendChild(input); wrap.appendChild(out);
    box.appendChild(wrap);
    if (o.label && /\$/.test(o.label)) CS.renderTex(name);
    var api = {
      el: input,
      get value() { return Number(input.value); },
      set: function (v) { input.value = v; show(); },
    };
    function show() { out.textContent = CS.fmt(Number(input.value), o.digits) + (o.unit ? ' ' + o.unit : ''); }
    input.addEventListener('input', function () { show(); if (o.onInput) o.onInput(Number(input.value)); });
    show();
    return api;
  };

  // ── 按钮：CS.button(容器, '文字', onClick, 'ghost') ──
  CS.button = function (box, text, fn, cls) {
    if (typeof box === 'string') box = $(box);
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cs-btn' + (cls ? ' ' + cls : ''); b.textContent = text;
    b.addEventListener('click', fn); box.appendChild(b); return b;
  };

  // ── 画布：按显示尺寸和像素比自动设置分辨率，绘图坐标用 CSS 像素 ──
  CS.canvas = function (cv) {
    if (typeof cv === 'string') cv = $(cv);
    var ctx = cv.getContext('2d');
    var api = { el: cv, ctx: ctx, w: 0, h: 0 }, aw = Number(cv.getAttribute('width')) || 300, ah = Number(cv.getAttribute('height')) || 150;
    api.resize = function () {
      var r = cv.getBoundingClientRect(), k = (CS.scale || 1), dpr = window.devicePixelRatio || 1;
      // 所在页还没显示时量不到尺寸：先按 width/height 属性画，翻到这一页时会重画
      var w = Math.max(10, r.width ? r.width / k : aw), h = Math.max(10, r.height ? r.height / k : ah);
      api.w = w; api.h = h;
      var bw = Math.round(w * k * dpr), bh = Math.round(h * k * dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
      ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
      return api;
    };
    /** 鼠标 / 触点 → 画布坐标 */
    api.point = function (e) { var r = cv.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return { x: (p.clientX - r.left) / r.width * api.w, y: (p.clientY - r.top) / r.height * api.h }; };
    api.resize();
    return api;
  };

  /**
   * 仿真循环：CS.sim({ canvas, controls, init(state), step(state, dt), draw(ctx, state, w, h), autoplay })
   * dt 单位秒，每帧最多 1/30 s（切后台回来不会跳）；自动加「播放/暂停」「重置」按钮。
   */
  CS.sim = function (o) {
    var c = CS.canvas(o.canvas), state = {}, playing = false, last = 0, raf = 0;
    var api = { canvas: c, state: state, t: 0 };
    function reset() { for (var k in state) delete state[k]; api.t = 0; if (o.init) o.init(state); draw(); }
    function draw() { c.resize(); c.ctx.clearRect(0, 0, c.w, c.h); try { o.draw(c.ctx, state, c.w, c.h); } catch (e) { errors.push('绘图出错：' + e.message); stop(); throw e; } }
    function frame(ts) {
      if (!playing) return;
      var dt = last ? Math.min(1 / 30, (ts - last) / 1000) : 0; last = ts;
      var sub = o.substeps || 4;
      try { for (var i = 0; i < sub; i++) { if (o.step) o.step(state, dt / sub); api.t += dt / sub; } } catch (e) { errors.push('仿真出错：' + e.message); stop(); throw e; }
      draw();
      if (o.until && o.until(state)) { stop(); return; }
      raf = requestAnimationFrame(frame);
    }
    function play() { if (playing) return; playing = true; last = 0; if (btn) btn.textContent = '暂停'; raf = requestAnimationFrame(frame); }
    function stop() { playing = false; cancelAnimationFrame(raf); if (btn) btn.textContent = '播放'; }
    var btn = null;
    if (o.controls) {
      var box = typeof o.controls === 'string' ? $(o.controls) : o.controls;
      btn = CS.button(box, '播放', function () { if (playing) stop(); else play(); });
      CS.button(box, '重置', function () { stop(); reset(); }, 'ghost');
    }
    api.play = play; api.pause = stop; api.reset = reset; api.redraw = draw;
    Object.defineProperty(api, 'playing', { get: function () { return playing; } });
    document.addEventListener('cs:resize', function () { draw(); });
    var page = o.canvas.closest ? o.canvas.closest('.cs-page') : null;
    if (page) page.addEventListener('cs:show', function () { draw(); if (o.autoplay) play(); });
    if (!page || page.classList.contains('on')) { /* 下一帧再画，等布局完成 */ requestAnimationFrame(function () { draw(); if (o.autoplay) play(); }); }
    CS._sims.push(api);
    reset();
    return api;
  };
  CS._sims = [];

  // ── 画图小工具（canvas 2D） ──
  /** 带下标 / 上标的标签：'F_N'、'v_0'、'a^2'、'F_{合}'，斜体字母 */
  CS.label = function (ctx, text, x, y, o) {
    o = o || {};
    var size = o.size || 20, color = o.color || getVar('--ink'), align = o.align || 'center';
    var parts = [], re = /([_^])(\{[^}]*\}|.)/g, last = 0, m;
    text = String(text);
    while ((m = re.exec(text))) { if (m.index > last) parts.push({ t: text.slice(last, m.index), k: 0 }); parts.push({ t: m[2].replace(/^\{|\}$/g, ''), k: m[1] === '_' ? 1 : -1 }); last = re.lastIndex; }
    if (last < text.length) parts.push({ t: text.slice(last), k: 0 });
    var font = function (p) { var s = p.k ? size * 0.68 : size, it = /^[A-Za-z]+$/.test(p.t) && !o.upright ? 'italic ' : ''; return it + (o.bold ? '600 ' : '') + s + 'px "Times New Roman", ' + getVar('--font'); };
    ctx.save(); ctx.fillStyle = color; ctx.textBaseline = 'middle';
    var w = 0; parts.forEach(function (p) { ctx.font = font(p); w += ctx.measureText(p.t).width; });
    var cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    parts.forEach(function (p) { ctx.font = font(p); ctx.textAlign = 'left'; ctx.fillText(p.t, cx, y + (p.k === 1 ? size * 0.28 : p.k === -1 ? -size * 0.34 : 0)); cx += ctx.measureText(p.t).width; });
    ctx.restore();
    return w;
  };
  /** 箭头：CS.arrow(ctx, x1, y1, x2, y2, { color, width, head, label, labelSide }) */
  CS.arrow = function (ctx, x1, y1, x2, y2, o) {
    o = o || {};
    var color = o.color || getVar('--accent'), lw = o.width || 4, head = o.head || Math.max(10, lw * 3.2);
    var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1) return;
    var ux = dx / len, uy = dy / len;
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
    var hl = Math.min(head, len * 0.6);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * hl * 0.8, y2 - uy * hl * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * hl - uy * hl * 0.5, y2 - uy * hl + ux * hl * 0.5); ctx.lineTo(x2 - ux * hl + uy * hl * 0.5, y2 - uy * hl - ux * hl * 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (o.label) { var s = o.labelSide || 1, off = o.labelOffset || 18; CS.label(ctx, o.label, x2 + uy * off * s + ux * 10, y2 - ux * off * s + uy * 10, { color: color, size: o.labelSize || 20, bold: true }); }
  };
  /**
   * 受力图：CS.force(ctx, { x, y, w, h, label, scale, forces: [{ name: 'F_N', value: 600, angle: 90, color, from: 'center|top|bottom' }] })
   * angle 按数学习惯：0 向右、90 向上；箭头长度 = value × scale（像素），太短的画最短 14 像素并标数值。
   */
  CS.force = function (ctx, o) {
    var w = o.w || 80, h = o.h || 80, x = o.x, y = o.y, scale = o.scale || 0.2;
    ctx.save();
    ctx.fillStyle = o.fill || color(getVar('--accent'), 0.14); ctx.strokeStyle = o.stroke || getVar('--accent'); ctx.lineWidth = 3;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 10); ctx.fill(); ctx.stroke();
    if (o.label) CS.label(ctx, o.label, x, y, { size: 20, color: getVar('--ink') });
    ctx.restore();
    (o.forces || []).forEach(function (f, k) {
      var a = (f.angle || 0) * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a);
      var len = Math.max(14, Math.abs(f.value) * scale) * (f.value < 0 ? -1 : 1);
      var sx = x, sy = y;
      if (f.from === 'top') sy = y - h / 2; else if (f.from === 'bottom') sy = y + h / 2;
      var cols = [getVar('--accent'), getVar('--accent-2'), getVar('--ok'), getVar('--bad')];
      CS.arrow(ctx, sx, sy, sx + ux * len, sy + uy * len, { color: f.color || cols[k % cols.length], width: 4, label: f.name + (f.show ? ' = ' + f.show : ''), labelSide: f.side || 1 });
    });
  };
  /**
   * 坐标图：var g = CS.plot(canvasApi 或 ctx, { x: [0, 10], y: [-5, 5], box: {l,t,w,h}, xLabel: 't/s', yLabel: 'a/(m·s⁻²)', xStep, yStep, grid: true })
   * g.axes() 画坐标轴；g.fn(f, style) 画函数；g.line(points, style)；g.dot(x, y, style)；g.px(x, y) 数据→像素；g.data(px, py) 像素→数据。
   */
  CS.plot = function (c, o) {
    var ctx = c.ctx || c, X = o.x, Y = o.y;
    // 画布尺寸会变（翻到这一页、窗口缩放），绘图区每次按当前尺寸算
    var box = function () { if (o.box) return o.box; var W = c.w || ctx.canvas.width, H = c.h || ctx.canvas.height; return { l: 70, t: 24, w: Math.max(10, W - 100), h: Math.max(10, H - 74) }; };
    var g = {
      get box() { return box(); },
      px: function (x, y) { var b = box(); return { x: b.l + (x - X[0]) / (X[1] - X[0]) * b.w, y: b.t + (Y[1] - y) / (Y[1] - Y[0]) * b.h }; },
      data: function (px, py) { var b = box(); return { x: X[0] + (px - b.l) / b.w * (X[1] - X[0]), y: Y[1] - (py - b.t) / b.h * (Y[1] - Y[0]) }; },
    };
    var nice = function (span) { var r = span / 8, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
    g.axes = function () {
      var b = box(), xs = o.xStep || nice(X[1] - X[0]), ys = o.yStep || nice(Y[1] - Y[0]), ink = getVar('--ink-2'), line = getVar('--line');
      ctx.save(); ctx.font = '16px ' + getVar('--font'); ctx.fillStyle = ink; ctx.lineWidth = 1;
      for (var x = Math.ceil(X[0] / xs) * xs; x <= X[1] + 1e-9; x += xs) { var p = g.px(x, 0); if (o.grid !== false) { ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(p.x, b.t); ctx.lineTo(p.x, b.t + b.h); ctx.stroke(); } ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(CS.fmt(x, 3), p.x, CS.clamp(g.px(0, 0).y, b.t, b.t + b.h) + 6); }
      for (var y = Math.ceil(Y[0] / ys) * ys; y <= Y[1] + 1e-9; y += ys) { var q = g.px(0, y); if (o.grid !== false) { ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(b.l, q.y); ctx.lineTo(b.l + b.w, q.y); ctx.stroke(); } if (Math.abs(y) > 1e-9) { ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(CS.fmt(y, 3), CS.clamp(g.px(0, 0).x, b.l, b.l + b.w) - 8, q.y); } }
      var o0 = g.px(CS.clamp(0, X[0], X[1]), CS.clamp(0, Y[0], Y[1]));
      CS.arrow(ctx, b.l - 6, o0.y, b.l + b.w + 18, o0.y, { color: ink, width: 2, head: 11 });
      CS.arrow(ctx, o0.x, b.t + b.h + 6, o0.x, b.t - 14, { color: ink, width: 2, head: 11 });
      if (o.xLabel) CS.label(ctx, o.xLabel, b.l + b.w + 10, o0.y + 26, { size: 18, color: ink, align: 'right' });
      if (o.yLabel) CS.label(ctx, o.yLabel, o0.x + 10, b.t - 10, { size: 18, color: ink, align: 'left' });
      ctx.restore();
      return g;
    };
    g.line = function (pts, s) {
      s = s || {}; if (!pts.length) return g;
      ctx.save(); ctx.strokeStyle = s.color || getVar('--accent'); ctx.lineWidth = s.width || 3; ctx.lineJoin = 'round'; if (s.dash) ctx.setLineDash(s.dash);
      ctx.beginPath(); pts.forEach(function (p, i) { var q = g.px(p[0], p[1]); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.restore();
      return g;
    };
    g.fn = function (f, s) { var pts = [], n = (s && s.samples) || 300; for (var i = 0; i <= n; i++) { var x = X[0] + (X[1] - X[0]) * i / n, y = f(x); if (isFinite(y)) pts.push([x, y]); } return g.line(pts, s); };
    g.dot = function (x, y, s) { s = s || {}; var q = g.px(x, y); ctx.save(); ctx.fillStyle = s.color || getVar('--accent-2'); ctx.beginPath(); ctx.arc(q.x, q.y, s.r || 7, 0, Math.PI * 2); ctx.fill(); ctx.restore(); if (s.label) CS.label(ctx, s.label, q.x + 12, q.y - 14, { size: 17, align: 'left' }); return g; };
    return g;
  };
  /**
   * 手画曲线：在坐标图上按住拖动画 y(x)（例如老师画 a–t 图让电梯跟着动）。
   * var d = CS.drawable(canvasApi, plot, { n: 120, init: x => 0, onChange(sample) }); d.at(x) 取值；d.set(fn)；d.draw(style)
   */
  CS.drawable = function (c, plot, o) {
    o = o || {};
    var b0 = plot.box, X0 = plot.data(b0.l, 0).x, X1 = plot.data(b0.l + b0.w, 0).x, n = o.n || 120, ys = [];
    var Ymin = plot.data(0, b0.t + b0.h).y, Ymax = plot.data(0, b0.t).y;
    for (var i = 0; i <= n; i++) ys.push(o.init ? o.init(X0 + (X1 - X0) * i / n) : 0);
    var idx = function (x) { return CS.clamp(Math.round((x - X0) / (X1 - X0) * n), 0, n); };
    var api = {
      at: function (x) { var f = CS.clamp((x - X0) / (X1 - X0) * n, 0, n), i = Math.floor(f), r = f - i; return i >= n ? ys[n] : ys[i] * (1 - r) + ys[i + 1] * r; },
      set: function (fn) { for (var i = 0; i <= n; i++) ys[i] = CS.clamp(fn(X0 + (X1 - X0) * i / n), Ymin, Ymax); if (o.onChange) o.onChange(api); },
      draw: function (s) { plot.line(ys.map(function (y, i) { return [X0 + (X1 - X0) * i / n, y]; }), s); },
      values: ys,
    };
    var down = false, lastI = -1;
    function paint(e) {
      var p = c.point(e), d = plot.data(p.x, p.y), i = idx(d.x), y = o.snap ? Math.round(CS.clamp(d.y, Ymin, Ymax) / o.snap) * o.snap : CS.clamp(d.y, Ymin, Ymax);
      if (lastI < 0) lastI = i;
      var a = Math.min(lastI, i), b2 = Math.max(lastI, i);
      for (var k = a; k <= b2; k++) ys[k] = y;
      lastI = i;
      if (o.onChange) o.onChange(api);
    }
    c.el.addEventListener('pointerdown', function (e) { down = true; lastI = -1; c.el.setPointerCapture && c.el.setPointerCapture(e.pointerId); paint(e); e.preventDefault(); });
    c.el.addEventListener('pointermove', function (e) { if (down) paint(e); });
    window.addEventListener('pointerup', function () { down = false; });
    return api;
  };

  // ── 点选题：<div class="cs-quiz" data-answer="B"> … <ol class="cs-opts"><li>…</li></ol><p class="cs-explain">…</p></div> ──
  var quizzes = [];
  function initQuiz(q) {
    var ans = String(q.getAttribute('data-answer') || '').toUpperCase().replace(/[^A-Z]/g, ''), multi = ans.length > 1 || q.hasAttribute('data-multi');
    var opts = $$('.cs-opts > li', q);
    opts.forEach(function (li, k) { li.setAttribute('data-key', String.fromCharCode(65 + k)); li.setAttribute('role', 'button'); li.tabIndex = 0; });
    var exp = $('.cs-explain', q);
    var state = { el: q, answer: ans, done: false, right: false };
    quizzes.push(state);
    function finish(picked) {
      state.done = true; state.right = picked === ans;
      q.classList.add('done');
      opts.forEach(function (li) { var k = li.getAttribute('data-key'); li.classList.remove('picked'); if (ans.indexOf(k) >= 0) li.classList.add('right'); else if (picked.indexOf(k) >= 0) li.classList.add('wrong'); });
      if (exp && !$('.cs-verdict', exp)) { var v = document.createElement('span'); v.className = 'cs-verdict ' + (state.right ? 'ok' : 'no'); v.textContent = state.right ? '答对了！' : '再想想：正确答案是 ' + ans + '。'; exp.insertBefore(v, exp.firstChild); }
      q.dispatchEvent(new CustomEvent('cs:answer', { bubbles: true, detail: { right: state.right, picked: picked } }));
      updateScore();
    }
    opts.forEach(function (li) {
      var pick = function () {
        if (state.done) return;
        if (!multi) { finish(li.getAttribute('data-key')); return; }
        li.classList.toggle('picked');
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    if (multi) {
      var b = CS.button(q, '提交', function () { if (state.done) return; finish(opts.filter(function (li) { return li.classList.contains('picked'); }).map(function (li) { return li.getAttribute('data-key'); }).join('')); });
      b.classList.add('cs-submit');
    }
    var reset = $('.cs-retry', q);
    if (reset) reset.addEventListener('click', function () { state.done = false; q.classList.remove('done'); opts.forEach(function (li) { li.className = ''; }); var v = exp && $('.cs-verdict', exp); if (v) v.remove(); updateScore(); });
  }
  function updateScore() { $$('.cs-score').forEach(function (el) { var done = quizzes.filter(function (s) { return s.done; }), ok = done.filter(function (s) { return s.right; }).length; el.textContent = done.length ? '答对 ' + ok + ' / ' + quizzes.length + ' 题' : '共 ' + quizzes.length + ' 题，点选项作答'; }); }
  CS.quizzes = quizzes;

  // ── 比例时间条：<div class="cs-timebar"><span data-min="5">回顾</span>…</div> ──
  function initTimebar(bar) {
    var cols = ['--accent', '--accent-2', '--ok', '--warn'];
    var spans = $$('span', bar).filter(function (s) { return s.parentNode === bar; });
    var total = spans.reduce(function (a, s) { return a + (Number(s.getAttribute('data-min')) || 0); }, 0) || 1;
    spans.forEach(function (s, k) { var m = Number(s.getAttribute('data-min')) || 0; s.style.flex = m + ' 0 0'; s.style.background = s.style.background || getVar(cols[k % cols.length]); if (!$('small', s)) { var sm = document.createElement('small'); sm.textContent = m + ' 分钟'; s.appendChild(sm); } s.title = s.textContent; });
    bar.setAttribute('data-total', String(total));
  }

  // ── 工具 ──
  function getVar(name) { return getComputedStyle(document.body).getPropertyValue(name).trim() || '#2f6fd6'; }
  CS.color = getVar;
  function color(hex, a) { var m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; var n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  CS.alpha = color;
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  CS.roundRect = roundRect;

  /**
   * 自检（导播台每轮结束自动跑，也可以在控制台运行 CS.selfTest()）：逐页显示、点遍按钮、拖遍滑块、作答点选题，
   * 返回 { pages, errors, overflow, texErrors, controls }。不改动最终显示的页。
   */
  CS.selfTest = function () {
    var report = { pages: deck.pages.length, errors: [], overflow: [], texErrors: [], controls: { buttons: 0, sliders: 0, quizzes: quizzes.length }, external: [] };
    var start = deck.i, before = errors.length;
    $$('.katex-error').forEach(function (e) { report.texErrors.push((e.getAttribute('title') || e.textContent).slice(0, 160)); });
    // 没渲染出来的公式（括号不配对时自动渲染会原样留下 $…$）
    var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), raw = 0;
    for (var tn = tw.nextNode(); tn && raw < 3; tn = tw.nextNode()) {
      var pe = tn.parentElement; if (!pe || /SCRIPT|STYLE|TEXTAREA|CODE|PRE/.test(pe.tagName) || pe.closest('.no-tex')) continue;
      if (/\$[^$\n]*(\\[a-zA-Z]+|[_^][{\w])[^$\n]*\$?/.test(tn.textContent) && /\$/.test(tn.textContent)) { report.texErrors.push('公式没有渲染：' + tn.textContent.trim().slice(0, 60)); raw++; }
    }
    $$('script[src], link[href], img[src], iframe[src], audio[src], video[src], source[src]').forEach(function (el) { var u = el.getAttribute('src') || el.getAttribute('href') || ''; if (/^(https?:)?\/\//i.test(u)) report.external.push(u.slice(0, 160)); });
    deck.pages.forEach(function (p, k) {
      CS.go(k); applySteps(p, totalSteps(p));
      var r = p.getBoundingClientRect();
      $$('*', p).forEach(function (el) {
        if (el.closest('.cs-nav') || el.closest('.katex')) return;
        var b = el.getBoundingClientRect();
        if (b.width && b.height && (b.right > r.right + 2 || b.bottom > r.bottom + 2 || b.left < r.left - 2)) {
          var label = (el.textContent || el.tagName).trim().slice(0, 30);
          if (report.overflow.length < 20 && !report.overflow.some(function (o) { return o.page === k + 1; })) report.overflow.push({ page: k + 1, what: label || el.tagName });
        }
      });
      $$('button', p).forEach(function (b) { if (b.closest('.cs-nav') || b.disabled) return; report.controls.buttons++; try { b.click(); b.click(); } catch (e) { report.errors.push('第 ' + (k + 1) + ' 页按钮「' + b.textContent.trim() + '」：' + e.message); } });
      $$('input[type="range"]', p).forEach(function (s) {
        report.controls.sliders++;
        var v0 = s.value;
        [s.min, s.max, v0].forEach(function (v) { s.value = v; try { s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { report.errors.push('第 ' + (k + 1) + ' 页滑块：' + e.message); } });
      });
      CS._sims.forEach(function (sim) { try { sim.redraw(); } catch (e) { report.errors.push('第 ' + (k + 1) + ' 页动画：' + e.message); } });
    });
    quizzes.forEach(function (q, k) { if (!q.done) { var li = $('.cs-opts > li', q.el); if (li) try { li.click(); } catch (e) { report.errors.push('第 ' + (k + 1) + ' 道点选题：' + e.message); } } if (!q.answer) report.errors.push('有一道点选题没写 data-answer'); });
    if (document.body.classList.contains('cs-scroll') && document.documentElement.scrollWidth > window.innerWidth + 2) report.overflow.push({ page: 0, what: '手机竖屏时页面比屏幕宽（自己写的 grid / 固定宽度要改用 .cs-cols 或百分比）' });
    report.errors = report.errors.concat(errors.slice(before), errors.slice(0, before));
    CS.go(start);
    return report;
  };

  function boot() {
    try {
      if (window.katex && window.renderMathInElement) CS.renderTex(document.body);
      initDeck();
      $$('.cs-quiz').forEach(initQuiz); updateScore();
      $$('.cs-timebar').forEach(initTimebar);
    } catch (e) { errors.push('课件初始化出错：' + e.message); }
    isReady = true;
    readyFns.splice(0).forEach(function (fn) { try { fn(); } catch (e) { errors.push(e.message); console.error(e); } });
    document.body.setAttribute('data-cs-ready', '1');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
