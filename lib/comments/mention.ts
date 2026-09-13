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
