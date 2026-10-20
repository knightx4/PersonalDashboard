import { basenameOf } from '@/lib/vault/paths';

/**
 * The daily note (note a268529a): the note named for a day, `YYYY-MM-DD.md`.
 * Today's is opened from the vault page, and written at the top of the vault
 * when there is none, where Obsidian's daily notes go by default.
 */

/**
 * The note for `day` among the stored paths: the one at the top of the vault
 * when there is one, else the nearest to the top, so a daily note filed into
 * a folder is still found. Null when the day has no note.
 */
export function findDailyNote(paths: readonly string[], day: string): string | null {
  const matches = paths.filter((path) => path.endsWith('.md') && basenameOf(path) === day);
  if (matches.length === 0) return null;
  const depth = (path: string) => path.split('/').length;
  return [...matches].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
}
