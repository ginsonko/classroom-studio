'use strict';
// 搬自万能创作终端 0.7.0（electron/ai-browser-page.cjs），只改了提示里的软件名；要改行为先同步上游。
// Scripts the AI browser runs inside each frame, in an isolated world of ours: the page's own scripts
// cannot see or patch them, and the element table they keep (window.__omniAi) is invisible to the page.
// Each export returns source text; results must be plain JSON.
//
// Element numbers are stable for the life of a document: an element keeps its number across
// snapshots (WeakMap), so an agent's earlier ref still works after the page re-renders around it.

const COMMON = String.raw`
const ROLE_MAP = { button: 'button', link: 'link', checkbox: 'checkbox', radio: 'radio', switch: 'switch', tab: 'tab', menuitem: 'menuitem', menuitemcheckbox: 'menuitem', menuitemradio: 'menuitem', option: 'option', combobox: 'combobox', textbox: 'textbox', searchbox: 'searchbox', slider: 'slider', spinbutton: 'textbox', treeitem: 'other', gridcell: null };
const CARD = /^cc-|card|cvc|cvv|卡号|安全码/i;
const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) : t; };
const st = (window.__omniAi = window.__omniAi || {});
if (!st.ids) { st.ids = new WeakMap(); st.els = new Map(); st.next = 1; }
if (!st.frameKeys) st.frameKeys = new WeakMap();
function idOf(el) {
  let n = st.ids.get(el);
  if (!n) { n = st.next++; st.ids.set(el, n); }
  st.els.set(n, new WeakRef(el));
  return n;
}
function byId(n) { const w = st.els.get(Number(n)); return w ? w.deref() || null : null; }
function up(n) { return n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null; }
function roleOf(el, cs) {
  const tag = el.tagName.toLowerCase();
  const r = (el.getAttribute('role') || '').toLowerCase().split(/\s+/)[0];
  if (tag === 'a' && el.hasAttribute('href')) return r === 'button' || r === 'tab' || r === 'menuitem' ? ROLE_MAP[r] : 'link';
  if (tag === 'button') return ROLE_MAP[r] && r !== 'link' ? ROLE_MAP[r] : 'button';
  if (tag === 'input') {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'hidden') return null;
    if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
    if (t === 'checkbox') return r === 'switch' ? 'switch' : 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'range') return 'slider';
    if (t === 'file') return 'file';
    if (t === 'search') return 'searchbox';
    return 'textbox';
  }
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'summary') return 'summary';
  if (el.getAttribute('draggable') === 'true') return 'draggable';
  if (ROLE_MAP[r]) return ROLE_MAP[r];
  if (el.isContentEditable && el.hasAttribute('contenteditable')) return 'editable';
  if (tag === 'body' || tag === 'html') return null;
  if (el.hasAttribute('onclick') || el.hasAttribute('ondrop') || el.hasAttribute('ondragover') || (el.hasAttribute('tabindex') && el.tabIndex >= 0 && !/^(dialog|alertdialog|region|main|document|application|group|list|listbox|tabpanel|presentation|none|article|feed)$/.test(r))) return 'other';
  // Sites that wire clicks to plain divs still show a hand cursor; only the outermost such element counts.
  if (cs && cs.cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') && el.childElementCount <= 8 && !el.querySelector('a[href],button,input,select,textarea,[role=button],[role=link]') && (el.innerText || '').trim()) return 'other';
  return null;
}
function rootText(el, id) { const r = el.getRootNode(); const x = r && r.getElementById ? r.getElementById(id) : document.getElementById(id); return x ? x.innerText || x.textContent || '' : ''; }
function labelOf(el) {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => rootText(el, id)).join(' ').trim();
    if (t) return t;
  }
  if (el.labels && el.labels.length) {
    const t = Array.from(el.labels).map((l) => l.innerText || '').join(' ').trim();
    if (t) return t;
  }
  return '';
}
function secret(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return false;
  return (el.type || '').toLowerCase() === 'password' || CARD.test(el.autocomplete || '') || CARD.test(el.name || '');
}
function nameOf(el, role) {
  const l = labelOf(el);
  if (l) return l;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' && /^(button|submit|reset)$/i.test(el.type)) return el.value || el.type;
  if (tag === 'input' && el.type === 'image') return el.alt || el.title || '图片按钮';
  if (role === 'textbox' || role === 'searchbox' || role === 'textarea' || role === 'select' || role === 'file' || role === 'slider' || role === 'checkbox' || role === 'radio' || role === 'switch')
    return el.placeholder || el.title || el.getAttribute('aria-placeholder') || el.name || '';
  const t = clip(el.innerText || el.textContent || '', 160);
  if (t) return t;
  const img = el.querySelector && el.querySelector('img[alt]');
  return (img && img.alt) || el.title || el.getAttribute('data-tooltip') || '';
}
function describe(el, role) {
  const tag = el.tagName.toLowerCase();
  const form = el.form || (el.closest && el.closest('form'));
  const type = (el.type || '').toLowerCase();
  const submit = Boolean((tag === 'button' && (el.getAttribute('type') || 'submit').toLowerCase() === 'submit' && form) || (tag === 'input' && (type === 'submit' || type === 'image')));
  let formAction = '';
  // Read the attributes: el.formAction falls back to the page URL, and form.action can be shadowed by a field named "action".
  if (form) {
    const attr = (submit && el.getAttribute('formaction')) || form.getAttribute('action') || '';
    try { formAction = new URL(attr, document.baseURI).href; } catch { formAction = ''; }
  }
  return {
    tag,
    type,
    role,
    text: secret(el) ? '' : clip(tag === 'input' ? (/^(button|submit|reset)$/.test(type) ? el.value : '') : el.innerText || el.textContent || '', 200),
    label: clip(labelOf(el) || el.title || '', 160),
    placeholder: clip(el.placeholder || '', 120),
    href: tag === 'a' && /^https?:/i.test(el.href || '') ? el.href : '',
    submit,
    inForm: Boolean(form),
    formAction: /^https?:/i.test(formAction) ? formAction : '',
    editable: Boolean(el.isContentEditable),
    disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
    secret: secret(el),
    autocomplete: el.autocomplete || '',
    field: el.name || '',
    checked: el.type === 'checkbox' || el.type === 'radio' ? Boolean(el.checked) : el.getAttribute('aria-checked') === 'true' ? true : el.getAttribute('aria-checked') === 'false' ? false : null,
  };
}
function shown(el, cs) {
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  if (cs.display === 'contents') return true;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 || el.getClientRects().length > 0;
}
function kids(el) {
  if (el.shadowRoot) return el.shadowRoot.childNodes;
  if (el.tagName === 'SLOT') { const a = el.assignedNodes({ flatten: true }); return a.length ? a : el.childNodes; }
  return el.childNodes;
}
function deepAt(x, y) {
  let top = document.elementFromPoint(x, y);
  while (top && top.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
  return top;
}
function holds(a, b) { for (let n = b; n; n = up(n)) if (n === a) return true; return false; }
function canScroll(el, cs) {
  cs = cs || getComputedStyle(el);
  return (/(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) || (/(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 4);
}
function windowScrolls() {
  const se = document.scrollingElement || document.documentElement;
  if (!se || se.scrollHeight <= innerHeight + 4) return false;
  const b = document.body;
  return !(b && getComputedStyle(b).overflowY === 'hidden' && getComputedStyle(document.documentElement).overflowY === 'hidden');
}
/** The element that scrolls when the page "scrolls": the window, or an app layout's main pane. */
function mainScroller() {
  if (windowScrolls()) return null;
  for (let n = deepAt(innerWidth / 2, innerHeight / 2); n; n = up(n)) if (n.nodeType === 1 && n !== document.body && n !== document.documentElement && canScroll(n)) return n;
  let best = null, area = 0;
  for (const el of document.querySelectorAll('div, main, section, article, ul')) {
    if (!canScroll(el)) continue;
    const r = el.getBoundingClientRect();
    const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (a > area) { area = a; best = el; }
  }
  return area > innerWidth * innerHeight * 0.2 ? best : null;
}
function position(el) {
  if (!el) { const se = document.scrollingElement || document.documentElement; return { scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), viewportH: innerHeight, viewportW: innerWidth, scrollH: Math.max(se ? se.scrollHeight : 0, document.body ? document.body.scrollHeight : 0), inner: false }; }
  const r = el.getBoundingClientRect();
  return { scrollX: Math.round(el.scrollLeft), scrollY: Math.round(el.scrollTop), viewportH: el.clientHeight, viewportW: el.clientWidth, scrollH: el.scrollHeight, inner: true, cx: r.left + r.width / 2, cy: r.top + Math.min(r.height, innerHeight) / 2 };
}
`;

