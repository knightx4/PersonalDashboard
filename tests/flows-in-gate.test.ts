/**
 * The whole-flow tests in tests/flows/ have to run in the gate and in CI.
 *
 * Each phase of an overhaul ends with a flow test there, and the next phase
 * waits on it (docs/SPEC-LAYER-SPEC.md Part 4). That wait means nothing if
 * the folder quietly drops out of the run: a narrowed vitest include, a gate
 * lane or a CI step given a path, or the last flow test deleted. Nothing would
 * go red, because a test that is not run cannot fail. So this reads the four
 * places that decide what runs and fails when any of them stops covering the
 * folder.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../vitest.config';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('tests/flows in the gate', () => {
  it('holds at least one flow test', () => {
    const tests = readdirSync(join(ROOT, 'tests/flows')).filter((name) =>
      /\.test\.tsx?$/.test(name),
    );
    expect(tests.length).toBeGreaterThan(0);
  });

  it('is inside what vitest runs', () => {
    const include = config.test?.include ?? [];
    expect(include.some((glob) => matchesGlob('tests/flows/a.test.ts', glob))).toBe(true);
    expect(config.test?.exclude ?? []).not.toContainEqual(expect.stringContaining('flows'));
  });

  it('runs in the gate, which runs the whole suite', () => {
    // The test lane names no path, so it runs every file the include covers.
    expect(read('scripts/gate.sh')).toMatch(/lane test "Test" npx vitest run &/);
  });

  it('runs in CI, which runs the whole suite', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/run: scripts\/ci-step\.sh Test npm test\n/);
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe('vitest run');
  });
});
