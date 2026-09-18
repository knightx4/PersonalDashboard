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
        feature: null,
        module: 'dev',
      },
    ]);
  });

  /**
   * The count the morning summary prints. Nothing files ideas from the night
   * yet -- #645 is the step that makes this run write what it noticed to the
   * ideas page -- so the honest number today is none, and the panel draws no
   * line for it. When that step lands this is the assertion it changes.
   */
  it('records how many ideas the night filed, which is none until something files them', async () => {
    const { supabase, inserted } = stubClient({ plan_items: [closedStep()] });

    await writeDigestFor(supabase, 'user-1', NOW);

    expect(inserted[0].row.ideas_filed).toBe(0);
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

  /**
   * The night is read from the runner's row and the feature runs it made, and
   * stored whole: `plan_overnight_runs` holds one row per account rather than
   * one per night, so tonight's press overwrites the night this summary is
   * about.
   */
  it('writes what the overnight runner did, with the reason it stopped', async () => {
    const { supabase, inserted } = stubClient({
      plan_items: [
        closedStep({
          id: 'f1',
          number: 100,
          title: 'The runner',
          status: 'in_progress',
          completed_at: null,
        }),
        closedStep({
          id: 's1',
          number: 101,
          parent_id: 'f1',
          title: 'The tick',
          completed_at: '2026-03-02T02:00:00Z',
        }),
      ],
      plan_overnight_runs: [
        {
          id: 'run-1',
          running: false,
          paused: false,
          features_budget: 6,
          features_left: 4,
          stop_by: '2026-03-02T07:00:00Z',
          started_at: '2026-03-01T23:00:00Z',
          last_fired_at: '2026-03-02T01:00:00Z',
          ended_at: '2026-03-02T03:00:00Z',
          ended_reason: 'You stopped it.',
          created_at: '2026-03-01T23:00:00Z',
          updated_at: '2026-03-02T03:00:00Z',
        },
      ],
      plan_runs: [{ plan_item_id: 'f1', created_at: '2026-03-02T01:00:00Z' }],
    });

    await writeDigestFor(supabase, 'user-1', NOW);

    expect(inserted[0].row.night).toMatchObject({
      standing: 'stopped',
      endedReason: 'You stopped it.',
      featuresBudget: 6,
      featuresLeft: 4,
      features: [{ ref: '#100', title: 'The runner' }],
      closed: [{ ref: '#101', title: 'The tick' }],
      blocked: [],
    });
  });

  it('writes no night on a day the runner did not run', async () => {
    const { supabase, inserted } = stubClient({ plan_items: [closedStep()] });

    await writeDigestFor(supabase, 'user-1', NOW);

    expect(inserted[0].row.night).toBeNull();
  });
});

describe('dayOf', () => {
  it('is the UTC date, which is the date the cron ticks on', () => {
    expect(dayOf(new Date('2026-03-02T23:30:00Z'))).toBe('2026-03-02');
  });
});
