/* 最强网课教辅系统 · 插件 SDK（cs-plugin/1）。导播台自动注入到插件的每个 HTML 页面里，插件直接用 window.cs。
   插件运行在独立的沙盒里：拿不到电脑文件和 API Key，只能通过下面这些接口请导播台办事；没在 plugin.json 里申请的权限会被拒绝。 */
(function () {
  if (window.cs) return;
  var seq = 0, waits = {}, subs = {}, readyResolve, closed = false;
  function post(m) { m.__csp = 1; try { parent.postMessage(m, '*'); } catch (e) { /* 页面被单独打开时没有父页面 */ } }
  function emit(name, data) { (subs[name] || []).slice().forEach(function (f) { try { f(data); } catch (err) { report(err); } }); }
  function report(err) {
    var msg = err && (err.stack || err.message) || String(err);
    post({ t: 'error', message: String(msg).slice(0, 600) });
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.__csp !== 1) return;
    if (d.t === 'res') {
      var w = waits[d.id];
      if (!w) return;
      delete waits[d.id]; clearTimeout(w.timer);
      if (d.ok) w.resolve(d.value); else w.reject(new Error(d.error || '调用失败'));
    } else if (d.t === 'event') {
      if (d.name === 'init' || d.name === 'theme') {
        var data = d.data || {};
        if (d.name === 'init') cs.context = data; else if (cs.context) { cs.context.theme = data.theme; cs.context.scheme = data.scheme; }
        var vars = data.theme || {}, root = document.documentElement;
        for (var k in vars) if (/^--cs-[a-z0-9-]+$/.test(k)) root.style.setProperty(k, String(vars[k]));
        if (d.name === 'init') root.setAttribute('data-cs-where', data.where || '');
        root.setAttribute('data-cs-scheme', data.scheme || 'dark');
        if (readyResolve && d.name === 'init') { readyResolve(cs.context); readyResolve = null; }
      }
      emit(d.name, d.data);
    }
  });
  window.addEventListener('error', function (e) { report(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { report(e.reason); });

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      if (closed) { reject(new Error('插件窗口已关闭')); return; }
      var id = ++seq, long = /^(ai\.|files\.)/.test(method);
      waits[id] = { resolve: resolve, reject: reject, timer: setTimeout(function () { if (waits[id]) { delete waits[id]; reject(new Error('导播台没有响应：' + method)); } }, long ? 300000 : 30000) };
      post({ t: 'call', id: id, method: String(method), args: args === undefined ? null : args });
    });
  }
  function merge(a, b) { var o = {}, k; for (k in (b || {})) o[k] = b[k]; for (k in a) o[k] = a[k]; return o; }

  var cs = window.cs = {
    protocol: 'cs-plugin/1',
    /** 导播台给的上下文：where（console / dock / page / lesson / preview）、subject、theme */
    context: null,
    ready: new Promise(function (r) { readyResolve = r; }),
    call: call,
    on: function (name, fn) { (subs[name] = subs[name] || []).push(fn); return function () { subs[name] = (subs[name] || []).filter(function (x) { return x !== fn; }); }; },
    app: { info: function () { return call('app.info'); } },
    student: { current: function () { return call('student.current'); } },
    board: {
      addText: function (text, o) { return call('board.addText', merge({ text: String(text) }, o)); },
      addImage: function (src, o) { return call('board.addImage', merge({ src: String(src) }, o)); },
      addSvg: function (svg, o) { return call('board.addImage', merge({ src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(svg)) }, o)); },
    },
    present: {
      open: function (page, o) { return call('present.open', merge({ page: String(page || 'index.html') }, o)); },
    },
    bank: {
      list: function (q) { return call('bank.list', q || {}); },
      add: function (q) { return call('bank.add', q || {}); },
    },
    ai: {
      chat: function (messages, o) { return call('ai.chat', merge({ messages: messages }, o)); },
      ask: function (prompt, o) { return call('ai.chat', merge({ messages: [{ role: 'user', content: String(prompt) }] }, o)).then(function (r) { return r.content; }); },
      image: function (prompt, o) { return call('ai.image', merge({ prompt: String(prompt) }, o)); },
    },
    files: { pick: function (o) { return call('files.pick', o || {}); } },
    storage: {
      get: function (key) { return call('storage.get', { key: key }); },
      set: function (key, value) { return call('storage.set', { key: key, value: value }); },
      remove: function (key) { return call('storage.remove', { key: key }); },
      keys: function () { return call('storage.keys'); },
    },
    ui: {
      toast: function (text) { return call('ui.toast', { text: String(text) }); },
      close: function () { return call('ui.close'); },
      resize: function (width, height) { return call('ui.resize', { width: width, height: height }); },
    },
  };
  window.addEventListener('pagehide', function () { closed = true; });
  post({ t: 'ready', title: document.title || '' });
})();
