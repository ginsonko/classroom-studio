'use strict';
// 搬自万能创作终端 0.7.0（electron/desk-policy.cjs），只改了提示里的软件名；要改行为先同步上游。
// 键鼠控制 · the pure rules: settings, screenshot-to-screen coordinates, key combos, which windows the AI
// may never touch. No Electron and no I/O, so every rule here is unit tested.
const path = require('node:path');
const { MAX_WIDTH, shotSize: captureSize } = require('./screen-capture.cjs');
const { physicalRect } = require('./displays.cjs');

/** Window titles / process names refused by default; the user can edit this list in 设置. */
const DEFAULT_BLOCKED = [
  '网上银行',
  '网银',
  '手机银行',
  '银行',
  'Bank',
  '支付宝',
  'Alipay',
  '微信支付',
  '云闪付',
  '收银台',
  '付款',
  '支付',
  'PayPal',
  '钱包',
  'Wallet',
  '密码管理',
  'Password Manager',
  '证券',
  '炒股',
];

/**
 * Always refused, whatever the user list says: system security prompts, sign-in and lock screens,
 * credential dialogs and password managers.
 */
const SYSTEM_BLOCKED = {
  exe: ['consent.exe', 'logonui.exe', 'lockapp.exe', 'credentialuibroker.exe', 'sechealthui.exe', 'securityhealthsystray.exe', 'useraccountcontrolsettings.exe', 'keepass.exe', 'keepassxc.exe', '1password.exe', 'bitwarden.exe', 'lastpass.exe', 'dashlane.exe', 'enpass.exe', 'roboform.exe', 'nordpass.exe'],
  title: ['用户账户控制', 'User Account Control', 'Windows 安全中心', 'Windows Security', 'Windows 安全', '凭据', 'Credential', '1Password', 'KeePass', 'Bitwarden', 'LastPass', 'Dashlane', 'Enpass'],
  cls: ['Credential Dialog Xaml Host', 'Windows.UI.Core.CoreWindow:LockApp'],
};

/** Combos the AI may not press: the secure attention sequence, locking the screen, and our own stop keys. */
const BLOCKED_COMBOS = new Set(['ctrl+alt+delete', 'win+l', 'ctrl+alt+q', 'ctrl+alt+esc']);

const VK = {
  ctrl: 0x11,
  shift: 0x10,
  alt: 0x12,
  win: 0x5b,
  enter: 0x0d,
  tab: 0x09,
  esc: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
  insert: 0x2d,
  space: 0x20,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  capslock: 0x14,
  printscreen: 0x2c,
  menu: 0x5d,
  volumemute: 0xad,
  volumedown: 0xae,
  volumeup: 0xaf,
};
const ALIAS = { control: 'ctrl', ctl: 'ctrl', option: 'alt', meta: 'win', cmd: 'win', command: 'win', super: 'win', windows: 'win', return: 'enter', escape: 'esc', del: 'delete', ins: 'insert', spacebar: 'space', pgup: 'pageup', pgdn: 'pagedown', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', apps: 'menu', prtsc: 'printscreen', mute: 'volumemute', volume_mute: 'volumemute', volume_down: 'volumedown', volume_up: 'volumeup' };
const MODIFIERS = ['ctrl', 'alt', 'shift', 'win'];

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(s.blocked) ? s.blocked : typeof s.blocked === 'string' ? s.blocked.split(/\n/) : DEFAULT_BLOCKED;
  const blocked = [...new Set(list.map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean))].slice(0, 200);
  const idle = Math.round(Number(s.resumeIdleSec));
  return {
    enabled: s.enabled === true,
    pauseOnInput: s.pauseOnInput !== false,
    // attended (主人在用电脑): a pause lasts until the owner says 继续. unattended (没人用电脑): it ends by
    // itself once the keyboard and mouse have been idle for resumeIdleSec.
    mode: s.mode === 'unattended' ? 'unattended' : 'attended',
    resumeIdleSec: Number.isFinite(idle) ? Math.max(5, Math.min(300, idle)) : 20,
    // desktop_paste_files borrows the owner's clipboard. Off unless turned on: a clipboard sync tool (seen with
    // 小米电脑管家) reads the file list first and once rewrote the clipboard after it had been put back.
    // 全部允许 also turns it on (pasteOn): the owner said 不用再问.
    pasteFiles: s.pasteFiles === true,
    // 全部允许 (the owner's switch): a string's 发送 / 撤回 / 删除 / 发布 go without a card (knack runner.confirm), and
    // 粘贴文件 is on (pasteOn). 付款 is not among them and is always asked; the blocked windows, password boxes,
    // secure desktop and the app's own windows stay off limits; 撤回 / 删除 still check it is her own message.
    allowAll: s.allowAll === true,
    blocked,
  };
}

