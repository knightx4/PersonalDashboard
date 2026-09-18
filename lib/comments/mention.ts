/**
 * The tag that turns a comment into a question.
 *
 * A comment with no tag in it is a note to yourself: it is written on the row,
 * nothing reads it and nothing happens. That is most of them, and it is why
 * the thread is worth having on rows nobody is waiting on. `@dash` is the one
 * thing that asks for an answer back, so the test for it has to be exact — a
 * note that accidentally started a session would make the quiet kind of
 * comment unusable.
 *
 * Hence the boundaries on both sides. `@dashboard` is a word, `me@dash.io` is
 * an address, and neither is asking anybody anything.
 */

/** What you type to ask. */
export const MENTION = '@dash';

const TAG = /(^|[^A-Za-z0-9_@.])@dash(?![A-Za-z0-9_.])/i;

/** Whether this comment is addressed to Claude rather than to yourself. */
export function mentionsDash(body: string): boolean {
  return TAG.test(body);
}

/**
 * A body split into the tag and the words around it.
 *
 * The thread draws the tag as a mention rather than as four ordinary
 * characters, and the split happens here so it is the same test that decides
 * whether a comment is a question. Two rules that agree today and drift in six
 * months would show up as a comment marked as asking and never answered.
 *
 * Returns one part per run of text; a body with no tag in it comes back as a
 * single part.
 */
export function splitOnMention(text: string): { text: string; mention: boolean }[] {
  const parts: { text: string; mention: boolean }[] = [];
  const scan = new RegExp(TAG.source, 'gi');
  let from = 0;

  for (let hit = scan.exec(text); hit; hit = scan.exec(text)) {
    // The match carries the character before the tag, which belongs to the
    // words around it: `[^A-Za-z0-9_@.]` is the boundary, not part of it.
    const before = hit[1] ?? '';
    const start = hit.index + before.length;
    if (start > from) parts.push({ text: text.slice(from, start), mention: false });
    parts.push({ text: text.slice(start, scan.lastIndex), mention: true });
    from = scan.lastIndex;
  }

  if (from < text.length || parts.length === 0) {
    parts.push({ text: text.slice(from), mention: false });
  }
  return parts;
}

/**
 * The question, with the tag taken out.
 *
 * "@dash what does option B cost?" is asking what option B costs; the tag is
 * how it was addressed, not part of what was asked. A comment that is only the
 * tag leaves nothing behind, so the body is used as it stands and the model is
 * left to make what it can of it.
 */
export function questionFrom(body: string): string {
  const stripped = body
    .replace(new RegExp(TAG.source, 'gi'), '$1')
    // The character before the tag is kept, so taking the tag out of the
    // middle of a sentence leaves the space on both sides of it.
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
  return stripped || body.trim();
}
