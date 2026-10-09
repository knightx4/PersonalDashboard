import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { BriefFact, Candidate } from './facts';
import { BODY_MAX, NO_PICKS, TITLE_MAX } from './notification';
import { runDayBriefFor, type DayBriefPorts, type DayBriefRow } from './run';

const PERSON = { userId: 'u1', timezone: 'America/New_York' };
const MORNING = new Date('2026-09-28T10:05:00Z'); // 06:05 in New York
const REPORT: SpendReport = {
  model: 'claude-haiku-5-5',
  usage: { inputTokens: 900, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 120 },
} as SpendReport;

const BUSY: BriefFact[] = [
  { kind: 'booked', text: '09:30: Interview with Acme' },
  { kind: 'overdue', text: 'Renew passport' },
];

const REPLY: Candidate = {
  kind: 'reply',
  key: 'task:t1',
  taskId: 't1',
  title: 'Reply to Maya: Offer',
  href: '/todo/all?status=all&focus=t1',
  receivedAt: '2026-09-25T15:00:00Z',
  daysWaiting: 2,
};
const RESULT: Candidate = {
  kind: 'dash-result',
  key: 'dash-result:d1',
  title: 'Price the sofa',
  href: '/goals/g1/s/d1',
  goalTitle: 'Furnish the flat',
  result: 'Three sofas under $900.',
  closedAt: '2026-09-28T02:00:00Z',
};
const TODO: Candidate = {
  kind: 'todo',
  key: 'task:t9',
  taskId: 't9',
  title: 'Check mailbox',
  href: '/todo/all?status=all&focus=t9',
  dueOn: '2026-09-20',
  overdue: true,
  createdAt: '2026-09-01T00:00:00Z',
};

const DASH_NOTE = { title: 'Reply to Maya about the offer', body: 'Maya has waited 2 days for your reply on the offer.' };

function ports(overrides: Partial<DayBriefPorts> = {}) {
  const saved: DayBriefRow[] = [];
  const events: string[] = [];
  const base: DayBriefPorts = {
    hasBrief: vi.fn(async () => false),
    facts: vi.fn(async () => BUSY),
    candidates: vi.fn(async () => [REPLY]),
    write: vi.fn(async (_day, _picks, onSpend) => {
      onSpend(REPORT);
      return { model: 'claude-haiku-5-5', reply: DASH_NOTE };
    }),
    ledger: vi.fn(async () => undefined),
    save: vi.fn(async (row) => {
      saved.push(row);
      events.push('save');
      return true;
    }),
    written: vi.fn(async () => {
      events.push('written');
    }),
  };
  return { ports: { ...base, ...overrides }, saved, events };
}

