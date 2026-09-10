/**
 * The sweep that put every z-index on a named rung and every resting shadow
 * on a layer is worth one commit; keeping it that way is worth a scanner.
 *
 * Both tables are read rather than restated. The rungs come out of
 * app/globals.css, where they are custom properties with a named `@utility`
 * each; the shadows come out of ELEVATION in app/dev/ui/measurements.ts, by
 * pulling the utility names out of the rows themselves. Adding a rung or a
 * layer means editing the thing that defines it and nothing here.
 *
 * What it refuses: a `z-` class that is not a rung, an arbitrary `z-[…]`, an
 * inline `zIndex`, and a `shadow-` utility no layer names.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ELEVATION } from '../app/dev/ui/measurements';

const ROOT = process.cwd();
const DIRECTORIES = ['app', 'components', 'lib'];

const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

/** Every rung, by the utility that names it. */
const RUNGS = new Set(
  [...css.matchAll(/^\s*--z-([a-z-]+):\s*\d+;/gm)].map(([, name]) => `z-${name}`),
);

/** Every shadow utility a layer in the elevation table names. */
const SHADOWS = new Set(
  ELEVATION.flatMap((row) => row.flatMap((cell) => [...cell.matchAll(/(?<![\w-])shadow-[a-z\d]+/g)]))
    .map(([match]) => match),
);

type Finding = { file: string; line: number; value: string; why: string };

/**
 * `z-index` and `box-shadow` are the CSS properties, and both are written in
 * prose in these files. Everything else that looks like a utility is treated
 * as one, comment or not: a rung named in a comment should be a real rung.
 */
const PROSE = new Set(['z-index']);

function scan(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  source.split('\n').forEach((text, index) => {
    const line = index + 1;
    for (const [value] of text.matchAll(/(?<![\w-])z-(?:\[[^\]]*\]|[a-z\d-]+)/g)) {
      if (PROSE.has(value) || RUNGS.has(value)) continue;
      findings.push({ file, line, value, why: 'not a rung of the z ladder in app/globals.css' });
    }
    for (const [value] of text.matchAll(/(?<![\w-])shadow-(?:\[[^\]]*\]|[a-z\d]+)/g)) {
      if (SHADOWS.has(value)) continue;
      findings.push({ file, line, value, why: 'no layer in ELEVATION carries this shadow' });
    }
    for (const [value] of text.matchAll(/\bzIndex\b/g)) {
      findings.push({ file, line, value, why: 'an inline z-index cannot name a rung' });
    }
  });
  return findings;
}

function sources(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...sources(path));
    } else if (['.ts', '.tsx'].includes(extname(entry.name))) {
      // tests/lint-boundaries.test.ts writes __design_probe.ts into app/ and
      // components/ and deletes it again, so a `__` file here is another
      // test's, may be gone by the time this reads it, and is not the app.
      if (entry.name.startsWith('__')) continue;
      out.push(path);
    }
  }
  return out;
}

function report(findings: Finding[]): string[] {
  return findings.map(({ file, line, value, why }) => `${file}:${line} ${value} — ${why}`);
}

describe('the z ladder and the elevation table', () => {
  /**
   * Neither count is pinned: adding a rung or a layer should mean editing
   * globals.css or ELEVATION and nothing here. What is pinned is that both
   * reads found something, so a regex that quietly stops matching does not
   * turn the scan below into a scan for nothing.
   */
  it('both tables were read, and every rung has its utility', () => {
    expect(RUNGS.size).toBeGreaterThan(0);
    expect(SHADOWS.size).toBeGreaterThan(0);
    RUNGS.forEach((utility) => expect(css).toContain(`@utility ${utility} {`));
  });

  it('every z and every shadow in the app is on one of them', () => {
    const findings = DIRECTORIES.flatMap((directory) =>
      sources(directory).flatMap((file) =>
        scan(relative(ROOT, file), readFileSync(join(ROOT, file), 'utf8')),
      ),
    );
    expect(report(findings)).toEqual([]);
  });

  /**
   * The probe. A scanner that has only ever been run over a clean tree has
   * not been shown to catch anything. It goes through `scan` with a made-up
   * path rather than a file written into app/, because the test above reads
   * the real tree and vitest runs files in parallel.
   */
  it('refuses a value that is not on either table', () => {
    const bad = [
      '<div className="fixed z-[65] shadow-lg" />',
      '<div className="z-99" />',
      '<div className="shadow-xl" />',
      '<div style={{ zIndex: 41 }} />',
    ].join('\n');
    expect(report(scan('app/probe.tsx', bad))).toEqual([
      'app/probe.tsx:1 z-[65] — not a rung of the z ladder in app/globals.css',
      'app/probe.tsx:2 z-99 — not a rung of the z ladder in app/globals.css',
      'app/probe.tsx:3 shadow-xl — no layer in ELEVATION carries this shadow',
      'app/probe.tsx:4 zIndex — an inline z-index cannot name a rung',
    ]);
  });

  it('lets a rung and a named shadow through', () => {
    const good = '<div className="fixed z-modal shadow-2xl" />\n<span className="z-over-link" />';
    expect(report(scan('app/probe.tsx', good))).toEqual([]);
  });
});
