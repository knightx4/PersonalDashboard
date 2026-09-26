/**
 * Claude's note on where things stand (supabase/migrations-goals/0044).
 *
 * A run that touches a goal leaves a few lines on it as it finishes: where
 * the goal stands, what Claude did, and what is waiting on the person. The
 * daily and weekly runs also leave one for the Goals home, covering every
 * goal at once. Each page shows the newest; the older ones stay in
 * goals.briefs as the record.
 *
 * Pure. The reads are in lib/goals/briefs-store.ts.
 */
import { formatDay } from '@/lib/goals/dates';
import { todayIn } from '@/lib/todo/tasks/model';

export type Brief = {
  id: string;
  /** The goal it heads; null for the Goals home. */
  itemId: string | null;
  runId: string | null;
  /** Markdown, a few lines. */
  body: string;
  createdAt: string;
};

export type BriefRow = {
  id: string;
  item_id: string | null;
  run_id: string | null;
  body: string;
  created_at: string;
};

export const BRIEF_COLUMNS = 'id, item_id, run_id, body, created_at';

/** The limit the table's check sets. */
export const BRIEF_MAX = 2000;

export function toBrief(row: BriefRow): Brief {
  return {
    id: row.id,
    itemId: row.item_id,
    runId: row.run_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

const DAY_MS = 86_400_000;

/**
 * Whether a note is old enough that the page should say so. Past a week it is
 * still shown, since it is still the latest word, but with its age in front,
 * so a fortnight-old "waiting on you" is not read as today's.
 */
export function briefIsStale(brief: Pick<Brief, 'createdAt'>, now: number): boolean {
  return now - Date.parse(brief.createdAt) > 7 * DAY_MS;
}

/**
 * When a note was written, to follow "Written": "today", "on 3 Oct", or "on
 * 3 Oct, over a week ago", with the day read in the account's zone.
 */
export function writtenWhen(brief: Pick<Brief, 'createdAt'>, timeZone: string, now: number): string {
  const day = todayIn(timeZone, new Date(brief.createdAt));
  const today = todayIn(timeZone, new Date(now));
  if (day === today) return 'today';
  return briefIsStale(brief, now) ? `on ${formatDay(day)}, over a week ago` : `on ${formatDay(day)}`;
}
