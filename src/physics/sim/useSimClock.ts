import { useEffect, useRef, useState } from 'react';
import type { Material } from '../../lib/types';
import { ROLE, useStore } from '../../lib/store';
import { initialParams, materialWithParams } from './presets';
import { changeClock, initialClock, withClockDefaults, type ClockAction, type SimScope } from './clock';

export function useSimClock(mat: Material, scope: SimScope) {
  const remote = useStore(s => s.sim);
  const studentTools = useStore(s => s.studentTools);
  const drawAuthor = useStore(s => s.drawAuthor);
  const [local, setLocal] = useState(() => initialClock(mat.id, initialParams(mat)));
  const localRef = useRef(local);
  const signature = JSON.stringify([mat.id, mat.scene?.params]);
  const oldSignature = useRef(signature);
  useEffect(() => {
    if (oldSignature.current !== signature) {
      oldSignature.current = signature;
      const next = initialClock(mat.id, initialParams(mat));
      localRef.current = next;
      setLocal(next);
    }
  }, [signature, mat]);
  useEffect(() => { localRef.current = local; }, [local]);
  const fallback = initialClock(mat.id, initialParams(mat));
  const clock = scope === 'program' ? (remote?.matId === mat.id ? withClockDefaults(remote) : fallback) : local.matId === mat.id ? withClockDefaults(local) : fallback;
  const canControl = ROLE !== 'student' || (scope === 'program' && (drawAuthor === 'teacher' || studentTools === 'open'));
  const act = (action: ClockAction, duration: number) => {
    if (!canControl) return;
    const now = Date.now();
    if (scope === 'program') {
      const st = useStore.getState();
      if (st.pgmMat.id !== mat.id) return; // A detached old PGM instance cannot rewrite a new lesson.
      const current = st.sim?.matId === mat.id ? withClockDefaults(st.sim) : initialClock(mat.id, initialParams(mat));
      st.setShared({ sim: changeClock(current, action, now, duration) });
    } else {
      const current = localRef.current.matId === mat.id ? localRef.current : fallback;
      const next = changeClock(current, action, now, duration);
      localRef.current = next;
      setLocal(next);
      if (action.type === 'params') {
        const st = useStore.getState(), params = next.params;
        // Only teacher-local references are updated. TAKE later carries these actual preview parameters.
        const updated = materialWithParams(mat, params);
        if (st.reader.mat.id === mat.id) st.set({ reader: { ...st.reader, mat: updated } });
        if (st.pvw?.mat.id === mat.id) st.set({ pvw: { ...st.pvw, mat: updated } });
      }
    }
  };
  return { clock, canControl, act };
}

export function useClockNow(playing: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!playing) { setNow(Date.now()); return; }
    let raf = 0;
    const tick = () => { setNow(Date.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return now;
}
