/**
 * What a task can be about.
 *
 * Six targets across three schemas, named once here so that adding a seventh
 * is a line in this file, a column in the migration and an edited check
 * constraint -- rather than a search for every place a target list was written
 * out by hand.
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
