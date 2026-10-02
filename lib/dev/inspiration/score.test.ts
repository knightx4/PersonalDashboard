import { describe, expect, it, vi } from 'vitest';
import { scoreUnscoredTakeaways, takeawayScoreText } from './score';

const USER = 'user-1';
const SCORE = { value: 75, confidence: 0.9, at: '2026-10-02T00:00:00Z' };

vi.mock('@/lib/specs/vision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/specs/vision')>()),
  loadModuleVisions: vi.fn(async () => ({ dev: { body: 'Make building easy.' } })),
}));

/** The two queries the catch-up makes, recorded. */
function fakeClient(rows: Array<{ id: string; title: string; body: string; module: string | null }>) {
  const updates: Array<{ id: string; score: unknown }> = [];
  const client = {
    from: () => {
      let pending: { score: unknown } | null = null;
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          if (pending && column === 'id') updates.push({ id: value, score: pending.score });
          return chain;
        },
        is: () => (pending ? Promise.resolve({ error: null }) : chain),
        neq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        update: (values: { score: unknown }) => {
          pending = values;
          return chain;
        },
      };
      return chain;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, updates };
}

describe('takeawayScoreText', () => {
  it('puts the title on the first line', () => {
    expect(takeawayScoreText({ title: ' Log decisions ', body: 'Keep a log. ' })).toBe('Log decisions\n\nKeep a log.');
  });
});

describe('scoreUnscoredTakeaways', () => {
  it('asks once per takeaway against its workspace vision and stores what comes back', async () => {
    const { client, updates } = fakeClient([
      { id: 't1', title: 'One', body: 'Body one', module: 'dev' },
      { id: 't2', title: 'Two', body: 'Body two', module: null },
    ]);
    const ask = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, score: SCORE })
      .mockResolvedValueOnce({ ok: false, reason: 'timeout', detail: 'slow' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await scoreUnscoredTakeaways(client, { userId: USER, spend: [], ask, gapMs: 0 });
    warn.mockRestore();

    expect(result).toEqual({ scored: 1, failed: 1, left: 0 });
    expect(ask.mock.calls[0][0]).toMatchObject({ body: 'One\n\nBody one', module: 'dev', vision: 'Make building easy.', triage: null });
    expect(ask.mock.calls[1][0]).toMatchObject({ module: null, vision: null });
    expect(updates).toEqual([{ id: 't1', score: SCORE }]);
  });

  it('starts nothing past the deadline and counts what is left', async () => {
    const { client } = fakeClient([{ id: 't1', title: 'One', body: 'Body', module: null }]);
    const ask = vi.fn();
    const result = await scoreUnscoredTakeaways(client, { userId: USER, spend: [], ask, deadline: 0, now: () => 1 });
    expect(ask).not.toHaveBeenCalled();
    expect(result).toEqual({ scored: 0, failed: 0, left: 1 });
  });
});
