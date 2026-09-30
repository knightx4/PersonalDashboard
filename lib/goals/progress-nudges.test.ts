import { describe, expect, it } from 'vitest';
import { dailyRunText } from './daily-run';
import { summariseProgress, type ProgressEntry, type ProgressEstimate } from './progress';
import { progressNudges, underWayLine } from './progress-nudges';
import { buildForest, markStartDates, type Step } from './steps';
import type { Goal } from './tree';

const TODAY = '2026-09-30';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...extra,
  };
}

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    status: 'open',
    title: id,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    ...extra,
  };
}

let n = 0;
function entry(
  itemId: string,
  happenedOn: string,
  quantity: number | null = null,
  unit: string | null = null,
  estimate: ProgressEstimate | null = null,
): ProgressEntry {
  n += 1;
  return {
    id: `e${n}`,
    itemId,
    captureId: null,
    happenedOn,
    text: 'did some',
    quantity,
    unit,
    estimate,
    createdAt: `${happenedOn}T09:00:00Z`,
  };
}

function nudges(goals: Goal[], steps: Step[], entries: ProgressEntry[]) {
  const { byGoal } = buildForest(
    goals.map((g) => g.id),
    steps,
  );
  markStartDates(byGoal, TODAY);
  return progressNudges(goals, byGoal, summariseProgress(entries), TODAY);
}

const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe('progressNudges', () => {
  it('lists a step under way with nothing logged for a week as stalled, longest first', () => {
    const { stalled, finished } = nudges(
      [goal('g')],
      [step('week', 'g'), step('month', 'g'), step('recent', 'g'), step('untouched', 'g')],
      [entry('week', '2026-09-23', 2, 'bags'), entry('month', '2026-08-30'), entry('recent', '2026-09-24')],
    );
    expect(ids(stalled)).toEqual(['month', 'week']);
    expect(stalled[1]).toMatchObject({ idleDays: 7, lastOn: '2026-09-23', sofar: '2 bags so far' });
    expect(finished).toEqual([]);
  });

  it('offers a step whose tally reached its total, however recent, and not one short of it', () => {
    const { stalled, finished } = nudges(
      [goal('g')],
      [
        step('full', 'g', { estimatedTotal: 10, totalUnit: 'bags' }),
        step('short', 'g', { estimatedTotal: 10, totalUnit: 'bags' }),
        step('oldfull', 'g', { estimatedTotal: 3, totalUnit: 'boxes' }),
      ],
      [
        entry('full', '2026-09-29', 9, 'bags'),
        entry('full', '2026-09-28', 1, 'bag'),
        entry('short', '2026-09-29', 9, 'bags'),
        entry('oldfull', '2026-08-01', 4, 'boxes'),
      ],
    );
    expect(ids(finished)).toEqual(['full', 'oldfull']);
    expect(finished[0].sofar).toBe('10 of about 10 bags, the estimate reached');
    expect(stalled).toEqual([]);
  });

  it('offers a step with no total whose newest answer is nearly done', () => {
    const { finished } = nudges(
      [goal('g')],
      [step('nearly', 'g'), step('half', 'g')],
      [
        entry('nearly', '2026-09-29', null, null, 'nearly'),
        entry('half', '2026-09-29', null, null, 'half'),
      ],
    );
    expect(ids(finished)).toEqual(['nearly']);
    expect(finished[0].sofar).toBe('nearly done');
  });

  it('leaves out steps that are not the person’s to move now', () => {
    const { stalled } = nudges(
      [goal('g'), goal('closed', { status: 'done' })],
      [
        step('claude', 'g', { kind: 'claude' }),
        step('rhythm', 'g', { kind: 'rhythm', rhythmCount: 2, rhythmPeriod: 'week' }),
        step('done', 'g', { status: 'done' }),
        step('later', 'g', { startsOn: '2026-11-01' }),
        step('phase', 'g'),
        step('child', 'phase', { title: 'child' }),
        step('elsewhere', 'closed'),
      ],
      ['claude', 'rhythm', 'done', 'later', 'phase', 'elsewhere'].map((id) => entry(id, '2026-08-01')),
    );
    expect(stalled).toEqual([]);
  });
});

describe('the morning brief', () => {
  const review = [
    { id: 'g', title: 'Clear the flat', acceptance: null, lastDoneAt: null, quietDays: 2, stalled: false, last: null },
  ];
  const base = { id: 's', goalId: 'g', goalTitle: 'Clear the flat', lastOn: '2026-09-20', idleDays: 10 };

  it('lists stalled and finished steps before the verdicts, each with the section to follow', () => {
    const text = dailyRunText({
      userId: 'u',
      runId: 'r',
      steps: [],
      review,
      underWay: {
        stalled: [{ ...base, title: 'Sort the garage', sofar: '3 boxes so far' }],
        finished: [{ ...base, id: 't', title: 'Move the bags', sofar: '10 of about 10 bags, the estimate reached' }],
      },
    });
    const nudge = text.indexOf('Then nudge each');
    const offer = text.indexOf('Then offer to close each');
    expect(nudge).toBeGreaterThan(text.indexOf('Closing a step from evidence'));
    expect(offer).toBeGreaterThan(nudge);
    expect(text.indexOf('goals.reviews')).toBeGreaterThan(offer);
    expect(text).toContain(
      '- "Sort the garage" (goals.items id s), under the goal "Clear the flat": 3 boxes so far; last logged 2026-09-20, 10 days ago',
    );
    expect(text).toContain('"Move the bags" (goals.items id t)');
    expect(text).toContain('do not close them');
    expect(text.match(/"Steps\nunder way"|"Steps under way"/g)).toHaveLength(2);
  });

  it('says nothing about steps under way when none has stalled or finished', () => {
    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], review, underWay: { stalled: [], finished: [] } });
    expect(text).not.toContain('under way');
  });

  it('writes a step with no tally without the words for one', () => {
    expect(underWayLine({ ...base, title: 'Paint', sofar: null, idleDays: 1 })).toBe(
      '- "Paint" (goals.items id s), under the goal "Clear the flat": last logged 2026-09-20, 1 day ago',
    );
  });
});