const CAPTCHA_TEXT = /安全验证|人机验证|滑动验证|拖动滑块|请完成验证|请完成安全|点击按钮进行验证|验证码|verify you are human|are you a robot|unusual traffic|security check|captcha|请按住滑块/i;
const CAPTCHA_HINT = /recaptcha|hcaptcha|geetest|turnstile|challenges\.cloudflare|captcha|nc_wrapper|nocaptcha|tcaptcha|aliyuncaptcha|verify\.(?:baidu|163)|\bslider-verify|yidun/i;

/** The outline of one frame. `prefix` names the frame in refs: "" -> e12, "f2" -> f2e12. */
function collect(prefix = '') {
  return String.raw`(() => {
${COMMON}
const PREFIX = ${JSON.stringify(String(prefix))};
const MAX_REFS = 600, MAX_ITEMS = 2400;
let budget = 40000, frames = 0, refs = 0, truncated = false, login = false;
const items = [];
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'head', 'meta', 'link', 'object', 'embed']);
let buf = '';
const flush = () => { const t = buf.replace(/\s+/g, ' ').trim(); if (t) items.push({ t: 'text', text: t.slice(0, 400) }); buf = ''; };
function element(el, role) {
  const name = role === 'scrollarea' ? clip(labelOf(el) || el.getAttribute('aria-label') || el.title || el.id || '', 60) : clip(nameOf(el, role), 160);
  const it = { t: 'el', ref: PREFIX + 'e' + idOf(el), role, name, tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase() };
  const tag = it.tag;
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (secret(el)) { it.filled = Boolean(el.value); it.secret = true; it.autocomplete = el.autocomplete || ''; it.field = el.name || ''; if (it.type === 'password') login = true; }
    else if (tag === 'select') {
      it.value = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : '';
      it.options = Array.from(el.options).slice(0, 15).map((o) => clip(o.text, 40));
      if (el.options.length > 15) it.options.push('…共 ' + el.options.length + ' 项');
    }
    else if (!/^(button|submit|reset|image|checkbox|radio|file)$/.test(it.type)) it.value = String(el.value || '').slice(0, 200);
    if (it.type === 'file' && el.files && el.files.length) it.value = el.files.length + ' 个文件';
  } else if (role === 'editable') it.value = clip(el.innerText, 200);
  if (it.type === 'checkbox' || it.type === 'radio') it.checked = Boolean(el.checked);
  else {
    const c = el.getAttribute('aria-checked') || el.getAttribute('aria-selected') || el.getAttribute('aria-pressed');
    if (c === 'true' || c === 'false') it.checked = c === 'true';
  }
  const ex = el.getAttribute('aria-expanded');
  if (ex === 'true' || ex === 'false') it.expanded = ex === 'true';
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') it.disabled = true;
  if (role === 'link' && /^https?:/i.test(el.href || '')) it.href = el.href;
  refs++;
  items.push(it);
}
function walk(node) {
  if (items.length >= MAX_ITEMS || budget-- <= 0) { truncated = true; return; }
  if (node.nodeType === 3) { buf += node.data; return; }
  if (node.nodeType !== 1) return;
  const el = node;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return;
  if (el.getAttribute('aria-hidden') === 'true') return;
  const cs = getComputedStyle(el);
  if (!shown(el, cs)) return;
  if (tag === 'iframe' || tag === 'frame') {
    frames++;
    const key = st.frameKeys.get(el);
    flush();
    items.push({ t: 'frame', key: key == null ? null : key, name: clip(el.title || el.name || el.getAttribute('aria-label') || '', 60), src: clip(el.src || '', 200) });
    return;
  }
  if (tag === 'br') { buf += ' '; return; }
  if (tag === 'img') { const alt = clip(el.alt, 80); if (alt) buf += ' [图片：' + alt + '] '; return; }
  let role = roleOf(el, cs);
  // A scrollable pane gets a number so browser_scroll can target it.
  if (!role && el !== document.body && el !== document.documentElement && canScroll(el, cs)) role = 'scrollarea';
  if (role && refs < MAX_REFS) {
    flush();
    element(el, role);
    if (role !== 'other' && role !== 'scrollarea') return;
  }
  const block = !/^inline/.test(cs.display) || /^(li|p|div|section|article|tr|dt|dd|blockquote|pre|td|th)$/.test(tag);
  if (/^h[1-6]$/.test(tag) && !el.querySelector('a[href],button,input,[role=button],[role=link]')) {
    flush();
    const t = clip(el.innerText, 200);
    if (t) items.push({ t: 'h', level: Number(tag[1]), text: t });
    return;
  }
  const dialog = el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog' || tag === 'dialog';
  if (block) flush();
  if (dialog) items.push({ t: 'text', text: '【对话框】' + clip(labelOf(el), 60) });
  if (tag === 'li') buf += '- ';
  for (const c of kids(el)) walk(c);
  if (block) flush();
  if (dialog) items.push({ t: 'text', text: '【对话框结束】' });
}
if (document.body) walk(document.body);
flush();
const sc = mainScroller();
const pos = position(sc);
let captcha = false;
try {
  const bodyText = document.body ? (document.body.innerText || '').slice(0, 6000) : '';
  captcha = ${CAPTCHA_TEXT}.test(bodyText) && bodyText.length < 3000 || Array.from(document.querySelectorAll('iframe[src], [class*=captcha], [id*=captcha], [class*=geetest], [class*=nc_], [class*=verify]')).slice(0, 40).some((e) => ${CAPTCHA_HINT}.test((e.src || '') + ' ' + (e.className && e.className.baseVal == null ? e.className : '') + ' ' + e.id) && shown(e, getComputedStyle(e)));
} catch {}
return { title: document.title, url: location.href, items, frames, truncated, scrollY: pos.scrollY, viewportH: pos.viewportH, scrollH: pos.scrollH, inner: pos.inner, captcha, login };
})()`;
}

