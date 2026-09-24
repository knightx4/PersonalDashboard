/**
 * Links from a goal to what Learn and the job search own (docs/GOALS-SPEC.md,
 * "Where things live"; plan #931).
 *
 * A link is a row of goals.links naming a Learn aim, the job search as a
 * whole, one role or one application. The goal page reads each target's
 * progress from its own module when it loads, so nothing is logged twice and
 * nothing is copied: the counts here are always Learn's and the job search's
 * own, read live.
 *
 * Pure, so the week and the wording are tested without a database. The reads
 * and writes are in lib/goals/links-store.ts.
 */
import { periodOf } from '@/lib/goals/rhythms';
import { wallClockToInstant } from '@/lib/todo/time';

export type LinkKind = 'aim' | 'job_search' | 'role' | 'application';

export const LINK_KINDS: readonly LinkKind[] = ['aim', 'job_search', 'role', 'application'];

export function isLinkKind(value: unknown): value is LinkKind {
  return typeof value === 'string' && (LINK_KINDS as readonly string[]).includes(value);
}

export type Link = {
  id: string;
  itemId: string;
  kind: LinkKind;
  /** Null for the job search, which is the whole of it. */
  targetId: string | null;
};

export const LINK_COLUMNS = 'id, item_id, kind, target_id';

export type LinkRow = { id: string; item_id: string; kind: string; target_id: string | null };

/** A row as read, or null for a kind this code does not know. */
export function toLink(row: LinkRow): Link | null {
  if (!isLinkKind(row.kind)) return null;
  return { id: row.id, itemId: row.item_id, kind: row.kind, targetId: row.target_id };
}

/** The Learn statuses that mean a card was read, not only drawn or passed over. */
export const READ_CARD_STATUSES = ['opened', 'saved', 'tested', 'known', 'review'] as const;

/** What a linked Learn aim shows, read from learn.aims and its cards. */
export type LinkedAim = {
  linkId: string;
  aimId: string;
  /** Null when the aim has been deleted from Learn since it was linked. */
  name: string | null;
  archived: boolean;
  /** The Level 3 list, whose progress is its claimed and tested articles. */
  level3: { claimed: number; tested: number; total: number } | null;
  /** Cards drawn for an open-subject aim that were read, and of those saved. */
  cardsRead: number;
  cardsSaved: number;
};

/** The job search's week, counted from job_search. */
export type JobWeek = { applied: number; interviews: number };

/** One role or application a goal points at. */
export type LinkedJob = {
  linkId: string;
  kind: 'role' | 'application';
  /** Where it opens in the job search, or null when it has gone. */
  roleId: string | null;
  title: string | null;
  company: string | null;
  /** The application's status as the job search says it; null for a role. */
  status: string | null;
};

export type GoalLinks = {
  aims: LinkedAim[];
  /** The link id and this week's counts; null when the goal does not hold the search. */
  jobSearch: { linkId: string; week: JobWeek | null } | null;
  jobs: LinkedJob[];
};

/**
 * This week, Monday to Monday, as the two instants a timestamp is compared
 * against. The same week the rhythms and the Todo calendar use, in the
 * account's zone.
 */
export function weekInstants(today: string, timezone: string): { from: string; to: string } {
  const { startsOn, endsOn } = periodOf('week', today);
  return {
    from: wallClockToInstant(startsOn, '00:00', timezone),
    to: wallClockToInstant(endsOn, '00:00', timezone),
  };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The line under a linked aim. */
export function aimProgressLine(aim: LinkedAim): string {
  if (aim.name === null) return 'No longer in Learn';
  if (aim.level3) {
    const { claimed, tested, total } = aim.level3;
    return `${claimed} of ${total} articles claimed, ${tested} tested`;
  }
  const read = aim.cardsRead === 0 ? 'No cards read yet' : count(aim.cardsRead, 'card read', 'cards read');
  const saved = aim.cardsSaved > 0 ? `, ${aim.cardsSaved} saved` : '';
  return `${read}${saved}${aim.archived ? '. Archived in Learn' : ''}`;
}

/** The line under the job search. */
export function jobWeekLine(week: JobWeek): string {
  return `This week: ${count(week.applied, 'application', 'applications')} sent, ${count(
    week.interviews,
    'interview',
    'interviews',
  )}`;
}
