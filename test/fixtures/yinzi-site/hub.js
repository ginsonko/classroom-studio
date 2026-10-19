/* 千面 · 数据中心 (mod/hub). Views shared by every frontend, styled with the host frontend's --qs-* variables:
 *   logs   – usage records: every log type, full new-api search, per-record detail (billing, tokens, smart-routing attempts)
 *   rank   – public model / vendor leaderboard (/api/rankings)
 *   smart  – smart routing centre: per-key route status, site-wide route board, route analytics, key usage analytics
 *   editor – create / edit a key: fixed group or smart routing with the full routing policy (opened by act.createKey/editKey)
 * Mount with app.modules.mount('hub', el, { view }) ; switch with handle.setView(view). */
(() => {
  'use strict'
  const MONO = '"JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace'
  const CSS = `
.qsh{--h-r:var(--qsm-radius,var(--qs-radius,14px));--h-rs:calc(var(--h-r) * .6);--h-btn-r:999px;--h-pnl:var(--qsm-panel,color-mix(in srgb,var(--qs-card) 94%,transparent));--h-bd:1px solid var(--qs-line);--h-field:color-mix(in srgb,var(--qs-bg) 45%,var(--qs-card));--h-soft:color-mix(in srgb,var(--qs-fg) 6%,var(--qs-card));--h-ac2:var(--qsm-accent-2,var(--qs-ac));--h-ok:var(--qs-ok,#5fbf8f);--h-bad:var(--qs-bad,#e5675a);--h-warn:#d9a441;--h-shadow:none;--h-num:var(--qs-font-num,var(--qs-font));--h-head:var(--qs-font-head,var(--qs-font));
  display:flex;flex-direction:column;gap:14px;color:var(--qs-fg);font-family:var(--qs-font);font-size:.92rem;line-height:1.5;min-width:0}
.qsh *{box-sizing:border-box}
.qsh button,.qsh input,.qsh select,.qsh textarea{font:inherit;color:inherit}
.qsh-pnl{background:var(--h-pnl);border:var(--h-bd);border-radius:var(--h-r);padding:14px 16px;box-shadow:var(--h-shadow);min-width:0}
.qsh-hd{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 10px}
.qsh-hd h3,.qsh-hd h4{margin:0;font:600 1.02rem/1.3 var(--h-head)}
.qsh-hd h4{font-size:.95rem}
.qsh-hd .sp{flex:1}
.qsh-mute{color:var(--qs-mute);font-size:.84rem}
.qsh-sm{font-size:.8rem}
.qsh-bad{color:var(--h-bad)}.qsh-ok{color:var(--h-ok)}.qsh-warn{color:var(--h-warn)}
.qsh-num{font-family:var(--h-num);font-variant-numeric:tabular-nums}
.qsh-mono{font-family:${MONO};font-size:.82rem;word-break:break-all}
.qsh-btn{appearance:none;border:1px solid var(--qs-line);background:transparent;border-radius:var(--h-btn-r);padding:6px 13px;cursor:pointer;white-space:nowrap;transition:border-color .15s,background .15s}
.qsh-btn:hover{border-color:color-mix(in srgb,var(--qs-fg) 40%,transparent)}
.qsh-btn.pri{background:var(--qs-ac);color:var(--qs-on-ac);border-color:transparent;font-weight:600}
.qsh-btn.sm{padding:3px 9px;font-size:.8rem}
.qsh-btn.bad{color:var(--h-bad)}
.qsh-btn:disabled{opacity:.45;cursor:default}
.qsh-btn:focus-visible,.qsh-seg button:focus-visible,.qsh-row:focus-visible{outline:2px solid var(--qs-ac);outline-offset:2px}
.qsh-seg{display:inline-flex;flex-wrap:wrap;gap:2px;border:1px solid var(--qs-line);border-radius:var(--h-btn-r);padding:3px}
.qsh-seg button{appearance:none;border:0;background:none;padding:4px 11px;border-radius:var(--h-btn-r);cursor:pointer;color:var(--qs-mute);font-size:.84rem}
.qsh-seg button[aria-pressed=true]{background:var(--qs-ac);color:var(--qs-on-ac)}
.qsh-tabs{display:flex;flex-wrap:wrap;gap:6px}
.qsh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.qsh-f{display:grid;gap:4px;min-width:0}
.qsh-f>span{font-size:.78rem;color:var(--qs-mute)}
.qsh-f small{font-size:.75rem;color:var(--qs-mute);line-height:1.35}
.qsh input:not([type=checkbox]):not([type=radio]),.qsh select,.qsh textarea{width:100%;min-width:0;padding:7px 10px;border:1px solid var(--qs-line);border-radius:var(--h-rs);background:var(--h-field);outline:none}
.qsh input:focus,.qsh select:focus,.qsh textarea:focus{border-color:var(--qs-ac)}
.qsh textarea{font-family:${MONO};font-size:.8rem;min-height:80px;resize:vertical}
.qsh input[type=checkbox],.qsh input[type=radio]{accent-color:var(--qs-ac);width:15px;height:15px;margin:0}
.qsh-chk{display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none}
.qsh-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.qsh-acts .sp{flex:1}
.qsh-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.qsh-kpi{background:var(--h-soft);border-radius:var(--h-rs);padding:9px 12px;min-width:0}
.qsh-kpi span{display:block;font-size:.75rem;color:var(--qs-mute)}
.qsh-kpi b{display:block;font:600 1.08rem/1.3 var(--h-num);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qsh-tag{display:inline-flex;align-items:center;gap:4px;padding:0 8px;border-radius:999px;border:1px solid var(--qs-line);font-size:.74rem;line-height:1.7;white-space:nowrap;color:var(--qs-mute)}
.qsh-tag.ok{color:var(--h-ok);border-color:color-mix(in srgb,var(--h-ok) 45%,transparent)}
.qsh-tag.bad{color:var(--h-bad);border-color:color-mix(in srgb,var(--h-bad) 45%,transparent)}
.qsh-tag.warn{color:var(--h-warn);border-color:color-mix(in srgb,var(--h-warn) 45%,transparent)}
.qsh-tag.ac{color:var(--qs-ac);border-color:color-mix(in srgb,var(--qs-ac) 45%,transparent)}
.qsh-tbl{width:100%;border-collapse:collapse;font-size:.84rem}
.qsh-tbl th{font-weight:500;color:var(--qs-mute);font-size:.76rem;text-align:left;padding:6px 8px;border-bottom:1px solid var(--qs-line);white-space:nowrap}
.qsh-tbl td{padding:8px;border-bottom:1px solid color-mix(in srgb,var(--qs-line) 70%,transparent);vertical-align:top}
.qsh-tbl td.r,.qsh-tbl th.r{text-align:right}
.qsh-tbl tr.qsh-row{cursor:pointer}
.qsh-tbl tr.qsh-row:hover td{background:var(--h-soft)}
.qsh-tbl .clip{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qsh-scroll{overflow-x:auto;min-width:0}
.qsh-pager{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px}
.qsh-pager select{width:auto}
.qsh-empty{padding:28px 10px;text-align:center;color:var(--qs-mute)}
.qsh-wait{padding:24px 10px;text-align:center;color:var(--qs-mute)}
.qsh-err{padding:10px 12px;border-radius:var(--h-rs);background:color-mix(in srgb,var(--h-bad) 12%,transparent);color:var(--h-bad);white-space:pre-wrap;word-break:break-word}
.qsh-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 16px}
.qsh-kv>div{display:flex;gap:8px;min-width:0;align-items:baseline}
.qsh-kv>div>span{flex:none;color:var(--qs-mute);font-size:.78rem;min-width:66px}
.qsh-kv>div>b{font-weight:500;min-width:0;word-break:break-all}
.qsh-pre{white-space:pre-wrap;word-break:break-word;background:var(--h-soft);border-radius:var(--h-rs);padding:10px 12px;margin:0;font-family:${MONO};font-size:.8rem;max-height:340px;overflow:auto}
.qsh details>summary{cursor:pointer;color:var(--qs-mute);font-size:.84rem;margin:4px 0}
.qsh-sec{margin-top:14px}
.qsh-sec>h4{margin:0 0 8px;font:600 .9rem/1.3 var(--h-head)}
.qsh-calc{font-family:var(--h-num);font-size:.84rem;line-height:1.75}
.qsh-bar{height:8px;border-radius:99px;background:var(--h-soft);overflow:hidden;min-width:60px}
.qsh-bar>i{display:block;height:100%;background:var(--qs-ac);border-radius:inherit}
.qsh-chart{width:100%;height:auto;display:block;overflow:visible}
.qsh-chart text{fill:var(--qs-mute);font-size:10px;font-family:var(--qs-font)}
.qsh-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:.78rem;color:var(--qs-mute)}
.qsh-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.qsh-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.qsh-li{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid color-mix(in srgb,var(--qs-line) 70%,transparent)}
.qsh-li:last-child{border-bottom:0}
.qsh-li .rk{width:26px;text-align:center;font:600 .9rem var(--h-num);color:var(--qs-mute)}
.qsh-li .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qsh-up{color:var(--h-ok)}.qsh-down{color:var(--h-bad)}
.qsh-av{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--h-soft);font-size:.72rem;font-weight:600;flex:none}
.qsh-sect{border-top:1px solid var(--qs-line);padding-top:12px;margin-top:12px}
.qsh-sect>h4{margin:0 0 10px;font:600 .9rem/1.3 var(--h-head);display:flex;gap:8px;align-items:baseline}
.qsh-sect>h4 small{font-weight:400;color:var(--qs-mute);font-size:.76rem}
.qsh-glist{display:grid;gap:4px;max-height:280px;overflow:auto;padding-right:4px}
.qsh-g{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--h-rs);background:var(--h-soft);font-size:.84rem}
.qsh-g .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qsh-glist.sec{max-height:380px;gap:10px}
.qsh-gsec{display:grid;gap:4px}
.qsh-gsh{display:flex;align-items:center;gap:8px;font-size:.8rem;padding:2px 2px 0}
.qsh-gsh .sw{width:10px;height:10px;border-radius:3px;flex:none}
.qsh-gsh b{font-weight:600}
.qsh-gsh .sp{flex:1}
.qsh-gbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 8px}
.qsh-mprev{margin:-2px 0 10px;font-size:.8rem;color:var(--qs-mute)}
.qsh-ed{display:flex;flex-direction:column;gap:0}
.qsh-ed .qsh-foot{position:sticky;bottom:-22px;background:var(--qs-pop,var(--qs-card));padding:12px 0 2px;margin-top:14px;border-top:1px solid var(--qs-line)}
.qsh-sum{display:inline-flex;gap:6px;flex-wrap:wrap}
@media (max-width:720px){
 .qsh-tbl.rsp thead{display:none}
 .qsh-tbl.rsp tr{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:9px 4px;border-bottom:1px solid var(--qs-line)}
 .qsh-tbl.rsp td{border:0;padding:0;max-width:none}
 .qsh-tbl.rsp td[data-k]::before{content:attr(data-k) " ";color:var(--qs-mute);font-size:.72rem}
 .qsh-tbl.rsp td.wide{grid-column:1/-1}
 .qsh-pnl{padding:12px}
}
.qs-dlg.qs-hubdlg{width:min(860px,100%);padding:20px 22px}
.qs-dlg .qsh-dlg h3{margin:0}
.qsh[data-flavor=console]{--h-r:var(--qsm-radius,0px);--h-rs:0px;--h-btn-r:0;--h-pnl:var(--qsm-panel,transparent);--h-bd:1px dashed var(--qs-line);--h-field:transparent;--h-soft:color-mix(in srgb,var(--qs-ac) 7%,transparent)}
.qsh[data-flavor=console] .qsh-hd h3::before{content:"── "}.qsh[data-flavor=console] .qsh-hd h3::after{content:" ──"}
.qsh[data-flavor=console] .qsh-hd h3{color:var(--qs-ac);font-weight:500}
.qsh[data-flavor=console] .qsh-seg button[aria-pressed=true]{background:none;color:var(--qs-ac);text-decoration:underline}
.qsh[data-flavor=receipt]{--h-r:0px;--h-rs:0px;--h-btn-r:0;--h-pnl:var(--qsm-panel,var(--qs-card));--h-bd:1px dashed var(--qs-line);--h-field:transparent;--h-soft:color-mix(in srgb,var(--qs-fg) 5%,transparent);font-size:.86rem}
.qsh[data-flavor=receipt] .qsh-tbl td{border-bottom-style:dashed}
.qsh[data-flavor=arcade]{--h-r:0px;--h-rs:0px;--h-btn-r:0;--h-bd:2px solid color-mix(in srgb,var(--qs-fg) 72%,var(--qs-bg));--h-pnl:var(--qsm-panel,var(--qs-card));letter-spacing:.02em}
.qsh[data-flavor=arcade] .qsh-btn{border-width:2px;box-shadow:3px 3px 0 color-mix(in srgb,var(--qs-fg) 60%,transparent)}
.qsh[data-flavor=arcade] .qsh-btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 color-mix(in srgb,var(--qs-fg) 60%,transparent)}
.qsh[data-flavor=journal]{--h-r:2px;--h-rs:2px;--h-btn-r:2px;--h-pnl:var(--qsm-panel,transparent);--h-num:var(--qs-font-num,Georgia,serif)}
.qsh[data-flavor=journal] .qsh-hd h3{font-style:italic;font-weight:500}
.qsh[data-flavor=cockpit]{--h-r:3px;--h-rs:2px;--h-btn-r:2px;--h-pnl:var(--qsm-panel,color-mix(in srgb,var(--qs-card) 82%,transparent));--h-soft:color-mix(in srgb,var(--qs-ac) 7%,transparent)}
.qsh[data-flavor=cockpit] .qsh-hd h3,.qsh[data-flavor=cockpit] .qsh-tbl th{text-transform:uppercase;letter-spacing:.08em}
.qsh[data-flavor=bento]{--h-r:22px;--h-pnl:var(--qsm-panel,var(--qs-card));--h-bd:1px solid transparent;--h-shadow:0 1px 0 rgba(0,0,0,.04),0 14px 34px -22px rgba(0,0,0,.3)}
.qsh[data-flavor=pocket]{--h-r:24px;--h-rs:14px;--h-pnl:var(--qsm-panel,var(--qs-card));--h-bd:1px solid transparent;--h-shadow:0 12px 32px -20px rgba(0,0,0,.35);font-size:.95rem}
.qsh[data-flavor=cinema]{--h-r:22px;--h-pnl:var(--qsm-panel,rgba(16,16,18,.72));--h-shadow:0 30px 80px -40px rgba(0,0,0,.85);--h-field:rgba(0,0,0,.28);--h-soft:rgba(255,255,255,.07)}
.qsh[data-flavor=cinema] .qsh-pnl{backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.qsh[data-flavor=desk]{--h-r:12px;--h-pnl:var(--qsm-panel,color-mix(in srgb,var(--qs-card) 90%,transparent));--h-shadow:0 26px 60px -26px rgba(0,0,0,.6)}
.qsh[data-flavor=chat]{--h-r:14px;--h-pnl:var(--qsm-panel,var(--qs-card))}
`
  const TYPES = [[0, '全部'], [2, '消耗'], [5, '错误'], [6, '退款'], [1, '充值'], [3, '管理'], [4, '系统'], [7, '登录']]
  const TYPE_NAME = { 1: '充值', 2: '消耗', 3: '管理', 4: '系统', 5: '错误', 6: '退款', 7: '登录' }
  const TYPE_CLS = { 2: 'ac', 5: 'bad', 6: 'warn', 1: 'ok' }
  const RANGES = [['today', '今天'], ['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['all', '全部'], ['custom', '自定义']]
  const STATE = { available: ['可用', 'ok'], healthy: ['健康', 'ok'], degraded: ['降级', 'warn'], recovering: ['恢复中', 'warn'], needs_review: ['待复核', 'bad'], pending_sample: ['待采样', ''], unavailable: ['不可用', 'bad'], quarantined: ['隔离中', 'bad'], unknown: ['未知', ''], available_unproven: ['可用（未验证）', ''] }
  const REASON = {
    selected_lowest_price_available: '价格最低且可用', above_price_limit: '超出密钥价格上限', group_not_selected: '不在密钥选择的分组里', group_excluded: '密钥排除了这个分组',
    group_unauthorized: '账号无权使用这个分组', planner_candidate: '可作为候选', available_after_selected_route: '首选失败后会尝试', no_candidate: '没有可用路线',
    endpoint_unsupported: '不支持这个接口', capability_unsupported: '不支持所需能力', context_unsupported: '上下文长度不够', ttft_unacceptable: '首字太慢', runtime_excluded: '运行时被排除',
    quarantined: '已隔离', needs_review: '等待管理员复核', capacity_limited: '容量受限', selected_most_stable: '最稳定', selected_fastest_ttft: '首字最快', selected_best_balanced: '综合最优',
    selected_manual_order: '按手动顺序', selected_custom_weighted: '按自定义权重最优', health_guard: '健康保护跳过',
  }
  const STRATEGY = [['price', '价格最低'], ['stability', '稳定优先'], ['latency', '首字最快'], ['balanced', '均衡'], ['custom_weighted', '按自定义权重排序'], ['manual', '手动排序']]
  const RECOVERY = [['fast', '快速恢复'], ['balanced', '均衡'], ['stable', '稳定优先（更谨慎）']]
  const OUTCOME = { success: '成功', failure: '失败', hard_failure: '失败', soft_failure: '软失败', timeout: '超时', unknown: '结果未知', rejected: '被拒绝', canceled: '已取消' }
  const PALETTE = ['var(--qs-ac)', '#6f9cf2', '#69c08d', '#e4ae55', '#e7708a', '#a888ec', '#3fb8cf', '#f08f5a', '#7ed3c1', '#b9c0dd']

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const pad = (n) => String(n).padStart(2, '0')
  const fullTime = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
  const localInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
  const parseJSON = (s) => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}') || {} } catch { return {} } }
  const ratioX = (ppm) => (ppm == null ? '—' : '×' + +(ppm / 1e6).toFixed(4))
  const pctPPM = (ppm) => (ppm == null ? '—' : +(ppm / 1e4).toFixed(1) + '%')
  const num = (v) => (v == null || v === '' ? null : Number(v))
  const ms = (v) => (v == null ? '—' : v < 1000 ? Math.round(v) + 'ms' : (v / 1000).toFixed(v < 1e4 ? 2 : 1) + 's')
  const stateTag = (h, s) => { const [t, c] = STATE[s] || [s || '—', '']; return h('span', { class: 'qsh-tag ' + c }, t) }
  const reasonText = (r) => REASON[r] || (r ? String(r).replace(/_/g, ' ') : '—')

  // Group colours are the admin's GroupVisuals (/api/status group_visuals) with the same name-based fallback as the
  // React frontend's resolveGroupVisualColor, so a group lands in the same colour section in both frontends.
  const GROUP_COLORS = [['blue', '蓝色', '#3b82f6'], ['green', '绿色', '#22c55e'], ['orange', '橙色', '#f97316'], ['violet', '紫罗兰', '#8b5cf6'], ['cyan', '青色', '#06b6d4'], ['teal', '蓝绿', '#14b8a6'], ['indigo', '靛蓝', '#6366f1'], ['purple', '紫色', '#a855f7'], ['pink', '粉色', '#ec4899'], ['red', '红色', '#ef4444'], ['amber', '琥珀', '#f59e0b'], ['yellow', '黄色', '#eab308'], ['lime', '青柠', '#84cc16'], ['light-blue', '浅蓝', '#38bdf8'], ['light-green', '浅绿', '#4ade80'], ['grey', '灰色', '#9ca3af'], ['slate', '石板灰', '#64748b']]
  const GROUP_COLOR = Object.fromEntries(GROUP_COLORS.map(([id, label, hex], order) => [id, { id, label, hex, order }]))
  const TAG_COLORS = ['amber', 'blue', 'cyan', 'green', 'grey', 'indigo', 'light-blue', 'lime', 'orange', 'pink', 'purple', 'red', 'teal', 'violet', 'yellow']
  function groupColor(group, overrides = {}) {
    const name = String(group || '').trim()
    if (GROUP_COLOR[overrides[name]]) return overrides[name]
    const lower = name.toLowerCase()
    if (lower === 'auto' || lower === 'default' || lower.includes('shared') || lower.includes('汇总') || lower.includes('综合')) return 'slate'
    if (lower.includes('gpt') || lower.includes('openai')) return 'blue'
    if (lower.includes('gemini') || lower.includes('google')) return 'green'
    if (lower.includes('claude') || lower.includes('anthropic')) return 'orange'
    if (lower.includes('grok') || lower.includes('xai')) return 'violet'
    let sum = 0
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i)
    return TAG_COLORS[sum % TAG_COLORS.length]
  }
  // Colour sections in the site's colour order; inside a section the most expensive group comes first.
  function colorSections(groups, overrides) {
    const by = new Map()
    for (const g of groups) {
      const id = groupColor(g.group, overrides)
      if (!by.has(id)) by.set(id, { ...GROUP_COLOR[id], groups: [] })
      by.get(id).groups.push(g)
    }
    const ratio = (g) => (g.effective_ratio_ppm == null || !Number.isFinite(+g.effective_ratio_ppm) ? -1 : +g.effective_ratio_ppm)
    return [...by.values()].sort((a, b) => a.order - b.order).map((s) => ({ ...s, groups: s.groups.sort((a, b) => ratio(b) - ratio(a) || String(a.group).localeCompare(String(b.group))) }))
  }

  function mount(app, root, opts = {}) {
    const { h, fmt } = app
    const flavor = opts.flavor || ''
    let view = opts.view || 'logs', inner = null, dead = false
    const money = (quota) => fmt.money((+quota || 0) / (app.qpu || 500000))
    const get = (path) => app.request('GET', path)
    const box = (cls = '') => h('div', { class: 'qsh ' + cls, 'data-flavor': flavor })
    const toast = (t, k) => app.ui.toast(t, k)
    const copy = (text, label) => app.act.copy ? app.act.copy(text, label) : navigator.clipboard?.writeText(text)
    const seg = (items, cur, on, label) => h('div', { class: 'qsh-seg', role: 'group', 'aria-label': label || '' }, items.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(String(v) === String(cur)), onclick: () => on(v) }, l)))
    const field = (label, control, help) => h('label', { class: 'qsh-f' }, h('span', {}, label), control, help ? h('small', {}, help) : null)
    const select = (value, options, on, attrs = {}) => {
      const s = h('select', { ...attrs, onchange: () => on(s.value) }, options.map(([v, l]) => h('option', { value: v }, l)))
      s.value = value
      return s
    }
    const wait = (t = '正在读取…') => h('div', { class: 'qsh-wait', role: 'status' }, t)
    const fail = (e) => h('div', { class: 'qsh-err' }, '读取失败：' + (e?.message || e))
    const dialog = (title, build) => app.ui.dialog((dlg, done) => {
      const b = box('qsh-dlg')
      b.append(h('div', { class: 'qsh-hd' }, h('h3', {}, title), h('span', { class: 'sp' }), h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => done() }, '关闭')))
      dlg.append(b)
      build(b, done)
    }, { wide: true, cls: 'qs-hubdlg' })
    const ctx = { app, h, fmt, money, get, box, toast, copy, seg, field, select, wait, fail, dialog, flavor, isDead: () => dead }

    function render() {
      try { inner?.destroy?.() } catch {}
      root.replaceChildren()
      const fn = VIEWS[view] || VIEWS.logs
      inner = fn(ctx, root, opts) || {}
    }
    render()
    return {
      setView(v) { if (v && v !== view && VIEWS[v]) { view = v; render() } },
      destroy() { dead = true; try { inner?.destroy?.() } catch {} },
    }
  }

  // ======================================================================= logs
  function logsView(c, root) {
    const { app, h, money, get, seg, field, select } = c
    const saved = app.prefs.get('hub.logs', {})
    const st = { type: saved.type ?? 0, range: saved.range || '7d', start: '', end: '', model: '', token: '', group: '', rid: '', urid: '', page: 1, size: saved.size || 20 }
    let ctl = null, last = null
    const el = c.box()
    root.append(el)
    const keys = () => [...new Set((app.state.keys || []).map((k) => k.name))]
    const models = () => (app.state.pricing || []).map((p) => p.model)
    if (!app.state.pricing) app.loadPricing?.().then(() => !c.isDead() && paintFilters()).catch(() => {})

    function window_() {
      const now = Math.floor(Date.now() / 1000)
      if (st.range === 'all') return [0, 0]
      if (st.range === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return [Math.floor(d / 1000), now] }
      if (st.range === '24h') return [now - 86400, now]
      if (st.range === '30d') return [now - 30 * 86400, now]
      if (st.range === 'custom') return [st.start ? Math.floor(new Date(st.start) / 1000) : 0, st.end ? Math.floor(new Date(st.end) / 1000) : 0]
      return [now - 7 * 86400, now]
    }
    function qs(withPage) {
      const [s, e] = window_()
      const p = new URLSearchParams()
      p.set('type', String(st.type))
      if (s) p.set('start_timestamp', String(s))
      if (e) p.set('end_timestamp', String(e))
      if (st.token) p.set('token_name', st.token)
      if (st.model) p.set('model_name', st.model.trim())
      if (st.group) p.set('group', st.group)
      if (st.rid) p.set('request_id', st.rid.trim())
      if (st.urid) p.set('upstream_request_id', st.urid.trim())
      if (withPage) { p.set('p', String(st.page)); p.set('page_size', String(st.size)) }
      return p.toString()
    }

    const filters = h('div', { class: 'qsh-pnl' })
    const statLine = h('div', { class: 'qsh-kpis' })
    const results = h('div', { class: 'qsh-pnl' })
    el.append(filters, statLine, results)

    function paintFilters() {
      const inp = (key, ph, list) => {
        const i = h('input', { value: st[key], placeholder: ph, autocomplete: 'off', spellcheck: 'false', list: list || null, oninput: () => { st[key] = i.value }, onkeydown: (e) => { if (e.key === 'Enter') { st.page = 1; query() } } })
        return i
      }
      const dl = h('datalist', { id: 'qsh-models-dl' }, models().map((m) => h('option', { value: m })))
      const groups = [['', '全部分组'], ...(app.state.groups || []).map((g) => [g.name, g.name]), ['auto', 'auto（智能路由）']]
      const custom = st.range === 'custom'
        ? [field('开始时间', h('input', { type: 'datetime-local', value: st.start, onchange: (e) => { st.start = e.target.value } })), field('结束时间', h('input', { type: 'datetime-local', value: st.end, onchange: (e) => { st.end = e.target.value } }))]
        : []
      filters.replaceChildren(
        h('div', { class: 'qsh-hd' }, h('h3', {}, '使用记录'), h('span', { class: 'sp' }), seg(TYPES, st.type, (v) => { st.type = v; st.page = 1; save(); paintFilters(); query() }, '记录类型')),
        h('div', { class: 'qsh-grid' },
          field('时间范围', select(st.range, RANGES, (v) => { st.range = v; if (v === 'custom' && !st.start) { st.start = localInput(Date.now() - 86400e3); st.end = localInput(Date.now()) } save(); paintFilters(); if (v !== 'custom') { st.page = 1; query() } })),
          ...custom,
          field('模型', inp('model', '模型名，支持部分匹配', 'qsh-models-dl')),
          field('密钥', select(st.token, [['', '全部密钥'], ...keys().map((k) => [k, k])], (v) => { st.token = v; st.page = 1; query() })),
          field('分组', select(st.group, groups, (v) => { st.group = v; st.page = 1; query() })),
          field('请求 ID', inp('rid', 'request id')),
          field('上游请求 ID', inp('urid', 'upstream request id'))),
        dl,
        h('div', { class: 'qsh-acts', style: { 'margin-top': '12px' } },
          h('button', { type: 'button', class: 'qsh-btn pri', onclick: () => { st.page = 1; query() } }, '查询'),
          h('button', { type: 'button', class: 'qsh-btn', onclick: () => { Object.assign(st, { type: 0, range: '7d', start: '', end: '', model: '', token: '', group: '', rid: '', urid: '', page: 1 }); save(); paintFilters(); query() } }, '重置'),
          h('span', { class: 'sp' }),
          h('button', { type: 'button', class: 'qsh-btn', disabled: !last?.items?.length, onclick: exportCsv }, '导出本页 CSV')),
      )
    }
    const save = () => app.prefs.set('hub.logs', { type: st.type, range: st.range === 'custom' ? '7d' : st.range, size: st.size })

    async function query() {
      ctl?.abort(); ctl = new AbortController()
      const sig = ctl.signal
      results.replaceChildren(c.wait('正在查询…'))
      statLine.replaceChildren()
      try {
        const [list, stat] = await Promise.all([
          app.request('GET', '/api/log/self?' + qs(true), { signal: sig }),
          app.request('GET', '/api/log/self/stat?' + qs(false), { signal: sig }).catch(() => null),
        ])
        if (sig.aborted || c.isDead()) return
        last = { items: list?.items || (Array.isArray(list) ? list : []), total: +list?.total || 0, capped: !!list?.total_capped, limit: list?.query_limit }
        paintStats(stat)
        paintResults()
        paintFilters()
      } catch (e) {
        if (e.name === 'AbortError' || c.isDead()) return
        results.replaceChildren(c.fail(e))
      }
    }
    function paintStats(stat) {
      const kpi = (l, v) => h('div', { class: 'qsh-kpi' }, h('span', {}, l), h('b', {}, v))
      statLine.replaceChildren(
        kpi('匹配记录', last.capped ? `${last.limit || last.total}+ 条` : `${c.fmt.num(last.total)} 条`),
        ...(stat ? [kpi('期间消耗', money(stat.quota)), kpi('RPM（近 60 秒）', c.fmt.num(stat.rpm)), kpi('TPM（近 60 秒）', c.fmt.num(stat.tpm))] : []),
      )
    }
    function paintResults() {
      const items = last.items
      if (!items.length) { results.replaceChildren(h('div', { class: 'qsh-empty' }, st.type === 5 ? '这段时间没有失败的请求。' : '没有符合条件的记录。')); return }
      const rows = items.map((l) => {
        const o = parseJSON(l.other)
        const rec = o.smart_router_receipt
        const err = l.type === 5
        const tok = (+l.prompt_tokens || 0) + (+l.completion_tokens || 0)
        return h('tr', { class: 'qsh-row', tabindex: '0', onclick: () => detail(c, l), onkeydown: (e) => { if (e.key === 'Enter') detail(c, l) } },
          h('td', { 'data-k': '', class: 'qsh-num' }, c.fmt.time((l.created_at || 0) * 1000)),
          h('td', { 'data-k': '' }, h('span', { class: 'qsh-tag ' + (TYPE_CLS[l.type] || '') }, TYPE_NAME[l.type] || l.type)),
          h('td', { 'data-k': '密钥', class: 'clip' }, l.token_name || '—'),
          h('td', { 'data-k': '', class: 'wide clip', title: err ? l.content : l.model_name },
            h('div', {}, l.model_name || (l.type === 2 || err ? '—' : ''), rec?.attempts?.length ? h('span', { class: 'qsh-tag ac', style: { 'margin-left': '6px' } }, `智能路由 · ${rec.attempts.length} 次`) : null),
            err || (!l.model_name && l.content) ? h('div', { class: 'qsh-sm ' + (err ? 'qsh-bad' : 'qsh-mute'), style: { 'white-space': 'normal' } }, String(l.content || '').slice(0, 160)) : null),
          h('td', { 'data-k': '分组', class: 'clip' }, rec?.final_group || l.group || '—'),
          h('td', { 'data-k': '用时', class: 'r qsh-num' }, l.use_time ? l.use_time + 's' : '—', o.frt ? h('div', { class: 'qsh-sm qsh-mute' }, '首字 ' + ms(o.frt)) : null, l.is_stream ? h('div', { class: 'qsh-sm qsh-mute' }, '流式') : null),
          h('td', { 'data-k': 'Tokens', class: 'r qsh-num' }, tok ? `${c.fmt.compact(l.prompt_tokens)} / ${c.fmt.compact(l.completion_tokens)}` : '—'),
          h('td', { 'data-k': '花费', class: 'r qsh-num' }, l.quota ? money(l.quota) : '—'),
        )
      })
      const pages = Math.max(1, Math.ceil(last.total / st.size))
      results.replaceChildren(
        h('div', { class: 'qsh-scroll' }, h('table', { class: 'qsh-tbl rsp' },
          h('thead', {}, h('tr', {}, ['时间', '类型', '密钥', '模型 / 内容', '分组', '用时', '输入 / 输出', '花费'].map((t, i) => h('th', { class: i >= 5 ? 'r' : '' }, t)))),
          h('tbody', {}, rows))),
        h('div', { class: 'qsh-pager' },
          h('span', { class: 'qsh-mute' }, '点任意一行查看完整详情'), h('span', { style: { flex: '1' } }),
          h('button', { type: 'button', class: 'qsh-btn sm', disabled: st.page <= 1, onclick: () => { st.page--; query() } }, '上一页'),
          h('span', { class: 'qsh-num' }, `${st.page} / ${pages}`),
          h('button', { type: 'button', class: 'qsh-btn sm', disabled: st.page >= pages, onclick: () => { st.page++; query() } }, '下一页'),
          select(String(st.size), [['20', '20 条/页'], ['50', '50 条/页'], ['100', '100 条/页']], (v) => { st.size = +v; st.page = 1; save(); query() })),
      )
    }
    function exportCsv() {
      if (!last?.items?.length) return
      const head = ['时间', '类型', '密钥', '模型', '分组', '输入tokens', '输出tokens', '花费', '用时(s)', '流式', '请求ID', '上游请求ID', '内容']
      const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
      const lines = [head.map(cell).join(',')].concat(last.items.map((l) => [fullTime((l.created_at || 0) * 1000), TYPE_NAME[l.type] || l.type, l.token_name, l.model_name, l.group, l.prompt_tokens, l.completion_tokens, money(l.quota), l.use_time, l.is_stream ? '是' : '否', l.request_id, l.upstream_request_id, l.content].map(cell).join(',')))
      const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = `usage-${new Date().toISOString().slice(0, 10)}-p${st.page}.csv`
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    paintFilters()
    query()
    return { destroy() { ctl?.abort() } }
  }

  // Full record detail: billing breakdown, tokens, smart-routing attempts, stream status, raw data.
  function detail(c, l) {
    const { h, money, app } = c
    const o = parseJSON(l.other)
    const usd = (v) => c.fmt.money(v)
    c.dialog(`${TYPE_NAME[l.type] || '记录'} · ${l.model_name || fullTime((l.created_at || 0) * 1000)}`, (b) => {
      const kv = (pairs) => h('div', { class: 'qsh-kv' }, pairs.filter(([, v]) => v != null && v !== '' && v !== false).map(([k, v, cp]) => h('div', {}, h('span', {}, k), h('b', { class: cp ? 'qsh-mono' : '' }, v), cp ? h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => c.copy(String(v), k) }, '复制') : null)))
      const sec = (t, ...kids) => h('div', { class: 'qsh-sec' }, h('h4', {}, t), ...kids)
      const rec = o.smart_router_receipt
      const gr = o.user_group_ratio != null && o.user_group_ratio !== -1 ? +o.user_group_ratio : o.group_ratio != null ? +o.group_ratio : null
      b.append(
        h('div', { class: 'qsh-kpis' },
          h('div', { class: 'qsh-kpi' }, h('span', {}, '花费'), h('b', {}, l.quota ? money(l.quota) : '—')),
          h('div', { class: 'qsh-kpi' }, h('span', {}, '输入 tokens'), h('b', {}, c.fmt.num(l.prompt_tokens))),
          h('div', { class: 'qsh-kpi' }, h('span', {}, '输出 tokens'), h('b', {}, c.fmt.num(l.completion_tokens))),
          h('div', { class: 'qsh-kpi' }, h('span', {}, '用时'), h('b', {}, l.use_time ? l.use_time + ' 秒' : '—')),
          o.frt ? h('div', { class: 'qsh-kpi' }, h('span', {}, '首字时间'), h('b', {}, ms(o.frt))) : null),
        sec('基本信息', kv([
          ['时间', fullTime((l.created_at || 0) * 1000)], ['类型', TYPE_NAME[l.type] || String(l.type)], ['模型', l.model_name], ['密钥', l.token_name],
          ['分组', l.group], ['实际分组', rec?.final_group && rec.final_group !== l.group ? rec.final_group : null], ['流式', l.is_stream ? '是' : '否'], ['IP', l.ip],
          ['请求路径', o.request_path], ['请求 ID', l.request_id, true], ['上游请求 ID', l.upstream_request_id, true],
        ])),
      )
      if (l.type === 2 || l.type === 5 || l.type === 6) b.append(sec('计费明细', billing()))
      const tk = Object.entries(o).filter(([k, v]) => /tokens?$/.test(k) && typeof v === 'number' && v > 0)
      if (tk.length) b.append(sec('Token 细分', kv(tk.map(([k, v]) => [TOKEN_LABEL[k] || k, c.fmt.num(v)]))))
      if (rec?.attempts?.length) {
        b.append(sec(`智能路由（${rec.completed ? '已完成' : '未完成'}，最终分组 ${rec.final_group || '—'}）`, h('div', { class: 'qsh-scroll' }, h('table', { class: 'qsh-tbl' },
          h('thead', {}, h('tr', {}, ['#', '分组', '倍率', '计价', '准入', '结果', '状态码', '是否计费'].map((t) => h('th', {}, t)))),
          h('tbody', {}, rec.attempts.map((a) => h('tr', {},
            h('td', {}, a.attempt), h('td', {}, a.group), h('td', { class: 'qsh-num' }, ratioX(a.ratio_ppm)), h('td', { class: 'qsh-sm' }, priceText(a.price)),
            h('td', { class: 'qsh-sm' }, a.admission || '—'), h('td', {}, h('span', { class: 'qsh-tag ' + (/success/.test(a.outcome) ? 'ok' : a.outcome ? 'bad' : '') }, OUTCOME[a.outcome] || a.outcome || (a.committed ? '成功' : '—'))),
            h('td', { class: 'qsh-num' }, a.status_code || '—'), h('td', {}, a.committed ? '是' : '否'))))))))
      }
      if (o.stream_status) b.append(sec('流状态', h('pre', { class: 'qsh-pre' }, typeof o.stream_status === 'string' ? o.stream_status : JSON.stringify(o.stream_status, null, 2))))
      if (o.reject_reason || o.violation_fee) b.append(sec('拦截 / 违规', kv([['原因', o.reject_reason], ['违规费用', o.violation_fee ? money(o.violation_fee) : null]])))
      if (l.content) b.append(sec(l.type === 5 ? '错误信息' : '内容', h('pre', { class: 'qsh-pre' + (l.type === 5 ? ' qsh-bad' : '') }, l.content)))
      const raw = JSON.stringify({ ...l, other: o }, null, 2)
      b.append(h('details', { class: 'qsh-sec' }, h('summary', {}, '全部原始字段'), h('div', { class: 'qsh-acts', style: { margin: '6px 0' } }, h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => c.copy(raw, '原始记录') }, '复制 JSON')), h('pre', { class: 'qsh-pre' }, raw)))

      function billing() {
        const rows = []
        const modelPrice = o.model_price != null ? +o.model_price : -1
        if (modelPrice >= 0 && (o.model_ratio == null || modelPrice > 0)) {
          rows.push(`按次计费：模型价格 ${usd(modelPrice)}${gr != null ? ` × 分组倍率 ${gr}` : ''} = ${usd(modelPrice * (gr ?? 1))}`)
        } else if (o.model_ratio != null) {
          const inP = +o.model_ratio * 2, outP = inP * (+o.completion_ratio || 1)
          const cache = +o.cache_tokens || 0, cacheW = +o.cache_creation_tokens || 0
          const plain = Math.max(0, (+l.prompt_tokens || 0) - cache - cacheW)
          const parts = [`输入 ${c.fmt.num(plain)} × ${usd(inP)}/M`]
          if (cache) parts.push(`缓存读 ${c.fmt.num(cache)} × ${usd(inP * (+o.cache_ratio || 1))}/M`)
          if (cacheW) parts.push(`缓存写 ${c.fmt.num(cacheW)} × ${usd(inP * (+o.cache_creation_ratio || 1))}/M`)
          parts.push(`输出 ${c.fmt.num(l.completion_tokens)} × ${usd(outP)}/M`)
          const base = (plain * inP + cache * inP * (+o.cache_ratio || 1) + cacheW * inP * (+o.cache_creation_ratio || 1) + (+l.completion_tokens || 0) * outP) / 1e6
          rows.push(`按量计费：（${parts.join(' + ')}）${gr != null ? ` × 分组倍率 ${gr}` : ''} ≈ ${usd(base * (gr ?? 1))}`)
          rows.push(`模型倍率 ${o.model_ratio} · 补全倍率 ${o.completion_ratio ?? 1}${o.cache_ratio != null ? ' · 缓存倍率 ' + o.cache_ratio : ''}${o.cache_creation_ratio != null ? ' · 缓存写入倍率 ' + o.cache_creation_ratio : ''}`)
        }
        rows.push(`实际扣费：${l.quota ? money(l.quota) : '0'}（以这一项为准；图片、音频、联网搜索等附加项会另外计入）`)
        const extra = Object.entries(o).filter(([k, v]) => (/ratio|price|fee|subscription|billing|quota/i.test(k)) && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'))
        return h('div', {},
          h('div', { class: 'qsh-calc' }, rows.map((r) => h('div', {}, r))),
          extra.length ? h('details', {}, h('summary', {}, '全部计费字段'), kv(extra.map(([k, v]) => [k, String(v)]))) : null)
      }
    })
  }
  const TOKEN_LABEL = { cache_tokens: '缓存读取', cache_creation_tokens: '缓存写入', cache_creation_tokens_5m: '缓存写入（5 分钟）', cache_creation_tokens_1h: '缓存写入（1 小时）', image_output_tokens: '图片输出', audio_input_tokens: '音频输入', audio_output_tokens: '音频输出', text_input_tokens: '文本输入', text_output_tokens: '文本输出', reasoning_tokens: '推理', web_search_tokens: '联网搜索' }
  function priceText(p) {
    if (!p) return '—'
    const mode = { fixed_price: '按次', ratio: '按量', per_second: '按秒' }[p.billing_mode] || p.billing_mode || ''
    return mode + (p.score_ppm ? ' · 价格分 ' + +(p.score_ppm / 1e6).toFixed(3) : '')
  }

  // ======================================================================= rank
  function rankView(c, root) {
    const { app, h } = c
    let period = app.prefs.get('hub.rank.period', 'week'), ctl = null
    const el = c.box()
    root.append(el)
    const head = h('div', { class: 'qsh-pnl' })
    const body = h('div', { style: { display: 'grid', gap: '14px' } })
    el.append(head, body)
    const PERIODS = [['today', '今天'], ['week', '本周'], ['month', '本月'], ['year', '今年']]
    function paintHead(d) {
      head.replaceChildren(h('div', { class: 'qsh-hd', style: { margin: '0' } },
        h('h3', {}, '模型排行榜'), h('span', { class: 'qsh-mute' }, '按全站调用 tokens 统计'), h('span', { class: 'sp' }),
        c.seg(PERIODS, period, (v) => { period = v; app.prefs.set('hub.rank.period', v); load() }, '统计周期')))
      if (d) head.append(h('div', { class: 'qsh-kpis', style: { 'margin-top': '12px' } },
        kpi('上榜模型', c.fmt.num(d.models?.length || 0)), kpi('厂商', c.fmt.num(d.vendors?.length || 0)),
        kpi('总 tokens', c.fmt.compact((d.vendors || []).reduce((a, v) => a + (+v.total_tokens || 0), 0))), kpi('第一名', d.models?.[0]?.model_name || '—')))
    }
    const kpi = (l, v) => h('div', { class: 'qsh-kpi' }, h('span', {}, l), h('b', { title: String(v) }, v))
    const growth = (g) => (g == null ? '' : h('span', { class: g >= 0 ? 'qsh-up' : 'qsh-down' }, (g >= 0 ? '↑' : '↓') + Math.abs(+g).toFixed(g > -10 && g < 10 ? 1 : 0) + '%'))
    const av = (name) => h('span', { class: 'qsh-av', 'aria-hidden': 'true' }, String(name || '?').slice(0, 1).toUpperCase())
    async function load() {
      ctl?.abort(); ctl = new AbortController()
      paintHead(null); body.replaceChildren(c.wait())
      try {
        const d = await app.request('GET', '/api/rankings?period=' + period, { anon: true, signal: ctl.signal })
        if (c.isDead()) return
        paintHead(d); paint(d || {})
      } catch (e) { if (e.name !== 'AbortError' && !c.isDead()) body.replaceChildren(c.fail(e)) }
    }
    function paint(d) {
      const models = d.models || [], vendors = d.vendors || []
      if (!models.length) { body.replaceChildren(h('div', { class: 'qsh-pnl qsh-empty' }, '这个周期还没有调用数据。')); return }
      const mh = d.models_history || {}, vh = d.vendor_share_history || {}
      const top = (mh.models || []).slice(0, 8).map((m) => m.name)
      body.replaceChildren(
        h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, '热门模型走势'), h('span', { class: 'qsh-mute qsh-sm' }, 'tokens / 时间段')), stacked(c, mh.points || [], 'model', top, 'tokens')),
        h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, '模型榜')), h('div', { class: 'qsh-scroll' }, h('table', { class: 'qsh-tbl rsp' },
          h('thead', {}, h('tr', {}, ['#', '模型', '厂商', 'tokens', '占比', '变化'].map((t, i) => h('th', { class: i >= 3 ? 'r' : '' }, t)))),
          h('tbody', {}, models.map((m) => h('tr', {},
            h('td', { class: 'qsh-num' }, m.rank, m.previous_rank && m.previous_rank !== m.rank ? h('span', { class: 'qsh-sm ' + (m.previous_rank > m.rank ? 'qsh-up' : 'qsh-down'), style: { 'margin-left': '4px' } }, m.previous_rank > m.rank ? '▲' + (m.previous_rank - m.rank) : '▼' + (m.rank - m.previous_rank)) : null),
            h('td', { 'data-k': '', class: 'wide' }, h('b', { style: { 'font-weight': '500' } }, m.model_name)),
            h('td', { 'data-k': '' }, h('span', { style: { display: 'inline-flex', gap: '6px', 'align-items': 'center' } }, av(m.vendor), m.vendor || '—')),
            h('td', { 'data-k': 'tokens', class: 'r qsh-num' }, c.fmt.compact(m.total_tokens)),
            h('td', { 'data-k': '占比', class: 'r' }, h('div', { style: { display: 'flex', gap: '8px', 'align-items': 'center', 'justify-content': 'flex-end' } }, h('div', { class: 'qsh-bar', style: { width: '80px' } }, h('i', { style: { width: Math.max(2, (+m.share || 0) * 100) + '%' } })), h('span', { class: 'qsh-num' }, ((+m.share || 0) * 100).toFixed(1) + '%'))),
            h('td', { 'data-k': '', class: 'r qsh-num' }, growth(m.growth_pct)))))))),
        h('div', { class: 'qsh-two' },
          moverList('上升最快', d.top_movers || [], true), moverList('下降最快', d.top_droppers || [], false)),
        h('div', { class: 'qsh-two' },
          h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, '厂商份额走势')), stacked(c, vh.points || [], 'vendor', (vh.vendors || []).slice(0, 8).map((v) => v.name), 'share')),
          h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, '厂商榜')), vendors.map((v) => h('div', { class: 'qsh-li' },
            h('span', { class: 'rk' }, v.rank), av(v.vendor),
            h('div', { class: 'nm' }, h('div', {}, v.vendor || '—'), h('div', { class: 'qsh-sm qsh-mute' }, `${v.models_count || 0} 个模型 · 最热 ${v.top_model || '—'}`)),
            h('div', { style: { 'text-align': 'right' } }, h('div', { class: 'qsh-num' }, c.fmt.compact(v.total_tokens)), h('div', { class: 'qsh-sm qsh-mute' }, ((+v.share || 0) * 100).toFixed(1) + '% ', growth(v.growth_pct))))))),
      )
    }
    function moverList(title, list, up) {
      return h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, title)),
        list.length ? list.slice(0, 8).map((m) => h('div', { class: 'qsh-li' }, h('span', { class: 'rk' }, '#' + (m.current_rank || '—')), h('div', { class: 'nm' }, m.model_name, h('span', { class: 'qsh-sm qsh-mute' }, '  ' + (m.vendor || ''))),
          h('span', { class: up ? 'qsh-up' : 'qsh-down' }, `${up ? '▲' : '▼'}${Math.abs(+m.rank_delta || 0)}`), m.growth_pct != null ? h('span', { class: 'qsh-sm qsh-mute' }, (+m.growth_pct).toFixed(0) + '%') : null))
          : h('div', { class: 'qsh-empty' }, '暂无变化'))
    }
    load()
    return { destroy() { ctl?.abort() } }
  }

  // Stacked columns per time bucket; series beyond `keys` fold into 其他.
  function stacked(c, points, by, keys, metric) {
    const { h } = c
    const buckets = [], idx = {}
    for (const p of points) {
      if (!(p.ts in idx)) { idx[p.ts] = buckets.length; buckets.push({ ts: p.ts, label: p.label || String(p.ts).slice(5, 10), v: {} }) }
      const k = keys.includes(p[by]) ? p[by] : '其他'
      const b = buckets[idx[p.ts]]
      b.v[k] = (b.v[k] || 0) + (+p[metric] || 0)
    }
    buckets.sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
    const series = [...keys, ...(buckets.some((b) => b.v['其他']) ? ['其他'] : [])]
    if (!buckets.length) return h('div', { class: 'qsh-empty' }, '暂无数据')
    const W = 640, H = 200, padL = 6, padB = 22, n = buckets.length
    const max = Math.max(...buckets.map((b) => series.reduce((a, s) => a + (b.v[s] || 0), 0)), 1e-9)
    const bw = Math.max(4, Math.min(56, (W - padL) / n * 0.7)), step = (W - padL) / n
    let svgs = ''
    buckets.forEach((b, i) => {
      let y = H - padB
      const x = padL + i * step + (step - bw) / 2
      series.forEach((s, si) => {
        const v = b.v[s] || 0
        if (!v) return
        const hgt = (v / max) * (H - padB - 8)
        y -= hgt
        svgs += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, hgt).toFixed(1)}" rx="2" style="fill:${PALETTE[si % PALETTE.length]};opacity:${s === '其他' ? 0.45 : 0.92}"><title>${esc(b.label)} · ${esc(s)}: ${metric === 'share' ? (v * 100).toFixed(1) + '%' : c.fmt.compact(v)}</title></rect>`
      })
      if (n <= 14 || i % Math.ceil(n / 12) === 0) svgs += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`
    })
    return h('div', {},
      c.app.svg(`<svg class="qsh-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="走势图">${svgs}</svg>`),
      h('div', { class: 'qsh-legend' }, series.map((s, si) => h('span', {}, h('i', { style: { background: PALETTE[si % PALETTE.length], opacity: s === '其他' ? '.45' : '1' } }), s))))
  }
  function spark(c, values, opts = {}) {
    const W = 600, H = opts.h || 70
    const vals = values.map((v) => (v == null ? null : +v))
    const max = Math.max(...vals.filter((v) => v != null), opts.min || 0, 1e-9)
    const n = vals.length || 1, bw = W / n
    let s = ''
    vals.forEach((v, i) => { if (v == null) return; const hh = Math.max(1, (v / max) * (H - 4)); s += `<rect x="${(i * bw + bw * 0.12).toFixed(1)}" y="${(H - hh).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" style="fill:${opts.color || 'var(--qs-ac)'};opacity:.85"/>` })
    return c.app.svg(`<svg class="qsh-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${s}</svg>`)
  }

  // ======================================================================= smart
  function smartView(c, root) {
    const { app, h } = c
    const el = c.box()
    root.append(el)
    let tab = app.prefs.get('hub.smart.tab', 'mine'), opt = null, inner = null
    const TABS = [['mine', '我的智能密钥'], ['board', '全站路由状态'], ['usage', '用量分析'], ['about', '分组与说明']]
    const head = h('div', { class: 'qsh-pnl' })
    const body = h('div', { style: { display: 'grid', gap: '14px' } })
    el.append(head, body)
    function paintHead() {
      head.replaceChildren(h('div', { class: 'qsh-hd', style: { margin: '0' } },
        h('h3', {}, '智能路由'),
        opt ? h('span', { class: 'qsh-tag ' + (opt.enabled ? 'ok' : 'bad') }, opt.enabled ? '已开启' : '站点未开启') : null,
        opt ? h('span', { class: 'qsh-mute qsh-sm' }, `${opt.model_count || 0} 个模型 · ${opt.route_count || 0} 条路线 · ${(opt.groups || []).length} 个分组`) : null,
        h('span', { class: 'sp' }),
        h('button', { type: 'button', class: 'qsh-btn pri sm', onclick: () => app.act.createKey() }, '新建密钥')),
        h('p', { class: 'qsh-mute qsh-sm', style: { margin: '8px 0 10px' } }, '智能密钥会按你的偏好在多个分组之间自动挑选线路：首选失败或不健康时自动切到下一个可用分组，不用自己盯着换分组。'),
        c.seg(TABS, tab, (v) => { tab = v; app.prefs.set('hub.smart.tab', v); paintHead(); paintBody() }, '智能路由页面'))
    }
    function paintBody() {
      try { inner?.destroy?.() } catch {}
      body.replaceChildren()
      inner = ({ mine: mineTab, board: boardTab, usage: usageTab, about: aboutTab }[tab] || mineTab)(c, body, opt) || {}
    }
    paintHead()
    body.append(c.wait())
    // Keys can still be in flight on a cold open; the mine/usage tabs need them.
    const keysP = app.ensureKeys ? app.ensureKeys() : Promise.resolve(app.state.keys || [])
    Promise.all([get('/api/smart-router/options'), keysP]).then(([d]) => { if (c.isDead()) return; opt = d || {}; paintHead(); paintBody() }).catch((e) => { if (!c.isDead()) body.replaceChildren(c.fail(e)) })
    function get(p) { return app.request('GET', p) }
    return { destroy() { try { inner?.destroy?.() } catch {} } }
  }

  const smartKeys = (app) => (app.state.keys || []).filter((k) => k.smart)
  function keyPicker(c, cur, on) {
    const { h, app } = c
    const ks = smartKeys(app)
    if (!ks.length) return null
    return c.select(String(cur || ''), ks.map((k) => [String(k.id), `${k.name}${k.status === 'on' ? '' : '（停用）'}`]), (v) => on(+v), { style: { width: 'auto', 'min-width': '180px' } })
  }
  function noSmartKey(c) {
    const { h, app } = c
    return h('div', { class: 'qsh-pnl qsh-empty' }, h('p', {}, '你还没有智能路由密钥。'), h('button', { type: 'button', class: 'qsh-btn pri', onclick: () => app.act.createKey() }, '新建智能密钥'))
  }
  function policySummary(c, k) {
    const { h } = c
    const p = parseJSON(k.raw?.routing_policy)
    const st = STRATEGY.find(([v]) => v === p.strategy)?.[1] || p.strategy || '—'
    const scope = p.allow_future_groups ? '全部可用分组' + (p.excluded_groups?.length ? `（排除 ${p.excluded_groups.length} 个）` : '') : `指定 ${p.manual_group_order?.length || 0} 个分组`
    return h('div', { class: 'qsh-sum' },
      h('span', { class: 'qsh-tag ac' }, '偏好：' + st), h('span', { class: 'qsh-tag' }, '范围：' + scope),
      h('span', { class: 'qsh-tag' }, '最多尝试 ' + (p.max_attempts || 3) + ' 次'), h('span', { class: 'qsh-tag' }, '价格上限 ' + (p.max_effective_ratio_ppm ? ratioX(p.max_effective_ratio_ppm) : '跟随站点')),
      p.health_guard ? h('span', { class: 'qsh-tag ok' }, '健康保护') : null, p.affinity_enabled ? h('span', { class: 'qsh-tag' }, '会话粘性') : null,
      p.ttft_policy?.enabled ? h('span', { class: 'qsh-tag' }, '首字 ≤ ' + ms(p.ttft_policy.target_ms)) : null)
  }

  // A paged model×endpoint index (per key or site-wide) with drill-down to route candidates.
  function modelIndex(c, host, { base, extra = '', onOpen }) {
    const { h, app } = c
    const st = { q: '', status: '', page: 1, size: 20 }
    let ctl = null
    const bar = h('div', { class: 'qsh-acts', style: { 'margin-bottom': '10px' } })
    const out = h('div', {})
    host.append(bar, out)
    const q = h('input', { placeholder: '搜索模型', style: { width: '220px' }, onkeydown: (e) => { if (e.key === 'Enter') { st.q = q.value.trim(); st.page = 1; load() } } })
    bar.append(q, c.select('', [['', '全部状态'], ['available', '可用'], ['degraded', '降级'], ['recovering', '恢复中'], ['needs_review', '待复核'], ['pending_sample', '待采样'], ['unavailable', '不可用']], (v) => { st.status = v; st.page = 1; load() }, { style: { width: 'auto' } }),
      h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => { st.q = q.value.trim(); st.page = 1; load() } }, '搜索'))
    async function load() {
      ctl?.abort(); ctl = new AbortController()
      out.replaceChildren(c.wait())
      try {
        const p = new URLSearchParams({ p: String(st.page), page_size: String(st.size) })
        if (st.q) p.set('q', st.q)
        if (st.status) p.set('status', st.status)
        const d = await app.request('GET', `${base}?${p}${extra}`, { signal: ctl.signal })
        if (c.isDead()) return
        const items = d?.items || []
        if (!items.length) { out.replaceChildren(h('div', { class: 'qsh-empty' }, '没有匹配的模型。')); return }
        const pages = Math.max(1, Math.ceil((+d.total || 0) / st.size))
        out.replaceChildren(
          h('div', { class: 'qsh-scroll' }, h('table', { class: 'qsh-tbl rsp' },
            h('thead', {}, h('tr', {}, ['模型', '接口', '状态', '分组（可用 / 总数）', '最低可用倍率', ''].map((t) => h('th', {}, t)))),
            h('tbody', {}, items.map((m) => h('tr', { class: 'qsh-row', tabindex: '0', onclick: () => onOpen(m), onkeydown: (e) => { if (e.key === 'Enter') onOpen(m) } },
              h('td', { 'data-k': '', class: 'wide' }, h('b', { style: { 'font-weight': '500' } }, m.display_name || m.model), h('div', { class: 'qsh-sm qsh-mute' }, m.family || '')),
              h('td', { 'data-k': '', class: 'qsh-sm qsh-mono' }, m.endpoint),
              h('td', { 'data-k': '' }, stateTag(h, m.primary_state)),
              h('td', { 'data-k': '分组', class: 'qsh-num' }, `${m.dispatch_eligible_groups ?? m.available_groups ?? 0} / ${m.group_count ?? 0}`, m.in_scope_group_count != null && extra ? h('div', { class: 'qsh-sm qsh-mute' }, `密钥范围内 ${m.in_scope_group_count}`) : null),
              h('td', { 'data-k': '最低倍率', class: 'qsh-num' }, m.lowest_eligible_known ? ratioX(m.lowest_eligible_ratio_ppm) : m.lowest_ratio_known ? h('span', { class: 'qsh-mute' }, ratioX(m.lowest_ratio_ppm) + '（不可选）') : '—'),
              h('td', { 'data-k': '' }, h('span', { class: 'qsh-mute' }, '详情 ›'))))))),
          h('div', { class: 'qsh-pager' }, h('span', { class: 'qsh-mute qsh-sm' }, `共 ${d.total || 0} 项${d.updated_at_ms ? ' · 更新于 ' + c.fmt.time(d.updated_at_ms) : ''}`), h('span', { style: { flex: '1' } }),
            h('button', { type: 'button', class: 'qsh-btn sm', disabled: st.page <= 1, onclick: () => { st.page--; load() } }, '上一页'), h('span', { class: 'qsh-num' }, `${st.page} / ${pages}`),
            h('button', { type: 'button', class: 'qsh-btn sm', disabled: st.page >= pages, onclick: () => { st.page++; load() } }, '下一页')))
      } catch (e) { if (e.name !== 'AbortError' && !c.isDead()) out.replaceChildren(c.fail(e)) }
    }
    load()
    return { reload: load, destroy() { ctl?.abort() } }
  }

  function routeDetail(c, path, title) {
    const { h, app } = c
    c.dialog(title, async (b) => {
      b.append(c.wait())
      try {
        const d = await app.request('GET', path)
        b.lastChild.remove()
        const pref = d.preference, sum = d.summary || {}, ep = d.effective_policy || {}
        b.append(
          h('div', { class: 'qsh-kpis' },
            kp('当前首选', pref?.group || (d.plan_error_code ? '无可用路线' : '—')), kp('首选倍率', pref ? ratioX(pref.effective_ratio_ppm) : '—'),
            kp('候选分组', `${d.coverage?.candidate_routes ?? 0} / ${sum.groups ?? 0}`), kp('健康分组', sum.healthy_groups ?? 0), kp('待采样', sum.pending_sample_groups ?? 0),
            kp('偏好', STRATEGY.find(([v]) => v === ep.strategy)?.[1] || ep.strategy || '—')),
          pref?.decision_reason ? h('p', { class: 'qsh-mute qsh-sm' }, '选择理由：' + reasonText(pref.decision_reason)) : null,
          d.plan_error_code ? h('p', { class: 'qsh-bad qsh-sm' }, '当前无法路由：' + reasonText(d.plan_error_code) + '（看下表每个分组被排除的原因）') : null,
          h('div', { class: 'qsh-scroll' }, h('table', { class: 'qsh-tbl rsp' },
            h('thead', {}, h('tr', {}, ['顺位', '分组', '倍率', '状态', '决定', '原因', '成功率', '首字', ''].map((t) => h('th', {}, t)))),
            h('tbody', {}, (d.items || []).map((it) => h('tr', {},
              h('td', { 'data-k': '', class: 'qsh-num' }, it.selection_rank || (it.selected ? '★' : '—')),
              h('td', { 'data-k': '', class: 'wide' }, h('b', { style: { 'font-weight': '500' } }, it.group)),
              h('td', { 'data-k': '倍率', class: 'qsh-num' }, ratioX(it.effective_ratio_ppm)),
              h('td', { 'data-k': '' }, stateTag(h, it.health_state || it.primary_state)),
              h('td', { 'data-k': '' }, h('span', { class: 'qsh-tag ' + (it.decision === 'selected' ? 'ok' : it.decision === 'rejected' ? 'bad' : '') }, { selected: '入选', rejected: '排除', candidate: '候选', skipped: '跳过' }[it.decision] || it.decision || '—')),
              h('td', { 'data-k': '', class: 'qsh-sm wide' }, reasonText(it.reason_code || it.skipped_reason)),
              h('td', { 'data-k': '成功率', class: 'qsh-num' }, it.success_rate != null ? (it.success_rate * 100).toFixed(1) + '%' : it.evidence?.sample_count ? '—' : '无样本'),
              h('td', { 'data-k': '首字', class: 'qsh-num' }, it.recent_ttft_average_ms != null ? ms(it.recent_ttft_average_ms) + (it.recent_ttft_source === 'system_reference' ? '*' : '') : '—'),
              h('td', { 'data-k': '' }, it.detail_id ? h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => routeAnalytics(c, it.detail_id, `${d.model} · ${it.group}`) }, '走势') : null)))))),
          h('p', { class: 'qsh-mute qsh-sm' }, '* 还没有真实样本时，首字时间用系统参考值。状态每隔几分钟更新一次。'),
        )
      } catch (e) { b.lastChild?.remove(); b.append(c.fail(e)) }
      function kp(l, v) { return h('div', { class: 'qsh-kpi' }, h('span', {}, l), h('b', { title: String(v) }, v)) }
    })
  }

  function routeAnalytics(c, id, title) {
    const { h, app } = c
    c.dialog('线路走势 · ' + title, (b) => {
      let range = '24h'
      const body = h('div', {})
      const RANGES3 = [['1h', '1 小时'], ['24h', '24 小时'], ['3d', '3 天']]
      let segEl = null
      const pick = (v) => { range = v; const n = c.seg(RANGES3, range, pick); segEl.replaceWith(n); segEl = n; load() }
      segEl = c.seg(RANGES3, range, pick)
      b.append(segEl, body)
      async function load() {
        body.replaceChildren(c.wait())
        try {
          const d = await app.request('GET', `/api/smart-router/leaderboard/routes/${encodeURIComponent(id)}/analytics?range=${range}`)
          const s = d.summary || {}, pts = d.points || []
          const kp = (l, v) => h('div', { class: 'qsh-kpi' }, h('span', {}, l), h('b', {}, v))
          body.replaceChildren(
            h('div', { class: 'qsh-kpis', style: { margin: '12px 0' } },
              kp('请求', c.fmt.num(s.logical_requests)), kp('最终可用率', pctPPM(s.final_availability_rate_ppm)), kp('首次命中', pctPPM(s.first_hit_success_rate_ppm)),
              kp('重试救回', c.fmt.num(s.retry_recoveries)), kp('确认失败', c.fmt.num(s.confirmed_failures)), kp('首字 P50 / P95', `${ms(s.ttft_p50_ms)} / ${ms(s.ttft_p95_ms)}`),
              kp('缓存命中', pctPPM(s.cache_rate_ppm)), kp('探测 成功/失败', `${s.probe_successes || 0} / ${s.probe_failures || 0}`)),
            h('div', { class: 'qsh-sec' }, h('h4', {}, '请求量'), spark(c, pts.map((p) => p.logical_requests))),
            h('div', { class: 'qsh-sec' }, h('h4', {}, '确认失败'), spark(c, pts.map((p) => p.confirmed_failures), { color: 'var(--h-bad)' })),
            h('p', { class: 'qsh-mute qsh-sm' }, `当前状态：${(STATE[d.current_state] || [d.current_state])[0] || '—'} · 分组倍率 ${ratioX(d.group_ratio_ppm)}${d.coverage?.partial ? ' · 数据还在汇总（可能略有延迟）' : ''}`),
          )
        } catch (e) { body.replaceChildren(c.fail(e)) }
      }
      load()
    })
  }

  function mineTab(c, host) {
    const { h, app } = c
    const ks = smartKeys(app)
    if (!ks.length) { host.append(noSmartKey(c)); return }
    let kid = app.prefs.get('hub.smart.key', ks[0].id)
    if (!ks.some((k) => k.id === kid)) kid = ks[0].id
    const k = ks.find((x) => x.id === kid)
    const pnl = h('div', { class: 'qsh-pnl' })
    host.append(pnl)
    pnl.append(
      h('div', { class: 'qsh-hd' }, h('h4', {}, '密钥'), keyPicker(c, kid, (v) => { app.prefs.set('hub.smart.key', v); host.replaceChildren(); idx?.destroy(); mineTab(c, host) }), h('span', { class: 'sp' }),
        h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => app.act.editKey(k).then(() => { if (!c.isDead()) { host.replaceChildren(); mineTab(c, host) } }) }, '编辑路由策略'),
        h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => app.act.copyKey(k) }, '复制密钥')),
      policySummary(c, k),
      h('p', { class: 'qsh-mute qsh-sm', style: { margin: '10px 0' } }, '下面是这个密钥对每个模型的实时路由预览：点开可以看到每个分组是否会被选中、为什么。'))
    const idx = modelIndex(c, pnl, { base: '/api/smart-router/status/models', extra: '&token_id=' + kid, onOpen: (m) => routeDetail(c, `/api/smart-router/status?token_id=${kid}&model=${encodeURIComponent(m.model)}&endpoint=${encodeURIComponent(m.endpoint || '')}`, `${m.display_name || m.model} · ${m.endpoint}`) })
    return { destroy() { idx?.destroy() } }
  }
  function boardTab(c, host) {
    const { h } = c
    const pnl = h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, '全站路由状态'), h('span', { class: 'qsh-mute qsh-sm' }, '不限密钥，按站点默认上限展示每个模型在各分组的健康和价格')))
    host.append(pnl)
    const idx = modelIndex(c, pnl, { base: '/api/smart-router/leaderboard/models', onOpen: (m) => routeDetail(c, `/api/smart-router/leaderboard/status?model=${encodeURIComponent(m.model)}&endpoint=${encodeURIComponent(m.endpoint || '')}`, `${m.display_name || m.model} · ${m.endpoint}`) })
    return { destroy() { idx.destroy() } }
  }
  function usageTab(c, host) {
    const { h, app, money } = c
    const ks = smartKeys(app)
    if (!ks.length) { host.append(noSmartKey(c)); return }
    let kid = app.prefs.get('hub.smart.key', ks[0].id), range = '1d', ctl = null
    if (!ks.some((k) => k.id === kid)) kid = ks[0].id
    const pnl = h('div', { class: 'qsh-pnl' }), out = h('div', {})
    host.append(pnl)
    const paint = () => {
      pnl.replaceChildren(h('div', { class: 'qsh-hd' }, h('h4', {}, '用量分析'), keyPicker(c, kid, (v) => { kid = v; app.prefs.set('hub.smart.key', v); paint() }), h('span', { class: 'sp' }),
        c.seg([['1h', '1 小时'], ['1d', '1 天'], ['7d', '7 天']], range, (v) => { range = v; paint() })), out)
      load()
    }
    async function load() {
      ctl?.abort(); ctl = new AbortController()
      out.replaceChildren(c.wait())
      try {
        const d = await app.request('GET', `/api/smart-router/usage-analytics?token_id=${kid}&range=${range}`, { signal: ctl.signal })
        if (c.isDead()) return
        const s = d.summary || {}, pts = d.points || []
        const kp = (l, v) => h('div', { class: 'qsh-kpi' }, h('span', {}, l), h('b', {}, v))
        const brk = (title, rows) => rows?.length ? h('div', { class: 'qsh-sec' }, h('h4', {}, title), h('div', { class: 'qsh-scroll' }, h('table', { class: 'qsh-tbl' },
          h('thead', {}, h('tr', {}, ['名称', '请求', '成功率', '净花费', '输入 / 输出'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
          h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.model || r.group || r.name || '—'), h('td', { class: 'r qsh-num' }, c.fmt.num(r.logical_requests ?? r.requests)), h('td', { class: 'r qsh-num' }, pctPPM(r.success_rate_ppm)),
            h('td', { class: 'r qsh-num' }, money(r.net_quota)), h('td', { class: 'r qsh-num' }, `${c.fmt.compact(r.input_tokens)} / ${c.fmt.compact(r.output_tokens)}`))))))) : null
        out.replaceChildren(
          h('div', { class: 'qsh-kpis', style: { margin: '6px 0 12px' } },
            kp('请求', c.fmt.num(s.logical_requests)), kp('成功率', pctPPM(s.success_rate_ppm)), kp('失败', c.fmt.num(s.failures)), kp('净花费', money(s.net_quota)),
            kp('退款', money(s.refund_quota)), kp('缓存命中', pctPPM(s.cache_rate_ppm)), kp('首字 P50 / P95', `${ms(s.ttft_p50_ms)} / ${ms(s.ttft_p95_ms)}`), kp('输入 / 输出', `${c.fmt.compact(s.input_tokens)} / ${c.fmt.compact(s.output_tokens)}`)),
          s.has_samples ? null : h('p', { class: 'qsh-mute' }, '这段时间这个密钥还没有请求。'),
          h('div', { class: 'qsh-sec' }, h('h4', {}, '请求量'), spark(c, pts.map((p) => p.logical_requests))),
          h('div', { class: 'qsh-sec' }, h('h4', {}, '失败'), spark(c, pts.map((p) => p.failures), { color: 'var(--h-bad)' })),
          brk('按模型', d.models), brk('按分组', d.groups),
          d.coverage?.partial ? h('p', { class: 'qsh-mute qsh-sm' }, '最近几分钟的数据还在汇总，稍后刷新会更完整。') : null)
      } catch (e) { if (e.name !== 'AbortError' && !c.isDead()) out.replaceChildren(c.fail(e)) }
    }
    paint()
    return { destroy() { ctl?.abort() } }
  }
  function aboutTab(c, host, opt) {
    const { h } = c
    const groups = [...(opt?.groups || [])].sort((a, b) => (a.effective_ratio_ppm || 0) - (b.effective_ratio_ppm || 0))
    host.append(
      h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, '智能密钥怎么工作')),
        h('div', { class: 'qsh-calc' },
          h('div', {}, '1. 每次请求，系统先找出这个模型在你允许的分组里所有可用线路。'),
          h('div', {}, '2. 按你选的「选路偏好」排序：价格最低、稳定优先、首字最快、均衡、自定义权重或手动顺序。'),
          h('div', {}, '3. 先发给第一名；如果它在开始生成前就报错（比如上游没号、限流），自动换下一名，最多尝试你设定的次数。'),
          h('div', {}, '4. 已经开始生成或结果未知的请求不会重复扣费重试；失败多的线路会被暂时跳过，恢复后自动回来。'),
          h('div', {}, `站点设置：每个请求最多尝试 ${opt?.max_attempts ?? '—'} 次，价格上限默认 ${ratioX(opt?.default_max_effective_ratio_ppm)}、最高 ${ratioX(opt?.absolute_max_effective_ratio_ppm)}。`))),
      h('div', { class: 'qsh-pnl' }, h('div', { class: 'qsh-hd' }, h('h4', {}, '可路由的分组'), h('span', { class: 'qsh-mute qsh-sm' }, '倍率越低越便宜')),
        groups.length ? h('div', { class: 'qsh-scroll' }, h('table', { class: 'qsh-tbl rsp' },
          h('thead', {}, h('tr', {}, ['分组', '倍率', '模型数', '健康线路', '状态'].map((t) => h('th', {}, t)))),
          h('tbody', {}, groups.map((g) => h('tr', {},
            h('td', { 'data-k': '', class: 'wide' }, h('b', { style: { 'font-weight': '500' } }, g.group), g.description && g.description !== g.group ? h('div', { class: 'qsh-sm qsh-mute' }, g.description) : null),
            h('td', { 'data-k': '倍率', class: 'qsh-num' }, ratioX(g.effective_ratio_ppm)), h('td', { 'data-k': '模型', class: 'qsh-num' }, g.supported_model_count ?? '—'),
            h('td', { 'data-k': '健康', class: 'qsh-num' }, `${g.healthy_route_count ?? 0} / ${g.route_count ?? 0}`), h('td', { 'data-k': '' }, stateTag(h, g.health_status))))))) : h('div', { class: 'qsh-empty' }, '暂无分组'),
      ))
  }

  // ======================================================================= editor
  function editorView(c, root, opts) {
    const { app, h, field, select } = c
    const k = opts.key || null
    const done = opts.done || (() => {})
    const el = c.box('qsh-ed')
    root.append(el)
    el.append(c.wait('正在准备…'))
    let opt = null, models = [], saving = false
    Promise.all([
      app.request('GET', '/api/smart-router/options').catch(() => null),
      app.request('GET', '/api/user/models').catch(() => []),
    ]).then(([o, m]) => { if (c.isDead()) return; opt = o; models = Array.isArray(m) ? m : []; init() })

    let F
    function init() {
      const isSmart = !!(k && k.group === 'auto' && k.routing_policy)
      const smartOn = !!opt?.enabled
      const base = k?.routing_policy ? parseJSON(k.routing_policy) : JSON.parse(JSON.stringify(opt?.default_policy || {}))
      const P = normPolicy(base)
      if (k && Object.prototype.hasOwnProperty.call(k, 'media_policy')) P.media_policy = typeof k.media_policy === 'string' ? parseJSON(k.media_policy) : k.media_policy
      const cur = app.currency
      F = {
        name: k ? k.name : opts.name || '我的密钥 ' + ((app.state.keys?.length || 0) + 1),
        mode: k ? (isSmart ? 'smart' : 'fixed') : smartOn && opt?.default_for_new_keys ? 'smart' : 'fixed',
        group: k && !isSmart ? k.group || '' : '',
        unlimited: k ? !!k.unlimited_quota : true,
        amount: k && !k.unlimited_quota ? String(+((k.remain_quota / (app.qpu || 500000)) * (cur.rate || 1)).toFixed(2)) : '',
        expire: k && k.expired_time > 0 ? localInput(k.expired_time * 1000) : '',
        limit: !!k?.model_limits_enabled, models: new Set(String(k?.model_limits || '').split(',').map((s) => s.trim()).filter(Boolean)),
        ips: k?.allow_ips || '', P, rawDirty: false, rawText: '', smartOn, modelQ: '',
      }
      F.scope = P.allow_future_groups ? 'all' : 'pick'
      paint()
    }
    function normPolicy(p) {
      const P = { version: 4, policy_id: '', enabled: true, strategy: 'price', pool_policy: '', order_mode: 'auto_price', manual_group_order: [], max_attempts: 3, failure_threshold: 3, max_effective_ratio_ppm: 0, excluded_groups: [], excluded_routes: [], contract_overrides: {}, health_guard: true, recovery_profile: 'balanced', ttft_policy: { enabled: false, metric: '', target_ms: 0, hard_max_ms: 0, min_samples: 0 }, queue_policy: { mode: 'no_queue', max_wait_ms: 0, min_saving_percent: 0 }, balanced_weights: { stability: 45, price: 40, ttft: 15 }, custom_weights: { cache: 25, cost: 25, ttft: 25, stability: 25 }, actual_input_cost_ranking: true, affinity_enabled: true, affinity_mode: 'economic_break_even', affinity_max_premium_percent: 10, affinity_ttl_seconds: 1800, compression_thresholds: [], allow_future_groups: true, allow_future_certified_routes: true, ...p }
      for (const a of ['manual_group_order', 'excluded_groups', 'excluded_routes', 'compression_thresholds']) if (!Array.isArray(P[a])) P[a] = []
      P.ttft_policy = { enabled: false, metric: '', target_ms: 0, hard_max_ms: 0, min_samples: 0, ...(P.ttft_policy || {}) }
      P.queue_policy = { mode: 'no_queue', max_wait_ms: 0, min_saving_percent: 0, ...(P.queue_policy || {}) }
      P.balanced_weights = { stability: 45, price: 40, ttft: 15, ...(P.balanced_weights || {}) }
      P.custom_weights = { cache: 25, cost: 25, ttft: 25, stability: 25, ...(P.custom_weights || {}) }
      if (P.actual_input_cost_ranking == null) P.actual_input_cost_ranking = true
      return P
    }
    function buildPolicy() {
      const P = JSON.parse(JSON.stringify(F.P))
      P.version = 4; P.enabled = true
      P.order_mode = P.strategy === 'manual' ? 'manual' : 'auto_price'
      P.allow_future_groups = F.scope === 'all'
      P.allow_future_certified_routes = P.allow_future_groups
      if (P.allow_future_groups && P.strategy !== 'manual') P.manual_group_order = []
      if (!P.allow_future_groups) P.excluded_groups = []
      if (P.ttft_policy.enabled) P.ttft_policy.metric = 'p95'
      if (P.queue_policy.mode !== 'short_wait') P.queue_policy = { mode: 'no_queue', max_wait_ms: 0, min_saving_percent: 0 }
      return P
    }
    function problems(P) {
      const out = []
      if (!F.name.trim()) out.push('请填写名称')
      if (F.mode !== 'smart') return out
      if (!P.allow_future_groups && !P.manual_group_order.length) out.push('「指定分组」至少选一个分组')
      const listed = opt?.groups || []
      if (P.allow_future_groups && listed.length && listed.every((g) => P.excluded_groups.includes(g.group))) out.push('「全部可用分组」至少保留一个分组')
      if (P.strategy === 'manual' && !P.manual_group_order.length) out.push('「手动排序」需要排好至少一个分组')
      const bw = P.balanced_weights, cw = P.custom_weights
      if (P.strategy === 'balanced' && bw.stability + bw.price + bw.ttft !== 100) out.push('均衡权重加起来要等于 100')
      if (P.strategy === 'custom_weighted' && cw.cache + cw.cost + cw.ttft + cw.stability !== 100) out.push('自定义权重加起来要等于 100')
      const maxA = opt?.max_attempts || 8, maxF = opt?.max_failure_threshold || 10
      if (P.max_attempts < 1 || P.max_attempts > maxA) out.push(`最多尝试次数要在 1–${maxA} 之间`)
      if (P.failure_threshold < 1 || P.failure_threshold > maxF) out.push(`失败阈值要在 1–${maxF} 之间`)
      if (opt?.absolute_max_effective_ratio_ppm && P.max_effective_ratio_ppm > opt.absolute_max_effective_ratio_ppm) out.push(`价格上限不能超过 ${ratioX(opt.absolute_max_effective_ratio_ppm)}`)
      if (P.ttft_policy.enabled && (!(P.ttft_policy.target_ms > 0) || !(P.ttft_policy.hard_max_ms >= P.ttft_policy.target_ms) || !(P.ttft_policy.min_samples > 0))) out.push('首字限制：目标 > 0、硬上限 ≥ 目标、最少样本 > 0')
      if (P.queue_policy.mode === 'short_wait' && (!(P.queue_policy.max_wait_ms > 0) || (opt?.max_queue_wait_ms && P.queue_policy.max_wait_ms > opt.max_queue_wait_ms))) out.push(`短暂排队的等待时间要在 1–${opt?.max_queue_wait_ms || 1000} 毫秒之间`)
      if (P.compression_thresholds.some((t) => !t.model || !(t.tokens > 0))) out.push('压缩阈值每一行都要填模型和正数 tokens')
      return out
    }

    function paint() {
      const scrollHost = el.closest('.qs-dlg')
      const y = scrollHost?.scrollTop || 0
      const listY = el.querySelector('[data-group-list]')?.scrollTop || 0
      const P = F.P
      const groups = opt?.groups || []
      const userGroups = app.state.groups || []
      const n = (path, attrs = {}) => {
        const [o, key] = path
        const i = h('input', { type: 'number', inputmode: 'numeric', value: String(o[key] ?? ''), ...attrs, oninput: () => { o[key] = i.value === '' ? 0 : +i.value; syncRaw() } })
        return i
      }
      const chk = (o, key, label, repaint) => h('label', { class: 'qsh-chk' }, h('input', { type: 'checkbox', checked: !!o[key], onchange: (e) => { o[key] = e.target.checked; repaint ? paint() : syncRaw() } }), label)
      const sect = (title, sub, ...kids) => h('div', { class: 'qsh-sect' }, h('h4', {}, title, sub ? h('small', {}, sub) : null), ...kids)
      const routingSect = (...args) => { const section = sect(...args); section.dataset.routingGroups = ''; section.tabIndex = -1; return section }
      const focusRouting = () => requestAnimationFrame(() => { const section = el.querySelector('[data-routing-groups]'); section?.scrollIntoView({ block: 'start' }); section?.focus({ preventScroll: true }) })

      const modeSeg = c.seg([['fixed', '固定分组'], ...(F.smartOn || F.mode === 'smart' ? [['smart', '智能路由']] : [])], F.mode, (v) => { F.mode = v; paint() }, '密钥类型')
      const parts = [
        h('div', { class: 'qsh-hd' }, h('h3', {}, k ? `编辑「${k.name}」` : '新建密钥'), h('span', { class: 'sp' }), h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => done(null) }, '取消')),
        h('div', { class: 'qsh-grid', style: { 'grid-template-columns': 'repeat(auto-fill,minmax(240px,1fr))' } },
          field('名称', h('input', { value: F.name, maxlength: '50', placeholder: '比如：Cherry Studio', oninput: (e) => { F.name = e.target.value } })),
          field('类型', modeSeg, F.mode === 'smart' ? '在多个分组之间自动选路，失败自动切换' : '只走一个分组，倍率固定')),
      ]
      if (F.mode === 'fixed') {
        parts.push(routingSect('分组', '不同分组倍率和可用模型不同',
          field('使用的分组', select(F.group, [['', '默认分组（跟随账号）'], ...userGroups.map((g) => [g.name, `${g.name}${g.ratio != null ? ' · ×' + g.ratio : ''}${g.desc && g.desc !== g.name ? ' · ' + g.desc : ''}`])], (v) => { F.group = v; schedulePreview() }))))
      } else {
        const sel = new Set(P.manual_group_order)
        // Both scopes show a ticked box for "may be used": in 全部可用分组 an unticked group is stored in
        // excluded_groups, in 指定分组 a ticked group is appended to manual_group_order.
        const isOn = (name) => (F.scope === 'all' ? !P.excluded_groups.includes(name) : sel.has(name))
        const setOn = (names, on) => {
          if (F.scope === 'all') P.excluded_groups = on ? P.excluded_groups.filter((x) => !names.includes(x)) : [...P.excluded_groups, ...names.filter((x) => !P.excluded_groups.includes(x))]
          else P.manual_group_order = on ? [...P.manual_group_order, ...names.filter((x) => !P.manual_group_order.includes(x))] : P.manual_group_order.filter((x) => !names.includes(x))
          paint()
        }
        const gRow = (g) => h('label', { class: 'qsh-g' }, h('input', { type: 'checkbox', checked: isOn(g.group), 'data-group': g.group, onchange: (e) => setOn([g.group], e.target.checked) }),
          h('span', { class: 'nm', title: g.description || g.group }, g.group), h('span', { class: 'qsh-num qsh-sm' }, ratioX(g.effective_ratio_ppm)), h('span', { class: 'qsh-sm qsh-mute' }, `${g.supported_model_count ?? 0} 模型`), stateTag(h, g.health_status))
        const sections = colorSections(groups, app.state.groupColors || {})
        const names = sections.flatMap((s) => s.groups.map((g) => g.group)), onCount = names.filter(isOn).length
        const groupList = h('div', { class: 'qsh-glist sec', 'data-group-list': '' }, sections.map((s) => {
          const ids = s.groups.map((g) => g.group), all = ids.every(isOn), on = ids.filter(isOn).length
          return h('div', { class: 'qsh-gsec', 'data-color': s.id }, h('div', { class: 'qsh-gsh' }, h('i', { class: 'sw', style: { background: s.hex }, 'aria-hidden': 'true' }), h('b', {}, s.label),
            h('span', { class: 'qsh-mute' }, `${on} / ${ids.length}`), h('span', { class: 'sp' }),
            h('button', { type: 'button', class: 'qsh-btn sm', 'aria-label': `${all ? '取消全选' : '全选'}${s.label}分组`, onclick: () => setOn(ids, !all) }, all ? '取消全选' : '全选')),
          s.groups.map(gRow))
        }))
        const scopeBody = h('div', {}, h('p', { class: 'qsh-mute qsh-sm', style: { margin: '0 0 6px' } }, F.scope === 'all'
          ? '允许使用账号能用的全部分组，以后新增的分组也会自动加入。取消勾选即排除这个分组：'
          : '只在勾选的分组之间切换：'),
        groups.length ? h('div', { class: 'qsh-gbar' }, h('span', { class: 'qsh-sm' }, `已选 ${onCount} / ${names.length} 个分组`), h('span', { class: 'qsh-mute qsh-sm' }, '按颜色分组，同色内价格从高到低'), h('span', { class: 'sp', style: { flex: '1' } }),
          h('button', { type: 'button', class: 'qsh-btn sm', disabled: onCount === names.length, onclick: () => setOn(names, true) }, '全选'),
          h('button', { type: 'button', class: 'qsh-btn sm', disabled: onCount === 0, onclick: () => setOn(names, false) }, '取消全选')) : null,
        groups.length ? groupList : h('div', { class: 'qsh-empty' }, '暂无可选分组'))
        parts.push(routingSect('允许使用的分组范围', null,
          c.seg([['all', '全部可用分组'], ['pick', '指定分组']], F.scope, (v) => { F.scope = v; if (v === 'pick' && !P.manual_group_order.length) P.manual_group_order = groups.slice(0, 3).map((g) => g.group); paint() }, '分组范围'),
          h('div', { style: { 'margin-top': '10px' } }, scopeBody)))
        const stratHelp = { price: '优先用最便宜的可用线路，失败再按价格往上换', stability: '优先成功率最高的线路', latency: '优先首字最快的线路', balanced: '按稳定、价格、首字三者加权', custom_weighted: '按缓存、成本、首字、稳定四项自定义权重', manual: '严格按你排好的分组顺序尝试' }
        const strat = [field('选路偏好', select(P.strategy, STRATEGY, (v) => { P.strategy = v; if (v === 'manual' && !P.manual_group_order.length) P.manual_group_order = (F.scope === 'all' ? groups : groups.filter((g) => sel.has(g.group))).slice(0, 3).map((g) => g.group); paint() }), stratHelp[P.strategy])]
        if (P.strategy === 'balanced') strat.push(h('div', { class: 'qsh-grid' }, field('稳定', n([P.balanced_weights, 'stability'], { min: 0, max: 100 })), field('价格', n([P.balanced_weights, 'price'], { min: 0, max: 100 })), field('首字', n([P.balanced_weights, 'ttft'], { min: 0, max: 100 }))), h('small', { class: 'qsh-mute' }, '三项相加须等于 100'))
        if (P.strategy === 'custom_weighted') strat.push(h('div', { class: 'qsh-grid' }, field('缓存', n([P.custom_weights, 'cache'], { min: 0, max: 100 })), field('成本', n([P.custom_weights, 'cost'], { min: 0, max: 100 })), field('首字', n([P.custom_weights, 'ttft'], { min: 0, max: 100 })), field('稳定', n([P.custom_weights, 'stability'], { min: 0, max: 100 }))), h('small', { class: 'qsh-mute' }, '四项相加须等于 100'))
        if (P.strategy === 'manual') {
          const ord = P.manual_group_order
          strat.push(h('div', { class: 'qsh-glist' }, ord.map((g, i) => h('div', { class: 'qsh-g' }, h('span', { class: 'qsh-num qsh-sm' }, i + 1), h('span', { class: 'nm' }, g),
            h('button', { type: 'button', class: 'qsh-btn sm', disabled: i === 0, 'aria-label': '上移', onclick: () => { [ord[i - 1], ord[i]] = [ord[i], ord[i - 1]]; paint() } }, '↑'),
            h('button', { type: 'button', class: 'qsh-btn sm', disabled: i === ord.length - 1, 'aria-label': '下移', onclick: () => { [ord[i + 1], ord[i]] = [ord[i], ord[i + 1]]; paint() } }, '↓'),
            h('button', { type: 'button', class: 'qsh-btn sm bad', 'aria-label': '移除', onclick: () => { ord.splice(i, 1); paint() } }, '✕')))),
          F.scope === 'all' ? field('加入排序', select('', [['', '选择分组…'], ...groups.filter((g) => !ord.includes(g.group)).map((g) => [g.group, `${g.group} · ${ratioX(g.effective_ratio_ppm)}`])], (v) => { if (v) { ord.push(v); paint() } })) : null)
        }
        parts.push(sect('选路偏好', null, ...strat))
        const ppmX = h('input', { type: 'number', min: '0', step: '0.01', value: P.max_effective_ratio_ppm ? String(+(P.max_effective_ratio_ppm / 1e6).toFixed(4)) : '', placeholder: `跟随站点（${ratioX(opt?.default_max_effective_ratio_ppm)}）`, oninput: (e) => { P.max_effective_ratio_ppm = e.target.value === '' ? 0 : Math.round(+e.target.value * 1e6); syncRaw() } })
        parts.push(sect('失败切换与价格上限', null, h('div', { class: 'qsh-grid' },
          field('最多尝试次数', n([P, 'max_attempts'], { min: 1, max: opt?.max_attempts || 8 }), `含第一次，最多 ${opt?.max_attempts || 8}`),
          field('失败阈值', n([P, 'failure_threshold'], { min: 1, max: opt?.max_failure_threshold || 10 }), '连续失败几次后暂时跳过这条线路'),
          field('价格上限（倍率）', ppmX, `留空跟随站点默认；最高 ${ratioX(opt?.absolute_max_effective_ratio_ppm)}`),
          field('恢复节奏', select(P.recovery_profile, RECOVERY, (v) => { P.recovery_profile = v; syncRaw() }), '被跳过的线路多快重新尝试')),
          h('div', { class: 'qsh-acts', style: { 'margin-top': '10px' } }, chk(P, 'health_guard', '健康保护（跳过近期不健康的线路）'), chk(P, 'actual_input_cost_ranking', '按真实输入成本排序（考虑缓存命中）'))))
        parts.push(sect('会话粘性', '同一会话尽量留在同一线路，提高缓存命中', h('div', { class: 'qsh-acts' }, chk(P, 'affinity_enabled', '开启会话粘性', true)),
          P.affinity_enabled ? h('div', { class: 'qsh-grid', style: { 'margin-top': '8px' } },
            field('粘性模式', select(P.affinity_mode || 'fixed_premium', [['economic_break_even', '按实际成本自动判断'], ['fixed_premium', '固定溢价上限']], (v) => { P.affinity_mode = v; paint() })),
            P.affinity_mode === 'fixed_premium' || !P.affinity_mode ? field('最多多付（%）', n([P, 'affinity_max_premium_percent'], { min: 0, max: 1000 }), '粘住的线路比最便宜的贵多少以内仍然保留') : null,
            field('粘性时长（秒）', n([P, 'affinity_ttl_seconds'], { min: 0 }))) : null))
        parts.push(sect('首字与排队', null, h('div', { class: 'qsh-acts' }, chk(P.ttft_policy, 'enabled', '限制首字时间（P95）', true)),
          P.ttft_policy.enabled ? h('div', { class: 'qsh-grid', style: { 'margin-top': '8px' } }, field('目标（毫秒）', n([P.ttft_policy, 'target_ms'], { min: 1 })), field('硬上限（毫秒）', n([P.ttft_policy, 'hard_max_ms'], { min: 1 })), field('最少样本数', n([P.ttft_policy, 'min_samples'], { min: 1 }))) : null,
          h('div', { class: 'qsh-grid', style: { 'margin-top': '10px' } },
            field('线路繁忙时', select(P.queue_policy.mode, [['no_queue', '不排队，直接换线路'], ['short_wait', '短暂等待更便宜的线路']], (v) => { P.queue_policy.mode = v; if (v === 'short_wait' && !P.queue_policy.max_wait_ms) P.queue_policy.max_wait_ms = Math.min(500, opt?.max_queue_wait_ms || 500); paint() })),
            P.queue_policy.mode === 'short_wait' ? field('最长等待（毫秒）', n([P.queue_policy, 'max_wait_ms'], { min: 1, max: opt?.max_queue_wait_ms || 1000 })) : null,
            P.queue_policy.mode === 'short_wait' ? field('至少省（%）', n([P.queue_policy, 'min_saving_percent'], { min: 0, max: 100 }), '等待能省下这么多才值得等') : null)))
        const ct = P.compression_thresholds
        parts.push(sect('上下文压缩阈值', '可选：某个模型的输入超过多少 tokens 时允许改走支持压缩的线路',
          ct.map((t, i) => h('div', { class: 'qsh-acts', style: { 'margin-bottom': '6px' } },
            h('input', { value: t.model, placeholder: '模型名', list: 'qsh-ed-models', style: { flex: '2', 'min-width': '140px' }, oninput: (e) => { t.model = e.target.value.trim(); syncRaw() } }),
            h('input', { type: 'number', min: '1', value: String(t.tokens || ''), placeholder: 'tokens', style: { flex: '1', 'min-width': '90px' }, oninput: (e) => { t.tokens = +e.target.value || 0; syncRaw() } }),
            h('button', { type: 'button', class: 'qsh-btn sm bad', onclick: () => { ct.splice(i, 1); paint() } }, '删除'))),
          h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => { ct.push({ model: '', tokens: 100000 }); paint() } }, '+ 添加一行')))
      }
      if (app.media?.smart) {
        const sm = app.media.smart
        const mediaRow = (kind) => {
          const label = sm.label(kind), cur = P.media_policy?.[kind] || null
          const sumEl = h('span', { class: 'qsh-mute qsh-sm' }, cur ? '自定义' : '站点默认')
          Promise.resolve().then(() => sm.catalog(kind, false, { tokenId: k?.id })).then((d) => {
            sumEl.textContent = d && d.enabled === false ? '站点暂未开放' : (cur ? '' : '站点默认 · ') + sm.summary(kind, cur, d?.catalog)
          }).catch(() => {})
          const save = (v) => {
            const next = { ...(P.media_policy || {}) }
            if (v) next[kind] = v; else delete next[kind]
            // An explicit null clears it: the server keeps a stored media_policy when the field is omitted.
            P.media_policy = Object.keys(next).length ? next : null
            if (F.rawDirty) { try { const raw = JSON.parse(F.rawText); raw.media_policy = P.media_policy; F.rawText = JSON.stringify(raw, null, 2) } catch {} }
            paint()
          }
          return h('div', {}, h('div', { class: 'qsh-acts', style: { 'margin-bottom': '6px' } }, h('b', {}, label), sumEl, h('span', { class: 'sp' }),
            cur ? h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => save(null) }, '恢复默认') : null,
            h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => sm.edit(kind, { value: cur, tokenId: k?.id, groups: sm.preview ? draftGroups() : undefined, title: `「${F.name || '这个密钥'}」的${label}偏好`, onSave: save, onConfigureRouting: focusRouting }) }, '调整')),
          sm.preview ? h('div', { class: 'qsh-mprev', 'data-media-preview': kind, role: 'status', 'aria-live': 'polite' }) : null)
        }
        parts.push(sect('智能视频 / 智能绘图', '用这个密钥请求 smart-video、smart-image 时，按这里的模型系列和价格上限在多个模型之间依次尝试',
          mediaRow('video'), mediaRow('image')))
      }
      // Quota, expiry, model limits, IP allowlist apply to both key types.
      const filtered = models.filter((m) => !F.modelQ || m.toLowerCase().includes(F.modelQ.toLowerCase()))
      parts.push(sect('额度与有效期', null, h('div', { class: 'qsh-grid' },
        field('额度', h('div', { class: 'qsh-acts' }, h('label', { class: 'qsh-chk' }, h('input', { type: 'checkbox', checked: F.unlimited, onchange: (e) => { F.unlimited = e.target.checked; paint() } }), '不限额度')),
          F.unlimited ? '仍然受账户余额限制' : null),
        F.unlimited ? null : field(`额度上限（${app.currency.sym}）`, h('input', { type: 'number', min: '0', step: '0.01', value: F.amount, oninput: (e) => { F.amount = e.target.value } }), k ? `已用 ${c.money(k.used_quota)}` : null),
        field('过期时间', h('input', { type: 'datetime-local', value: F.expire, onchange: (e) => { F.expire = e.target.value } }), '留空表示永不过期'))))
      parts.push(sect('模型限制', null, h('div', { class: 'qsh-acts' }, h('label', { class: 'qsh-chk' }, h('input', { type: 'checkbox', checked: F.limit, onchange: (e) => { F.limit = e.target.checked; paint() } }), '只允许下面勾选的模型'), F.limit ? h('span', { class: 'qsh-mute qsh-sm' }, `已选 ${F.models.size} 个`) : null),
        F.limit ? h('div', { style: { 'margin-top': '8px' } },
          h('div', { class: 'qsh-acts', style: { 'margin-bottom': '6px' } }, h('input', { placeholder: '筛选模型', value: F.modelQ, style: { flex: '1' }, oninput: (e) => { F.modelQ = e.target.value; const s = e.target.selectionStart; paint(); const ni = el.querySelector('input[data-mq]'); ni?.focus(); ni?.setSelectionRange(s, s) }, 'data-mq': '' }),
            h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => { filtered.forEach((m) => F.models.add(m)); paint() } }, '全选筛选结果'), h('button', { type: 'button', class: 'qsh-btn sm', onclick: () => { F.models.clear(); paint() } }, '清空')),
          h('div', { class: 'qsh-glist' }, filtered.map((m) => h('label', { class: 'qsh-g' }, h('input', { type: 'checkbox', checked: F.models.has(m), onchange: (e) => { e.target.checked ? F.models.add(m) : F.models.delete(m) } }), h('span', { class: 'nm' }, m))))) : null))
      parts.push(sect('IP 白名单', '可选，每行一个 IP 或 CIDR；留空不限制', h('textarea', { rows: '3', placeholder: '例如 203.0.113.7\n198.51.100.0/24', oninput: (e) => { F.ips = e.target.value } }, F.ips)))
      if (F.mode === 'smart') {
        const raw = h('textarea', { rows: '10', 'data-raw': '', oninput: (e) => { F.rawDirty = true; F.rawText = e.target.value } }, F.rawDirty ? F.rawText : JSON.stringify(buildPolicy(), null, 2))
        parts.push(h('details', { class: 'qsh-sect' }, h('summary', {}, '高级：原始路由策略 JSON（改了这里会以这里为准）'), raw))
      }
      parts.push(h('datalist', { id: 'qsh-ed-models' }, models.map((m) => h('option', { value: m }))))
      const msg = h('div', { class: 'qsh-sm qsh-bad', role: 'alert' })
      parts.push(h('div', { class: 'qsh-foot qsh-acts' }, msg, h('span', { class: 'sp' }), h('button', { type: 'button', class: 'qsh-btn', onclick: () => done(null) }, '取消'),
        h('button', { type: 'button', class: 'qsh-btn pri', disabled: saving, onclick: () => submit(msg) }, saving ? '正在保存…' : k ? '保存' : '创建')))
      el.replaceChildren(...parts)
      if (scrollHost) scrollHost.scrollTop = y
      const list = el.querySelector('[data-group-list]')
      if (list) list.scrollTop = listY
      schedulePreview()
    }
    // Groups the key would route to with the unsaved settings, mirroring the server's key scope: allowed or picked
    // groups at or under the effective price cap; a fixed key uses its single group (or the account's group).
    function draftGroups() {
      if (F.mode !== 'smart') { const g = F.group || app.state.user?.group || ''; return g ? [g] : [] }
      const P = F.P, listed = (opt?.groups || []).filter((g) => g.group && g.group !== 'auto')
      let cap = P.max_effective_ratio_ppm || opt?.default_max_effective_ratio_ppm || 0
      if (opt?.absolute_max_effective_ratio_ppm && (!cap || cap > opt.absolute_max_effective_ratio_ppm)) cap = opt.absolute_max_effective_ratio_ppm
      const scoped = F.scope === 'all' ? listed.filter((g) => !P.excluded_groups.includes(g.group)) : P.manual_group_order.map((n) => listed.find((g) => g.group === n) || { group: n })
      return scoped.filter((g) => !cap || g.effective_ratio_ppm == null || +g.effective_ratio_ppm <= cap).map((g) => g.group)
    }
    const pv = { key: '', timer: 0, seq: 0, res: {} }
    function paintPreview(kind) {
      const node = el.querySelector(`[data-media-preview="${kind}"]`), r = pv.res[kind]
      if (!node || !r) return
      const sm = app.media.smart
      node.className = 'qsh-mprev' + (r.err || (r.r && !r.r.available) ? ' qsh-warn' : '')
      node.textContent = r.err ? '预览失败：' + r.err : r.r ? '按编辑中的设置（未保存）：' + sm.previewText(r.r) : '按编辑中的设置（未保存）：正在计算…'
    }
    function schedulePreview() {
      const sm = app.media?.smart
      if (!sm?.preview || !F) return
      const groups = draftGroups(), policy = F.P.media_policy || {}
      const key = JSON.stringify([groups, policy.video || null, policy.image || null])
      if (key === pv.key) { ['video', 'image'].forEach(paintPreview); return }
      pv.key = key
      clearTimeout(pv.timer)
      const seq = ++pv.seq
      for (const kind of ['video', 'image']) { pv.res[kind] = {}; paintPreview(kind) }
      pv.timer = setTimeout(() => {
        for (const kind of ['video', 'image']) {
          sm.preview(kind, { groups, policy: policy[kind] || null })
            .then((r) => { if (seq === pv.seq) { pv.res[kind] = { r }; paintPreview(kind) } }, (e) => { if (seq === pv.seq) { pv.res[kind] = { err: e?.message || '请稍后再试' }; paintPreview(kind) } })
        }
      }, 400)
    }
    function syncRaw() {
      schedulePreview()
      if (F.rawDirty) return
      const t = el.querySelector('textarea[data-raw]')
      if (t) t.value = JSON.stringify(buildPolicy(), null, 2)
    }
    async function submit(msg) {
      let P = null
      if (F.mode === 'smart') {
        if (F.rawDirty) {
          try { const raw = JSON.parse(F.rawText); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(); P = normPolicy(raw); if (!Object.prototype.hasOwnProperty.call(raw, 'media_policy')) P.media_policy = F.P.media_policy } catch { msg.textContent = '原始 JSON 格式不对'; return }
        } else P = buildPolicy()
      }
      const errs = problems(P || {})
      if (errs.length) { msg.textContent = errs.join('；'); return }
      const cur = app.currency
      const body = {
        name: F.name.trim().slice(0, 50),
        expired_time: F.expire ? Math.floor(new Date(F.expire).getTime() / 1000) : -1,
        unlimited_quota: F.unlimited,
        remain_quota: F.unlimited ? (k?.remain_quota || 0) : Math.round(((+F.amount || 0) / (cur.rate || 1)) * (app.qpu || 500000)),
        model_limits_enabled: F.limit && F.models.size > 0, model_limits: F.limit ? [...F.models].join(',') : '',
        allow_ips: F.ips.split(/[\n,，\s]+/).map((s) => s.trim()).filter(Boolean).join('\n'),
        group: F.mode === 'smart' ? 'auto' : F.group, cross_group_retry: F.mode === 'smart' ? false : !!k?.cross_group_retry,
      }
      if (body.expired_time !== -1 && body.expired_time * 1000 < Date.now()) { msg.textContent = '过期时间不能早于现在'; return }
      body.media_policy = (P || F.P).media_policy ?? null
      if (F.mode === 'smart') body.routing_policy = JSON.stringify(P)
      else if (k) body.routing_policy = ''
      saving = true; msg.textContent = ''
      const btn = el.querySelector('.qsh-foot .pri'); if (btn) { btn.disabled = true; btn.textContent = '正在保存…' }
      try {
        if (k) await app.request('PUT', '/api/token/', { json: { ...body, id: k.id, status: k.status } })
        else await app.request('POST', '/api/token/', { json: body })
        done({ name: body.name })
      } catch (e) {
        saving = false
        if (btn) { btn.disabled = false; btn.textContent = k ? '保存' : '创建' }
        msg.textContent = '保存失败：' + e.message
      }
    }
    return {}
  }

  const VIEWS = { logs: logsView, rank: rankView, smart: smartView, editor: editorView }
  window.__qs.defineModule({ id: 'hub', css: CSS, mount })
})()
