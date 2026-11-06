import { describe, expect, it } from 'vitest';
import { nextReachOutAt, reachOutViewOf, understoodOf } from '@/lib/you/reach-out-card';
import { NO_REACH_OUT, nextTextLine, nextTextWhen } from '@/lib/you/reach-out-card-model';
import { reachOutSummary } from '@/lib/you/reach-out-make';
import type { ReachOutRule } from '@/lib/you/reach-out-rule';

const DAY = 24 * 60 * 60 * 1000;
// Tuesday 3 November 2026, 09:00 in London.
const NOW = Date.parse('2026-11-03T09:00:00Z');
const ZONE = 'Europe/London';

const RULE: ReachOutRule = {
  version: 1,
  watches: [
    { key: 'jobs', about: 'good-fit jobs', tables: ['job_search.suggestions'], mode: 'roundup', every_days: 7, repeat_after_days: null, form: 'list' },
    { key: 'habit', about: 'a habit', tables: ['you.insights'], mode: 'pick', every_days: 14, repeat_after_days: 30, form: 'bubbles' },
  ],
  cannot_watch: ['your savings balance'],
};

const sent = (watchKey: string, daysAgo: number) => ({
  watchKey,
  refTable: 'job_search.suggestions',
  refId: `${watchKey}-${daysAgo}`,
  sentAt: new Date(NOW - daysAgo * DAY).toISOString(),
});

describe('nextReachOutAt', () => {
  it('is due now while any watch has never sent', () => {
    expect(nextReachOutAt(RULE, [], NOW)).toBeNull();
    expect(nextReachOutAt(RULE, [sent('jobs', 1)], NOW)).toBeNull();
  });

  it('is the soonest watch, its cadence after its last text less the round slack', () => {
    const at = nextReachOutAt(RULE, [sent('jobs', 1), sent('habit', 2)], NOW);
    // jobs: 1 day ago + 7 days - 12 hours, sooner than habit's 12 days on.
    expect(at).toBe(NOW - DAY + 7 * DAY - 12 * 60 * 60 * 1000);
  });

  it('is due now once a cadence has passed', () => {
    expect(nextReachOutAt(RULE, [sent('jobs', 8), sent('habit', 2)], NOW)).toBeNull();
  });
});

describe('reachOutViewOf', () => {
  it('is empty with no brief', () => {
    expect(reachOutViewOf({ reach_out_brief: '  ' }, [], NOW)).toEqual(NO_REACH_OUT);
  });

  it('keeps the words and the error when no rule was made', () => {
    expect(reachOutViewOf({ reach_out_brief: 'My savings', reach_out_error: 'Dash cannot watch your savings.' }, [], NOW)).toEqual({
      ...NO_REACH_OUT,
      brief: 'My savings',
      error: 'Dash cannot watch your savings.',
    });
  });

  it('keeps the words with no error once turned off', () => {
    expect(reachOutViewOf({ reach_out_brief: 'Jobs on Monday' }, [], NOW)).toEqual({ ...NO_REACH_OUT, brief: 'Jobs on Monday' });
  });

  it('splits what Dash cannot watch out of the summary and says when the next text is due', () => {
    const summary = reachOutSummary('Ada will text you good-fit jobs every week.', ['your savings balance']);
    const view = reachOutViewOf(
      { reach_out_brief: 'Jobs weekly', reach_out_rule: RULE, reach_out_summary: summary },
      [sent('jobs', 1), sent('habit', 2)],
      NOW,
    );
    expect(view.summary).toBe('Ada will text you good-fit jobs every week.');
    expect(view.cannotWatch).toEqual(['your savings balance']);
    expect(view.next?.at).toBe(new Date(NOW + 6 * DAY - 12 * 60 * 60 * 1000).toISOString());
  });
});

describe('understoodOf', () => {
  it('leaves a summary alone when its foot is not the cannot-watch sentence', () => {
    expect(understoodOf('Weekly jobs.', ['x'])).toBe('Weekly jobs.');
  });
});

describe('the next text, in words', () => {
  it('says the next daily round when due now', () => {
    expect(nextTextWhen({ at: null }, { timeZone: ZONE, now: NOW })).toBe('At the next daily round, if there is something new');
    expect(nextTextLine({ at: null }, { timeZone: ZONE, now: NOW })).toBe('Next text at the next round, if there is news');
  });

  it('names the day, keeping a weekday capitalised', () => {
    expect(nextTextLine({ at: '2026-11-09T09:00:00Z' }, { timeZone: ZONE, now: NOW })).toBe('Next text Monday, if there is news');
    expect(nextTextLine({ at: '2026-11-04T09:00:00Z' }, { timeZone: ZONE, now: NOW })).toBe('Next text tomorrow, if there is news');
  });
});
