import { describe, expect, it } from 'vitest';
import { mergeRunLines, runActivityFrom, type RunActivity } from './run-activities';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  user_id: 'u1',
  run_table: 'plan_runs',
  run_id: 'r1',
  kind: 'action',
  body: 'Claimed #1826',
  options: null,
  created_at: '2026-10-12T10:00:00.000Z',
  ...over,
});

const line = (id: string, at: string): RunActivity => runActivityFrom(row({ id, created_at: at }))!;

describe('runActivityFrom', () => {
  it('reads a row from a select or a Realtime payload', () => {
    expect(runActivityFrom(row())).toEqual({ ...row(), options: null });
  });

  it('keeps a question its choices and drops an empty list', () => {
    expect(runActivityFrom(row({ kind: 'question', options: ['Yes', 'No'] }))?.options).toEqual(['Yes', 'No']);
    expect(runActivityFrom(row({ options: [] }))?.options).toBeNull();
  });

  it('refuses what is not a line it can draw', () => {
    expect(runActivityFrom(null)).toBeNull();
    expect(runActivityFrom(row({ kind: 'shout' }))).toBeNull();
    expect(runActivityFrom(row({ run_table: 'runs' }))).toBeNull();
    expect(runActivityFrom(row({ body: 4 }))).toBeNull();
  });
});

describe('mergeRunLines', () => {
  it('keeps each line once when it arrives from the read and from Realtime', () => {
    const first = line('a1', '2026-10-12T10:00:00.000Z');
    const merged = mergeRunLines([first], [first, line('a2', '2026-10-12T10:00:05.000Z')]);
    expect(merged.map((l) => l.id)).toEqual(['a1', 'a2']);
  });

  it('puts a line that arrived early back in the order it was written', () => {
    const later = line('b', '2026-10-12T10:05:00.000Z');
    const earlier = line('a', '2026-10-12T10:01:00.000Z');
    expect(mergeRunLines([later], [earlier]).map((l) => l.id)).toEqual(['a', 'b']);
  });
});