/** Element info and click point for an element number; `focus` also selects its text for typing. */
function inspect(id, { scroll = true, focus = false } = {}) {
  return String.raw`(() => {
${COMMON}
const el = byId(${Number(id)});
if (!el) return { error: 'noref' };
if (!el.isConnected) return { error: 'gone' };
const role = roleOf(el) || 'other';
if (${scroll ? 'true' : 'false'}) {
  const r0 = el.getBoundingClientRect();
  if (r0.top < 0 || r0.left < 0 || r0.bottom > innerHeight || r0.right > innerWidth) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
}
if (${focus ? 'true' : 'false'}) {
  el.focus();
  if (typeof el.select === 'function' && !/^(checkbox|radio|file|button|submit|range|color)$/.test(el.type || '')) el.select();
  else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
const r = el.getBoundingClientRect();
// Big elements: aim inside the visible part, not at a centre that may sit off screen.
const vx0 = Math.max(r.left, 0), vx1 = Math.min(r.right, innerWidth), vy0 = Math.max(r.top, 0), vy1 = Math.min(r.bottom, innerHeight);
const x = vx1 > vx0 ? (vx0 + vx1) / 2 : r.left + r.width / 2, y = vy1 > vy0 ? (vy0 + vy1) / 2 : r.top + r.height / 2;
const top = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? deepAt(x, y) : null;
const covered = !top || !(holds(el, top) || (holds(top, el) && top !== document.body && top !== document.documentElement));
let active = document.activeElement;
while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
return Object.assign(describe(el, role), { x, y, w: r.width, h: r.height, left: r.left, top: r.top, covered, pageUrl: location.href, focused: active === el, vw: innerWidth, vh: innerHeight });
})()`;
}

