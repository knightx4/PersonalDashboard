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

/** What a linked Learn aim shows, read from learn.aims and its cards. */
export type LinkedAim = {
  linkId: string;
  aimId: string;
  /** Null when the aim has been deleted from Learn since it was linked. */
  name: string | null;
  archived: boolean;
  /**
   * The goal in the Learn area the aim stands for (plan #1491), whose page
   * is where the aim is now seen and changed. Null when it has none.
   */
  goalId?: string | null;
  /** The Level 3 list, whose progress is its claimed and tested articles. */
  level3: { claimed: number; tested: number; total: number } | null;
  /** The subject's preparation run; 'none' for a goal that points at no subject. */
  preparation: SubjectPreparation;
  /** The subject's lens, or null when it has none or no topic on it is approved. */
  lens: LensProgressView | null;
  /** Title of the next piece to work in the subject, or null when none is written. */
  nextPiece: string | null;
};

/**
 * Where the subject's preparation stands (plan #2302.4): 'none' when no run
 * was started, 'working' for a run still going, 'failed' for one that
 * stopped, 'done' once the subject is prepared.
 */
export type SubjectPreparation = 'none' | 'working' | 'failed' | 'done';

/** What the subject's lens holds, per kind of evidence, over the levels its topics ask for. */
export type LensProgressView = {
  topics: number;
  tested: number;
  inferred: number;
  declared: number;
  total: number;
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

/** Whether a goal holds nothing from Learn or the job search. */
export function noLinks(links: GoalLinks): boolean {
  return links.aims.length === 0 && !links.jobSearch && links.jobs.length === 0;
}

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

/** The levels held, said by kind: "5 of 40 levels held: 3 tested, 2 inferred". */
export function lensHeldLine(lens: LensProgressView): string {
  const held = lens.tested + lens.inferred + lens.declared;
  const kinds = [
    lens.tested > 0 ? `${lens.tested} tested` : null,
    lens.inferred > 0 ? `${lens.inferred} inferred` : null,
    lens.declared > 0 ? `${lens.declared} declared` : null,
  ].filter((part): part is string => part !== null);
  return `${held} of ${count(lens.total, 'level', 'levels')} held${kinds.length > 0 ? `: ${kinds.join(', ')}` : ''}`;
}

/** The line under a linked aim: the subject's lens, its preparation and the next piece (plan #2302.4). */
export function aimProgressLine(aim: LinkedAim): string {
  if (aim.name === null) return 'No longer in Learn';
  if (aim.level3) {
    const { claimed, tested, total } = aim.level3;
    return `${claimed} of ${total} articles claimed, ${tested} tested`;
  }
  const archived = aim.archived ? '. Archived in Learn' : '';
  if (aim.preparation === 'none') return `Preparation has not run${archived}`;
  const parts: string[] = [];
  if (aim.preparation === 'working') parts.push('Preparing the subject');
  if (aim.preparation === 'failed') parts.push('Preparation stopped');
  if (aim.lens) parts.push(lensHeldLine(aim.lens));
  else if (aim.preparation === 'done') parts.push('No topics on the lens yet');
  if (aim.nextPiece) parts.push(`Next: ${aim.nextPiece}`);
  return `${parts.join('. ')}${archived}`;
}

/** The line under the job search. */
export function jobWeekLine(week: JobWeek): string {
  return `This week: ${count(week.applied, 'application', 'applications')} sent, ${count(
    week.interviews,
    'interview',
    'interviews',
  )}`;
}
