'use strict';
// 搬自万能创作终端 0.7.0（electron/ai-browser-cdp.cjs），只改了提示里的软件名；要改行为先同步上游。
// One AI browser page seen through the Chrome DevTools Protocol: every frame (cross-site iframes run
// in their own targets, reached through flattened sessions) gets an isolated world of ours, so page
// scripts can neither see nor patch what we run, and nothing waits for slow ads to finish loading
// (webContents.executeJavaScript does).

const WORLD_NAME = 'omni-ai';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, msg) => {
  let timer;
  return Promise.race([p, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(msg || '网页没有响应（可能弹出了对话框，等用户处理）')), ms)))]).finally(() => clearTimeout(timer));
};
const stale = (e) => /Cannot find context|context was destroyed|Execution context|No frame|Frame with the given id|Cannot find default|Inspected target navigated|No target with given id|Session with given id not found/i.test(String(e?.message || e));

class Driver {
  /**
   * @param {any} wc webContents
   * @param {{event?: (method: string, params: any, sessionId: string) => void, log?: any}} o
   */
  constructor(wc, o = {}) {
    this.wc = wc;
    this.onEvent = o.event || (() => {});
    this.log = o.log;
    this.ok = false;
    this.mainFrame = '';
    this.sessions = new Map();
    this.frameSid = new Map();
    this.worlds = new Map();
    this.parents = new Map();
    this.urls = new Map();
  }

  attach() {
    const dbg = this.wc.debugger;
    dbg.attach('1.3');
    this.ok = true;
    dbg.on('detach', () => {
      this.ok = false;
    });
    dbg.on('message', (_e, method, params, sessionId) => this.message(method, params || {}, sessionId || ''));
    this.starting = this.init('');
    return this.starting;
  }

  async init(sid) {
    await this.send('Page.enable', {}, sid);
    await this.send('Page.setLifecycleEventsEnabled', { enabled: true }, sid).catch(() => {});
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
    if (!sid) {
      await this.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
      await this.tree('');
    }
  }

  send(method, params, sid = '', ms = 15000) {
    if (!this.ok) return Promise.reject(new Error('浏览器调试通道断开了，关掉这个对话的浏览器再打开'));
    return within(sid ? this.wc.debugger.sendCommand(method, params || {}, sid) : this.wc.debugger.sendCommand(method, params || {}), ms);
  }

  message(method, p, sid) {
    if (method === 'Target.attachedToTarget') {
      const child = p.sessionId;
      if (p.targetInfo?.type !== 'iframe') {
        void this.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
        return;
      }
      this.sessions.set(child, { targetId: p.targetInfo.targetId, root: p.targetInfo.targetId });
      // An OOPIF target's id is the id of the frame it renders.
      this.frameSid.set(p.targetInfo.targetId, child);
      this.worlds.delete(p.targetInfo.targetId);
      void this.init(child)
        .then(() => this.tree(child))
        .then(() => this.send('Runtime.runIfWaitingForDebugger', {}, child))
        .catch(() => {});
    } else if (method === 'Target.detachedFromTarget') {
      const s = this.sessions.get(p.sessionId);
      this.sessions.delete(p.sessionId);
      if (s) for (const [f, x] of this.frameSid) if (x === p.sessionId) this.forget(f);
    } else if (method === 'Page.frameNavigated') {
      const f = p.frame || {};
      this.worlds.delete(f.id);
      this.urls.set(f.id, f.url || '');
      if (f.parentId) this.parents.set(f.id, f.parentId);
      else if (!sid) this.mainFrame = f.id;
      this.own(f.id, sid);
    } else if (method === 'Page.frameAttached') {
      this.parents.set(p.frameId, p.parentFrameId);
      this.own(p.frameId, sid);
    } else if (method === 'Page.frameDetached') {
      if (p.reason !== 'swap') this.forget(p.frameId);
    } else if (method === 'Runtime.executionContextsCleared') {
      for (const [f, x] of this.frameSid) if (x === sid) this.worlds.delete(f);
    }
    try {
      this.onEvent(method, p, sid);
    } catch (e) {
      this.log?.warn?.('[ai-browser] cdp event', e);
    }
  }

  /** A frame swapped into its own process belongs to that target's session, never to its parent's tree. */
  own(frameId, sid) {
    const owned = this.frameSid.get(frameId);
    if (owned && owned !== sid && this.sessions.get(owned)?.root === frameId) return;
    this.frameSid.set(frameId, sid);
  }

  forget(frameId) {
    this.worlds.delete(frameId);
    this.frameSid.delete(frameId);
    this.parents.delete(frameId);
    this.urls.delete(frameId);
  }

  /** A cross-document navigation kills every subframe; detach events for them are not reliable, so start over. No tree refresh here: the old document is still in place when this runs, and the new one announces itself through Page events. */
  reset() {
    const main = this.mainFrame;
    this.frameSid.clear();
    if (main) this.frameSid.set(main, '');
    this.worlds.clear();
    this.parents.clear();
    this.urls.clear();
    this.sessions.clear();
  }

