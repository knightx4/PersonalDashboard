/**
 * Links from a goal to what other workspaces own (docs/GOALS-SPEC.md,
 * "Where things live"; plan #931, plan #2330.1).
 *
 * A link is a row of goals.links naming a Learn aim, the job search as a
 * whole, one role or one application, or a row a goal lists: a reading, a
 * calendar event, a saved product or a contact. The goal page reads each
 * target from its own workspace when it loads, so nothing is logged twice and
 * nothing is copied: finishing a reading in Learn shows on the goal because
 * the goal reads the reading itself.
 *
 * Pure, so the week and the wording are tested without a database. The reads
 * and writes are in lib/goals/links-store.ts.
 */
import { periodOf } from '@/lib/goals/rhythms';
import { wallClockToInstant } from '@/lib/todo/time';

/**
 * The kinds of row a goal's list can point at (plan #2330.1). Each is a row
 * another workspace keeps: a reading on a Learn track, a Todo calendar event,
 * a product saved for later in Shopping, a contact in the job search.
 */
export const LISTED_KINDS = ['reading', 'event', 'saved_item', 'contact'] as const;

export type ListedKind = (typeof LISTED_KINDS)[number];

export function isListedKind(value: unknown): value is ListedKind {
  return typeof value === 'string' && (LISTED_KINDS as readonly string[]).includes(value);
}

export type LinkKind = 'aim' | 'job_search' | 'role' | 'application' | ListedKind;

export const LINK_KINDS: readonly LinkKind[] = ['aim', 'job_search', 'role', 'application', ...LISTED_KINDS];

export function isLinkKind(value: unknown): value is LinkKind {
  return typeof value === 'string' && (LINK_KINDS as readonly string[]).includes(value);
}

/**
 * The list a link lands in when it is made without a name. Links of one goal
 * with the same list name are one list, so a goal's readings are one list
 * called "Reading" until someone names a second.
 */
export const DEFAULT_LIST_NAMES: Record<ListedKind, string> = {
  reading: 'Reading',
  event: 'Events',
  saved_item: 'Products',
  contact: 'People',
};

/** The most a list name holds, as goals.links_list_name_ck allows. */
export const LIST_NAME_MAX = 80;

/** A list name as typed, trimmed; null when blank, which means the kind's own list. */
export function parseListName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') return null;
  return name.slice(0, LIST_NAME_MAX).trim();
}

export type Link = {
  id: string;
  itemId: string;
  kind: LinkKind;
  /** Null for the job search, which is the whole of it. */
  targetId: string | null;
  /** The list it belongs to; null is the kind's own (DEFAULT_LIST_NAMES). */
  listName: string | null;
};

export const LINK_COLUMNS = 'id, item_id, kind, target_id, list_name';

export type LinkRow = { id: string; item_id: string; kind: string; target_id: string | null; list_name?: string | null };

/** A row as read, or null for a kind this code does not know. */
export function toLink(row: LinkRow): Link | null {
  if (!isLinkKind(row.kind)) return null;
  return { id: row.id, itemId: row.item_id, kind: row.kind, targetId: row.target_id, listName: row.list_name ?? null };
}

/** The name of the list a link shows in. */
export function listNameOf(link: Pick<Link, 'kind' | 'listName'>): string {
  if (link.listName) return link.listName;
  return isListedKind(link.kind) ? DEFAULT_LIST_NAMES[link.kind] : link.kind;
}

type LinkedBase = {
  linkId: string;
  targetId: string;
  listName: string;
  /** True when the row has been removed from its workspace since it was linked. */
  gone: boolean;
  /** Where the row opens in its own workspace; null once it has gone. */
  href: string | null;
};

/** A reading on a Learn track, as Learn has it now. */
export type LinkedReading = LinkedBase & {
  kind: 'reading';
  title: string | null;
  /** learn.readings.status, as Learn writes it. */
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

/** A Todo calendar event. Exactly one of the two pairs is set, as todo.events enforces. */
export type LinkedEvent = LinkedBase & {
  kind: 'event';
  title: string | null;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

/** A product saved for later in Shopping. */
export type LinkedSavedItem = LinkedBase & {
  kind: 'saved_item';
  title: string | null;
  /** The shop's page for it. */
  url: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  currency: string | null;
  /** public.saved_items.status, as Shopping writes it. */
  status: string | null;
  /** Matched to an order line in Shopping (saved_items.purchased_order_item_id). */
  bought: boolean;
};

/** A contact in the job search. */
export type LinkedContact = LinkedBase & {
  kind: 'contact';
  name: string | null;
  /** Their job title. */
  role: string | null;
  company: string | null;
  email: string | null;
  linkedinUrl: string | null;
};

/** One row a goal lists, read live from the workspace that keeps it. */
export type LinkedRow = LinkedReading | LinkedEvent | LinkedSavedItem | LinkedContact;

/** A list on a goal: every link of one item that shares a list name. */
export type LinkedList = {
  name: string;
  /** The kinds its rows are, in the order they first appear. */
  kinds: ListedKind[];
  rows: LinkedRow[];
};

/**
 * Rows into their lists, each list placed where its first row is and each
 * row in the order it was linked. Names compare without case, so "reading"
 * and "Reading" are one list, shown as the first was written.
 */
export function groupLists(rows: readonly LinkedRow[]): LinkedList[] {
  const lists = new Map<string, LinkedList>();
  for (const row of rows) {
    const key = row.listName.toLowerCase();
    let list = lists.get(key);
    if (!list) {
      list = { name: row.listName, kinds: [], rows: [] };
      lists.set(key, list);
    }
    if (!list.kinds.includes(row.kind)) list.kinds.push(row.kind);
    list.rows.push(row);
  }
  return [...lists.values()];
}

/** Where a linked row opens in its own workspace. An event opens on its week in the calendar. */
export function linkedHref(
  kind: ListedKind,
  id: string,
  event?: { startsOn: string | null; startsAt: string | null },
): string {
  if (kind === 'reading') return `/learn/r/${id}`;
  if (kind === 'saved_item') return `/shopping/saved/${id}`;
  if (kind === 'contact') return `/jobs/contacts/${id}`;
  const day = event?.startsOn ?? event?.startsAt?.slice(0, 10) ?? null;
  const params = new URLSearchParams({ view: 'week', ...(day ? { date: day } : {}), event: id });
  return `/todo/calendar?${params}`;
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