/**
 * Watches for the real input event about to be sent, so a click or key that never reached the page
 * (a window that was never on screen does not route input) can fall back to a DOM call.
 */
function arm(kind) {
  const types = kind === 'key' ? ['keydown'] : kind === 'hover' ? ['pointermove', 'mousemove', 'mouseover'] : ['pointerdown', 'mousedown', 'click', 'contextmenu', 'dblclick'];
  return `(() => {
const st = (window.__omniAi = window.__omniAi || {});
if (st.disarm) st.disarm();
st.landed = false;
const types = ${JSON.stringify(types)};
const h = (e) => { if (e.isTrusted) st.landed = true; };
for (const k of types) window.addEventListener(k, h, true);
st.disarm = () => { for (const k of types) window.removeEventListener(k, h, true); st.disarm = null; };
return true;
})()`;
}

/** true / false, or null when the page navigated away (the world was reset, so it surely landed). */
const LANDED = `(() => { const st = window.__omniAi; if (!st || !st.disarm) return null; const ok = st.landed; st.disarm(); return ok; })()`;

/** Enter that never reached the page: submit the focused field's form the way Enter would. */
const SUBMIT_FOCUSED = `(() => { let el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; const f = el && (el.form || (el.closest && el.closest('form'))); if (!f) return false; if (f.requestSubmit) f.requestSubmit(); else f.submit(); return true; })()`;

