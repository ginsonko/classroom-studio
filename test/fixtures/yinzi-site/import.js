/* 千面 · 一键导入 (mod/import). Site side of the yinzi-import/1 contract (一键导入规则说明 v1), kept in step with the
 * React keys page (features/keys/lib/one-click-import.ts): pick a desktop app, the settings to import and their models,
 * then hand a deep link to the app, with a YZIMPORT1: code / .yzimport file as fallback.
 * Mount with app.modules.mount('import', el, { key: { id, name, smart }, fullKey, done, launch? }); launch(href) replaces
 * the location hand-off (tests). */
(() => {
  'use strict'
  const SCHEMA = 'yinzi-import/1', PREFIX = 'YZIMPORT1:', TTL = 600, MAX_BYTES = 8192, LAUNCH_WAIT_MS = 2000
  const TARGETS = {
    'omni-creator': { label: '万能创作终端', desc: '绘图、视频、写作和智能体，一个软件全搞定', slots: ['text', 'vision', 'image', 'video', 'agent'] },
    // 教学导播台 has no image/video features yet, so those slots are not offered.
    'classroom-studio': { label: '最强网课教辅系统', desc: '备课与上课助手', slots: ['text', 'vision', 'agent'] },
  }
  const ROWS = [
    { field: 'text', label: '文本模型', group: 'chat', slot: 'text' },
    { field: 'vision', label: '看图模型', group: 'chat', slot: 'vision' },
    { field: 'image', label: '绘图模型', group: 'image', slot: 'image' },
    { field: 'video', label: '视频模型', group: 'video', slot: 'video' },
    { field: 'codex', label: 'Codex 智能体', group: 'codex', slot: 'agent' },
    { field: 'claude', label: 'Claude 智能体', group: 'claude', slot: 'agent' },
  ]
  const BRAND_DOMAINS = ['yinziapi.top']
  const VIDEO = /(^|[-_/])(smart-video|sora|veo|kling|hailuo|vidu|seedance|wan|video|t2v|i2v)([-_/.0-9]|$)/i
  const IMAGE = /(^|[-_/])(smart-image|dall-e|gpt-image|image|imagen|flux|midjourney|mj|seedream|stable-diffusion|sd|nano-banana)([-_/.0-9]|$)/i
  const NON_CHAT = /(^|[-_/])(tts|whisper|audio|speech|transcri|embedding|embed|rerank|moderation|suno)([-_/.0-9]|$)/i
  const CODEX = /^(gpt-|o\d|codex)/i, CLAUDE = /^claude-/i

  function classify(models) {
    const g = { chat: [], image: [], video: [], codex: [], claude: [] }
    for (const m of new Set(models)) {
      if (!m) continue
      if (VIDEO.test(m)) g.video.push(m)
      else if (IMAGE.test(m)) g.image.push(m)
      else if (!NON_CHAT.test(m)) {
        g.chat.push(m)
        if (CODEX.test(m)) g.codex.push(m)
        if (CLAUDE.test(m)) g.claude.push(m)
      }
    }
    return g
  }
  // Higher version numbers first: gpt-5.4-mini before gpt-5-mini, sonnet-4-6 before sonnet-4-5-20250929.
  function byNewest(a, b) {
    const va = (a.match(/\d+/g) || []).map(Number), vb = (b.match(/\d+/g) || []).map(Number)
    for (let i = 0; i < Math.max(va.length, vb.length); i++) { const d = (vb[i] ?? -1) - (va[i] ?? -1); if (d) return d }
    return a.length - b.length
  }
  const firstMatch = (list, patterns) => { for (const p of patterns) { const f = list.filter((m) => p.test(m)).sort(byNewest); if (f.length) return f[0] } return list[0] || '' }
  // Site-recommended models; each is used only when the key can call it, otherwise the slot falls back to the rules below.
  const RECOMMENDED = { text: 'gpt-6.1-sol', vision: 'gpt-6.1-sol', image: 'smart-image', video: 'smart-video', codex: 'gpt-6-astra', claude: 'claude-opus-5-5' }
  const recommended = (list, field) => list.find((m) => m.toLowerCase() === RECOMMENDED[field].toLowerCase())
  function defaults(g) {
    const text = firstMatch(g.chat, [/^gpt-5(\.\d+)?-mini$/i, /^gpt-4\.1-mini$|^gpt-4o-mini$/i, /deepseek-(chat|v3)/i, /gemini-[\d.]+-flash$/i, /claude-.*(sonnet|haiku)/i])
    return {
      text: recommended(g.chat, 'text') || text,
      vision: recommended(g.chat, 'vision') || text,
      image: recommended(g.image, 'image') || firstMatch(g.image, [/^smart-image/i, /gpt-image/i]),
      video: recommended(g.video, 'video') || firstMatch(g.video, [/^smart-video/i]),
      codex: recommended(g.codex, 'codex') || recommended(g.codex, 'text') || firstMatch(g.codex, [/^gpt-5(\.\d+)?-codex$/i, /^gpt-5(\.\d+)?$/i, /^gpt-4\.1$/i]),
      claude: recommended(g.claude, 'claude') || firstMatch(g.claude, [/^claude-sonnet-\d/i, /^claude-opus-\d/i, /sonnet/i]),
    }
  }
  const brandFor = (host) => (BRAND_DOMAINS.some((d) => host === d || host.endsWith('.' + d)) ? 'yinzi' : 'neutral')
  const fieldsFor = (target) => ROWS.filter((r) => TARGETS[target].slots.includes(r.slot)).map((r) => r.field)

  function buildSlots(target, pick) {
    const allowed = TARGETS[target].slots, slots = {}
    if (allowed.includes('text') && pick.text) slots.text = { model: pick.text }
    if (allowed.includes('vision') && pick.vision) slots.vision = { model: pick.vision }
    if (allowed.includes('image') && pick.image) slots.image = { model: pick.image, endpoint: '/v1/images/generations' }
    if (allowed.includes('video') && pick.video) slots.video = { model: pick.video, endpoint: '/v1/videos' }
    if (allowed.includes('agent') && (pick.codex || pick.claude)) {
      slots.agent = {}
      if (pick.codex) slots.agent.codex = { model: pick.codex }
      if (pick.claude) slots.agent.claude = { model: pick.claude }
    }
    return slots
  }
  function buildPayload(o) {
    const url = new URL(o.serverAddress)
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') throw new Error('insecure_origin')
    const slots = buildSlots(o.target, o.slots)
    if (!Object.keys(slots).length) throw new Error('no_slots')
    const iat = Math.floor(o.now / 1000)
    const payload = {
      schema: SCHEMA, target: o.target, nonce: o.nonce, iat, exp: iat + TTL,
      site: { name: o.siteName, origin: url.origin, brand: brandFor(url.hostname.toLowerCase()) },
      profile: { id: `${url.host}#token-${o.tokenId}`, name: String(o.profileName || '').trim() || `${o.siteName} · ${o.keyName}`, mode: o.mode },
    }
    if (o.apiKey) payload.credentials = { base_url: url.origin + '/v1', api_key: o.apiKey, key_name: o.keyName, smart_routing: !!o.smartRouting }
    payload.slots = slots
    return payload
  }
  function b64url(text) {
    let bin = ''
    for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
    return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  }
  function encode(payload) {
    const json = JSON.stringify(payload)
    if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error('too_large')
    return b64url(json)
  }
  const link = (payload) => `${payload.target}://v1/import?data=${encode(payload)}`
  const code = (payload) => PREFIX + encode(payload)
  const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
  const ERRORS = { too_large: '导入内容太大，请少勾选几项。', insecure_origin: '本站地址不是 HTTPS，暂时不能一键导入。', no_slots: '请至少勾选一项' }

  async function listModels(fullKey) {
    const res = await fetch('/v1/models', { credentials: 'omit', headers: { Authorization: 'Bearer ' + fullKey } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const body = await res.json()
    return (body?.data || []).map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
  }

  function mount(app, root, opts) {
    const { h } = app
    const key = opts.key || {}
    const siteName = app.state.siteName || location.hostname
    const defaultName = `${siteName} · ${key.name || ''}`
    const st = { target: 'omni-creator', groups: null, models: {}, picked: {}, profileName: '', mode: 'merge', includeKey: true, error: '', code: '', launch: '' }
    let timer = 0, dead = false
    const onBlur = () => { if (st.launch === 'pending') { st.launch = 'opened'; paint() } }
    addEventListener('blur', onBlur)

    const isPicked = (f) => (f in st.picked ? st.picked[f] : !!st.models[f])
    function submit() {
      const slots = {}
      for (const f of fieldsFor(st.target)) if (isPicked(f) && st.models[f]) slots[f] = st.models[f]
      try {
        const payload = buildPayload({
          target: st.target, serverAddress: app.state.endpoint || location.origin, siteName, tokenId: key.id, keyName: key.name,
          apiKey: st.includeKey ? opts.fullKey : undefined, smartRouting: key.smart, profileName: st.profileName || defaultName,
          mode: st.mode, slots, now: Date.now(), nonce: nonce(),
        })
        const href = link(payload)
        st.code = code(payload); st.launch = 'pending'
        clearTimeout(timer)
        timer = setTimeout(() => { if (st.launch === 'pending') { st.launch = 'silent'; paint() } }, LAUNCH_WAIT_MS)
        paint()
        ;(opts.launch || ((u) => { location.href = u }))(href)
      } catch (e) { app.ui.toast(ERRORS[e.message] || ERRORS.no_slots, 'bad') }
    }
    async function copyCode() {
      try { await navigator.clipboard.writeText(st.code); app.ui.toast('已复制导入码') } catch { app.ui.toast('复制失败，请改用「下载导入文件」', 'bad') }
    }
    function download() {
      const url = URL.createObjectURL(new Blob([st.code], { type: 'text/plain' }))
      const a = h('a', { href: url, download: `${location.hostname}-${key.id}.yzimport` })
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: 'qs-btn ' + cls, onclick }, label)
    const radio = (name, value, checked, label, sub, onchange) => h('label', { class: 'qsi-opt' + (checked ? ' on' : '') },
      h('input', { type: 'radio', name, value, checked, onchange }), h('span', {}, h('b', {}, label), sub ? h('small', {}, sub) : null))

    function slotsBody() {
      if (st.error) return h('p', { class: 'qsi-bad' }, '读取这个密钥的模型失败，请稍后再试')
      if (!st.groups) return h('p', { class: 'qs-mute' }, '正在读取这个密钥能用的模型…')
      return h('div', { class: 'qsi-slots' }, ROWS.filter((r) => fieldsFor(st.target).includes(r.field)).map((r) => {
        const list = st.groups[r.group], ok = list.length > 0, on = ok && isPicked(r.field)
        return h('div', { class: 'qsi-slot' },
          h('label', { class: 'qsi-chk' }, h('input', { type: 'checkbox', checked: on, disabled: !ok, onchange: (e) => { st.picked[r.field] = e.target.checked; paint() } }),
            h('span', {}, r.label), ok ? null : h('small', { class: 'qs-mute' }, '这个密钥没有可用的模型')),
          on ? h('select', { 'aria-label': r.label, onchange: (e) => { st.models[r.field] = e.target.value } },
            list.map((m) => h('option', { value: m, selected: m === st.models[r.field] }, m))) : null)
      }))
    }
    function launched() {
      return [
        h('p', { role: 'status' }, st.launch === 'silent' ? '没有反应？请先安装或更新软件，或者改用下面的导入码。' : '软件应该已经弹出确认框，请在软件里确认导入。'),
        h('div', { class: 'qs-btns left' }, btn('复制导入码', copyCode), btn('下载导入文件', download)),
        h('p', { class: 'qs-mute' }, '在软件里点「从剪贴板导入」或打开这个文件即可。导入码 10 分钟内有效，里面含有密钥，不要发给别人。'),
      ]
    }
    function form() {
      return [
        h('div', { class: 'qsi-sec' }, h('h4', {}, '导入到'), ...Object.entries(TARGETS).map(([id, t]) =>
          radio('qsi-target', id, st.target === id, t.label, t.desc, () => { st.target = id; paint() }))),
        h('div', { class: 'qsi-sec' }, h('h4', {}, '导入哪些设置'), slotsBody()),
        h('label', { class: 'qs-field' }, h('span', {}, '配置名称'),
          h('input', { value: st.profileName, placeholder: defaultName, maxlength: '60', autocomplete: 'off', oninput: (e) => { st.profileName = e.target.value } })),
        h('div', { class: 'qsi-sec' },
          radio('qsi-mode', 'merge', st.mode === 'merge', '合并：只修改勾选的项目（推荐）', '', () => { st.mode = 'merge'; paint() }),
          radio('qsi-mode', 'replace', st.mode === 'replace', '覆盖：重建这套配置，没勾选的项目会被清空', '', () => { st.mode = 'replace'; paint() })),
        h('label', { class: 'qsi-chk' }, h('input', { type: 'checkbox', checked: st.includeKey, onchange: (e) => { st.includeKey = e.target.checked; paint() } }),
          h('span', {}, '同时导入密钥'), h('small', { class: 'qs-mute' }, '不勾选时，只修改软件里已有配置的默认模型。')),
        st.includeKey ? h('p', { class: 'qsi-warn' }, '导入链接里包含你的密钥，请不要发给别人。') : null,
      ]
    }
    function paint() {
      if (dead) return
      const body = st.code ? launched() : form()
      root.replaceChildren(h('div', { class: 'qsi' },
        h('div', { class: 'qs-ph' }, h('h3', {}, `一键导入「${key.name || ''}」`), h('span', { style: { flex: '1' } }), h('button', { type: 'button', class: 'qs-x', 'aria-label': '关闭', onclick: () => opts.done?.() }, '✕')),
        h('p', { class: 'qs-mute' }, '把这个密钥导入到桌面软件。软件会先请你确认，再修改任何设置。'),
        ...body,
        h('div', { class: 'qs-btns' }, btn(st.code ? '关闭' : '取消', () => opts.done?.()),
          h('button', { type: 'button', class: 'qs-btn pri', disabled: !st.groups, onclick: submit }, st.code ? '再次打开软件' : '导入到软件'))))
    }

    paint()
    listModels(opts.fullKey).then((models) => {
      st.groups = classify(models); st.models = defaults(st.groups); paint()
    }).catch(() => { st.error = 'load'; paint() })
    return { destroy() { dead = true; clearTimeout(timer); removeEventListener('blur', onBlur) } }
  }

  const CSS = `
.qsi{display:grid;gap:4px}
.qsi h4{margin:14px 0 6px;font-size:.9rem}
.qsi-sec{display:grid;gap:6px}
.qsi-opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--qs-line);border-radius:calc(var(--qs-radius) - 4px);cursor:pointer}
.qsi-opt.on{border-color:var(--qs-ac)}
.qsi-opt span{display:grid;gap:2px}.qsi-opt small{color:var(--qs-mute)}
.qsi-slots{display:grid;gap:10px}
.qsi-slot{display:grid;gap:6px}
.qsi-chk{display:flex;gap:8px;align-items:center;flex-wrap:wrap;cursor:pointer;margin:6px 0}
.qsi select{width:100%;padding:9px 12px;border-radius:calc(var(--qs-radius) - 4px);border:1px solid var(--qs-line);background:color-mix(in srgb,var(--qs-bg) 70%,transparent)}
.qsi-warn{color:#d9a441!important;font-size:.84rem}
.qsi-bad{color:var(--qs-bad,#e5675a)!important}`

  window.__qs.defineModule({ id: 'import', css: CSS, mount, lib: { classify, defaults, buildPayload, link, code, fieldsFor } })
})()
