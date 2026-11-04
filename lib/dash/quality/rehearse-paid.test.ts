import { describe, expect, it, vi } from 'vitest';
import type { AskContext } from '@/lib/ask/db';
import type { DashSeen } from '@/lib/dash/sets';
import type { DashPaidTool } from '@/lib/dash/registry';
import { rehearsePaid } from './rehearse-paid';

const CTX = { userId: 'u-1', today: '2026-11-04', timezone: 'UTC', enabledModules: ['jobs'] } as unknown as AskContext;
const seen = (() => true) as DashSeen;

function tool(prepare: DashPaidTool['prepare'], run = vi.fn()): DashPaidTool {
  return {
    name: 'draft_application_answers',
    kind: 'paid',
    inAppOnly: true,
    action: 'app/jobs/(app)/roles/actions.ts#draftApplication',
    runs: 'lib/jobs/drafting/run-draft.ts#draftApplicationAs',
    workspace: 'jobs',
    definition: { name: 'draft_application_answers', description: '', input_schema: { type: 'object', properties: {} } },
    prepare,
    run,
  } as DashPaidTool;
}

describe('a paid press in a quality case', () => {
  it('is checked as in Ask and told to the model as queued, without running', async () => {
    const run = vi.fn();
    const prepare = vi.fn(async () => ({ ok: true as const, args: { ids: ['a', 'b'] }, line: 'Dash will draft 2 applications.', count: 2, paths: [] }));
    const result = await rehearsePaid(CTX)(tool(prepare, run), { application_refs: ['a', 'b'] }, seen);

    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', seen }), { application_refs: ['a', 'b'] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.note).toContain('Queued: Dash will draft 2 applications.');
    expect(run).not.toHaveBeenCalled();
  });

  it('passes on the check refusing it, so a bad press still fails the case', async () => {
    const prepare = vi.fn(async () => ({ ok: false as const, error: 'That application is not one a lookup returned.' }));
    const result = await rehearsePaid(CTX)(tool(prepare), { application_refs: ['x'] }, seen);
    expect(result).toEqual({ ok: false, error: 'That application is not one a lookup returned.' });
  });

  it('refuses a press in a workspace that is switched off, as Ask does', async () => {
    const prepare = vi.fn();
    const off = { ...CTX, enabledModules: [] } as unknown as AskContext;
    const result = await rehearsePaid(off)(tool(prepare), {}, seen);
    expect(result.ok).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });
});
