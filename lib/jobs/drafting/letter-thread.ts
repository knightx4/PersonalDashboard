/**
 * Dash's reply to a comment tagged @dash under an application's cover letter.
 *
 * That thread used to be answered by the reply every other row gets
 * (lib/thread/ask.ts), which knows nothing of the letter's template: it wrote
 * letters freehand, gave a finance role the AI paragraph the template keeps
 * for AI roles, quoted their notes back as "where AI and finance meet", and
 * could not keep what it wrote. A comment there now goes to the letter's own
 * drafter (./draft-cover-letter.ts). The comment is already saved on the
 * thread, and gather() reads it as one of their comments on the letter, so
 * "make it shorter" or a letter pasted as the model to follow is what the
 * redraft follows. The redraft is kept beside the editor as the Draft
 * button's is, and the reply in the thread is the letter itself.
 */
import type { StoredAsk } from './store';
import type { CoverLetterDraftView } from './draft-cover-letter-payload';

/** The reply written into the thread for a redrafted letter. */
export function letterReply(draft: CoverLetterDraftView): string {
  const open = draft.asks.filter((ask: StoredAsk) => ask.reply === null);
  return [
    'I redrafted the letter with your comments. It is beside the letter: Insert puts it in, and Save keeps it.',
    draft.letter.trim(),
    draft.bannedFound.length > 0 ? `It still uses ${draft.bannedFound.map((b) => `"${b}"`).join(', ')}.` : null,
    draft.unsupportedClaims.length > 0
      ? `Nothing on file backs these:\n${draft.unsupportedClaims.map((claim) => `- ${claim}`).join('\n')}`
      : null,
    open.length > 0
      ? `Answers to these, under the draft, would make it better:\n${open.map((ask) => `- ${ask.question}`).join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}
