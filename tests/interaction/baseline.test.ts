import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SURFACE_ROUTES } from '../../lib/preview/routes';
import { compare, surfaceIdsIn, touchedSurfaces, type Baseline } from './baseline';
import type { Findings } from './checks';

const none: Findings = { sideways: [], targets: [], dock: [], contrast: [], next: [], press: [] };

describe('compare', () => {
  it('fails a count that rises, and holds a surface the baseline does not name to zero', () => {
    const baseline: Baseline = { a: { targets: 2 } };
    const { rises } = compare(baseline, {
      a: { ...none, targets: ['x', 'y', 'z'] },
      b: { ...none, dock: ['under'] },
    });
    expect(rises.map((r) => `${r.surface} ${r.check} ${r.was}→${r.now}`)).toEqual([
      'a targets 2→3',
      'b dock 0→1',
    ]);
  });

  it('writes a fall back, drops a surface that reaches zero, and leaves unmeasured ones alone', () => {
    const baseline: Baseline = { a: { targets: 3, contrast: 1 }, b: { dock: 1 }, c: { sideways: 1 } };
    const { rises, next, lowered } = compare(baseline, {
      a: { ...none, targets: ['x'], contrast: ['faint'] },
      b: none,
    });
    expect(rises).toEqual([]);
    expect(next).toEqual({ a: { targets: 1, contrast: 1 }, c: { sideways: 1 } });
    expect(lowered).toEqual(['a targets 3 → 1', 'b dock 1 → 0']);
  });
});

describe('touched surfaces', () => {
  it('reads every surface id out of lib/preview/routes.ts', () => {
    const source = readFileSync(join(process.cwd(), 'lib/preview/routes.ts'), 'utf8');
    expect(surfaceIdsIn(source)).toEqual(Object.keys(SURFACE_ROUTES));
  });

  it('adds the surfaces a change put in the gallery to the ones its files serve', () => {
    expect(touchedSurfaces(['b'], ['a', 'b'], ['a', 'b', 'new'])).toEqual(['b', 'new']);
    expect(touchedSurfaces([], ['a'], ['a'])).toEqual([]);
  });
});

describe('the gate', () => {
  it('runs the phone checks after the build they serve', () => {
    const gate = readFileSync(join(process.cwd(), 'scripts/gate.sh'), 'utf8');
    expect(gate).toMatch(/"Build" npm run -s build -- "Phone checks" npm run -s check:phone &/);
  });
});