/** Fallback when something sits on top of the element or input never arrives: DOM events. */
function domClick(id, { button = 'left', double = false } = {}) {
  return String.raw`(() => {
${COMMON}
const el = byId(${Number(id)});
if (!el || !el.isConnected) return false;
const r = el.getBoundingClientRect();
const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: ${button === 'right' ? 2 : button === 'middle' ? 1 : 0} };
if (${JSON.stringify(button)} === 'right') { el.dispatchEvent(new MouseEvent('contextmenu', o)); return true; }
el.click();
if (${double ? 'true' : 'false'}) { el.click(); el.dispatchEvent(new MouseEvent('dblclick', o)); }
return true;
})()`;
}

function domHover(id) {
  return String.raw`(() => {
${COMMON}
const el = byId(${Number(id)});
if (!el || !el.isConnected) return false;
const r = el.getBoundingClientRect();
const o = { bubbles: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, o));
return true;
})()`;
}

/** Synthetic HTML5 drag-and-drop for when the real input channel is unusable; covers handler-based drops. */
function domDrag(fromId, toId) {
  return String.raw`(() => {
${COMMON}
const from = byId(${Number(fromId)}), to = byId(${Number(toId)});
if (!from || !from.isConnected || !to || !to.isConnected) return { error: 'gone' };
let dt;
try { dt = new DataTransfer(); } catch { dt = null; }
const fire = (el, type) => {
  let ev;
  try { ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }); }
  catch { ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }); if (dt) Object.defineProperty(ev, 'dataTransfer', { value: dt }); }
  el.dispatchEvent(ev);
};
fire(from, 'dragstart');
fire(to, 'dragenter');
fire(to, 'dragover');
fire(to, 'drop');
fire(from, 'dragend');
return { ok: true };
})()`;
}

const FOCUSED = String.raw`(() => {
${COMMON}
let el = document.activeElement;
while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
if (!el || el === document.body) return { tag: 'body', role: 'other', text: '', inForm: false, pageUrl: location.href };
return Object.assign(describe(el, roleOf(el) || 'other'), { pageUrl: location.href });
})()`;

/** Picks options of a <select> by value or visible text. */
function selectOptions(id, values) {
  return String.raw`(() => {
${COMMON}
const el = byId(${Number(id)});
if (!el || !el.isConnected) return { error: 'gone' };
if (el.tagName !== 'SELECT') return { error: 'notselect', role: roleOf(el) || 'other' };
if (el.disabled) return { error: 'disabled' };
const want = ${JSON.stringify((values || []).map(String))};
const opts = Array.from(el.options);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const picked = [];
for (const w of want) {
  const n = norm(w);
  const o = opts.find((o) => o.value === w) || opts.find((o) => norm(o.text) === n) || opts.find((o) => norm(o.label) === n) || opts.find((o) => norm(o.text).includes(n));
  if (!o) return { error: 'nooption', value: w, options: opts.slice(0, 30).map((o) => clip(o.text, 40)) };
  if (o.disabled) return { error: 'optdisabled', value: w };
  picked.push(o);
}
if (!el.multiple && picked.length > 1) return { error: 'single' };
el.focus();
for (const o of opts) o.selected = picked.includes(o);
el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return { ok: true, picked: picked.map((o) => clip(o.text, 60)) };
})()`;
}

/** Where to aim the wheel to scroll this element's own scroll area (or its nearest scrolling ancestor). */
function scrollArea(id) {
  return String.raw`(() => {
${COMMON}
const el = byId(${Number(id)});
if (!el || !el.isConnected) return { error: 'gone' };
let n = el;
for (; n; n = up(n)) if (n.nodeType === 1 && (canScroll(n) || n === document.documentElement)) break;
if (!n || n === document.documentElement || n === document.body) return { window: true };
const r = n.getBoundingClientRect();
const vx0 = Math.max(r.left, 0), vx1 = Math.min(r.right, innerWidth), vy0 = Math.max(r.top, 0), vy1 = Math.min(r.bottom, innerHeight);
st.area = new WeakRef(n);
return { x: (vx0 + vx1) / 2, y: (vy0 + vy1) / 2, top: n.scrollTop, left: n.scrollLeft, h: n.clientHeight, sh: n.scrollHeight };
})()`;
}

