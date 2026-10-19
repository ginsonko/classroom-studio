// 中转站模型列表的分类和厂商分组（只看模型名，中转站很少给更多信息）。收藏存在本机。

export type ModelCat = 'chat' | 'image' | 'video' | 'audio' | 'other';
export const CAT_LABELS: Record<ModelCat, string> = { chat: '对话', image: '绘图', video: '视频', audio: '音频', other: '其他' };

// 视频先判断：像 "jimeng-video"、"image-to-video" 这种名字归视频
const VIDEO = /video|sora|veo|kling|hailuo|seedance|wan-?2|wanx|runway|vidu|pixverse|luma|ray-?2|i2v|t2v|s2v|pika|cogvideo|hunyuan-?video|mochi/i;
const IMAGE = /image|dall-?e|flux|midjourney|^mj[-_]|seedream|imagen|stable-?diffusion|sdxl|sd-?3|recraft|ideogram|nano-?banana|qwen-?image|kolors|jimeng|cogview|hidream|playground/i;
const AUDIO = /tts|whisper|audio|speech|suno|music|voice|realtime|transcri|asr|udio/i;
const OTHER = /embed|rerank|moderation|bge-|search-preview/i;

export function modelCat(id: string): ModelCat {
  if (VIDEO.test(id)) return 'video';
  if (IMAGE.test(id)) return 'image';
  if (AUDIO.test(id)) return 'audio';
  if (OTHER.test(id)) return 'other';
  return 'chat';
}

const VENDORS: [RegExp, string][] = [
  [/^smart-|^auto$|^auto-/i, '智能路由'],
  [/claude|anthropic/i, 'Claude'],
  [/^gpt|^o\d|chatgpt|codex|dall-?e|sora|openai|whisper|tts-1|text-embedding/i, 'OpenAI'],
  [/gemini|gemma|imagen|veo|nano-?banana|google/i, 'Google'],
  [/deepseek/i, 'DeepSeek'],
  [/qwen|qwq|wan-?2|wanx|tongyi/i, '通义千问'],
  [/glm|chatglm|cogview|cogvideo|zhipu/i, '智谱'],
  [/kimi|moonshot/i, 'Kimi'],
  [/doubao|seed|jimeng|bytedance/i, '字节豆包'],
  [/grok|xai/i, 'xAI'],
  [/minimax|hailuo|abab/i, 'MiniMax'],
  [/kling/i, '可灵'],
  [/hunyuan/i, '腾讯混元'],
  [/ernie|wenxin/i, '百度文心'],
  [/mistral|mixtral|codestral/i, 'Mistral'],
  [/llama|meta-/i, 'Llama'],
  [/flux|black-forest/i, 'FLUX'],
  [/midjourney|^mj[-_]/i, 'Midjourney'],
  [/suno/i, 'Suno'],
];

export function modelVendor(id: string): string {
  const base = id.includes('/') ? id.split('/').pop() || id : id;
  for (const [re, name] of VENDORS) if (re.test(base)) return name;
  return '其他';
}

const VENDOR_ORDER = [...new Set(VENDORS.map(([, n]) => n)), '其他'];
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** 同一厂商里版本号大的排前面："gpt-6.1" 在 "gpt-5.4" 前 */
export const sortModels = (ids: string[]) => [...ids].sort((a, b) => collator.compare(b, a));

export function groupByVendor(ids: string[]): { vendor: string; ids: string[] }[] {
  const map = new Map<string, string[]>();
  for (const id of ids) { const v = modelVendor(id); map.set(v, [...(map.get(v) || []), id]); }
  return [...map.entries()].sort((a, b) => VENDOR_ORDER.indexOf(a[0]) - VENDOR_ORDER.indexOf(b[0])).map(([vendor, list]) => ({ vendor, ids: sortModels(list) }));
}

/** 看图（课上读学生画面）一般要多模态模型 */
export const likelyVision = (id: string) => /gpt-4o|gpt-4\.1|gpt-5|gpt-6|claude|gemini|vl|vision|qwen.*(vl|omni)|glm-4v|glm-4\.\dv|doubao.*vision|kimi.*vision|grok/i.test(id);

/**
 * 一键导入后没指定模型时替老师挑一个：能看图的旗舰对话模型优先，同系列取版本号大的。
 * 跳过 mini / nano / flash-lite 这类小模型（读题、画板书容易出错）和明显不是对话的模型。
 */
const PREFER = [/^gpt-6/i, /^gpt-5/i, /claude.*(opus|sonnet)/i, /gemini.*pro/i, /^gpt-4\.1/i, /^gpt-4o/i, /qwen.*(vl|omni|max)/i, /deepseek/i, /glm/i, /doubao/i, /kimi/i];
const SMALL = /mini|nano|lite|tiny|small|(^|[-_])(1|3|7|8)b\b|instruct-?\d*k?$|search|realtime|audio|tts|embed|whisper|moderation|codex/i;
/** 银子 API 网站一键导入推荐的文本模型；Key 能用就直接选它 */
const RECOMMENDED = ['gpt-6.1-sol'];
export function pickDefaultModel(ids: string[]): string {
  const rec = RECOMMENDED.map((m) => ids.find((id) => id.toLowerCase() === m)).find(Boolean);
  if (rec) return rec;
  const chat = ids.filter((id) => modelCat(id) === 'chat');
  const big = chat.filter((id) => !SMALL.test(id));
  for (const re of PREFER) { const hit = sortModels(big.filter((id) => re.test(id))); if (hit.length) return hit[0]; }
  return sortModels(big.filter(likelyVision))[0] || sortModels(big)[0] || sortModels(chat)[0] || '';
}

const FAV_KEY = 'cs.favModels';
export function loadFavorites(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || 'null'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export function saveFavorites(list: string[]) {
  localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 100)));
  window.dispatchEvent(new Event('cs-favorites'));
}
