/**
 * The counters spec rules are checked by. A rule in a spec's `## Rules`
 * section names one as `Checked by: count \`<name>\`, baseline N, target M.`
 * (docs/SPEC-LAYER-SPEC.md, Part 1).
 *
 * Each counter returns the items it counts, measured over the repository at
 * `root`; lib/specs/counts.ts has the helpers (`filesMatching`,
 * `tablesCreated`, `listFiles`) and the ratchet. The recorded values are in
 * scripts/spec-baseline.json, and `npm run check:specs` fails when one rises.
 *
 * To add a counter: add it here, run `npm run check:specs` once to record its
 * value, and commit the baseline with it. To retire one, take it out and run
 * the check again; its baseline entry goes with it.
 */
import type { SpecCounter } from '../lib/specs/counts';

export const SPEC_COUNTERS: readonly SpecCounter[] = [];
