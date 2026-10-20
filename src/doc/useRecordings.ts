import { useCallback, useEffect, useState } from 'react';
import { host } from '../lib/host';

export interface LocalRecording {
  id: string; createdAt: string | number; startedAt?: string | number; endedAt?: string | number;
  phase: string; bytes: number; folder: string; mp4?: string; raw?: string; studentId?: string; title?: string; progress?: number;
}

export function useRecordings() {
  const [recordings, setRecordings] = useState<LocalRecording[]>([]), [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!host.electron) return;
    try {
      const data = await host.call<LocalRecording[]>('recordings');
      setRecordings(data.filter((r) => r?.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    void reload();
    // 录课电平和回放进度每秒都会推送；只有阶段或排队数变化才重新扫目录，进度直接就地更新
    let last = '';
    return host.onEvent((e) => {
      if (e.type === 'recordSaved') { void reload(); return; }
      if (e.type !== 'recording') return;
      const jobs: { id: string; progress?: number }[] = e.status.jobs ?? [], key = e.status.phase + '|' + jobs.map((j) => j.id).join(',');
      if (key !== last) { last = key; void reload(); return; }
      if (jobs.length) setRecordings((rows) => rows.map((r) => { const j = jobs.find((x) => x.id === r.id); return j ? { ...r, progress: j.progress } : r; }));
    });
  }, [reload]);
  return { recordings, error, reload };
}

export function recordingMinutes(r: LocalRecording) {
  if (!r.startedAt || !r.endedAt) return null;
  const minutes = (new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes * 10) / 10 : null;
}
