/**
 * What a task can be about.
 *
 * Fourteen targets across six schemas, named once here so that adding a
 * fifteenth is a line in this file, a column in the migration and an edited
 * check constraint -- rather than a search for every place a target list was
 * written out by hand.
 *
 * `appointment` arrived with migrations-goals/0064 (plan #1373) and is the
 * one target that is not a key to the row it is about. A subscribed
 * appointment's row in todo.feed_events is rewritten on every refresh, so the
 * link keeps the subscription (`feed_id`, a real key) and names the
 * appointment the way the calendar does: its UID and, for a repeat, which
 * date. lib/todo/links/appointment.ts finds the current copy. Wherever a
 * function here takes a target id, the id for `appointment` is the
 * feed_events row the person opened, which write.ts turns into that name.
 *
 * `goal` arrived with migrations-goals/0062 (plan #1263): a task handed to
 * Dash as an errand points at the errand it became. It references
 * goals.items, which holds steps as well as goals, so a task picked against a
 * step points at the step through the same column.
 *
 * The six that are not in job_search or obsidian arrived with
 * migrations-todo/0004, so that a picker over everything the search can find
 * has somewhere to put what it finds. Their names are the same words
 * `SearchHit.kind` uses, deliberately: two vocabularies that agree where they
 * overlap need a table between them rather than a translation.
 *
 * Pure and client-safe: the inline sections are client components and need the
 * same vocabulary the server writes with.
 */

export const LINK_TARGETS = [
  'application',
  'role',
  'company',
  'contact',
  'interview',
  'note',
  'order',
  'inventory',
  'saved',
  'reading',
  'track',
  'subject',
  'goal',
  'appointment',
] as const;

export type LinkTarget = (typeof LINK_TARGETS)[number];

export type LinkRelation = 'about' | 'source';

/** The column each target uses on todo.task_links. */
export const TARGET_COLUMNS: Record<LinkTarget, string> = {
  application: 'application_id',
  role: 'role_id',
  company: 'company_id',
  contact: 'contact_id',
  interview: 'interview_id',
  note: 'note_id',
  order: 'order_id',
  inventory: 'inventory_item_id',
  saved: 'saved_item_id',
  reading: 'reading_id',
  track: 'track_id',
  subject: 'subject_id',
  goal: 'goal_id',
  appointment: 'feed_id',
};

/**
 * The appointment a link names, as todo.task_links holds it: which
 * subscription, which appointment in it, which date of a repeat, and the name
 * and start it had when it was linked.
 */
export interface AppointmentRef {
  feedId: string;
  uid: string;
  /** feed_events.occurrence: null for a one-off. */
  occurrence: string | null;
  title: string;
  startsOn: string | null;
  startsAt: string | null;
}

/** The columns besides feed_id that only an appointment link fills. */
export const APPOINTMENT_COLUMNS = [
  'feed_uid',
  'feed_occurrence',
  'feed_title',
  'feed_starts_on',
  'feed_starts_at',
] as const;

export function isLinkTarget(value: string): value is LinkTarget {
  return (LINK_TARGETS as readonly string[]).includes(value);
}

export interface TaskLink {
  taskId: string;
  relation: LinkRelation;
  target: LinkTarget;
  /** The row's id; for `appointment`, the subscription's (feed_id). */
  targetId: string;
  /** Set on an `appointment` link, and only there. */
  appointment?: AppointmentRef;
}
