/** Lines of the text already there shown above what is added, so you can see where it goes. */
export const CONTEXT_LINES = 3;

/**
 * What the merge dialog's preview draws (plan #2357.5): the last few lines
 * already there, and what is added after them. Both merges add at the end of
 * the text with its trailing whitespace trimmed (join-notes.ts), so the added
 * text is what `after` has beyond that. When `after` does not begin with
 * `before`, which neither merge does, the whole of `after` is shown as added.
 */
export function previewParts(before: string, after: string): { context: string; added: string } {
  const head = before.trimEnd();
  if (!after.startsWith(head)) return { context: '', added: after.trim() };
  return {
    context: head.split('\n').slice(-CONTEXT_LINES).join('\n').trim(),
    added: after.slice(head.length).trim(),
  };
}
