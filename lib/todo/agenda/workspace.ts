import type { ModuleId } from '@/lib/modules';
import { parseRef } from '@/lib/core/refs';
import { tableWorkspace } from '@/lib/sources/catalogue';
import type { AgendaEntry, AgendaPile } from '@/lib/todo/agenda/merge';
import type { AgendaItem, SourceId } from '@/lib/todo/agenda/sources';

/**
 * The agenda cut to one workspace, for that workspace's Inbox (plan #1937.5,
 * docs/ONE-INTERFACE-SPEC.md Part 1).
 *
 * The Inbox is not a second list. It is the agenda's own entries, merged and
 * overlaid with the same dismissals, filtered to the workspace each belongs
 * to. Every entry belongs to exactly one workspace, so no row is in two
 * Inboxes and Home's union of them counts each once.
 *
 * PURE: the source-to-module lookup is passed in, so the registry (which is
 * server-only) stays out of the tests.
 */

/** The workspaces whose Inbox is drawn from the agenda. */
export const AGENDA_INBOXES = ['shopping', 'jobs', 'todo', 'vault', 'learn', 'news'] as const;
export type AgendaInbox = (typeof AGENDA_INBOXES)[number];

export function isAgendaInbox(value: string): value is AgendaInbox {
  return (AGENDA_INBOXES as readonly string[]).includes(value);
}

/**
 * Which workspace an item belongs to: what the item says, else the
 * workspace of its row's table, else the workspace of the source that found
 * it (a table in core belongs to no one workspace).
 */
export function itemWorkspace(item: AgendaItem, sourceModule: (id: SourceId) => ModuleId): ModuleId {
  if (item.workspace) return item.workspace;
  const parsed = parseRef(item.ref);
  return (parsed && tableWorkspace(parsed.table)) || sourceModule(item.source);
}

/** A task is Todo's; an item is its row's workspace's. */
export function entryWorkspace(entry: AgendaEntry, sourceModule: (id: SourceId) => ModuleId): ModuleId | null {
  if (entry.kind === 'task') return 'todo';
  return entry.item ? itemWorkspace(entry.item, sourceModule) : null;
}

/**
 * The entries a workspace's Inbox lists, in the agenda's own order: overdue,
 * today, soon, later, then no date.
 *
 * Todo's Inbox is the undated on-you pile alone. A dated task is on the
 * agenda, Todo's Now, by its day; the things with no day are what need you
 * whenever you get to them. Every other workspace lists all of its entries,
 * dated or not, since its Now is not a dated list.
 *
 * An entry is listed once even if two sources found the same row.
 */
export function inboxEntries(
  piles: readonly AgendaPile[],
  workspace: AgendaInbox,
  sourceModule: (id: SourceId) => ModuleId,
): AgendaEntry[] {
  const seen = new Set<string>();
  const out: AgendaEntry[] = [];
  for (const pile of piles) {
    if (workspace === 'todo' && pile.bucket !== 'undated') continue;
    for (const entry of pile.entries) {
      if (entryWorkspace(entry, sourceModule) !== workspace) continue;
      const key = entryRef(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

/** The row an entry is about, as `schema.table:id`. */
export function entryRef(entry: AgendaEntry): string {
  if (entry.kind === 'task' && entry.task) return `todo.tasks:${entry.task.id}`;
  return entry.item?.ref ?? entry.key;
}
