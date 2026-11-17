// 1.7.0 备课用到的课件提前转码：备课一记下（小羽归档 / 记一次备课 / 自动备课），PPT、Word 就在后台转成软件能直接显示的格式，
// 转好的放在转换缓存里（关了软件也在），上课点了直接能用。一次只转一个、每个之间歇几秒；正在上课（录像中）就停下让路，下课再接着转。
import { host } from './host';
import { isLive, useRecording } from './recording';
import { useStudy } from './studyStore';
import type { Prep } from './studyLogic';

const KEY = 'cs.prepWarm';
import { needsConvert, prepPaths } from './prepRecord';
export { needsConvert, prepPaths };
const load = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const save = (q: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(q.slice(0, 200))); } catch { /* 存不下就算了 */ } };
let queue: string[] = [], running = false, started = false;
const done = new Set<string>();


/** 排进后台转码队列（已经转过 / 已经在排的跳过） */
export function warmPaths(paths: string[]) {
  if (!host.electron || host.role !== 'teacher') return;
  const add = paths.filter((p) => needsConvert(p) && !done.has(p) && !queue.includes(p));
  if (!add.length) return;
  queue.push(...add); save(queue); void run();
}
export const warmPrep = (p: Pick<Prep, 'files' | 'materials' | 'courseware'>) => warmPaths(prepPaths(p));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 正在上课（开始、录像中、收尾）就等着 */
async function idle() { while (isLive(useRecording.getState().status.phase)) await sleep(15000); }

async function run() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      await idle();
      await sleep(host.test ? 50 : 4000);
      await idle();
      const p = queue[0];
      try {
        await host.call('assistant.grant', { path: p });
        await host.call('convert', { path: p, id: 'prep-warm' });
        done.add(p);
      } catch { /* 文件不在了、转不了：上课点的时候再报，这里不打扰老师 */ }
      queue = queue.filter((x) => x !== p); save(queue);
    }
  } finally { running = false; }
}

/** 教师窗口启动：接着转上次没转完的；最近 3 天的备课也看一遍 */
export function startPrepWarm() {
  if (started || !host.electron || host.role !== 'teacher') return;
  started = true;
  queue = load();
  const kick = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from = new Date(today.getTime() - 86400000).toISOString().slice(0, 10), to = new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    for (const p of useStudy.getState().data.preps ?? []) if (p.date >= from && p.date <= to) warmPrep(p);
    void run();
  };
  if (useStudy.getState().loaded) setTimeout(kick, 30000);
  else { const off = useStudy.subscribe((s) => { if (s.loaded) { off(); setTimeout(kick, host.test ? 500 : 30000); } }); }
}
export const warmState = () => ({ queue: [...queue], done: [...done], running });