const AREA_POS = `(() => { const st = window.__omniAi; const n = st && st.area && st.area.deref(); return n ? { top: n.scrollTop, left: n.scrollLeft, h: n.clientHeight, sh: n.scrollHeight } : null; })()`;
function areaBy(dx, dy) {
  return `(() => { const st = window.__omniAi; const n = st && st.area && st.area.deref(); if (!n) return false; n.scrollBy({ left: ${Number(dx) || 0}, top: ${Number(dy) || 0}, behavior: 'instant' }); return true; })()`;
}

function hasText(text) {
  return String.raw`(() => {
${COMMON}
const want = ${JSON.stringify(String(text))};
if (document.body && (document.body.innerText || '').includes(want)) return true;
// Text inside open shadow roots is missing from innerText.
const stack = [document.body];
let n = 0;
while (stack.length && n++ < 20000) {
  const el = stack.pop();
  if (!el) continue;
  if (el.shadowRoot) { if ((el.shadowRoot.textContent || '').includes(want)) return true; stack.push(...el.shadowRoot.children); }
  stack.push(...el.children);
}
return false;
})()`;
}

function hasSelector(selector) {
  return String.raw`(() => {
${COMMON}
let el;
try { el = document.querySelector(${JSON.stringify(String(selector))}); } catch { return { error: 'bad' }; }
return Boolean(el && shown(el, getComputedStyle(el)));
})()`;
}

function scrollTo(where) {
  return String.raw`(() => {
${COMMON}
const sc = mainScroller();
const top = ${where === 'top' ? '0' : '1e9'};
if (sc) sc.scrollTo({ top, behavior: 'instant' }); else scrollTo({ top, behavior: 'instant' });
return true;
})()`;
}

function scrollBy(dx, dy) {
  return String.raw`(() => {
${COMMON}
const sc = mainScroller();
const o = { left: ${Number(dx) || 0}, top: ${Number(dy) || 0}, behavior: 'instant' };
if (sc) sc.scrollBy(o); else scrollBy(o);
return true;
})()`;
}

const POSITION = String.raw`(() => {
${COMMON}
return position(mainScroller());
})()`;

/** The element itself, for CDP calls that need a handle (file inputs). */
function handle(id) {
  return String.raw`(() => {
${COMMON}
const el = byId(${Number(id)});
return el && el.isConnected ? el : null;
})()`;
}

const fileMode = (id) => String.raw`(() => {
${COMMON}
const el = byId(${Number(id)});
if (!el || !el.isConnected || el.tagName !== 'INPUT' || el.type !== 'file') return false;
return el.multiple ? 'multi' : 'single';
})()`;

/** Size of the whole document, for full-page screenshots. */
const PAGE_SIZE = `(() => { const se = document.scrollingElement || document.documentElement; return { w: Math.max(se.scrollWidth, innerWidth), h: Math.max(se.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio }; })()`;

/**
 * Viewport rect (CSS px, with a white margin for the quiet zone) of the most likely login QR code: a visible,
 * square img / canvas / svg, preferring ones named like a QR code. Scrolls it into view when cut off. null = none.
 */
const FIND_QR = `(() => {
  const hint = /qr|二维码|scan|扫码/i;
  // A QR code is nearly all black and white; decorative canvases and photos are not. null = can't read the pixels.
  const bw = (el) => {
    if (el.tagName === 'svg') return null;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      // Point sampling: averaging shrinks a QR code's modules to grey.
      g.imageSmoothingEnabled = false;
      g.drawImage(el, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let dark = 0, light = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        n++;
        const v = (d[i] + d[i + 1] + d[i + 2]) / 3, sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        if (sat < 60 && v < 90) dark++;
        else if (sat < 60 && v > 170) light++;
      }
      return n > 1000 && dark > n * 0.2 && light > n * 0.2 && dark + light > n * 0.75;
    } catch {
      return null;
    }
  };
  let best = null;
  for (const el of document.querySelectorAll('img, canvas, svg')) {
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.width > 700 || Math.abs(r.width - r.height) > r.width * 0.15) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.1) continue;
    const name = [el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className, el.id, el.getAttribute('alt'), el.getAttribute('src') && el.getAttribute('src').slice(0, 200), el.parentElement && el.parentElement.className].join(' ');
    const look = bw(el);
    const score = r.width * r.height * (hint.test(String(name)) ? 10 : 1) * (look === true ? 50 : look === false ? 0.05 : 1);
    if (!best || score > best.score) best = { el, score };
  }
  if (!best) return null;
  let r = best.el.getBoundingClientRect();
  if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) {
    best.el.scrollIntoView({ block: 'center', inline: 'center' });
    r = best.el.getBoundingClientRect();
  }
  const pad = Math.round(r.width * 0.08) + 4;
  const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
  return { x, y, w: Math.min(innerWidth, r.right + pad) - x, h: Math.min(innerHeight, r.bottom + pad) - y };
})()`;

