import { describe, expect, it, vi } from 'vitest';
import { fireSessionHandoff, NO_SESSION_ROUTINE } from './handoff-fire';
import type { SessionHandoff } from './handoffs';

/** A stand-in for core.dash_handoffs: one row, and the updates made to it. */
function fakeCore(row: { status: string; claimed_by?: string | null }) {
  const updates: Record<string, unknown>[] = [];
  const core = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const apply = () => {
          const matches =
            (filters.status === undefined || filters.status === row.status) &&
            (!('claimed_by' in filters) || filters.claimed_by === (row.claimed_by ?? null));
          if (matches) {
            updates.push(patch);
            if (typeof patch.status === 'string') row.status = patch.status;
          }
          return matches;
        };
        const chain = {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          is: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          select: async () => ({ data: apply() ? [{ id: 'h1' }] : [], error: null }),
          then: (resolve: (value: { error: null }) => void) => {
            apply();
            resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  };
  return { core: core as never, updates, row };
}

const HANDOFF: SessionHandoff = {
  id: 'h1',
  advisorId: null,
  conversationId: 'c1',
  advisorChatId: null,
  request: 'Write #3001 in full',
  asked: 'flesh out 3001',
  summary: null,
  refs: [],
  subjectRef: null,
  requestKey: 'k',
  state: 'queued',
  runId: null,
  error: null,
  costMicros: null,
  createdAt: '2026-11-06T00:00:00Z',
  firedAt: null,
  finishedAt: null,
  lastSeenAt: null,
  browserTask: false,
  browser: null,
  browserReason: null,
};

const ROUTINE = () => ({ id: 'trig_1', token: 'tok' });
const NOW = () => new Date('2026-11-06T10:00:00Z');

describe('fireSessionHandoff', () => {
  it('claims the row, starts the backup routine with the session brief, and keeps the run id', async () => {
    const { core, updates, row } = fakeCore({ status: 'pending' });
    const fire = vi.fn(async () => ({ ok: true as const, detail: '', status: 200, body: {}, runId: 'cse_9' }));
    const result = await fireSessionHandoff(core, 'u1', HANDOFF, { routine: ROUTINE, fire, now: NOW });
    expect(result).toEqual({ state: 'running', runId: 'cse_9', error: null, started: true });
    expect(row.status).toBe('fired');
    expect(updates[0]).toMatchObject({ status: 'fired', fired_at: '2026-11-06T10:00:00.000Z' });
    expect(updates[1]).toEqual({ run_id: 'cse_9' });
    const sent = fire.mock.calls[0] as unknown as [{ apiKey: string; routineId: string; text: string }];
    expect(sent[0]).toMatchObject({ apiKey: 'tok', routineId: 'trig_1' });
    expect(sent[0].text.startsWith('Hand-off h1\nkind session\nuser_id u1')).toBe(true);
  });

  it('starts nothing for a row another caller already claimed', async () => {
    const { core } = fakeCore({ status: 'fired' });
    const fire = vi.fn();
    const result = await fireSessionHandoff(core, 'u1', HANDOFF, { routine: ROUTINE, fire, now: NOW });
    expect(result.state).toBe('running');
    expect(fire).not.toHaveBeenCalled();
  });

  it('starts nothing for a hand-off that is not queued', async () => {
    const { core } = fakeCore({ status: 'done' });
    const fire = vi.fn();
    const result = await fireSessionHandoff(core, 'u1', { ...HANDOFF, state: 'done' }, { routine: ROUTINE, fire });
    expect(result.state).toBe('done');
    expect(fire).not.toHaveBeenCalled();
  });

  it('marks it failed with the reason when the routine refuses', async () => {
    const { core, row, updates } = fakeCore({ status: 'pending' });
    const fire = vi.fn(async () => ({ ok: false as const, error: 'Anthropic answered 401.', status: 401, body: null }));
    const result = await fireSessionHandoff(core, 'u1', HANDOFF, { routine: ROUTINE, fire, now: NOW });
    expect(result).toEqual({
      state: 'failed',
      runId: null,
      error: 'The session could not be started: Anthropic answered 401.',
      started: false,
    });
    expect(row.status).toBe('failed');
    expect(updates[1]).toMatchObject({
      status: 'failed',
      finished_at: '2026-11-06T10:00:00.000Z',
      told_at: '2026-11-06T10:00:00.000Z',
    });
  });

  it('marks it failed when no routine is set up', async () => {
    const { core, row } = fakeCore({ status: 'pending' });
    const fire = vi.fn();
    const result = await fireSessionHandoff(core, 'u1', HANDOFF, {
      routine: () => ({ id: null, token: null }),
      fire,
      now: NOW,
    });
    expect(result).toEqual({ state: 'failed', runId: null, error: NO_SESSION_ROUTINE, started: false });
    expect(row.status).toBe('failed');
    expect(fire).not.toHaveBeenCalled();
  });
});

describe('fireSessionHandoff on a browser task (plan #3040.4)', () => {
  const BROWSER: SessionHandoff = { ...HANDOFF, browserTask: true };

  it('starts nothing when it is kept, leaving it for a computer of theirs to claim', async () => {
    const { core, row, updates } = fakeCore({ status: 'pending', claimed_by: null });
    const fire = vi.fn();
    const result = await fireSessionHandoff(core, 'u1', BROWSER, { routine: ROUTINE, fire, now: NOW });
    expect(result).toEqual({ state: 'queued', runId: null, error: null, started: false });
    expect(row.status).toBe('pending');
    expect(updates).toHaveLength(0);
    expect(fire).not.toHaveBeenCalled();
  });

  it('starts the cloud session after the wait when no computer claimed it', async () => {
    const { core, row } = fakeCore({ status: 'pending', claimed_by: null });
    const fire = vi.fn(async () => ({ ok: true as const, detail: '', status: 200, body: {}, runId: 'cse_7' }));
    const result = await fireSessionHandoff(core, 'u1', BROWSER, { routine: ROUTINE, fire, now: NOW, afterWait: true });
    expect(result).toEqual({ state: 'running', runId: 'cse_7', error: null, started: true });
    expect(row.status).toBe('fired');
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('starts nothing after the wait when the PC or Mac took it', async () => {
    const { core, row, updates } = fakeCore({ status: 'pending', claimed_by: 'pc' });
    const fire = vi.fn();
    const result = await fireSessionHandoff(core, 'u1', BROWSER, { routine: ROUTINE, fire, now: NOW, afterWait: true });
    expect(result.started).toBe(false);
    expect(row.status).toBe('pending');
    expect(updates).toHaveLength(0);
    expect(fire).not.toHaveBeenCalled();
  });

  it('still starts a hand-off that is not a browser task at once', async () => {
    const { core, row } = fakeCore({ status: 'pending', claimed_by: 'pc' });
    const fire = vi.fn(async () => ({ ok: true as const, detail: '', status: 200, body: {}, runId: 'cse_8' }));
    const result = await fireSessionHandoff(core, 'u1', HANDOFF, { routine: ROUTINE, fire, now: NOW });
    expect(result.started).toBe(true);
    expect(row.status).toBe('fired');
  });
});
