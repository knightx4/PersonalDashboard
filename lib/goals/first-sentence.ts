/**
 * The first sentence of Dash's closing text. Dash opens every result with one
 * plain sentence (plan #2376.4); a heading or list marker in front of it is
 * dropped, and a result that is all one run-on line is clipped by the caller.
 * The phone message (lib/goals/step-done-notify.ts) and the Goals Inbox row of
 * a finished step (lib/goals/today.ts) both read it; pure, so either can.
 */
export function firstSentence(text: string | null | undefined): string {
  if (!text) return '';
  const line = text
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
        .replace(/[*_`]/g, '')
        .trim(),
    )
    .find((l) => l.length > 0);
  if (!line) return '';
  const match = line.match(/^.+?[.?!](?=\s|$)/);
  return (match ? match[0] : line).trim();
}
