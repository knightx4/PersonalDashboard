import { describe, expect, it } from 'vitest';
import type { FiledEntry } from '@/lib/goals/capture';
import {
  PACE_ENOUGH_DAYS,
  activeDays,
  goalPace,
  lastActiveWords,
  paceHint,
  paceLine,
  paceWords,
  type PaceSources,
} from '@/lib/goals/pace';

const TODAY = '2026-10-11';
const TZ = 'UTC';

function sources(over: Partial<PaceSources> = {}): PaceSources {
  return {
    steps: [],
    progress: [],
    periods: [],
    captures: [],
    itemIds: new Set(['goal', 'step-a', 'step-b']),
    ...over,
  };
}

describe('activeDays', () => {
  it('counts closed steps of yours, not Dash’s, and leaves open ones out', () => {
    const days = activeDays(
      sources({
        steps: [
          { kind: 'mine', status: 'done', closedAt: '2026-10-03T18:00:00Z' },
          { kind: 'decision', status: 'done', closedAt: '2026-10-05T09:00:00Z' },
          { kind: 'claude', status: 'done', closedAt: '2026-10-07T10:00:00Z' },
          { kind: 'mine', status: 'open', closedAt: null },
          { kind: 'mine', status: 'dropped', closedAt: '2026-10-08T10:00:00Z' },
        ],
      }),
      TODAY,
      TZ,
    );
    expect(days).toEqual(['2026-10-03', '2026-10-05']);
  });

  it('reads an instant as a day in the account’s zone', () => {
    const days = activeDays(
      sources({ steps: [{ kind: 'mine', status: 'done', closedAt: '2026-10-04T03:00:00Z' }] }),
      TODAY,
      'America/Los_Angeles',
    );
    expect(days).toEqual(['2026-10-03']);
  });

  it('counts progress by the day it happened, each day once', () => {
    const days = activeDays(
      sources({
        progress: [{ happenedOn: '2026-10-02' }, { happenedOn: '2026-10-02' }, { happenedOn: '2026-10-09' }],
      }),
      TODAY,
      TZ,
    );
    expect(days).toEqual(['2026-10-02', '2026-10-09']);
  });

  it('places a counted period on the day its count moved, kept inside the period', () => {
    const days = activeDays(
      sources({
        periods: [
          { startsOn: '2026-10-05', endsOn: '2026-10-12', count: 1, updatedAt: '2026-10-07T12:00:00Z' },
          // Closed the morning after it ended: kept on its last day.
          { startsOn: '2026-09-28', endsOn: '2026-10-05', count: 2, updatedAt: '2026-10-05T10:05:00Z' },
          { startsOn: '2026-10-01', endsOn: '2026-10-02', count: 0, updatedAt: '2026-10-01T20:00:00Z' },
        ],
      }),
      TODAY,
      TZ,
    );
    expect(days).toEqual(['2026-10-04', '2026-10-07']);
  });

  it('counts filed capture lines on the goal that record something done', () => {
    const filed: FiledEntry[] = [
      { kind: 'close', step_id: 'step-a', title: 'x', goal_title: 'g', undone_at: null },
      {
        kind: 'count',
        step_id: 'step-b',
        title: 'x',
        goal_title: 'g',
        starts_on: '2026-10-05',
        counted_on: '2026-10-06',
        undone_at: null,
      },
      { kind: 'add', step_id: 'step-a', title: 'x', step_kind: 'mine', goal_title: 'g', undone_at: null },
      { kind: 'close', step_id: 'elsewhere', title: 'x', goal_title: 'h', undone_at: null },
      { kind: 'reading', reading_id: 'r', goal_id: 'goal', goal_title: 'g', value: 3, unit: null, undone_at: '2026-10-08T00:00:00Z' },
    ];
    const days = activeDays(
      sources({ captures: [{ createdAt: '2026-10-08T15:00:00Z', filed }] }),
      TODAY,
      TZ,
    );
    expect(days).toEqual(['2026-10-06', '2026-10-08']);
  });

  it('leaves out anything older than eight weeks or after today', () => {
    const days = activeDays(
      sources({
        progress: [{ happenedOn: '2026-08-16' }, { happenedOn: '2026-08-17' }, { happenedOn: '2026-10-12' }],
      }),
      TODAY,
      TZ,
    );
    expect(days).toEqual(['2026-08-17']);
  });
});

describe('goalPace', () => {
  it('says not enough to tell with fewer than four active days in six weeks', () => {
    const pace = goalPace(['2026-10-01', '2026-10-05', '2026-10-09'], TODAY);
    expect(pace).toEqual({ known: false, activeDays: 3, lastOn: '2026-10-09', daysSince: 2 });
    expect(paceWords(pace)).toBe('Not enough to tell yet');
    expect(paceLine(pace)).toBe('last active 2 days ago');
    expect(paceHint(pace)).toContain(`needs ${PACE_ENOUGH_DAYS} active days`);
  });

  it('does not count days older than six weeks towards enough', () => {
    const pace = goalPace(['2026-08-20', '2026-08-25', '2026-08-30', '2026-10-09'], TODAY);
    expect(pace.known).toBe(false);
  });

  it('says nothing in the line when there is no active day at all', () => {
    const pace = goalPace([], TODAY);
    expect(pace).toEqual({ known: false, activeDays: 0, lastOn: null, daysSince: null });
    expect(paceLine(pace)).toBeNull();
    expect(lastActiveWords(pace)).toBeNull();
  });

  it('takes the median gap, so one long break does not set it', () => {
    const pace = goalPace(['2026-09-01', '2026-09-30', '2026-10-04', '2026-10-09'], TODAY);
    // Gaps 29, 4, 5: the median is 5.
    expect(pace).toMatchObject({ known: true, typicalGap: 5, daysSince: 2, slower: false });
    expect(paceWords(pace)).toBe('Every 5 days');
    expect(lastActiveWords(pace)).toBe('2 days ago');
    expect(paceLine(pace)).toBe('usually every 5 days, last 2 days ago');
  });

  it('reads slower than usual once the gap passes one and a half times the usual', () => {
    const days = ['2026-09-20', '2026-09-24', '2026-09-28', '2026-10-02'];
    expect(goalPace(days, '2026-10-08')).toMatchObject({ typicalGap: 4, daysSince: 6, slower: false });
    expect(goalPace(days, '2026-10-09')).toMatchObject({ typicalGap: 4, daysSince: 7, slower: true });
  });

  it('takes halfway between the two middle gaps for an even count', () => {
    // Gaps 1, 1, 3, 5: halfway between 1 and 3.
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-03', '2026-10-08'];
    expect(goalPace(days, TODAY)).toMatchObject({ known: true, typicalGap: 2, daysSince: 3, slower: false });
  });

  it('says every day and today for a daily habit', () => {
    const pace = goalPace(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'], TODAY);
    expect(paceWords(pace)).toBe('Every day');
    expect(lastActiveWords(pace)).toBe('Today');
    expect(paceLine(pace)).toBe('usually every day, last today');
  });
});