  async tree(sid) {
    const r = await this.send('Page.getFrameTree', {}, sid);
    const walk = (node, parent) => {
      const f = node.frame;
      this.urls.set(f.id, f.url || '');
      if (parent) this.parents.set(f.id, parent);
      else if (!sid) this.mainFrame = f.id;
      this.own(f.id, sid);
      for (const c of node.childFrames || []) walk(c, f.id);
    };
    walk(r.frameTree, sid ? this.parents.get(r.frameTree.frame.id) : null);
    return r.frameTree;
  }

  /** Frames in document order of discovery, the main frame first. */
  frames() {
    const kids = new Map();
    for (const [f, parent] of this.parents) {
      if (!parent || !this.frameSid.has(f)) continue;
      const sid = this.frameSid.get(f);
      if (sid && !this.sessions.has(sid)) continue; // target died without a detach event
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(f);
    }
    const out = [];
    const seen = new Set();
    const walk = (f, depth) => {
      if (seen.has(f)) return;
      seen.add(f);
      out.push({ id: f, parent: this.parents.get(f) || '', depth, url: this.urls.get(f) || '' });
      for (const c of kids.get(f) || []) walk(c, depth + 1);
    };
    if (this.mainFrame) walk(this.mainFrame, 0);
    return out;
  }

  async world(frameId) {
    const hit = this.worlds.get(frameId);
    if (hit) return hit;
    const sid = this.frameSid.get(frameId) ?? '';
    const p = this.send('Page.createIsolatedWorld', { frameId, worldName: WORLD_NAME, grantUniveralAccess: false }, sid).then((r) => r.executionContextId);
    this.worlds.set(frameId, p);
    p.catch(() => {
      if (this.worlds.get(frameId) === p) this.worlds.delete(frameId);
    });
    return p;
  }

  /** Runs `code` in our world of `frameId` (main frame when empty) and returns its JSON value. */
  async eval(frameId, code, { gesture = false, ms = 15000, handle = false } = {}) {
    let f = frameId || this.mainFrame;
    if (!f && this.starting) {
      // attach() is still learning the frame tree; give it a moment.
      await within(this.starting, 3000).catch(() => {});
      f = frameId || this.mainFrame;
    }
    if (!f) throw new Error('网页还没有准备好');
    for (let attempt = 0; ; attempt++) {
      try {
        const ctx = await this.world(f);
        const r = await this.send('Runtime.evaluate', { expression: code, contextId: ctx, returnByValue: !handle, awaitPromise: true, userGesture: gesture }, this.frameSid.get(f) ?? '', ms);
        if (r.exceptionDetails) throw new Error(`网页脚本出错：${r.exceptionDetails.exception?.description || r.exceptionDetails.text || ''}`.slice(0, 300));
        return handle ? r.result.objectId : r.result.value;
      } catch (e) {
        this.worlds.delete(f);
        if (attempt >= 1 || !stale(e)) throw e;
        await sleep(150);
      }
    }
  }

  /**
   * Where a child frame's content box sits inside its parent's viewport, after tagging the owner
   * element with `key` in the parent's world so the parent's outline can place the frame.
   */
  async owner(frameId, key) {
    const parent = this.parents.get(frameId);
    if (!parent) return null;
    const psid = this.frameSid.get(parent) ?? '';
    const { backendNodeId } = await this.send('DOM.getFrameOwner', { frameId }, psid);
    const ctx = await this.world(parent);
    const { object } = await this.send('DOM.resolveNode', { backendNodeId, executionContextId: ctx }, psid);
    try {
      const r = await this.send(
        'Runtime.callFunctionOn',
        {
          objectId: object.objectId,
          functionDeclaration: `function (key) {
            const st = (window.__omniAi = window.__omniAi || {});
            if (!st.frameKeys) st.frameKeys = new WeakMap();
            if (key != null) st.frameKeys.set(this, key);
            const r = this.getBoundingClientRect(), cs = getComputedStyle(this);
            const x = r.left + this.clientLeft + parseFloat(cs.paddingLeft || 0), y = r.top + this.clientTop + parseFloat(cs.paddingTop || 0);
            return { x, y, w: this.clientWidth, h: this.clientHeight, shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1 };
          }`,
          arguments: [{ value: key == null ? null : key }],
          returnByValue: true,
        },
        psid,
      );
      return r.result.value;
    } finally {
      void this.send('Runtime.releaseObject', { objectId: object.objectId }, psid).catch(() => {});
    }
  }

  /** Top-left of a frame's viewport in main-frame CSS pixels. */
  async offset(frameId) {
    let x = 0;
    let y = 0;
    let f = frameId;
    for (let i = 0; f && f !== this.mainFrame && i < 8; i++) {
      const o = await this.owner(f, null);
      if (!o) return null;
      x += o.x;
      y += o.y;
      f = this.parents.get(f);
    }
    return { x, y };
  }

  sessionOf(frameId) {
    return this.frameSid.get(frameId || this.mainFrame) ?? '';
  }

  detach() {
    try {
      if (this.ok) this.wc.debugger.detach();
    } catch {
      /* gone */
    }
    this.ok = false;
  }
}

module.exports = { Driver, within, sleep };
