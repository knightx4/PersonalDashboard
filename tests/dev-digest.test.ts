/**
 * The morning summary's writer.
 *
 * The property that matters is that it is written once. The page says what
 * happened in the last day and what to look at, and a summary rebuilt on the
 * second cron tick of the day -- or on a retry after a timeout -- would change
 * under somebody halfway through reading it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dayOf, writeDigestFor } from '@/inngest/dev/digest';

type Row = Record<string, unknown>;

/**
 * Enough of the query builder for the four reads and the one write this makes.
 * Every filter is ignored: the tables are stubbed with exactly the rows the
 * case is about, so there is nothing for a filter to remove.
 */
function stubClient(tables: Record<string, Row[]>) {
  const inserted: Array<{ table: string; row: Row }> = [];

  const builder = (table: string) => {
    const rows = () => tables[table] ?? [];
    const self = {
      select: () => self,
      eq: () => self,
      order: () => self,
      limit: () => self,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: async (row: Row) => {
        inserted.push({ table, row });
        (tables[table] ??= []).push(row);
        return { error: null };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
    };
    return self;
  };

  return { supabase: { from: builder } as unknown as SupabaseClient, inserted };
}

const NOW = new Date('2026-03-02T12:00:00Z');

function closedStep(over: Row = {}): Row {
  return {
    id: 'a',
    number: 42,
    module: 'dev',
    parent_id: null,
    title: 'The panel',
    detail: null,
    acceptance: null,
    status: 'done',
    kind: 'build',
    fog: null,
    resolution: null,
    comment: null,
    priority: 2,
    size: null,
    assignee: null,
    commit_sha: 'abc1234def',
    position: 10,
    started_at: null,
    completed_at: '2026-03-02T09:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('writeDigestFor', () => {
  it('writes the day it covers and what closed inside the window', async () => {
    const { supabase, inserted } = stubClient({ plan_items: [closedStep()] });

    await expect(writeDigestFor(supabase, 'user-1', NOW)).resolves.toBe(true);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].row).toMatchObject({
      user_id: 'user-1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00.000Z',
    });
    expect(inserted[0].row.happened).toEqual([
      {
        kind: 'step',
        title: 'The panel',
        ref: '#42',
        commit: 'abc1234',
        note: null,
        at: '2026-03-02T09:00:00Z',
      },
    ]);
  });

  it('writes nothing the second time it runs on the same day', async () => {
    const { supabase, inserted } = stubClient({ plan_items: [closedStep()] });

    await writeDigestFor(supabase, 'user-1', NOW);
    await expect(writeDigestFor(supabase, 'user-1', NOW)).resolves.toBe(false);

    expect(inserted).toHaveLength(1);
  });

  it('asks the model for nothing without a key, and still writes the rest', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { supabase, inserted } = stubClient({
      plan_items: [closedStep({ status: 'not_started', completed_at: null, title: 'Build it' })],
    });

    await writeDigestFor(supabase, 'user-1', NOW);

    expect(inserted[0].row.attention).toEqual([
      { kind: 'ready', title: 'Build it', ref: '#42', detail: null },
    ]);
    vi.unstubAllEnvs();
  });
});

describe('dayOf', () => {
  it('is the UTC date, which is the date the cron ticks on', () => {
    expect(dayOf(new Date('2026-03-02T23:30:00Z'))).toBe('2026-03-02');
  });
});
