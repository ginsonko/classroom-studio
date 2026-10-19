import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SimRun } from '../src/physics/sim/engine';
import { sceneErrors } from '../src/physics/sim/domain';
import { PRESETS, makePreset } from '../src/physics/sim/presets';

const result: { at: string; presets: string[]; checks: unknown[]; failures: unknown[]; deterministic?: boolean; passed?: boolean } = {
  at: new Date().toISOString(), presets: PRESETS.map((p) => p.id), checks: [], failures: [],
};
for (const p of PRESETS) {
  for (const side of ['min', 'max'] as const) {
    try {
      const values = Object.fromEntries(p.params.map((x) => [x.key, side === 'min' ? x.min : x.max]));
      const mat = makePreset(p.id, values, false);
      const errors = sceneErrors(mat.scene!);
      assert.equal(errors.length, 0, `${p.id}/${side}: ${errors.join('; ')}`);
      const run = new SimRun(mat.scene!, { events: p.events });
      run.ensure(run.duration);
      assert.ok(run.frames.length > 2, `${p.id}/${side}: no frames`);
      for (const frame of run.frames) {
        for (const b of frame.b) {
          for (const value of [b.x, b.y, b.vx, b.vy, b.ax, b.ay]) assert.ok(Number.isFinite(value), `${p.id}/${side}: nonfinite state`);
        }
      }
      (result.checks as unknown[]).push({ preset: p.id, side, frames: run.frames.length, duration: run.duration, events: run.events.length });
    } catch (error) {
      (result.failures as unknown[]).push({ preset: p.id, side, error: String(error instanceof Error ? error.stack : error) });
    }
  }
  try {
    const a = new SimRun(makePreset(p.id, {}, false).scene!, { events: p.events });
    const b = new SimRun(makePreset(p.id, {}, false).scene!, { events: p.events });
    a.ensure(a.duration); b.ensure(b.duration);
    assert.deepEqual(a.frames, b.frames, `${p.id}: deterministic replay`);
  } catch (error) {
    (result.failures as unknown[]).push({ preset: p.id, check: 'deterministic', error: String(error instanceof Error ? error.stack : error) });
  }
}
result.deterministic = result.failures.length === 0;
result.passed = result.failures.length === 0;
const reportPath = path.resolve('..', 'reports', 'rich-physics-acceptance.json');
fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ passed: result.passed, presetCount: PRESETS.length, checks: result.checks.length, failures: result.failures }, null, 2));
if (!result.passed) process.exitCode = 1;
