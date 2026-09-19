import { describe, expect, it, vi } from 'vitest';
import { pickUpRaise, pickupTurn } from './pickup';
import { raisedRowFrom } from './load';
import { startRoutineRun } from '@/lib/plan/runs';

// Firing a routine is its own tested unit; what matters here is whether it is
// reached at all, and what the turn it is handed says.
vi.mock('@/lib/plan/runs', () => ({
  startRoutineRun: vi.fn(async () => ({ ok: true, runId: 'run-1', status: 200, body: null })),
}));

const USER = '11111111-1111-1111-1111-111111111111';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '22222222-2222-2222-2222-222222222222',
  title: 'The review queue re-scores every held message',
  detail: 'The scorer is handed nulls for signals the row already carries.',
  ask: 'Should the page pass the thread id it already has into the scorer?',
  consequence: null,
  outcome: null,
  module: 'jobs',
  source: 'notes session 2026-09-11',
  status: 'answered',
  created_at: '2026-09-11T20:07:08Z',
  answered_at: '2026-09-11T20:39:45Z',
  thread: [
    { id: 'c1', author: 'claude', body: 'Raised it.', created_at: '2026-09-11T20:07:09Z' },
    { id: 'c2', author: 'me', body: 'yes', created_at: '2026-09-11T20:39:45Z' },
  ],
  ...over,
});

/** A client that hands back one raise, which is all this reads. */
function db(found: Record<string, unknown> | null) {
  return {
    from() {
      return {
        select() {
          const filtered = {
            eq: () => filtered,
            maybeSingle: () => Promise.resolve({ data: found }),
          };
          return filtered;
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('the turn a picked-up raise is handed', () => {
  it('carries the raise, what was already said, and the answer', () => {
    const raise = raisedRowFrom(row());
    const turn = pickupTurn({
      userId: USER,
      row: raise,
      history: raise.thread.filter((comment) => comment.id !== 'c2'),
      answer: 'yes',
    });

    expect(turn).toContain('The review queue re-scores every held message');
    expect(turn).toContain('Claude: Raised it.');
    expect(turn).toContain('## Their answer\n\nyes');
    // Both writes are spelled out, because the CLI cannot reach the database
    // from Claude Code on the web.
    expect(turn).toContain('insert into dev_comments');
    expect(turn).toContain("update raised_items set status = 'closed'");
  });
});

describe('picking a raise up', () => {
  it('starts a run on the raise, not on a plan step', async () => {
    const picked = await pickUpRaise({
      supabase: db(row()),
      userId: USER,
      id: '22222222-2222-2222-2222-222222222222',
      commentId: 'c2',
      answer: 'yes',
    });

    expect(picked.ok).toBe(true);
    expect(vi.mocked(startRoutineRun)).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(startRoutineRun).mock.calls[0][0];
    expect(sent.job).toBe('raise');
    expect(sent.planItemId).toBeNull();
    // The comment carrying the answer is the answer, not history above it.
    expect(sent.text).not.toContain('The person: yes');
  });

  it('starts nothing on a raise that is already finished with', async () => {
    vi.mocked(startRoutineRun).mockClear();
    const picked = await pickUpRaise({
      supabase: db(row({ status: 'closed' })),
      userId: USER,
      id: '22222222-2222-2222-2222-222222222222',
      commentId: 'c3',
      answer: 'worth remembering',
    });

    expect(picked).toEqual({ ok: false, said: null });
    expect(vi.mocked(startRoutineRun)).not.toHaveBeenCalled();
  });
});
