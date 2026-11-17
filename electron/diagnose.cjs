'use strict';
// 「帮我查查」免费自检（设计稿 E.2）：在主进程里逐项检查，绝不发付费的模型调用。
//   1 账号与 Key  2 连通（GET /models 是否 200、用时；聊天、/v1/responses 两个接口各自通不通）
//   3 余额（登录了才查）  4 三个用途的档位与分组  5 AI 工坊的安全运行环境预热
// 接口通不通只发「空请求」：站点在校验请求体时就返回 400/422，不会调用模型、不扣费；404/405 才说明这条接口没有。
const tier = require('./tier.cjs');

const LOW_BALANCE = 2; // 元：低于这个数提醒充值
const clip = (s, n = 160) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const cleanBase = (u) => String(u || '').trim().replace(/\/+$/, '');

async function timed(fetchFn, url, init, ms = 15000) {
  const ctl = new AbortController(), t0 = Date.now();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal });
    const text = await res.text().catch(() => '');
    return { status: res.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: e?.name === 'AbortError' ? `超过 ${Math.round(ms / 1000)} 秒没有回应` : String(e?.cause?.code || e?.message || e) };
  } finally { clearTimeout(timer); }
}

/** 空请求探接口：有这条接口时站点会因为缺参数返回 400/422（或 401），没有才是 404/405 */
const exists = (r) => r.status > 0 && r.status !== 404 && r.status !== 405 && r.status < 500;

/**
 * o: { cfg:{baseUrl,model,hasKey}, key, account:{view(), self()}, tiers:{all()}, codexHome:{view()}, fetch, defects }
 * 返回 { at, ok, items:[{ id, title, ok, level:'ok'|'warn'|'bad', detail, advice, action? }] }
 */
