/**
 * The tables Dash may propose deleting from, and what their rows are called
 * (plan #2266.2). Kept apart from delete-rows.ts so the delete popup, a client
 * component, can name the rows without importing the server-side checks.
 */
export type DeletableTable = 'job_search.application_answers' | 'job_search.notes' | 'job_search.roles' | 'todo.tasks';

/** What the rows are called, singular and plural. */
export const DELETE_NOUNS: Record<DeletableTable, readonly [string, string]> = {
  'job_search.application_answers': ['answer', 'answers'],
  'job_search.notes': ['note', 'notes'],
  'job_search.roles': ['role', 'roles'],
  'todo.tasks': ['task', 'tasks'],
};