/** Viewport offset of the iframe showing `url` (or of the only visible iframe), for a rect found inside it. */
const iframeAt = (url) => `(() => {
  const want = ${JSON.stringify(String(url || ''))}.split('#')[0];
  const shown = [...document.querySelectorAll('iframe')].filter((f) => { const r = f.getBoundingClientRect(); return r.width > 60 && r.height > 60; });
  const f = shown.find((x) => x.src && (want.startsWith(x.src.split('#')[0]) || x.src.split('#')[0].startsWith(want))) || (shown.length === 1 ? shown[0] : null);
  if (!f) return null;
  const r = f.getBoundingClientRect();
  return { x: r.left + f.clientLeft, y: r.top + f.clientTop };
})()`;

/**
 * Readable content as blocks (headings, paragraphs, list items, quotes, code, tables, images).
 * `root`: an element number to read just that part; `full`: keep navigation, sidebars and footers.
 */
function read({ id = null, full = false, selector = '' } = {}) {
  return String.raw`(() => {
${COMMON}
const ID = ${id == null ? 'null' : Number(id)}, FULL = ${full ? 'true' : 'false'}, SEL = ${JSON.stringify(String(selector || ''))};
const MAX = 3000;
let root = null, how = 'page';
if (ID != null) { root = byId(ID); if (!root || !root.isConnected) return { error: 'gone' }; how = 'ref'; }
else if (SEL) { try { root = document.querySelector(SEL); } catch { return { error: 'bad' }; } if (!root) return { error: 'nosel' }; how = 'selector'; }
else if (!FULL && document.body) {
  const total = (document.body.innerText || '').length;
  let best = null, len = 0;
  for (const c of document.querySelectorAll('article, main, [role=main], [itemprop=articleBody], #content, #main, #article, .article, .post, .post-content, .article-content, .content')) {
    const cs = getComputedStyle(c);
    if (!shown(c, cs)) continue;
    const l = (c.innerText || '').length;
    if (l > len) { len = l; best = c; }
  }
  if (best && len > 200 && len > total * 0.3) { root = best; how = 'main'; }
}
if (!root) root = document.body;
const blocks = [];
let buf = '', skipped = 0, nodes = 0, cut = false;
const flush = () => { const t = buf.replace(/[ \t\r\n\f]+/g, ' ').trim(); if (t) blocks.push({ t: 'p', text: t }); buf = ''; };
const CHROME = /^(nav|aside|footer|header)$/;
const CHROME_ROLE = /^(navigation|banner|contentinfo|complementary|search)$/;
function cellText(c) { return clip(c.innerText || c.textContent || '', 300); }
function table(el) {
  const rows = [];
  const trs = el.tagName === 'TABLE' ? Array.from(el.rows) : Array.from(el.querySelectorAll('[role=row]'));
  for (const tr of trs.slice(0, 300)) {
    const cells = tr.cells ? Array.from(tr.cells) : Array.from(tr.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]'));
    rows.push(cells.slice(0, 30).map(cellText));
  }
  return { t: 'table', rows, more: Math.max(0, trs.length - 300), caption: el.caption ? clip(el.caption.innerText, 120) : clip(el.getAttribute('aria-label') || '', 120) };
}
function walk(node, depth) {
  if (blocks.length >= MAX || nodes++ > 60000) { cut = true; return; }
  if (node.nodeType === 3) { buf += node.data; return; }
  if (node.nodeType !== 1) return;
  const el = node, tag = el.tagName.toLowerCase();
  if (/^(script|style|noscript|template|svg|canvas|head|iframe|frame|object|embed|button|select|input|textarea)$/.test(tag)) {
    if (tag === 'button' || tag === 'select') buf += ' ';
    return;
  }
  if (el.getAttribute('aria-hidden') === 'true') return;
  const cs = getComputedStyle(el);
  if (!shown(el, cs)) return;
  if (!FULL && el !== root && (CHROME.test(tag) || CHROME_ROLE.test(el.getAttribute('role') || ''))) { skipped++; return; }
  if (tag === 'br') { buf += '\n'; return; }
  if (tag === 'img') { const alt = clip(el.alt || el.title, 80); if (alt) buf += ' [图片：' + alt + '] '; return; }
  if (/^h[1-6]$/.test(tag)) { flush(); const t = clip(el.innerText, 300); if (t) blocks.push({ t: 'h', level: Number(tag[1]), text: t }); return; }
  if (tag === 'table' || el.getAttribute('role') === 'table' || el.getAttribute('role') === 'grid') { flush(); blocks.push(table(el)); return; }
  if (tag === 'pre') { flush(); const t = (el.innerText || '').slice(0, 6000); if (t.trim()) blocks.push({ t: 'code', text: t }); return; }
  if (tag === 'li') {
    flush();
    let t = '';
    const nested = [];
    for (const c of kids(el)) {
      if (c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName)) nested.push(c);
      else if (c.nodeType === 3) t += c.data;
      else if (c.nodeType === 1 && shown(c, getComputedStyle(c))) t += ' ' + (c.innerText || c.textContent || '') + ' ';
    }
    t = clip(t, 2000);
    if (t) blocks.push({ t: 'li', text: t, depth: Math.min(Math.max(depth - 1, 0), 4) });
    for (const n of nested) walk(n, depth);
    return;
  }
  if (tag === 'blockquote') { flush(); const t = clip(el.innerText, 4000); if (t) blocks.push({ t: 'quote', text: t }); return; }
  const block = !/^inline/.test(cs.display) || /^(p|div|section|article|tr|dt|dd|figcaption|figure)$/.test(tag);
  if (block) flush();
  const list = tag === 'ul' || tag === 'ol';
  for (const c of kids(el)) walk(c, list ? depth + 1 : depth);
  if (block) flush();
}
walk(root, 0);
flush();
return { title: document.title, url: location.href, how, blocks, skipped, cut };
})()`;
}

