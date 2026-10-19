'use strict';
// 课前提醒：按本机课表在开课前 N 分钟弹出系统通知。只读课表，不联网。
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekday = (d) => (d.getDay() + 6) % 7; // 0 = 周一，与课表一致

function onDate(slot, d) {
  if (slot.repeat || !slot.date) return slot.day === weekday(d) && (!slot.date || dateKey(d) >= slot.date);
  return slot.date === dateKey(d);
}

/** 开课时间落在 (now, now + lead] 且还没提醒过的课 */
function due(slots, now, leadMinutes, sent) {
  if (!Array.isArray(slots) || !(leadMinutes > 0)) return [];
  const out = [];
  for (const day of [0, 1]) {
    const d = new Date(now); d.setDate(d.getDate() + day); d.setHours(0, 0, 0, 0);
    for (const s of slots) {
      if (!s || !Number.isFinite(s.start) || !onDate(s, d)) continue;
      const at = new Date(d); at.setHours(Math.floor(s.start), Math.round((s.start % 1) * 60), 0, 0);
      const mins = (at.getTime() - now.getTime()) / 60000, key = `${s.id}@${dateKey(d)}`;
      if (mins > 0 && mins <= leadMinutes && !sent.has(key)) out.push({ key, slot: s, at, minutes: Math.ceil(mins) });
    }
  }
  return out;
}

function createReminders({ getLocal, getLead, onDue, log }) {
  const sent = new Set();
  let timer = null;
  const tick = () => {
    try {
      const local = getLocal() ?? {}, lead = Number(getLead()) || 0;
      for (const item of due(local.slots, new Date(), lead, sent)) {
        sent.add(item.key);
        const student = (local.students ?? []).find((x) => x.id === item.slot.studentId);
        onDue({ ...item, studentName: student?.name ?? '学生' });
      }
      if (sent.size > 500) sent.clear();
    } catch (e) { log?.warn('课前提醒检查失败', e); }
  };
  return {
    start() { clearInterval(timer); timer = setInterval(tick, 30000); tick(); },
    stop() { clearInterval(timer); },
    tick,
  };
}

module.exports = { due, createReminders, dateKey };
