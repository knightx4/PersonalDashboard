import { describe, expect, it } from 'vitest';
import type { Candidate } from './facts';
import {
  AGENDA_HREF,
  fallbackPicks,
  picksFromKeys,
  PICKS_MAX,
  reasonFor,
  shortlist,
  shortlistPrompt,
  SHORTLIST_MAX,
} from './picks';

const ZONE = { timezone: 'America/New_York' };

const interview: Candidate = {
  kind: 'interview',
  key: 'interview-round:r1',
  title: 'Respark: hiring screen',
  href: null,
  at: '2026-09-29T14:30:00Z',
  detail: 'with Dana',
};
const bill: Candidate = {
  kind: 'bill',
  key: 'bill:c1',
  title: 'Car loan',
  href: '/shopping/recurring',
  event: 'bill',
  dueOn: '2026-09-29',
  dueIn: 0,
  amountCents: 31_250,
  currency: 'USD',
};
const reply: Candidate = {
  kind: 'reply',
  key: 'task:r1',
  taskId: 'r1',
  title: 'Reply to Maya: Offer',
  href: '/todo/all?status=all&focus=r1',
  receivedAt: '2026-09-26T15:00:00Z',
  daysWaiting: 3,
};
const step: Candidate = {
  kind: 'goal-step',
  key: 'goal-step:s1',
  title: 'Measure the walls that could take furniture',
  href: '/goals/g1#step-s1',
  goalTitle: 'Furnish the flat',
  waiting: 5,
  dashWaiting: 5,
};
const rise: Candidate = {
  kind: 'price-rise',
  key: 'price-rise:c2',
  title: 'Netflix',
  href: '/shopping/recurring',
  amountCents: 1500,
  previousAmountCents: 1200,
  currency: 'USD',
  period: 'month',
  startsOn: null,
};

function result(n: number, closedAt: string): Candidate {
  return {
    kind: 'dash-result',
    key: `dash-result:d${n}`,
    title: `Result ${n}`,
    href: null,
    goalTitle: null,
    result: `Finding ${n}`,
    closedAt,
  };
}

function todo(id: string, dueOn: string | null, createdAt: string, overdue = true): Candidate {
  return {
    kind: 'todo',
    key: `task:${id}`,
    taskId: id,
    title: `To-do ${id}`,
    href: `/todo/all?status=all&focus=${id}`,
    dueOn,
    overdue,
    createdAt,
  };
}

const results = Array.from({ length: 12 }, (_, i) =>
  result(i + 1, `2026-09-29T0${Math.floor(i / 2)}:${i % 2 ? '30' : '00'}:00Z`),
);

describe('shortlist', () => {
  it('on a full day takes a round of each kind before a second of any, and stops at eight', () => {
    const list = shortlist(
      [
        ...results,
        rise,
        todo('t1', '2026-09-20', '2026-09-01T00:00:00Z'),
        step,
        reply,
        bill,
        interview,
      ],
      ZONE,
    );
    expect(list).toHaveLength(SHORTLIST_MAX);
    expect(list.map((entry) => entry.pick.key)).toEqual([
      'interview-round:r1',
      'bill:c1',
      'task:r1',
      'goal-step:s1',
      'dash-result:d12',
      'price-rise:c2',
      'dash-result:d11',
      'dash-result:d10',
    ]);
    expect(list.some((entry) => entry.candidate.kind === 'todo')).toBe(false);
  });

  it('gives every entry a reason and a link, falling back to the Agenda or Goals', () => {
    const list = shortlist([interview, result(1, '2026-09-29T01:00:00Z')], ZONE);
    // Intl puts a narrow no-break space before AM.
    expect(list.map((entry) => [entry.pick.reason.replace(/\s/g, ' '), entry.pick.href])).toEqual([
      ['Interview today at 10:30 AM (with Dana)', AGENDA_HREF],
      ['Dash finished this and you have not read it', '/goals'],
    ]);
  });

  it('on a quiet day is empty', () => {
    expect(shortlist([], ZONE)).toEqual([]);
    expect(fallbackPicks([])).toEqual([]);
  });

  it('with only to-dos is the oldest one alone', () => {
    const list = shortlist(
      [
        todo('late', '2026-09-25', '2026-09-01T00:00:00Z'),
        todo('today', '2026-09-29', '2026-08-01T00:00:00Z', false),
        todo('older', '2026-09-20', '2026-09-10T00:00:00Z'),
        todo('older-still', '2026-09-20', '2026-09-05T00:00:00Z'),
      ],
      ZONE,
    );
    expect(list.map((entry) => entry.pick.key)).toEqual(['task:older-still']);
    expect(list[0]!.pick.reason).toBe('Overdue since 20 September, the oldest thing on your list');
  });

  it('breaks ties by the key, whatever order the candidates came in', () => {
    const a = result(1, '2026-09-29T03:00:00Z');
    const b = { ...result(2, '2026-09-29T03:00:00Z') };
    const forward = shortlist([a, b], ZONE).map((entry) => entry.pick.key);
    const backward = shortlist([b, a], ZONE).map((entry) => entry.pick.key);
    expect(forward).toEqual(['dash-result:d1', 'dash-result:d2']);
    expect(backward).toEqual(forward);
  });

  it('gives the same shortlist for the same candidates in any order', () => {
    const all = [...results, rise, step, reply, bill, interview];
    const once = shortlist(all, ZONE);
    expect(shortlist([...all].reverse(), ZONE)).toEqual(once);
  });

  it('drops a repeated key', () => {
    expect(shortlist([reply, reply], ZONE)).toHaveLength(1);
  });
});

