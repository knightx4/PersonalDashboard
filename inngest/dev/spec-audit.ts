import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { specAuditRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { startRoutineRun } from '@/lib/plan/runs';
import { loadSpecAuditFacts, specAuditDue, specAuditRunText } from '@/lib/specs/spec-audit-run';
import { createServiceSupabase } from '@/inngest/supabase-admin';

/**
 * The weekly spec audit tick (plan #1524), called on Mondays by pg_cron
 * (supabase/migrations/0178_spec_audit_weekly.sql).
 *
 * Fires the spec audit routine once for the owner, which follows
 * .claude/skills/spec-audit, and records the fire in `plan_runs` with job
 * `audit`. Refuses when an audit wrote findings or was started in the last
 * six days, so a second call in the same week fires nothing.
 *
 * The owner only: the specs are the app's, and the allowance each run spends
 * is the owner's. Modelled on the vision review's tick.
 */

export type SpecAuditTickResult =
  | { skipped: string }
  | { started: string | null }
  | { failed: string };

export type SpecAuditTickDeps = {
  client: SupabaseClient;
  routine: RoutineTarget;
  now: number;
  fetch?: typeof globalThis.fetch;
};

const ownerSchema = z.object({ userId: z.string().uuid() });

export async function runSpecAuditTick(
  deps?: Partial<SpecAuditTickDeps>,
): Promise<SpecAuditTickResult> {
  const routine = deps?.routine ?? specAuditRoutine();
  const client = deps?.client ?? createServiceSupabase();
  const now = deps?.now ?? Date.now();

  const owner = await client.rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to audit for.');
  const userId = parsed.data.userId;

  const due = specAuditDue({ ...(await loadSpecAuditFacts(client, userId)), now });
  if (!due.due) return { skipped: due.reason };

  // A due week with no routine is a failed fire, recorded like one, so the
  // record says why nothing ran rather than pg_cron logging a success.
  const missing = !routine.id
    ? 'CLAUDE_SPEC_AUDIT_ROUTINE_ID'
    : !routine.token
      ? 'CLAUDE_SPEC_AUDIT_ROUTINE_TOKEN'
      : null;
  if (missing) {
    const error = `${missing} is not set on the deployment, so the weekly spec audit could not start.`;
    const { error: insertError } = await client.from('plan_runs').insert({
      user_id: userId,
      plan_item_id: null,
      job: 'audit',
      routine_id: routine.id,
      external_id: null,
      status: 'failed',
      http_status: null,
      response: null,
      error,
    });
    if (insertError) console.error(`plan_runs insert failed for an audit run: ${insertError.message}`);
    return { failed: error };
  }

  const result = await startRoutineRun({
    supabase: client,
    userId,
    job: 'audit',
    routine,
    text: specAuditRunText(userId),
    fetch: deps?.fetch,
  });
  return result.ok ? { started: result.runId } : { failed: result.error };
}
