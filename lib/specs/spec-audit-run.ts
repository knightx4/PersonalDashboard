import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The weekly spec audit's clock (plan #1524): when it is due and what the
 * routine is told.
 *
 * Shaped like the vision review's (`vision-review-run.ts`). A run is two facts
 * in two tables: the fire is a `plan_runs` row with job `audit` and no step,
 * written by the Monday tick, and what the run found is the `spec_findings`
 * rows it wrote under one `audit_id`. The last run is the newer of the two,
 * because the first audits were run by hand and have no fire behind them, and
 * a fire that has not written anything yet is still a run.
 *
 * Not `server-only`: the rule is pure and the loader only queries the client
 * it is handed.
 */

/**
 * How recent a run must be to stop another one. Six days rather than seven so
 * the Monday tick is never refused by last Monday's run finishing a few
 * minutes later in the day than this week's tick fires.
 */
export const SPEC_AUDIT_GAP_MS = 6 * 24 * 60 * 60 * 1000;

/** The weekly fire, as its `plan_runs` row records it. */
export type AuditFire = {
  status: 'started' | 'finished' | 'failed';
  at: string;
};

export type SpecAuditDue = { due: true } | { due: false; reason: string };

/**
 * Whether the tick should fire. Not when findings were written in the last
 * six days, and not when a fire in that time started a run that may still be
 * writing. A fire that failed does not count, so the next call tries again.
 */
export function specAuditDue(input: {
  lastFire: AuditFire | null;
  lastFindingAt: string | null;
  now: number;
}): SpecAuditDue {
  const recent = (at: string | null) =>
    at !== null && input.now - new Date(at).getTime() < SPEC_AUDIT_GAP_MS;
  if (recent(input.lastFindingAt)) {
    return { due: false, reason: `an audit wrote its findings at ${input.lastFindingAt}` };
  }
  if (input.lastFire && input.lastFire.status !== 'failed' && recent(input.lastFire.at)) {
    return { due: false, reason: `an audit was started at ${input.lastFire.at}` };
  }
  return { due: true };
}

/** The turn appended to the routine's session: the account, and the rules. */
export function specAuditRunText(userId: string): string {
  return (
    `Run the weekly spec audit for user_id ${userId}. Read ` +
    '.claude/skills/spec-audit/SKILL.md first and follow it: one subagent per spec, ' +
    'every finding of this run under one audit_id, and no new spec change drafted while ' +
    'five are waiting on the person. You write rows, not code. Do not commit, push or ' +
    'edit docs/.'
  );
}

/** The last fire and the newest finding, under the service role. */
export async function loadSpecAuditFacts(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ lastFire: AuditFire | null; lastFindingAt: string | null }> {
  const [fire, finding] = await Promise.all([
    supabase
      .from('plan_runs')
      .select('status, created_at')
      .eq('user_id', userId)
      .eq('job', 'audit')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('spec_findings')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (fire.error) throw new Error(`Could not read the spec audit fires: ${fire.error.message}`);
  if (finding.error) throw new Error(`Could not read the spec findings: ${finding.error.message}`);

  const fireRow = (fire.data ?? [])[0] as { status: string; created_at: string } | undefined;
  const findingRow = (finding.data ?? [])[0] as { created_at: string } | undefined;
  return {
    lastFire: fireRow
      ? {
          status:
            fireRow.status === 'failed' || fireRow.status === 'finished' ? fireRow.status : 'started',
          at: fireRow.created_at,
        }
      : null,
    lastFindingAt: findingRow?.created_at ?? null,
  };
}
