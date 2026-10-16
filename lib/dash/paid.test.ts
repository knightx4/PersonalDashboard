import { describe, expect, it, vi } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { queuePaidPress } from './paid';
import { writeYearReviewTool } from './paid-tools';
import type { DashPaidCheckContext, DashPaidTool } from './registry';

/**
 * Queueing a paid press (plan #2228.1): checked and priced, kept as an item
 * to approve, and nothing run.
 */

const ME = '00000000-0000-4000-8000-00000000000a';

const ESTIMATE: CostEstimate = {
  lowMicros: 1_000,
  medianMicros: 2_000,
  highMicros: 4_000,
  runs: 8,
  basis: 'measured',
  per: 'unit',
  models: ['claude-haiku-4-5'],
};

/** A client whose one read returns `row`. */
function reading(row: Record<string, unknown> | null): SchemaClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => query } as unknown as SchemaClient;
}

function context(row: Record<string, unknown> | null = null, enabled: DashPaidCheckContext['enabledModules'] = ['jobs']): DashPaidCheckContext {
  return {
    userId: ME,
    today: '2026-10-15',
    timezone: 'UTC',
    enabledModules: enabled,
    db: async () => reading(row),
    searchSources: [],
    now: Date.parse('2026-10-15T12:00:00Z'),
    seen: () => true,
  };
}

function fakeTool(run = vi.fn()): DashPaidTool {
  return {
    name: 'draft_answers',
    kind: 'paid',
    inAppOnly: true,
    action: 'app/jobs/(app)/roles/actions.ts#draftApplication',
    runs: 'lib/jobs/draft.ts#draft',
    workspace: 'jobs',
    definition: { name: 'draft_answers', input_schema: { type: 'object' } },
    prepare: async () => ({ ok: true, args: { roleId: 'r1' }, line: 'Draft 3 answers on the Acme role.', count: 3, paths: ['/jobs/roles/r1'] }),
    run,
  };
}

describe('queuePaidPress', () => {
  it('keeps the press with its line and the hint’s estimate scaled by its count, and runs nothing', async () => {
    const run = vi.fn();
    const estimate = vi.fn(async () => ESTIMATE);
    const queued = await queuePaidPress(fakeTool(run), {}, context(), estimate);
    expect(run).not.toHaveBeenCalled();
    expect(estimate).toHaveBeenCalledWith('app/jobs/(app)/roles/actions.ts#draftApplication');
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.change).toEqual({
      kind: 'paid_action',
      input: {
        tool: 'draft_answers',
        action: 'app/jobs/(app)/roles/actions.ts#draftApplication',
        args: { roleId: 'r1' },
        line: 'Draft 3 answers on the Acme role.',
        count: 3,
        estimate: { ...ESTIMATE, lowMicros: 3_000, medianMicros: 6_000, highMicros: 12_000, per: 'run' },
        workspace: 'jobs',
        paths: ['/jobs/roles/r1'],
      },
    });
    expect(queued.note).toContain('Nothing has run yet');
    expect(queued.note).toContain('$0.0060');
  });

  it('queues without an estimate when the ledger cannot be read', async () => {
    const queued = await queuePaidPress(fakeTool(), {}, context(), async () => {
      throw new Error('down');
    });
    expect(queued.ok && queued.change.input.estimate).toBeNull();
  });

  it('refuses a press in a workspace that is off, before checking or pricing it', async () => {
    const estimate = vi.fn();
    const queued = await queuePaidPress(fakeTool(), {}, context(null, []), estimate);
    expect(queued).toEqual({ ok: false, error: 'The Job search workspace is switched off, so nothing can be run there.' });
    expect(estimate).not.toHaveBeenCalled();
  });

  it('passes the tool’s refusal on', async () => {
    const tool = { ...fakeTool(), prepare: async () => ({ ok: false as const, error: 'That role has no questions.' }) };
    expect(await queuePaidPress(tool, {}, context(), async () => ESTIMATE)).toEqual({ ok: false, error: 'That role has no questions.' });
  });
});

describe('write_year_review', () => {
  it('queues the year, and says so when it is written again', async () => {
    expect(await writeYearReviewTool.prepare(context(), { year: 2026 })).toEqual({
      ok: true,
      args: { year: 2026 },
      line: 'Write the review of 2026 from the timeline.',
      paths: ['/timeline/year/2026'],
    });
    const again = await writeYearReviewTool.prepare(context({ complete: false }), { year: 2026 });
    expect(again.ok && again.line).toBe('Write the review of 2026 again from the timeline.');
  });

  it('refuses a year that has not started, and one written up after it ended', async () => {
    expect((await writeYearReviewTool.prepare(context(), { year: 2027 })).ok).toBe(false);
    expect(await writeYearReviewTool.prepare(context({ complete: true }), { year: 2025 })).toEqual({
      ok: false,
      error: 'The review of 2025 was written after the year ended, so it stays as it is.',
    });
  });
});