// ---------------------------------------------------------------- coordinates

/** The size screen_capture returns for a display of this physical size. */
function shotSize(phys, maxWidth = MAX_WIDTH) {
  return captureSize(phys, maxWidth);
}

/** Screenshot pixel (x, y) of one display -> physical screen pixel (the centre of the area it covers). */
function toPhysical(phys, shot, x, y) {
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('坐标要是数字（截图里的像素位置）');
  if (nx < 0 || ny < 0 || nx > shot.width || ny > shot.height) throw new Error(`坐标 (${nx}, ${ny}) 超出了截图范围（${shot.width}x${shot.height}）`);
  const sx = phys.width / shot.width;
  const sy = phys.height / shot.height;
  return {
    x: phys.x + Math.min(phys.width - 1, Math.floor((Math.min(nx, shot.width - 0.5) + 0.5) * sx)),
    y: phys.y + Math.min(phys.height - 1, Math.floor((Math.min(ny, shot.height - 0.5) + 0.5) * sy)),
  };
}

/**
 * Physical pixel -> {index, x, y} in the screenshot of the display that contains it; null when off screen.
 * Measured from the pixel's centre, so a point toPhysical produced maps back to the same screenshot pixel.
 */
function fromPhysical(displays, shotOf, px, py) {
  for (const d of displays) {
    const p = d.phys;
    if (px < p.x || py < p.y || px >= p.x + p.width || py >= p.y + p.height) continue;
    const shot = shotOf(d);
    const at = (v, o, size, out) => Math.min(out - 1, Math.floor(((v - o + 0.5) * out) / size));
    return { index: d.index, x: at(px, p.x, p.width, shot.width), y: at(py, p.y, p.height, shot.height) };
  }
  return null;
}

// ---------------------------------------------------------------- keys and text

/** "Ctrl+Shift+S" -> {combo: 'ctrl+shift+s', vks: [0x11, 0x10, 0x53]}; throws a readable error otherwise. */
function parseCombo(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('要按哪个键？例如 enter、ctrl+s、alt+tab');
  const parts = raw
    .toLowerCase()
    .split(/\s*\+\s*/)
    .map((p) => ALIAS[p] || p);
  if (parts.length > 4 || parts.some((p) => !p)) throw new Error(`看不懂这个按键：${raw}`);
  const mods = parts.slice(0, -1);
  const key = parts.at(-1);
  for (const m of mods) if (!MODIFIERS.includes(m)) throw new Error(`「${m}」不是修饰键，组合键写成 ctrl+shift+s 这样`);
  if (new Set(mods).size !== mods.length) throw new Error(`重复的修饰键：${raw}`);
  let vk = VK[key];
  if (vk == null && /^[a-z0-9]$/.test(key)) vk = key.toUpperCase().charCodeAt(0);
  if (vk == null && /^f([1-9]|1[0-9]|2[0-4])$/.test(key)) vk = 0x6f + Number(key.slice(1));
  if (vk == null) throw new Error(`不支持的键「${key}」。可用：字母、数字、F1–F24、enter、tab、esc、backspace、delete、方向键、home、end、pageup、pagedown、space、volumeup / volumedown / volumemute（音量），以及 ctrl / alt / shift / win 组合`);
  const ordered = MODIFIERS.filter((m) => mods.includes(m));
  const combo = [...ordered, key].join('+');
  if (BLOCKED_COMBOS.has(combo)) throw Object.assign(new Error(`不允许按 ${combo}（安全键、锁屏或急停键）`), { code: 'blocked' });
  return { combo, vks: [...ordered.map((m) => VK[m]), vk] };
}

