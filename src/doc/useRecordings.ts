import { useCallback, useEffect, useState } from 'react';
import { host } from '../lib/host';

export interface LocalRecording {
  id: string; createdAt: string | number; startedAt?: string | number; endedAt?: string | number;
  phase: string; bytes: number; folder: string; mp4?: string; raw?: string; studentId?: string; title?: string;
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
    return host.onEvent((e) => { if (e.type === 'recording') void reload(); });
  }, [reload]);
  return { recordings, error, reload };
}

export function recordingMinutes(r: LocalRecording) {
  if (!r.startedAt || !r.endedAt) return null;
  const minutes = (new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes * 10) / 10 : null;
}