describe('reasonFor', () => {
  it('says why each kind matters from its facts', () => {
    expect(reasonFor(bill, ZONE)).toBe('$312.50 due today');
    expect(
      reasonFor({ ...bill, event: 'trial_ending', dueIn: 1, amountCents: null } as Candidate, ZONE),
    ).toBe('The free trial ends tomorrow');
    expect(reasonFor(rise, ZONE)).toBe('Up from $12.00 to $15.00 a month');
    expect(reasonFor({ ...rise, startsOn: '2026-10-03' } as Candidate, ZONE)).toBe(
      'Up from $12.00 to $15.00 a month, from 3 October',
    );
    expect(reasonFor(reply, ZONE)).toBe('Waiting on your reply for 3 days');
    expect(reasonFor({ ...reply, daysWaiting: 1 } as Candidate, ZONE)).toBe(
      'Waiting on your reply since yesterday',
    );
    expect(reasonFor(step, ZONE)).toBe('5 Dash steps wait on this');
    expect(reasonFor({ ...step, waiting: 4, dashWaiting: 1 } as Candidate, ZONE)).toBe(
      "4 steps wait on this, 1 of them Dash's",
    );
    expect(reasonFor({ ...step, waiting: 1, dashWaiting: 0 } as Candidate, ZONE)).toBe(
      '1 step waits on this',
    );
  });
});

describe('picks', () => {
  const list = shortlist([...results, rise, step, reply, bill, interview], ZONE);

  it('without a choice from Dash are the first three of the shortlist', () => {
    expect(fallbackPicks(list).map((pick) => pick.key)).toEqual([
      'interview-round:r1',
      'bill:c1',
      'task:r1',
    ]);
  });

  it("keep Dash's order, drop what is not on the shortlist and repeats, and stop at three", () => {
    const picks = picksFromKeys(list, [
      'goal-step:s1',
      'task:not-on-the-list',
      'goal-step:s1',
      ' price-rise:c2 ',
      'dash-result:d12',
      'bill:c1',
    ]);
    expect(picks?.map((pick) => pick.key)).toEqual([
      'goal-step:s1',
      'price-rise:c2',
      'dash-result:d12',
    ]);
    expect(picks).toHaveLength(PICKS_MAX);
    for (const pick of picks ?? []) {
      expect(pick.reason).not.toBe('');
      expect(pick.href).toMatch(/^\//);
    }
  });

  it('are null when Dash named nothing on the shortlist, so the caller falls back', () => {
    expect(picksFromKeys(list, [])).toBeNull();
    expect(picksFromKeys(list, ['task:elsewhere'])).toBeNull();
  });

  it('are the same for the same shortlist and the same reply', () => {
    const keys = ['task:r1', 'interview-round:r1'];
    expect(picksFromKeys(list, keys)).toEqual(
      picksFromKeys(
        shortlist([...results, rise, step, reply, bill, interview].reverse(), ZONE),
        keys,
      ),
    );
  });
});

describe('shortlistPrompt', () => {
  it('gives Dash each key with its kind, title, reason and extra facts', () => {
    const prompt = shortlistPrompt(
      '2026-09-29',
      shortlist([step, result(1, '2026-09-29T01:00:00Z')], ZONE),
    );
    expect(prompt).toContain('key: goal-step:s1');
    expect(prompt).toContain('why: 5 Dash steps wait on this');
    expect(prompt).toContain('goal: Furnish the flat');
    expect(prompt).toContain('result: Finding 1');
  });
});
