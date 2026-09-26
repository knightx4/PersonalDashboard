/**
 * The words a goal is matched against your vault notes on (plan #1114, under
 * #1110): its title and its done-when. The goal page passes this to
 * relatedNotes (lib/vault/notes/related.ts), which embeds it once and keeps
 * the vector by the text's hash, so only an edit to the title or the done-when
 * costs a new embedding. Steps, readings and status stay out: they change
 * daily and say how the goal is going rather than what it is about.
 */
export function goalMatchText(goal: { title: string; acceptance: string | null }): string {
  return [goal.title.trim(), goal.acceptance?.trim() ?? ''].filter(Boolean).join('\n');
}
