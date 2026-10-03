/**
 * Which skills write the person's rows, and whether they record those writes
 * (plan #1460; docs/CORE-AND-DASH-SPEC.md, Part 5, rule R6).
 *
 * Claude Code routines write through the Supabase connector, so the app never
 * sees their writes and cannot record them in core.dash_actions itself. Each
 * skill that writes the person's rows tells the routine to call
 * core.record_dash_action after the write, and
 * tests/skills-record-dash-actions.test.ts reads every skill under
 * .claude/skills with skillsMissingRecord to check that it does.
 *
 * A skill's writes are read from the SQL it shows: `insert into`, `update`
 * and `delete from` followed by a table, where a table with no schema is in
 * `public`. Prose that only describes a write is not seen, so a skill that
 * edits the person's rows without showing the SQL should still name the call,
 * as dash-backup does.
 */

/** The function a routine calls to record a write. */
export const RECORD_CALL = 'core.record_dash_action';

/**
 * The tables whose rows are the person's: what they wrote, want, did or
 * have, which they would want to see Dash change on Home and be able to undo.
 *
 * Not here, because Dash writes them as its own record of a run rather than
 * as a change to anything of the person's: run rows and reports
 * (goals.runs, goals.reviews, goals.briefs, goals.context, plan_runs,
 * spec_findings, ui_reviews, vision_reviews), Dash's own replies and raises
 * (core.conversation_turns, dev_comments, raised_items), its suggestions and
 * drafts waiting on the person (goals.suggestions, job_search.suggestions,
 * spec_changes, social_posts), hand-offs, and join rows (goals.dependencies,
 * plan_dependencies, goals.links, goals.collection_goals).
 */
export const PERSON_ROW_TABLES: ReadonlySet<string> = new Set([
  // Goals
  'goals.items',
  'goals.records',
  'goals.answers',
  'goals.collections',
  // Dev
  'public.plan_items',
  'public.ideas',
  'public.feedback_items',
  // Files and watches
  'core.files',
  'core.watches',
  // The other workspaces' own rows
  'todo.tasks',
  'todo.events',
  'todo.appointments',
  'job_search.thoughts',
  'job_search.roles',
  'job_search.applications',
  'job_search.application_events',
  'job_search.interviews',
  'job_search.companies',
  'job_search.contacts',
  'job_search.contact_touches',
  'job_search.notes',
  'job_search.cover_letters',
  'job_search.application_answers',
  'job_search.reminders',
  'obsidian.notes',
  'learn.aims',
  'learn.goals',
  'learn.watch_list',
  'news.saved_stories',
  'public.saved_items',
  'public.inventory_items',
  'public.recurring_payments',
]);

const WRITE = /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\b/gi;

/** The person's tables a skill's text writes, in the order first seen. */
export function personTablesWritten(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(WRITE)) {
    const name = match[1].toLowerCase();
    const table = name.includes('.') ? name : `public.${name}`;
    if (PERSON_ROW_TABLES.has(table) && !found.includes(table)) found.push(table);
  }
  return found;
}

/** One skill as the check reads it: its name and the text of all its files. */
export type SkillText = { name: string; text: string };

/** A skill that writes the person's rows and never names the call. */
export type SkillMissingRecord = { name: string; tables: string[] };

export function skillsMissingRecord(skills: readonly SkillText[]): SkillMissingRecord[] {
  return skills.flatMap(({ name, text }) => {
    const tables = personTablesWritten(text);
    return tables.length > 0 && !text.includes(RECORD_CALL) ? [{ name, tables }] : [];
  });
}