/** Visible links, numbered like the outline so they can be clicked. */
function links(prefix = '', { id = null } = {}) {
  return String.raw`(() => {
${COMMON}
const PREFIX = ${JSON.stringify(String(prefix))};
const ID = ${id == null ? 'null' : Number(id)};
const root = ID != null ? byId(ID) : document;
if (!root) return { error: 'gone' };
const out = [];
const seen = new Set();
const all = [];
const stack = [root];
while (stack.length && all.length < 4000) {
  const n = stack.pop();
  if (n.shadowRoot) stack.push(n.shadowRoot);
  const list = n.querySelectorAll ? n.querySelectorAll('a[href], [role=link]') : [];
  for (const a of list) all.push(a);
  for (const h of n.querySelectorAll ? n.querySelectorAll('*') : []) if (h.shadowRoot) stack.push(h.shadowRoot);
}
for (const a of all) {
  if (out.length >= 1500) break;
  const href = a.href && typeof a.href === 'string' ? a.href : '';
  if (href && !/^https?:/i.test(href)) continue;
  if (!shown(a, getComputedStyle(a))) continue;
  const text = clip(nameOf(a, 'link'), 120);
  const key = href + '|' + text;
  if (seen.has(key)) continue;
  seen.add(key);
  out.push({ ref: PREFIX + 'e' + idOf(a), text, href });
}
return { title: document.title, url: location.href, links: out };
})()`;
}

const SIGNALS = String.raw`(() => {
${COMMON}
return { url: location.href, title: document.title, ready: document.readyState };
})()`;

module.exports = {
  COMMON,
  COLLECT: collect(''),
  collect,
  FOCUSED,
  POSITION,
  LANDED,
  SUBMIT_FOCUSED,
  AREA_POS,
  PAGE_SIZE,
  FIND_QR,
  iframeAt,
  SIGNALS,
  inspect,
  arm,
  domClick,
  domHover,
  domDrag,
  selectOptions,
  scrollArea,
  areaBy,
  hasText,
  hasSelector,
  scrollTo,
  scrollBy,
  handle,
  fileMode,
  read,
  links,
  CAPTCHA_TEXT,
  CAPTCHA_HINT,
};
