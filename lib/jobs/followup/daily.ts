/**
 * Name someone for each application that went in lately, every day, so the
 * note is waiting without a press (designate.ts).
 *
 * Applications sent in the last RECENT_DAYS with nobody named, and not
 * looked at in the last week, newest first. Most applications carry no
 * submitted_at (the confirmation mail sets the status, not the date), so one
 * without it counts from when its row was made. Someone on file costs only the draft;
 * a web search for the hiring manager is the costly part, so at most
 * SEARCHES_PER_DAY run, and only while the run has time left for one.
 */
import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { designateFollowUp } from './designate';
import { APPLIED_STATUSES } from './load';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back an application still counts as just sent. */
const RECENT_DAYS = 15;
/** How long after a look that found nobody before looking again. */
const RETRY_DAYS = 7;
/** Applications worked a day, each a draft. */
const PER_DAY = 5;
export const SEARCHES_PER_DAY = 2;
/** A web search started with less time than this would be cut off. */
const SEARCH_ROOM_MS = 90_000;

export type DailyFollowUps = { named: number; searchSpend: SpendReport[]; draftSpend: SpendReport[]; errors: string[] };

export async function followUpRecentApplications(
  supabase: AppSupabaseClient,
  userId: string,
  options: { apiKey: string; now: Date; deadline: number },
): Promise<DailyFollowUps> {
  const out: DailyFollowUps = { named: 0, searchSpend: [], draftSpend: [], errors: [] };
  const since = new Date(options.now.getTime() - RECENT_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('applications')
    .select('id, submitted_at, created_at, follow_up_tried_at, application_outreach ( id )')
    .eq('user_id', userId)
    .in('status', [...APPLIED_STATUSES])
    .or(`submitted_at.gte.${since},and(submitted_at.is.null,created_at.gte.${since})`);
  if (error) return { ...out, errors: [error.message] };
  // Only applications with nobody named yet.
  const unnamed = ((data ?? []) as (SentRow & { application_outreach: unknown[] | null })[]).filter(
    (row) => (row.application_outreach ?? []).length === 0,
  );
  const due = dueForFollowUp(unnamed, options.now);

  let searches = SEARCHES_PER_DAY;
  for (const id of due) {
    const allowSearch = searches > 0 && options.deadline - Date.now() > SEARCH_ROOM_MS;
    const result = await designateFollowUp(supabase, userId, id, {
      apiKey: options.apiKey,
      allowSearch,
      deadline: options.deadline,
      onSearchSpend: (report) => out.searchSpend.push(report),
      onDraftSpend: (report) => out.draftSpend.push(report),
    });
    if (result.ok) {
      out.named += 1;
      if (result.from !== 'file') searches -= 1;
      if (result.draftError) out.errors.push(result.draftError);
    } else if (result.searched) {
      searches -= 1;
    }
    if (Date.now() > options.deadline) break;
  }
  return out;
}

type SentRow = { id: string; submitted_at: string | null; created_at: string; follow_up_tried_at: string | null };

/**
 * The applications to work today, newest sent first: sent (or, with no sent
 * date, made) in the last RECENT_DAYS, and not looked at in the last
 * RETRY_DAYS. At most PER_DAY.
 */
export function dueForFollowUp(rows: readonly SentRow[], now: Date): string[] {
  const since = now.getTime() - RECENT_DAYS * DAY_MS;
  const retryBefore = now.getTime() - RETRY_DAYS * DAY_MS;
  const sent = (row: SentRow) => Date.parse(row.submitted_at ?? row.created_at);
  return rows
    .filter((row) => sent(row) >= since)
    .filter((row) => row.follow_up_tried_at === null || Date.parse(row.follow_up_tried_at) < retryBefore)
    .sort((a, b) => sent(b) - sent(a))
    .slice(0, PER_DAY)
    .map((row) => row.id);
}