async function diagnose(o = {}) {
  const fetchFn = o.fetch || globalThis.fetch;
  const cfg = o.cfg || {};
  const base = cleanBase(cfg.baseUrl);
  const items = [];
  const add = (it) => { items.push({ ok: it.level === 'ok', ...it }); };
  const view = (() => { try { return o.account?.view?.() || {}; } catch { return {}; } })();
  const site = base && tier.applies(base);

  // 1 账号与 Key
  if (view.signedIn) add({ id: 'account', title: '账号与 Key', level: o.key ? 'ok' : 'warn', detail: `已登录 ${view.site?.name || '玲珑'}账号 ${view.username || ''}`.trim(), advice: o.key ? '账号已连上，不用再填 Key' : '账号登录了，但还没拿到 Key：点「重新连接账号」', action: o.key ? '' : 'account' });
  else if (o.key) add({ id: 'account', title: '账号与 Key', level: 'ok', detail: `填了 API Key（尾号 ${String(cfg.keyHint || o.key.slice(-4))}）`, advice: '已配置好 Key' });
  else add({ id: 'account', title: '账号与 Key', level: 'bad', detail: '没有登录账号，也没有填 API Key', advice: '登录玲珑账号最省事；已有 Key 的话在「AI 设置」里填上', action: 'account' });

  // 2 连通：GET /models 免费；聊天、/responses 发空请求看接口在不在
  let models = [], chatOk = false;
  if (!o.key || !base) add({ id: 'network', title: '网络与接口', level: 'bad', detail: '还没有可用的 Key，没法测连通', advice: '先登录账号或填好 Key' });
  else {
    const auth = { Authorization: 'Bearer ' + o.key, 'Content-Type': 'application/json', ...tier.siteHeaders(base + '/models') };
    const m = await timed(fetchFn, base + '/models', { method: 'GET', headers: auth });
    if (m.status === 200) {
      try { const j = JSON.parse(m.text); models = (Array.isArray(j?.data) ? j.data : []).map((x) => String(x?.id || x || '')).filter(Boolean); } catch { /* 不是 JSON 也算通 */ }
      const empty = {}, hdr = { ...auth };
      const [c, r] = await Promise.all([
        timed(fetchFn, base + '/chat/completions', { method: 'POST', headers: hdr, body: JSON.stringify(empty) }),
        timed(fetchFn, base + '/responses', { method: 'POST', headers: hdr, body: JSON.stringify(empty) }),
      ]);
      chatOk = exists(c);
      const respOk = exists(r);
      const slow = m.ms > 3000;
      add({
        id: 'network', title: '网络与接口', level: chatOk && respOk && !slow ? 'ok' : chatOk ? 'warn' : 'bad',
        detail: `模型列表 200（${m.ms} 毫秒，${models.length} 个模型）；聊天接口${chatOk ? '可用' : '不可用'}；/v1/responses ${respOk ? '可用' : '不可用'}`,
        advice: !chatOk ? '这个接口地址不支持聊天，检查地址是不是以 /v1 结尾' : !respOk ? '课堂 AI 能用；小羽和 AI 工坊要用 /v1/responses，这个站点不支持，换一个支持的线路' : slow ? '能连上但比较慢，网络不稳时会自动重连' : '网络正常',
        ms: m.ms, chat: chatOk, responses: respOk,
      });
    } else if (m.status === 401 || m.status === 403) add({ id: 'network', title: '网络与接口', level: 'bad', detail: `接口拒绝了这个 Key（${m.status}）`, advice: 'Key 不对或已失效：重新登录账号或换一个 Key', action: 'account', ms: m.ms });
    else if (m.status) add({ id: 'network', title: '网络与接口', level: 'bad', detail: `读取模型列表返回 ${m.status}（${m.ms} 毫秒）`, advice: m.status >= 500 ? '服务暂时出错，过几分钟再试' : '检查接口地址是不是写对了', ms: m.ms });
    else add({ id: 'network', title: '网络与接口', level: 'bad', detail: '连不上 AI 服务：' + clip(m.error, 80), advice: '检查电脑网络；学校网络拦了的话换手机热点试试', ms: m.ms });
  }

  // 3 余额（登录了才查；只读 /api/user/self，不扣费）
  if (view.signedIn && o.account?.self) {
    try {
      const me = await o.account.self();
      const b = Number(me.balance) || 0;
      add({ id: 'balance', title: '账户余额', level: b <= 0 ? 'bad' : b < LOW_BALANCE ? 'warn' : 'ok', detail: `余额 ¥${b.toFixed(2)}`, advice: b <= 0 ? '余额用完了，充值后才能继续用 AI' : b < LOW_BALANCE ? '余额不多了，建议先充一点' : '余额充足', action: b < LOW_BALANCE ? 'topup' : '', balance: b });
    } catch (e) { add({ id: 'balance', title: '账户余额', level: 'warn', detail: '读不到余额：' + clip(e.message, 80), advice: '登录可能过期了，重新登录一下', action: 'account' }); }
  } else add({ id: 'balance', title: '账户余额', level: 'ok', detail: o.key ? '用的是自己的 Key，余额在 Key 所在网站查看' : '没有登录账号', advice: '不用处理', skipped: true });

  // 4 档位与分组：三个用途各是什么档；第三方 Key 档位不起作用；空请求附带当前档位探一次分组兼容性（不扣费）+ 检查最近分组回退记录
  const uses = (() => { try { return o.tiers?.all?.() || {}; } catch { return {}; } })();
  const names = Object.entries(uses).map(([u, t]) => `${tier.USE_NAMES[u] || u}：${tier.TIERS[t]?.name || t}`).join('；');
  const defects = (o.defects || tier.recentDefects()).filter((d) => /分组|scope|route/i.test(String(d?.kind || d?.reason || d?.message || '')));
  const fallbacks = o.fallbacks || (typeof tier.recentFallbacks === 'function' ? tier.recentFallbacks() : []);
  let probeConflict = '';
  let probeInvalid = '';
  if (site && o.key && base && chatOk) {
    const activeTiers = [...new Set(Object.values(uses).filter((t) => tier.scopeOf(t)))];
    for (const tid of activeTiers) {
      const hdr = { Authorization: 'Bearer ' + o.key, 'Content-Type': 'application/json', ...tier.siteHeaders(base + '/chat/completions', tid) };
      const pr = await timed(fetchFn, base + '/chat/completions', { method: 'POST', headers: hdr, body: '{}' });
      if (tier.isInvalidScope(pr.status, pr.text)) { probeInvalid = tier.TIERS[tid]?.name || tid; break; }
      if (tier.isNoRoute(pr.status, pr.text)) { probeConflict = tier.TIERS[tid]?.name || tid; break; }
    }
  }
  const weak = tier.weakModel(cfg.model);
  if (!site) add({ id: 'tier', title: '档位与分组', level: 'ok', detail: names || '默认档位', advice: base ? '这个接口不是玲珑 / 合作站，档位不起作用，按 Key 自己的线路走' : '登录账号后档位才起作用', skipped: !base });
  else if (probeInvalid || defects.some((d) => d.kind === 'invalid_route_scope')) add({ id: 'tier', title: '档位与分组', level: 'bad', detail: names + `；站点提示分组范围规则不兼容${probeInvalid ? `（${probeInvalid}）` : ''}`, advice: '先把档位切到「省钱优先」，或更新到最新版软件后再试', action: 'tier' });
  else if (probeConflict || fallbacks.length || defects.length) add({ id: 'tier', title: '档位与分组', level: 'warn', detail: names + (probeConflict ? `；当前 Key 在「${probeConflict}」档位下没有可用分组` : `；最近 ${fallbacks.length + defects.length} 次档位里没有可用分组，已自动按 Key 自己的范围重发`), advice: '这把 Key 的分组和档位对不上：把档位换成「均衡」或「省钱优先」，或者在网站上给 Key 换成 auto 分组', action: 'tier' });
  else if (weak && uses.workshop !== 'quality') add({ id: 'tier', title: '档位与分组', level: 'warn', detail: names + `；默认模型 ${cfg.model} 偏弱`, advice: '做课件、出题这类成品建议把 AI 工坊换成「质量优先」', action: 'tier' });
  else add({ id: 'tier', title: '档位与分组', level: 'ok', detail: names || '默认档位', advice: '档位设置没有冲突' });

  // 5 AI 工坊的安全运行环境预热
  const w = (() => { try { return o.codexHome?.view?.() || null; } catch { return null; } })();
  if (!w) add({ id: 'warmup', title: 'AI 工坊运行环境', level: 'ok', detail: '这台电脑不需要预热', advice: '不用处理', skipped: true });
  else if (w.phase === 'ready' || w.ready) add({ id: 'warmup', title: 'AI 工坊运行环境', level: 'ok', detail: '安全运行环境已就绪', advice: '不用处理' });
  else if (w.phase === 'running') add({ id: 'warmup', title: 'AI 工坊运行环境', level: 'warn', detail: `正在准备（${Math.round(w.pct || 0)}%，${w.step || ''}）`, advice: '第一次要 3～5 分钟，准备好之前工坊任务会排队等', pct: w.pct || 0 });
  else add({ id: 'warmup', title: 'AI 工坊运行环境', level: 'warn', detail: w.phase === 'failed' ? '上次准备失败：' + clip(w.error || w.step, 80) : '还没有准备', advice: '点「立即准备」，第一次要 3～5 分钟，之后工坊开任务就快了', action: 'warmup' });

  return { at: Date.now(), ok: items.every((x) => x.level === 'ok'), items, models: models.length };
}

module.exports = { diagnose, LOW_BALANCE };
