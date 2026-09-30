import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { QUIET_LINE, type BriefFact, type Candidate } from './facts';
import { runDayBriefFor, type DayBriefPorts, type DayBriefRow } from './run';

const PERSON = { userId: 'u1', timezone: 'America/New_York' };
const MORNING = new Date('2026-09-28T10:05:00Z'); // 06:05 in New York
const REPORT: SpendReport = {
  model: 'claude-haiku-4-5',
  usage: { inputTokens: 900, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 120 },
} as SpendReport;

const BUSY: BriefFact[] = [
  { kind: 'booked', text: '09:30: Interview with Acme' },
  { kind: 'overdue', text: 'Renew passport' },
];

function ports(overrides: Partial<DayBriefPorts> = {}) {
  const saved: DayBriefRow[] = [];
  const events: string[] = [];
  const base: DayBriefPorts = {
    hasBrief: vi.fn(async () => false),
    facts: vi.fn(async () => BUSY),
    write: vi.fn(async (_day, _facts, onSpend) => {
      onSpend(REPORT);
      return { model: 'claude-haiku-4-5', text: 'You have the Acme interview at 09:30, and the passport is overdue.' };
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

  it('stores the model brief with its facts, records the spend, then hands the row on', async () => {
    const { ports: p, saved, events } = ports();
    const result = await runDayBriefFor(p, PERSON, MORNING);
    expect(result).toEqual({
      status: 'written',
      day: '2026-09-28',
      quiet: false,
      model: 'claude-haiku-4-5',
      facts: 2,
      candidates: 0,
    });
    expect(saved).toEqual([
      {
        user_id: 'u1',
        day: '2026-09-28',
        body: 'You have the Acme interview at 09:30, and the passport is overdue.',
        facts: BUSY,
        model: 'claude-haiku-4-5',
      },
    ]);
    expect(p.ledger).toHaveBeenCalledWith('u1', REPORT);
    expect(events).toEqual(['save', 'written']);
  });

  it('writes a quiet day as one line without asking the model', async () => {
    const { ports: p, saved } = ports({ facts: vi.fn(async () => [{ kind: 'news', text: 'Rates held' }] as BriefFact[]) });
    const result = await runDayBriefFor(p, PERSON, MORNING);
    expect(result).toMatchObject({ status: 'written', quiet: true, model: null });
    expect(p.write).not.toHaveBeenCalled();
    expect(saved[0]?.body).toBe(QUIET_LINE);
  });

  it('falls back to the plain brief when the call fails, still recording what it cost', async () => {
    const { ports: p, saved } = ports({
      write: vi.fn(async (_day, _facts, onSpend) => {
        onSpend(REPORT);
        throw new Error('overloaded');
      }),
    });
    const result = await runDayBriefFor(p, PERSON, MORNING);
    expect(result).toMatchObject({ status: 'written', model: null });
    expect(saved[0]?.body).toBe('Booked today: 09:30: Interview with Acme. Overdue: Renew passport.');
    expect(p.ledger).toHaveBeenCalledTimes(1);
  });

  it('falls back to the plain brief without a key', async () => {
    const { ports: p, saved } = ports({ write: vi.fn(async () => null) });
    await runDayBriefFor(p, PERSON, MORNING);
    expect(saved[0]?.model).toBeNull();
    expect(saved[0]?.body).toContain('Interview with Acme');
  });

  it('counts the candidates, and a failure gathering them costs only them', async () => {
    const reply: Candidate = {
      kind: 'reply',
      key: 'task:t1',
      taskId: 't1',
      title: 'Reply to Maya: Offer',
      href: '/todo/all?status=all&focus=t1',
      receivedAt: '2026-09-25T15:00:00Z',
      daysWaiting: 2,
    };
    const counted = ports({ candidates: vi.fn(async () => [reply]) });
    expect(await runDayBriefFor(counted.ports, PERSON, MORNING)).toMatchObject({ status: 'written', candidates: 1 });

    const failing = ports({
      candidates: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    expect(await runDayBriefFor(failing.ports, PERSON, MORNING)).toMatchObject({ status: 'written', candidates: 0 });
    expect(failing.saved).toHaveLength(1);
  });

  it('does not hand the row on when another call stored the day first', async () => {
    const { ports: p } = ports({ save: vi.fn(async () => false) });
    expect(await runDayBriefFor(p, PERSON, MORNING)).toEqual({ status: 'already-written', day: '2026-09-28' });
    expect(p.written).not.toHaveBeenCalled();
  });
});
