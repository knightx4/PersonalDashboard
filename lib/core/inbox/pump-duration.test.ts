/**
 * Every route that starts the pump must outlive it.
 *
 * The pump works until PUMP_BUDGET_MS is nearly spent and *then* calls the
 * next invocation. A route whose own ceiling is lower is killed before it gets
 * there: the chain stops dead, the job sits queued, and some minutes later it
 * is marked stalled -- which looks like a mailbox with nothing in it rather
 * than like a failure.
 *
 * That is not hypothetical. Raising the pump's budget from 45s to 240s left
 * the cron routes at 60, and the daily sync would have died mid-batch every
 * night without anything in the logs saying so. A source-level check because
 * `maxDuration` is a build-time constant: there is nothing to assert at run
 * time, and by the time it matters the function is already gone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** Routes that call pumpInboxSync, directly or through a cron stage. */
const PUMPING_ROUTES = [
  'app/api/inbox/sync/route.ts',
  'app/api/inbox/sync/continue/route.ts',
  'app/api/cron/daily/route.ts',
  'app/api/cron/inbox-incremental/route.ts',
];

/** Mirrors PUMP_BUDGET_MS in inngest/core/inbox-sync.ts. */
const PUMP_BUDGET_MS = 240_000;

function maxDurationOf(file: string): number {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const match = source.match(/export const maxDuration = (\d+);/);
  expect(match, `${file} declares no maxDuration`).not.toBeNull();
  return Number(match![1]);
}

describe('the sync routes outlive the work they start', () => {
  it.each(PUMPING_ROUTES)('%s allows the whole pump budget', (file) => {
    expect(maxDurationOf(file) * 1000).toBeGreaterThanOrEqual(PUMP_BUDGET_MS);
  });

  it('is checking against the budget the pump actually uses', () => {
    const pump = readFileSync(join(ROOT, 'inngest/core/inbox-sync.ts'), 'utf8');
    const declared = pump.match(/const PUMP_BUDGET_MS = ([\d_]+);/);
    expect(declared).not.toBeNull();
    expect(Number(declared![1].replace(/_/g, ''))).toBe(PUMP_BUDGET_MS);
  });
});
