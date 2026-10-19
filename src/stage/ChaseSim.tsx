import { useMemo } from 'react';
import { SimHost } from '../physics/SimHost';
import { makePreset } from '../physics/sim/presets';
import type { SimScope } from '../physics/sim/clock';

/** Legacy material IDs use the same physics engine and clock as new simulations. */
export function ChaseSim({ a0 = 3, v0 = 6, scope = 'preview' }: { a0?: number; v0?: number; scope?: SimScope }) {
  const mat = useMemo(() => makePreset('chase', { a: a0, v: v0 }, false), [a0, v0]);
  return <SimHost mat={mat} scope={scope} />;
}
