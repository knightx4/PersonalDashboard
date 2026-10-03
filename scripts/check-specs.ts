/**
 * Holds every spec rule's count where it is or lower.
 *
 *   npm run check:specs              # check; records any count that fell
 *   npm run check:specs -- --list    # and print what each counter counted
 *
 * Fails when a counter in scripts/spec-counts.ts measures more than
 * scripts/spec-baseline.json records. When one measures less, the lower value
 * is written to the baseline, to be committed with the change that lowered
 * it. The engine is lib/specs/counts.ts.
 */
import { join } from 'node:path';
import { runSpecCheck } from '../lib/specs/counts';
import { SPEC_COUNTERS } from './spec-counts';

const root = process.cwd();
process.exit(
  runSpecCheck({
    root,
    counters: SPEC_COUNTERS,
    baselinePath: join(root, 'scripts/spec-baseline.json'),
    list: process.argv.includes('--list'),
  }),
);
