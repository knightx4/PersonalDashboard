import { z } from 'zod';

/**
 * What a tag on a task may be. Kept out of write.ts, which is server-only, so
 * the row that edits tags can check a name with the same rule before sending it.
 *
 * The database holds the same rule (supabase/migrations-todo/0018_task_tags.sql):
 * trimmed, lowercased, 1 to 40 characters, unique per task.
 */

export const TAG_MAX = 40;

/** One tag, normalised: "  Home " becomes "home". Blank or too long is refused. */
export const tagName = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'A tag needs a name.')
  .max(TAG_MAX, `A tag is at most ${TAG_MAX} characters.`);

/** A task's tags, each normalised. The same tag twice is refused, however it was cased. */
export const tagList = z
  .array(tagName)
  .refine((tags) => new Set(tags).size === tags.length, 'That tag is on the list twice.');

/** Tags in the order a list shows them: by name. */
export function sortTags(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => a.localeCompare(b));
}