describe('runDayBriefFor', () => {
  it('does nothing outside the morning window', async () => {
    const { ports: p } = ports();
    expect(await runDayBriefFor(p, PERSON, new Date('2026-09-28T09:00:00Z'))).toEqual({ status: 'not-morning' });
    expect(p.hasBrief).not.toHaveBeenCalled();
  });

  it('does nothing when the day is already written', async () => {
    const { ports: p } = ports({ hasBrief: vi.fn(async () => true) });
    expect(await runDayBriefFor(p, PERSON, MORNING)).toEqual({ status: 'already-written', day: '2026-09-28' });
    expect(p.facts).not.toHaveBeenCalled();
  });

  it("stores Dash's notification with its picks and facts, records the spend, then hands the row on", async () => {
    const { ports: p, saved, events } = ports();
    const result = await runDayBriefFor(p, PERSON, MORNING);
    expect(result).toEqual({
      status: 'written',
      day: '2026-09-28',
      quiet: false,
      model: 'claude-haiku-5-5',
      facts: 2,
      candidates: 1,
      picks: 1,
    });
    expect(saved).toEqual([
      {
        user_id: 'u1',
        day: '2026-09-28',
        title: 'Reply to Maya about the offer',
        body: 'Maya has waited 2 days for your reply on the offer.',
        facts: BUSY,
        model: 'claude-haiku-5-5',
        picks: [
          {
            key: 'task:t1',
            kind: 'reply',
            title: 'Reply to Maya: Offer',
            reason: 'Waiting on your reply for 2 days',
            href: '/todo/all?status=all&focus=t1',
          },
        ],
      },
    ]);
    expect(p.write).toHaveBeenCalledWith('2026-09-28', saved[0]?.picks, expect.any(Function));
    expect(p.ledger).toHaveBeenCalledWith('u1', REPORT);
    expect(events).toEqual(['save', 'written']);
  });

  it('stores a day with no picks without asking Dash, and sends nothing', async () => {
    const { ports: p, saved, events } = ports({ candidates: vi.fn(async () => []) });
    const result = await runDayBriefFor(p, PERSON, MORNING);
    expect(result).toMatchObject({ status: 'written', quiet: true, model: null, picks: 0 });
    expect(p.write).not.toHaveBeenCalled();
    expect(saved[0]).toMatchObject({ title: NO_PICKS.title, body: NO_PICKS.body, picks: [], facts: BUSY });
    expect(p.written).not.toHaveBeenCalled();
    expect(events).toEqual(['save']);
  });

  it('builds the notification from the picks when the call fails, still recording what it cost', async () => {
    const { ports: p, saved, events } = ports({
      write: vi.fn(async (_day, _picks, onSpend) => {
        onSpend(REPORT);
        throw new Error('overloaded');
      }),
    });
    const result = await runDayBriefFor(p, PERSON, MORNING);
    expect(result).toMatchObject({ status: 'written', model: null });
    expect(saved[0]).toMatchObject({ title: 'Reply to Maya: Offer', body: 'Waiting on your reply for 2 days.' });
    expect(p.ledger).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['save', 'written']);
  });

  it('builds the notification from the picks without a key', async () => {
    const { ports: p, saved } = ports({ write: vi.fn(async () => null) });
    await runDayBriefFor(p, PERSON, MORNING);
    expect(saved[0]?.model).toBeNull();
    expect(saved[0]?.title).toBe('Reply to Maya: Offer');
  });

  it("refuses Dash's notification when it is longer than a lock screen or names what the picks do not", async () => {
    const replies = [
      { title: 'Reply to Maya, who has been waiting on you about the offer', body: 'Two days now.' },
      { title: 'Reply to Maya', body: 'Maya has waited 2 days. '.repeat(10) },
      { title: 'Reply to Maya', body: 'Maya has waited 2 days, and the dentist is at 16:00.' },
    ];
    for (const reply of replies) {
      const { ports: p, saved } = ports({ write: vi.fn(async () => ({ model: 'claude-haiku-5-5', reply })) });
      await runDayBriefFor(p, PERSON, MORNING);
      expect(saved[0]).toMatchObject({ title: 'Reply to Maya: Offer', model: null });
    }
  });

  it('keeps the title and body within a lock screen and about the picks alone', async () => {
    const long: Candidate = { ...RESULT, title: 'Price the sofa, the rug and the lamp for the new flat on Elm Street' };
    const { ports: p, saved } = ports({
      candidates: vi.fn(async () => [REPLY, long, TODO]),
      write: vi.fn(async () => null),
    });
    await runDayBriefFor(p, PERSON, MORNING);
    const row = saved[0]!;
    expect(row.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(row.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(row.title).toBe('Reply to Maya: Offer');
    expect(row.body).toContain('Price the sofa');
    expect(row.body).not.toContain('Check mailbox');
    expect(row.body).not.toContain('Acme');
  });

  it('counts the candidates, and a failure gathering them costs only them', async () => {
    const counted = ports();
    expect(await runDayBriefFor(counted.ports, PERSON, MORNING)).toMatchObject({ status: 'written', candidates: 1 });

    const failing = ports({
      candidates: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    expect(await runDayBriefFor(failing.ports, PERSON, MORNING)).toMatchObject({
      status: 'written',
      candidates: 0,
      quiet: true,
    });
    expect(failing.saved).toHaveLength(1);
  });

  it("stores Dash's picks from the shortlist, in its order, and records what the choice cost", async () => {
    const choose = vi.fn(async (_day: string, _list: unknown, onSpend: (report: SpendReport) => void) => {
      onSpend(REPORT);
      return { model: 'claude-haiku-5-5', keys: ['dash-result:d1', 'nope', 'task:t1', 'dash-result:d1'] };
    });
    const { ports: p, saved } = ports({ candidates: vi.fn(async () => [REPLY, RESULT, TODO]), choose });
    expect(await runDayBriefFor(p, PERSON, MORNING)).toMatchObject({ status: 'written', candidates: 3, picks: 2 });
    expect(choose.mock.calls[0]?.[1]).toHaveLength(2); // the to-do is left off the shortlist
    expect(saved[0]?.picks.map((pick) => pick.key)).toEqual(['dash-result:d1', 'task:t1']);
    expect(p.ledger).toHaveBeenCalledTimes(2);
  });

  it("falls back to the shortlist's first three when the choice fails or there is no key", async () => {
    const failing = ports({
      candidates: vi.fn(async () => [RESULT, REPLY]),
      choose: vi.fn(async () => {
        throw new Error('overloaded');
      }),
    });
    await runDayBriefFor(failing.ports, PERSON, MORNING);
    expect(failing.saved[0]?.picks.map((pick) => pick.key)).toEqual(['task:t1', 'dash-result:d1']);

    const keyless = ports({ candidates: vi.fn(async () => [RESULT, REPLY]), choose: vi.fn(async () => null) });
    await runDayBriefFor(keyless.ports, PERSON, MORNING);
    expect(keyless.saved[0]?.picks.map((pick) => pick.key)).toEqual(['task:t1', 'dash-result:d1']);
  });

  it('does not ask Dash about a single candidate, and names the oldest to-do only when nothing else qualifies', async () => {
    const choose = vi.fn();
    const { ports: p, saved } = ports({ candidates: vi.fn(async () => [TODO]), choose });
    await runDayBriefFor(p, PERSON, MORNING);
    expect(choose).not.toHaveBeenCalled();
    expect(saved[0]?.picks).toEqual([
      {
        key: 'task:t9',
        kind: 'todo',
        title: 'Check mailbox',
        reason: 'Overdue since 20 September, the oldest thing on your list',
        href: '/todo/all?status=all&focus=t9',
      },
    ]);
  });

  it('does not hand the row on when another call stored the day first', async () => {
    const { ports: p } = ports({ save: vi.fn(async () => false) });
    expect(await runDayBriefFor(p, PERSON, MORNING)).toEqual({ status: 'already-written', day: '2026-09-28' });
    expect(p.written).not.toHaveBeenCalled();
  });
});
