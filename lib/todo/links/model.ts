/**
 * What a task can be about.
 *
 * Twelve targets across five schemas, named once here so that adding a
 * thirteenth is a line in this file, a column in the migration and an edited
 * check constraint -- rather than a search for every place a target list was
 * written out by hand.
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
};

export function isLinkTarget(value: string): value is LinkTarget {
  return (LINK_TARGETS as readonly string[]).includes(value);
}

export interface TaskLink {
  taskId: string;
  relation: LinkRelation;
  target: LinkTarget;
  targetId: string;
}
