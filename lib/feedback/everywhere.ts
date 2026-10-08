/**
 * Whether a note asks for something on every page rather than the one it was
 * filed on (docs/UI-QUALITY-SPEC.md, Part 3; plan #1547).
 *
 * Such a note is a preference as well as a fix: the notes routine adds it to
 * `app/dev/ui/taste.ts` in the batch that fixes it, so the design critic
 * holds every later screen to it. `notes.ts list` marks the notes this
 * matches, and the session reading them decides. "Let me collapse the
 * recommended roles and any similar boxes anywhere else" matches; "it
 * crashes anywhere I tap" also matches, and is a bug with no preference in
 * it, which is why this marks a note rather than deciding for it.
 */
const EVERYWHERE =
  /\b(?:any|every)(?:where|\s+(?:page|screen|list|box|card|row)s?)\b|\ball\s+(?:the\s+)?(?:pages|screens|lists|boxes)\b|\b(?:across|throughout)\s+the\s+(?:app|site)\b|\bany\s+(?:similar|other)\b/i;

export function asksEverywhere(body: string): boolean {
  return EVERYWHERE.test(body);
}
