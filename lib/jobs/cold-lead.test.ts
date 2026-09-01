/**
 * When an untouched lead is let go.
 *
 * The reported bug: pursuits with no activity for a hundred and sixty days
 * still sitting in the first column. Ghosting deliberately skips `lead` --
 * that describes your own inaction rather than theirs, and the derivation has
 * a test saying so -- but nothing else closed them either.
 */
import { describe, expect, it } from 'vitest';
import { coldLeadCutoffDays } from '@/inngest/jobs/cron/sweep';
import { DEFAULT_GHOST_THRESHOLD_DAYS } from '@/lib/jobs/pipeline';

describe('the cold-lead cutoff', () => {
  it('gives a lead twice as long as an application', () => {
    // Nothing was sent, so there is nothing to be waiting on, and a recruiter
    // resurfacing after six weeks is not unusual.
    expect(coldLeadCutoffDays(DEFAULT_GHOST_THRESHOLD_DAYS)).toBe(60);
  });

  it('follows the threshold the user set', () => {
    expect(coldLeadCutoffDays(45)).toBe(90);
    expect(coldLeadCutoffDays(7)).toBe(14);
  });

  it('is longer than the ghost threshold at every setting', () => {
    for (const days of [1, 7, 14, 30, 45, 60, 90, 365]) {
      expect(coldLeadCutoffDays(days)).toBeGreaterThan(days);
    }
  });
});
