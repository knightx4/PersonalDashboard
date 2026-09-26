/**
 * The pages Previous page can go back to on Quick read (note 460be33e).
 *
 * Kept in the tab, not the database: a few pages is all the ask needs --
 * "enough to go back to the last one if you skipped too fast" -- and a tab
 * closed is a reading session over. Pure, so the stack is tested without a
 * browser; quick-controls.tsx reads and writes it in sessionStorage.
 */
import type { StoryPass } from '@/lib/news/quick/next';

/** How many pages back Previous page can go. */
export const BACK_PAGES = 5;

/** The stack as stored, oldest page first. Anything malformed reads as empty. */
export function parseBack(raw: string | null): StoryPass[][] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (page): page is StoryPass[] =>
        Array.isArray(page) &&
        page.length > 0 &&
        page.every(
          (story) =>
            typeof story === 'object' &&
            story !== null &&
            typeof story.issueId === 'string' &&
            Number.isInteger(story.storyIndex),
        ),
    );
  } catch {
    return [];
  }
}

/** The stack with this page on top, keeping only the newest BACK_PAGES. */
export function pushBack(stack: readonly StoryPass[][], page: readonly StoryPass[]): StoryPass[][] {
  if (page.length === 0) return [...stack];
  const pairs = page.map(({ issueId, storyIndex }) => ({ issueId, storyIndex }));
  return [...stack, pairs].slice(-BACK_PAGES);
}
