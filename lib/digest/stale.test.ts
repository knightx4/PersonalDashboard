import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MORNING_RUN_SOURCE,
  fileStaleCheckBacks,
  splitStaleBlocks,
  staleDetail,
  type BlockedRow,
} from './stale';

const ROWS: BlockedRow[] = [
  { id: 'p985', number: 985, title: 'Read statements', status: 'blocked', kind: 'build', blockAsk: 'A real run.' },
  { id: 'p986', number: 986, title: 'Show them', status: 'not_started', kind: 'build', blockAsk: null },
  { id: 'p990', number: 990, title: 'Which bank?', status: 'blocked', kind: 'decision', blockAsk: null },
];

const stale = (step: number | null) => ({
  title: `Blocked on code that shipped (#${step})`,
  detail: 'Read its block.',
  step,
  kind: 'stale_block' as const,
});

describe('splitStaleBlocks', () => {
  it('hands a stale block on a blocked build step to a session', () => {
    const { handoffs, rest } = splitStaleBlocks([stale(985)], ROWS);
    expect(handoffs.map((h) => h.step.number)).toEqual([985]);
    expect(rest).toEqual([]);
  });

  it('leaves a step that is not blocked, a decision, an unknown step and an ordinary line to be filed', () => {
    const ordinary = { title: 'An idea nobody shaped', detail: null, step: null, kind: 'other' as const };
    const { handoffs, rest } = splitStaleBlocks(
      [stale(986), stale(990), stale(4040), stale(null), ordinary],
      ROWS,
    );
    expect(handoffs).toEqual([]);
    expect(rest).toHaveLength(5);
  });

  it('files a line with no kind as before, as the model answered before #1224', () => {
    const { handoffs, rest } = splitStaleBlocks([{ title: 'x (#985)', detail: null }], ROWS);
    expect(handoffs).toEqual([]);
    expect(rest).toHaveLength(1);
  });
});

describe('staleDetail', () => {
  it('names the block and the three moves, and leaves the decision to the person', () => {
    const detail = staleDetail({ suggestion: stale(985), step: ROWS[0]! });
    expect(detail).toContain('A real run.');
    expect(detail).toContain('reopen 985');
    expect(detail).toContain('done 985 --note');
    expect(detail).toContain('block 985 --ask');
    expect(detail).toContain('do not answer it');
  });
});

function client(waiting: Array<{ plan_item_id: string }>) {
  const inserted: Record<string, unknown>[] = [];
  const self = {
    select: () => self,
    eq: () => self,
    in: async () => ({ data: waiting, error: null }),
    insert: async (row: Record<string, unknown>) => {
      inserted.push(row);
      return { error: null };
    },
  };
  return { supabase: { from: () => self } as unknown as SupabaseClient, inserted };
}

describe('fileStaleCheckBacks', () => {
  const now = new Date('2026-09-29T06:00:00Z');

  it('writes one waiting check-back, due now and woken, on the step', async () => {
    const { supabase, inserted } = client([]);
    const handoff = { suggestion: stale(985), step: ROWS[0]! };
    expect(await fileStaleCheckBacks(supabase, 'u', [handoff, handoff], now)).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      plan_item_id: 'p985',
      due_at: now.toISOString(),
      wake: true,
      source: MORNING_RUN_SOURCE,
    });
  });

  it('writes nothing for a step that already has a waiting check-back', async () => {
    const { supabase, inserted } = client([{ plan_item_id: 'p985' }]);
    const handoff = { suggestion: stale(985), step: ROWS[0]! };
    expect(await fileStaleCheckBacks(supabase, 'u', [handoff], now)).toBe(0);
    expect(inserted).toEqual([]);
  });
});
