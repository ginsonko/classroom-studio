'use strict';
// 临时网络问题自动重试（设计稿 E.3）：课堂 AI、工坊、小羽共用。
// 只重试「网络抖一下就好」的错误：断网、连接超时 / 重置、DNS 临时失败、流中途断开、502/503/504。
// 400/401/402（余额不足）/403/404/422（内容拦截）/429 额度和「没有可用分组 / 渠道」都是确定性错误，重试也一样，绝不重试。
const DELAYS = [1000, 2000, 4000, 8000, 15000];
const MAX = DELAYS.length;

/** 测试可以用 CS_RETRY_DELAYS=10,10,10,10,10 把等待缩短 */
function delays(over) {
  if (Array.isArray(over) && over.length) return over.map((n) => Math.max(0, Number(n) || 0));
  const env = String(process.env.CS_RETRY_DELAYS || '').trim();
  if (env) { const a = env.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0); if (a.length) return a; }
  return DELAYS.slice();
}

const TRANSIENT = /UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|EPIPE|ENETUNREACH|ENETDOWN|EHOSTUNREACH|fetch failed|socket hang up|network ?error|stream disconnected|premature close|terminated|connection (reset|closed|error|refused)|中途断开|连不上 AI 服务|网络波动|timed out|Bad Gateway|Service Unavailable|Gateway Time-?out|暂时出错（50[234]）|\b50[234]\b/i;
const FATAL = /AI 响应超时|没有可用分组|没有分组|没有可用渠道|无可用渠道|没有可用线路|No available channel|no eligible automatic route|未包含可用线路|余额不足|额度不足|insufficient|quota|欠费|401|402|403|422|Unauthorized|Forbidden|invalid.?api.?key|Key 不对|Key 无效|内容(被)?拦截|content.?(policy|filter|blocked)|moderation|不接受这个请求|找不到这个模型|model_not_found|已手动停止|已停止|cancel/i;

/** 是不是值得自动重试的临时错误 */
function isTransient(err) {
  if (!err) return false;
  if (err.name === 'AbortError' && err.userAbort) return false;
  const status = Number(err.status || err.statusCode || 0);
  if (status) {
    if ([502, 503, 504].includes(status)) return !FATAL.test(String(err.body || '') + ' ' + String(err.message || ''));
    if (status >= 400) return false;
  }
  const text = [err.code, err.cause?.code, err.cause?.message, err.message].filter(Boolean).join(' ');
  if (FATAL.test(text)) return false;
  return TRANSIENT.test(text);
}

/** 文字里有确定性错误（余额不足、Key 不对、内容拦截、没有可用分组……）：这类绝不重试 */
const isFatalText = (text) => FATAL.test(String(text || ''));

/** 文字（工坊 CLI 的错误尾巴、小羽的错误信息）是不是临时网络问题 */
function isTransientText(text) {
  const s = String(text || '');
  if (!s.trim() || FATAL.test(s)) return false;
  return TRANSIENT.test(s);
}

function wait(ms, signal) {
  return new Promise((ok, no) => {
    if (signal?.aborted) { no(abortError()); return; }
    const t = setTimeout(() => { signal?.removeEventListener?.('abort', on); ok(); }, ms);
    const on = () => { clearTimeout(t); no(abortError()); };
    signal?.addEventListener?.('abort', on, { once: true });
  });
}
function abortError() { return Object.assign(new Error('已取消'), { name: 'AbortError', userAbort: true }); }

/** 调 fn(第几次)，临时错误按 1s、2s、4s、8s、15s 递增等待后重来，最多重试 5 次；signal 取消立刻停 */
async function retry(fn, { signal, delays: over, onRetry, should = isTransient } = {}) {
  const ds = delays(over);
  for (let i = 0; ; i++) {
    if (signal?.aborted) throw abortError();
    try { return await fn(i); } catch (e) {
      if (signal?.aborted) throw abortError();
      if (i >= ds.length || !should(e)) throw e;
      try { onRetry?.({ attempt: i + 1, max: ds.length, wait: ds[i], error: e }); } catch { /* 提示失败不影响重试 */ }
      await wait(ds[i], signal);
    }
  }
}

const retryText = (n, max = MAX) => `网络波动，正在自动重连（第 ${n}/${max} 次）…`;

module.exports = { DELAYS, MAX, delays, isTransient, isTransientText, retry, wait, retryText, isFatalText, abortErrorOf: abortError };