const MAX_TEXT = 500;

/** Text to type: at most MAX_TEXT characters, no control characters except newline and tab. */
function cleanText(input) {
  const s = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  if (!s) throw new Error('没有要输入的文字');
  if ([...s].length > MAX_TEXT) throw new Error(`一次最多输入 ${MAX_TEXT} 个字，请分几次`);
  return s;
}

/**
 * The files of desktop_paste_files: one path or a list, each an absolute local or network path (the clipboard's
 * file list holds full paths only). Duplicates go; Windows paths compare without case.
 */
function cleanFiles(input) {
  const list = (Array.isArray(input) ? input : [input]).filter((x) => x !== '' && x != null);
  if (!list.length) throw new Error('要粘贴哪些文件？files 里写文件的完整路径');
  const out = new Map();
  for (const x of list) {
    const s = typeof x === 'string' ? x.trim() : '';
    if (!/^([a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(s) || /[\u0000-\u001f"<>|?*]/.test(s.slice(2))) throw new Error(`「${String(x).slice(0, 80)}」不是文件的完整路径（要像 C:\\Users\\...\\图.png 这样）`);
    const p = path.win32.normalize(s);
    if (!out.has(p.toLowerCase())) out.set(p.toLowerCase(), p);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- windows the AI may not touch

/**
 * Why the AI may not act on this window, or '' when it may.
 * @param {{title?: string, exe?: string, cls?: string, pid?: number, elevated?: boolean|null} | null} w
 * @param {string[]} userBlocked
 * @param {{ownPid?: number, selfElevated?: boolean}} [ctx]
 */
function refusal(w, userBlocked, ctx = {}) {
  if (!w) return '';
  const title = String(w.title || '');
  const exe = String(w.exe || '').toLowerCase();
  const cls = String(w.cls || '');
  const low = title.toLowerCase();
  if (ctx.ownPid && Number(w.pid) === Number(ctx.ownPid)) return '这是教辅系统自己的窗口：确认卡片、设置和停止按钮只能由你来点，AI 不能操作';
  if (SYSTEM_BLOCKED.exe.includes(exe) || SYSTEM_BLOCKED.cls.includes(cls) || SYSTEM_BLOCKED.title.some((t) => low.includes(t.toLowerCase()))) return `「${title || exe}」是系统安全、登录或密码管理窗口，AI 永远不能操作`;
  if (w.elevated === null && w.pid && !ctx.selfElevated) return `「${title || exe}」以管理员或系统身份运行，AI 不能操作`;
  if (w.elevated === true && !ctx.selfElevated) return `「${title || exe}」以管理员身份运行，AI 不能操作`;
  for (const item of userBlocked || []) {
    const it = String(item).trim().toLowerCase();
    if (!it) continue;
    if (it.endsWith('.exe') ? exe === it : low.includes(it) || (exe && exe.replace(/\.exe$/, '') === it)) return `「${title || exe}」在你设置的禁止操作列表里（${item}）`;
  }
  return '';
}

module.exports = { DEFAULT_BLOCKED, SYSTEM_BLOCKED, BLOCKED_COMBOS, MAX_TEXT, normalizeSettings, physicalRect, shotSize, toPhysical, fromPhysical, parseCombo, cleanText, cleanFiles, refusal };
