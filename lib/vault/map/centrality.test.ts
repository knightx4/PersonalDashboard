import { describe, expect, it, vi } from 'vitest';
import { scorePositionCentrality } from './centrality';

/**
 * The TypeScript side of scoring centrality. The PageRank itself is
 * obsidian.score_position_centrality; this checks the calls and when they
 * stop.
 */

function client(...replies: { data: unknown; error: unknown }[]) {
  const rpc = vi.fn();
  for (const reply of replies) rpc.mockResolvedValueOnce(reply);
  return { supabase: { rpc } as never, rpc };
}

const clock = (at: number) => () => at;

describe('scorePositionCentrality', () => {
  it('calls again while rows are left, then reports what it wrote', async () => {
    const { supabase, rpc } = client(
      { data: { scored: 4676, written: 1200, remaining: 3476 }, error: null },
      { data: { scored: 4676, written: 3476, remaining: 0 }, error: null },
    );
    const result = await scorePositionCentrality(supabase, { userId: null, deadline: 60_000, now: clock(0) });
    expect(result).toEqual({ scored: 4676, written: 4676, remaining: 0, stopped: null });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('score_position_centrality', { p_user_id: null, p_budget_ms: 4_000 });
  });

  it('stops without spinning when a call has no time to write', async () => {
    const { supabase, rpc } = client({ data: { scored: 10, written: 0, remaining: 10 }, error: null });
    const result = await scorePositionCentrality(supabase, { userId: 'u', deadline: 60_000, now: clock(0) });
    expect(result.stopped).toEqual({ reason: 'time' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not start a call too close to the deadline', async () => {
    const { supabase, rpc } = client();
    const result = await scorePositionCentrality(supabase, { userId: null, deadline: 2_000, now: clock(0) });
    expect(result).toEqual({ scored: 0, written: 0, remaining: 0, stopped: { reason: 'time' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shortens the budget to fit the deadline', async () => {
    const { supabase, rpc } = client({ data: { scored: 1, written: 1, remaining: 0 }, error: null });
    await scorePositionCentrality(supabase, { userId: null, deadline: 3_500, now: clock(0) });
    expect(rpc).toHaveBeenCalledWith('score_position_centrality', { p_user_id: null, p_budget_ms: 2_500 });
  });

  it('returns the database error', async () => {
    const { supabase } = client({ data: null, error: { message: 'boom' } });
    const result = await scorePositionCentrality(supabase, { userId: null, deadline: 60_000, now: clock(0) });
    expect(result.stopped).toEqual({ reason: 'error', detail: 'boom' });
  });
});
