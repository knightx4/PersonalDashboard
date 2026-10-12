import { describe, expect, it, vi } from 'vitest';
import { RUN_SILENT_MINUTES, lineSilent, readLastLines } from './run-liveness';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe('lineSilent (plan #1825)', () => {
  it('says nothing for a run with no lines, so the clock rule applies', () => {
    expect(lineSilent(null, NOW)).toBeNull();
    expect(lineSilent(undefined, NOW)).toBeNull();
    expect(lineSilent('not a time', NOW)).toBeNull();
  });

  it('is silent from 30 minutes after the newest line', () => {
    expect(RUN_SILENT_MINUTES).toBe(30);
    expect(lineSilent(minutesAgo(29), NOW)).toBe(false);
    expect(lineSilent(minutesAgo(30), NOW)).toBe(true);
    expect(lineSilent(minutesAgo(60 * 9), NOW)).toBe(true);
  });

  it('is never silent before the clock has mounted', () => {
    expect(lineSilent(minutesAgo(600), 0)).toBe(false);
  });
});

describe('readLastLines', () => {
  it('maps each run that wrote a line to its newest line time', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ run_id: 'a', last_at: '2026-10-12T11:00:00Z' }],
      error: null,
    }));
    const lines = await readLastLines({ rpc }, 'plan_runs', ['a', 'b', 'a']);
    expect(rpc).toHaveBeenCalledWith('run_last_lines', { p_run_table: 'plan_runs', p_run_ids: ['a', 'b'] });
    expect([...lines]).toEqual([['a', '2026-10-12T11:00:00Z']]);
  });

  it('asks nothing for no runs, and reads a failure as no lines', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    expect((await readLastLines({ rpc }, 'goals.runs', [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await readLastLines({ rpc }, 'goals.runs', ['a'])).size).toBe(0);
    quiet.mockRestore();
  });
});
