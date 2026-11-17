// AI 工坊（Codex / Claude CLI）、小羽、连接测试报的错 → 一句老师看得懂的话 + 一个该点的按钮。原文留着折叠显示。
// 纯函数，Node 里可以直接测试。

export type FixAction = 'import' | 'settings' | 'recharge' | 'retry' | 'assistant';
export interface AiTrouble { text: string; action: FixAction; label: string }

const RULES: [RegExp, AiTrouble][] = [
  [/no eligible (automatic )?route|未包含可用线路|没有可用线路|无可用渠道|no available channel|分组.{0,12}线路|没有这个模型能用的线路/i,
    { text: '这把 Key 能聊天，但没开通小羽和 AI 工坊要用的线路（Codex 走 /v1/responses）。请到站点给这把 Key 勾上对应分组，或点「站点一键导入」重新导入一次', action: 'import', label: '站点一键导入' }],
  [/insufficient[_ ]quota|余额不足|额度不足|欠费|quota exceeded|exceeded your current quota|\b402\b/i,
    { text: 'AI 账户的余额或额度不够了，充值后再点「继续」就能接着做', action: 'recharge', label: '去站点充值' }],
  [/\b401\b|\b403\b|unauthori[sz]ed|invalid[_ ]api[_ ]key|incorrect api key|令牌.{0,6}(无效|过期|已禁用)|API Key 无效|无效的令牌|token.{0,10}(invalid|expired)/i,
    { text: 'API Key 无效、过期或被禁用了。重新点「站点一键导入」最省事', action: 'import', label: '站点一键导入' }],
  [/model[_ ]not[_ ]found|does not exist|模型.{0,6}(不存在|不可用)|no such model|unknown model|\b404\b/i,
    { text: '这把 Key 用不了现在选的模型。换一个模型，或点「站点一键导入」用站点推荐的模型', action: 'settings', label: '去换模型' }],
  [/\b429\b|rate.?limit|too many requests|请求太频繁/i,
    { text: 'AI 服务这会儿太忙（请求太频繁），等半分钟再点「继续」', action: 'retry', label: '再试一次' }],
  [/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR|fetch failed|stream disconnected|连不上 AI 服务|network|超时/i,
    { text: '网络连不上 AI 服务，检查一下网络，稍后再点「继续」', action: 'retry', label: '再试一次' }],
  [/\b50[0234]\b|Service Unavailable|Bad Gateway|暂时出错/i,
    { text: 'AI 服务暂时出错了，过一会儿再点「继续」；一直这样就点「站点一键导入」重新导入', action: 'retry', label: '再试一次' }],
];

/** 认得出来的错误返回解释，认不出来返回 null（照原样显示） */
export function explainAiError(raw: string): AiTrouble | null {
  const s = String(raw ?? '');
  if (!s.trim()) return null;
  for (const [re, t] of RULES) if (re.test(s)) return t;
  return null;
}

/** 连接测试：聊天通但 Codex 那条（/responses）不通时给老师的话 */
export function agentProbeText(agent: { ok: boolean; model: string; message?: string } | null | undefined): string {
  if (!agent || agent.ok) return '';
  const t = explainAiError(agent.message ?? '');
  return `但这把 Key 能聊天、不能给小羽和 AI 工坊干活（${agent.model} 走 /v1/responses 不通）：${t?.action === 'import' || !t ? '请在站点给这把 Key 勾上对应分组，或点「站点一键导入」' : t.text}`;
}
