import { PICKS_MAX, type DayBriefPick } from './picks';

/**
 * Reading this morning's brief back for the home page (plan #1241).
 *
 * core.day_briefs.picks is jsonb: null on a row written before #1239, which
 * the page shows by its body, and otherwise the picks in brief order, `[]`
 * when nothing qualified. The page links each pick, so a pick whose href is
 * not a path inside the app is left out rather than linked.
 */

/** The home page's anchor for the brief, which the notification opens at. */
export const BRIEF_ANCHOR = 'brief';

function isPick(value: unknown): value is DayBriefPick {
  if (typeof value !== 'object' || value === null) return false;
  const pick = value as Record<string, unknown>;
  return (
    typeof pick.key === 'string' &&
    typeof pick.kind === 'string' &&
    typeof pick.title === 'string' &&
    pick.title.trim() !== '' &&
    typeof pick.reason === 'string' &&
    typeof pick.href === 'string' &&
    // A path in this app: one slash, not two, which would be another host.
    /^\/(?!\/)/.test(pick.href)
  );
}

/**
 * The stored picks as the page shows them: null when the row has none (an
 * older row), otherwise the well-formed ones, at most PICKS_MAX.
 */
export function storedPicks(value: unknown): DayBriefPick[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isPick).slice(0, PICKS_MAX);
}

/** What the home page shows for the day. */
export type ShownBrief =
  | { kind: 'picks'; picks: DayBriefPick[] }
  | { kind: 'none' }
  | { kind: 'body'; body: string };

/**
 * The day's row as the page shows it, or null when the run has not written
 * one yet. An empty array is a day with nothing that qualified. An array whose
 * every entry was unreadable is shown by its body, since that body was written
 * from the same picks.
 */
export function shownBrief(row: { body: string | null; picks: unknown } | null): ShownBrief | null {
  if (!row) return null;
  const picks = storedPicks(row.picks);
  if (picks !== null && picks.length > 0) return { kind: 'picks', picks };
  if (Array.isArray(row.picks) && row.picks.length === 0) return { kind: 'none' };
  const body = row.body?.trim();
  return body ? { kind: 'body', body } : null;
}
