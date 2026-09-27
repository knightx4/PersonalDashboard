import { describe, expect, it } from 'vitest';
import { summariseSearch, type SummaryApplication, type SummaryInterview } from './summary';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

function app(
  status: SummaryApplication['status'],
  submittedAt: string | null = null,
  confirmationReceivedAt: string | null = null,
): SummaryApplication {
  return { status, submittedAt, confirmationReceivedAt };
}

function interview(
  id: string,
  scheduledAt: string | null,
  groupId: string | null = null,
  timeKnown = true,
): SummaryInterview {
  return { id, scheduledAt, groupId, timeKnown };
}

describe('summariseSearch', () => {
  it('counts live applications by the board columns, closed and unsent ones left out', () => {
    const summary = summariseSearch(
      [
        app('lead'),
        app('drafting'),
        app('submitted'),
        app('acknowledged'),
        app('in_process'),
        app('final_round'),
        app('offer'),
        app('rejected'),
        app('ghosted'),
        app('withdrawn'),
        app('role_closed'),
      ],
      [],
      NOW,
    );
    expect(summary.byStage).toEqual([
      { key: 'submitted', label: 'Submitted', count: 2 },
      { key: 'in_process', label: 'In process', count: 2 },
      { key: 'offer', label: 'Offer', count: 1 },
    ]);
    expect(summary.live).toBe(5);
  });

  it('counts what was sent in the last seven days, whatever became of it', () => {
    const summary = summariseSearch(
      [
        app('acknowledged', ago(1)),
        app('rejected', ago(6)),
        app('acknowledged', null, ago(2)),
        app('acknowledged', ago(8)),
        app('lead'),
      ],
      [],
      NOW,
    );
    expect(summary.sentRecently).toBe(3);
  });

  it('counts upcoming rounds within fourteen days, a round of several once', () => {
    const summary = summariseSearch(
      [],
      [
        interview('a', ahead(2), 'g1'),
        interview('b', ahead(2.1), 'g1'),
        interview('c', ahead(5)),
        interview('d', ahead(20)),
        interview('e', ago(3)),
        interview('f', null),
      ],
      NOW,
    );
    expect(summary.interviewsSoon).toBe(2);
  });

  it('keeps a day-only round from today as upcoming until the day is over', () => {
    const midnight = '2026-09-27T00:00:00.000Z';
    expect(summariseSearch([], [interview('a', midnight, null, false)], NOW).interviewsSoon).toBe(1);
    expect(summariseSearch([], [interview('a', midnight, null, true)], NOW).interviewsSoon).toBe(0);
  });

  it('reports interviews it could not read as unknown, not zero', () => {
    expect(summariseSearch([], null, NOW).interviewsSoon).toBeNull();
  });
});
