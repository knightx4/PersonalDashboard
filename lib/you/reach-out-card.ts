import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { DUE_SLACK_MS, lastSentUnder, type SentRef } from '@/lib/you/reach-out-due';
import { reachOutSummary } from '@/lib/you/reach-out-make';
import { parseReachOutRule, type ReachOutRule } from '@/lib/you/reach-out-rule';
import { NO_REACH_OUT, type ReachOutView } from '@/lib/you/reach-out-card-model';

/**
 * Building the reach-out view a person's form and thread draw (plan
 * #2931.3), from their board_advisors row and the rows their texts have
 * named (you.advisor_reach_outs), and turning a rule off.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The board_advisors columns the view reads. */
export const REACH_OUT_COLUMNS = 'reach_out_brief, reach_out_rule, reach_out_summary, reach_out_error';

/** When the rule's next text is due, or null when one is due now. */
export function nextReachOutAt(rule: ReachOutRule, sent: readonly SentRef[], now: number): number | null {
  let soonest: number | null = null;
  for (const watch of rule.watches) {
    const last = lastSentUnder(watch.key, sent);
    if (last === null) return null;
    const at = last + watch.every_days * DAY_MS - DUE_SLACK_MS;
    if (at <= now) return null;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/** The summary as stored, less the sentence reachOutSummary added about what cannot be watched. */
export function understoodOf(summary: string, cannotWatch: readonly string[]): string {
  if (!cannotWatch.length) return summary;
  const gap = reachOutSummary('', cannotWatch);
  return summary.endsWith(gap) ? summary.slice(0, -gap.length).trim() : summary;
}

/** The view from a board_advisors row's reach_out columns and what this person has named. */
export function reachOutViewOf(
  row: { reach_out_brief?: unknown; reach_out_rule?: unknown; reach_out_summary?: unknown; reach_out_error?: unknown },
  sent: readonly SentRef[],
  now: number,
): ReachOutView {
  const brief = typeof row.reach_out_brief === 'string' ? row.reach_out_brief.trim() : '';
  if (!brief) return NO_REACH_OUT;
  const error = typeof row.reach_out_error === 'string' && row.reach_out_error.trim() ? row.reach_out_error.trim() : null;
  const parsed = row.reach_out_rule == null ? null : parseReachOutRule(row.reach_out_rule);
  if (!parsed || !('rule' in parsed)) return { ...NO_REACH_OUT, brief, error };
  const cannotWatch = parsed.rule.cannot_watch ?? [];
  const stored = typeof row.reach_out_summary === 'string' ? row.reach_out_summary.trim() : '';
  const at = nextReachOutAt(parsed.rule, sent, now);
  return {
    brief,
    summary: understoodOf(stored, cannotWatch) || null,
    cannotWatch,
    error: null,
    next: { at: at === null ? null : new Date(at).toISOString() },
  };
}


/** What this person's texts have named, newest first, for the next-text clock. */
export async function readSentBy(client: YouSupabaseClient, userId: string, advisorId: string): Promise<SentRef[]> {
  const { data, error } = await client
    .from('advisor_reach_outs')
    .select('watch_key, ref_table, ref_id, sent_at')
    .eq('user_id', userId)
    .eq('advisor_id', advisorId)
    .order('sent_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Reading what they have mentioned failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    watchKey: String(row.watch_key ?? ''),
    refTable: String(row.ref_table ?? ''),
    refId: String(row.ref_id ?? ''),
    sentAt: String(row.sent_at ?? ''),
  }));
}

/** One person's reach-out view, read from the database; the empty view when they are not on the list. */
export async function loadReachOutView(client: YouSupabaseClient, userId: string, advisorId: string, now: number): Promise<ReachOutView> {
  const { data, error } = await client
    .from('board_advisors')
    .select(REACH_OUT_COLUMNS)
    .eq('user_id', userId)
    .eq('id', advisorId)
    .maybeSingle();
  if (error) throw new Error(`Reading what they text you about failed: ${error.message}`);
  if (!data) return NO_REACH_OUT;
  const row = data as Record<string, unknown>;
  const sent = row.reach_out_rule == null ? [] : await readSentBy(client, userId, advisorId);
  return reachOutViewOf(row, sent, now);
}

/**
 * Turn Off: the rule, its summary and any error go, and your words stay, so
 * Set it up makes the rule again from them. With no rule the daily round
 * goes back to choosing when they text.
 */
export async function turnOffReachOut(client: YouSupabaseClient, userId: string, advisorId: string): Promise<void> {
  const { error } = await client
    .from('board_advisors')
    .update({ reach_out_rule: null, reach_out_summary: null, reach_out_error: null })
    .eq('user_id', userId)
    .eq('id', advisorId);
  if (error) throw new Error(`Turning it off failed: ${error.message}`);
}
