/**
 * The motion tokens (plan #1549, docs/UI-QUALITY-SPEC.md Part 8, rule R7).
 *
 * app/globals.css and lib/motion.ts hold the same durations and easings, one
 * for CSS and one for code that times an animation; these fail when the two
 * drift. The `raw-motion-values` counter is checked against a few written-out
 * values, so a count of zero means the app has none rather than that the
 * counter sees nothing.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EASE, MOTION_MS, SPRING_POINTS, springAt } from '@/lib/motion';
import { SPEC_COUNTERS } from '@/scripts/spec-counts';

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

/** The value a custom property is first given in app/globals.css. */
function declared(name: string): string {
  const m = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
  if (!m) throw new Error(`${name} is not declared in app/globals.css`);
  return m[1].trim();
}

describe('the motion tokens', () => {
  it('give app/globals.css and lib/motion.ts the same durations', () => {
    for (const [speed, ms] of Object.entries(MOTION_MS)) {
      expect(declared(`--motion-${speed}`)).toBe(`${ms}ms`);
    }
  });

  it('give them the same easings', () => {
    expect(declared('--ease-out-soft')).toBe(EASE.outSoft);
    expect(declared('--ease-spring')).toBe(EASE.spring);
    expect(declared('--ease-sway')).toBe(EASE.sway);
  });

  it('collapse under reduced motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const speed of Object.keys(MOTION_MS)) expect(block).toContain(`--motion-${speed}: 0.01ms;`);
  });

  it('spring past the end a little and settle on it', () => {
    expect(SPRING_POINTS[0]).toBe(0);
    expect(SPRING_POINTS.at(-1)).toBe(1);
    const peak = Math.max(...SPRING_POINTS);
    expect(peak).toBeGreaterThan(1.03);
    expect(peak).toBeLessThan(1.1);
    expect(springAt(0)).toBe(0);
    expect(springAt(1)).toBe(1);
    expect(springAt(0.5)).toBeGreaterThan(0.9);
  });
});

describe('raw-motion-values', () => {
  const counter = SPEC_COUNTERS.find((c) => c.name === 'raw-motion-values');

  function measure(files: Record<string, string>): string[] {
    const root = mkdtempSync(join(tmpdir(), 'motion-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return counter!.measure(root);
  }

  it('counts durations and easings written out by hand', () => {
    const items = measure({
      'app/globals.css': [
        '.a { transition: opacity 120ms var(--ease-out-soft); }',
        '.b {\n  animation: spin 2s ease-in-out infinite;\n}',
        '.c { animation-delay: calc(var(--i) * 40ms); }',
      ].join('\n'),
      'components/x.tsx': [
        "const a = 'transition-colors duration-150 ease-out';",
        'const b = { animationDelay: `${i * 180}ms` };',
        "el.animate(frames, { duration: 300, easing: 'ease-out' });",
      ].join('\n'),
    });
    expect(items.map((i) => i.split(': ')[0])).toEqual([
      'app/globals.css:1',
      'app/globals.css:3',
      'app/globals.css:5',
      'components/x.tsx:1',
      'components/x.tsx:1',
      'components/x.tsx:2',
      // the 'ease-out' string reads as a class too, so the call counts twice
      'components/x.tsx:3',
      'components/x.tsx:3',
    ]);
  });

  it('passes the tokens, zero, and what is not a curve', () => {
    const items = measure({
      'app/globals.css': [
        '/* 150ms ease-out was the old way */',
        '.a { transition: opacity var(--motion-quick) var(--ease-out-soft); }',
        '.b { animation: spin calc(var(--motion-moment) * 2) linear infinite; }',
        '.c { animation: caret var(--motion-moment) steps(1) infinite; }',
        '.d { animation-duration: 0.01ms !important; transition: none; }',
      ].join('\n'),
      'components/x.tsx': [
        '// duration-150 in a comment',
        "const a = 'transition-colors duration-quick ease-out-soft';",
        'const b = { animationDelay: `${i * MOTION_MS.quick}ms` };',
        'el.animate(frames, { duration: FLIGHT_MS, easing: EASE.outSoft });',
      ].join('\n'),
      'components/x.test.tsx': "const a = 'duration-150';",
    });
    expect(items).toEqual([]);
  });
});
