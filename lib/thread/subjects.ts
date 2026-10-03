import type { CommentTarget } from '@/lib/comments/load';

/**
 * What a thread is on, named by its ref (docs/CORE-AND-DASH-SPEC.md, Part 2).
 *
 * `<Thread subject={ref} />` takes a ref, `schema.table:id`, the same string
 * core.conversations keys a row thread by (plan #1468), where every thread is
 * kept since plan #1470. This file maps each table that has a thread to the
 * target its actions take, which decides what follows a comment there.
 *
 * Client-safe: no database, no server imports. lib/core/refs.ts has the same
 * parse, but it reads the sources catalogue to resolve pages, which a client
 * component has no use for.
 */

/**
 * The targets a thread can sit under today: a dev row, a goal or step
 * (plan #957), a role in Jobs (note 89ad8bef), a file (note 7a6a37aa), or a
 * todo, an order, an inventory item, a saved news story or a vault note
 * (plan #1471).
 */
export type ThreadTarget =
  | CommentTarget
  | 'goal'
  | 'role'
  | 'file'
  | 'task'
  | 'order'
  | 'item'
  | 'story'
  | 'vault_note';

/** The table each target's rows live in, which is the table half of its ref. */
export const THREAD_TABLES = {
  idea: 'public.ideas',
  step: 'public.plan_items',
  raise: 'public.raised_items',
  note: 'public.feedback_items',
  spec: 'public.spec_sections',
  takeaway: 'public.inspiration_takeaways',
  change: 'public.spec_changes',
  goal: 'goals.items',
  role: 'job_search.roles',
  file: 'core.files',
  task: 'todo.tasks',
  order: 'public.orders',
  item: 'public.inventory_items',
  story: 'news.saved_stories',
  vault_note: 'obsidian.notes',
} as const satisfies Record<ThreadTarget, string>;

const TARGET_OF = new Map<string, ThreadTarget>(
  (Object.entries(THREAD_TABLES) as [ThreadTarget, string][]).map(([target, table]) => [
    table,
    target,
  ]),
);

/** The ref a thread under this row is keyed by. */
export function threadRef(target: ThreadTarget, id: string): string {
  return `${THREAD_TABLES[target]}:${id}`;
}

/** A thread's subject split into the target and row id its actions take. */
export type ThreadSubject = { ref: string; table: string; target: ThreadTarget; id: string };

/**
 * The target and row a ref names, or null when the ref is malformed or its
 * table has no thread yet.
 */
export function threadSubject(ref: string): ThreadSubject | null {
  const colon = ref.indexOf(':');
  if (colon < 0) return null;
  const table = ref.slice(0, colon);
  const id = ref.slice(colon + 1).trim();
  const target = TARGET_OF.get(table);
  if (!target || !id) return null;
  return { ref, table, target, id };
}
