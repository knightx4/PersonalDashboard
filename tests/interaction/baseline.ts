/**
 * The phone checks' baseline, and which surfaces a change touched.
 *
 * Pure, so the rules are tested without a browser (./baseline.test.ts).
 * scripts/check-phone.ts supplies the file lists and the measurements.
 *
 * Main had findings on most surfaces when the checks arrived (small press
 * targets above all), so the checks hold each surface's count per check where
 * it is, the way check:ui and check:specs hold theirs: a touched surface that
 * measures more than scripts/phone-baseline.json records fails, one that
 * measures less writes the lower count back, and a surface the baseline does
 * not name is held to zero.
 */
import { CHECKS, type Check, type Findings } from './checks';

/** Per surface, per check, how many findings main has. Zeros are left out. */
export type Baseline = Record<string, Partial<Record<Check, number>>>;

export type Rise = { surface: string; check: Check; was: number; now: number; findings: string[] };

/**
 * Compares measured surfaces with the baseline. Returns the rises, and the
 * baseline with every measured surface's falls written in (rises are never
 * written: that is the gate's to refuse, not this file's to absorb).
 */
export function compare(
  baseline: Baseline,
  measured: Record<string, Findings>,
): { rises: Rise[]; next: Baseline; lowered: string[] } {
  const rises: Rise[] = [];
  const lowered: string[] = [];
  const next: Baseline = structuredClone(baseline);
  for (const [surface, findings] of Object.entries(measured)) {
    const held = baseline[surface] ?? {};
    const kept: Partial<Record<Check, number>> = {};
    for (const check of CHECKS) {
      const was = held[check] ?? 0;
      const now = findings[check].length;
      if (now > was) rises.push({ surface, check, was, now, findings: findings[check] });
      if (now < was) lowered.push(`${surface} ${check} ${was} → ${now}`);
      const value = Math.min(was, now);
      if (value > 0) kept[check] = value;
    }
    if (Object.keys(kept).length > 0) next[surface] = kept;
    else delete next[surface];
  }
  return { rises, next: sortBaseline(next), lowered };
}

/** The baseline in a stable order, surfaces then checks, so a diff of it reads. */
export function sortBaseline(baseline: Baseline): Baseline {
  const out: Baseline = {};
  for (const surface of Object.keys(baseline).sort()) {
    const row: Partial<Record<Check, number>> = {};
    for (const check of CHECKS) {
      const value = baseline[surface][check];
      if (value) row[check] = value;
    }
    if (Object.keys(row).length > 0) out[surface] = row;
  }
  return out;
}

/**
 * The surface ids a copy of lib/preview/routes.ts names in SURFACE_ROUTES.
 * Read off the text so the copy on the merge base can be read too.
 */
export function surfaceIdsIn(routesSource: string): string[] {
  const start = routesSource.indexOf('SURFACE_ROUTES');
  if (start < 0) return [];
  const end = routesSource.indexOf('\n};', start);
  const body = routesSource.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/^\s*'([\w-]+)':/gm)].map((m) => m[1]);
}

/**
 * The surfaces a change touched: those its changed screen files serve, and
 * those it added to the gallery. A new surface is drawn in app/preview/,
 * which serves no page, so without the second half a step adding a surface
 * would never have it checked.
 */
export function touchedSurfaces(
  served: readonly string[],
  idsBefore: readonly string[],
  idsNow: readonly string[],
): string[] {
  const before = new Set(idsBefore);
  const found = new Set([...served, ...idsNow.filter((id) => !before.has(id))]);
  return idsNow.filter((id) => found.has(id));
}
