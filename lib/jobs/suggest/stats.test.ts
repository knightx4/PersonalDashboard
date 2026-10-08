import { describe, expect, it } from 'vitest';
import { formatCost, openingStats, type OpeningOutcome } from './stats';

const app = (status: string, hasInterview = false) => ({ status, rejectionStage: null, hasInterview });

describe('openingStats', () => {
  it('counts each source from found to interview', () => {
    const rows: OpeningOutcome[] = [
      { origin: 'search', status: 'done', application: app('in_process') },
      { origin: 'search', status: 'done', application: app('submitted') },
      { origin: 'search', status: 'done', application: app('lead') },
      { origin: 'search', status: 'dismissed', application: null },
      { origin: 'board', status: 'expired', application: null },
      { origin: 'discovered', status: 'done', application: app('lead') },
      { origin: null, status: 'open', application: null },
    ];
    expect(openingStats(rows)).toEqual([
      { origin: 'search', found: 4, saved: 3, applied: 2, interviews: 1, dismissed: 1, expired: 0 },
      { origin: 'board', found: 1, saved: 0, applied: 0, interviews: 0, dismissed: 0, expired: 1 },
      { origin: 'discovered', found: 1, saved: 1, applied: 0, interviews: 0, dismissed: 0, expired: 0 },
      { origin: 'goal', found: 1, saved: 0, applied: 0, interviews: 0, dismissed: 0, expired: 0 },
    ]);
  });

  it('leaves out a source that found nothing', () => {
    expect(openingStats([])).toEqual([]);
  });
});

describe('formatCost', () => {
  it('shows cents under ten dollars and whole dollars above', () => {
    expect(formatCost(4_200_000)).toBe('$4.20');
    expect(formatCost(12_600_000)).toBe('$13');
  });
});
