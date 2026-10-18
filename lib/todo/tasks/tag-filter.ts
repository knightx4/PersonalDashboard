import type { AgendaPile } from '@/lib/todo/agenda/merge';
import type { Task } from '@/lib/todo/tasks/model';
import { tagSuggestions } from '@/lib/todo/tasks/tags';

/**
 * Narrowing a list of todos to one tag, or to the todos with none (plan
 * #2340.3). The agenda and the all-tasks page both read it from the address,
 * so a filtered list survives a reload and can be linked:
 *
 *   ?tag=now        the todos tagged "now"
 *   ?untagged=1     the todos with no tag
 *
 * Two parameters rather than one with a reserved word, since a tag may be any
 * name, "untagged" included. When both are given the tag wins.
 *
 * Kept free of server code so the gallery can draw the filter from fixtures.
 */

export type TagFilter = { kind: 'tag'; tag: string } | { kind: 'untagged' } | null;

/** What the address says, normalised as a tag is: "?tag=Now" is "now". */
export function parseTagFilter(params: { tag?: string | string[]; untagged?: string | string[] }): TagFilter {
  const raw = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const tag = raw?.trim().toLowerCase();
  if (tag) return { kind: 'tag', tag };
  const untagged = Array.isArray(params.untagged) ? params.untagged[0] : params.untagged;
  return untagged !== undefined && untagged !== '0' ? { kind: 'untagged' } : null;
}

/** The filter as query parameters, to merge into a link's other ones. */
export function tagFilterQuery(filter: TagFilter): Record<string, string> {
  if (!filter) return {};
  return filter.kind === 'tag' ? { tag: filter.tag } : { untagged: '1' };
}

/** Whether two filters are the same choice, for marking the chip that is on. */
export function sameTagFilter(a: TagFilter, b: TagFilter): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'untagged' || b.kind === 'untagged') return a.kind === b.kind;
  return a.tag === b.tag;
}

/** Whether a todo is in the list the filter asks for. No filter keeps everything. */
export function matchesTagFilter(task: Pick<Task, 'tags'>, filter: TagFilter): boolean {
  if (!filter) return true;
  return filter.kind === 'untagged' ? task.tags.length === 0 : task.tags.includes(filter.tag);
}

/**
 * The chips the filter row offers, in order: Now and Eventually, then every
 * other tag the person has used (most used first, as loadUsedTags reads them),
 * and the tag being filtered on even if nothing carries it any more, so the
 * chip that is on is always on the row.
 */
export function tagFilterChoices(used: readonly string[], filter: TagFilter): string[] {
  const choices = tagSuggestions(used);
  return filter?.kind === 'tag' && !choices.includes(filter.tag) ? [...choices, filter.tag] : choices;
}

/**
 * The agenda's piles under a filter. Only your own todos carry tags, so a
 * filter keeps only them: rows the agenda borrows from other workspaces and
 * the day's appointments drop out, and so does any pile left with nothing in
 * it. The items under a todo go with it, whatever their own tags.
 */
export function filterPiles(piles: AgendaPile[], filter: TagFilter): AgendaPile[] {
  if (!filter) return piles;
  return piles
    .map((pile) => ({
      ...pile,
      entries: pile.entries.filter(
        (entry) => entry.kind === 'task' && entry.task !== undefined && matchesTagFilter(entry.task, filter),
      ),
      context: [],
    }))
    .filter((pile) => pile.entries.length > 0);
}

/** How the filter reads in a sentence: "now", or "no tag". */
export function tagFilterLabel(filter: Exclude<TagFilter, null>): string {
  return filter.kind === 'tag' ? filter.tag : 'no tag';
}
