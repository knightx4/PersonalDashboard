/**
 * The two helpers that read a flat list of steps: what sits beneath one, and
 * how one reads in a picker.
 *
 * Typed on the fields they read rather than on the plan's catalog entry, so
 * the shared tree components can use them with a goal's steps as well
 * (plan #995).
 */

/** Every step under this one, by id, including the one named. */
export function subtreeOf(
  catalog: readonly { id: string; parentId: string | null }[],
  id: string,
): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of catalog) {
      if (entry.parentId && ids.has(entry.parentId) && !ids.has(entry.id)) {
        ids.add(entry.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** How a step reads in a picker: its depth, its number and its title. */
export function catalogLabel(entry: { depth: number; number: number; title: string }): string {
  return `${'· '.repeat(entry.depth)}#${entry.number} ${entry.title}`;
}
