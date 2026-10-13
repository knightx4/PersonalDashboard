import { MAX_READING_TEXT } from '@/lib/learn/tracks/reading-text';
import { UNREADABLE_ACTION } from '@/lib/learn/tracks/reading-summary';

/**
 * The chat with Dash on a reading's page (plan #1876.5): the parts with no
 * model in them. The thread is the row thread under the reading
 * (`learn.readings:<id>` in core.conversations), so it is kept like any other.
 */

/** Said once, at the top of Dash's first answer, when the reading was cut. */
export const CHAT_CUT_LINE = `I read only the first ${MAX_READING_TEXT.toLocaleString('en-GB')} characters of this reading, so I cannot speak to anything after that.`;

/**
 * Dash's turn when the reading's text cannot be had: what went wrong and what
 * to paste. Ends with the same words as the summary's message, which the page
 * points at the paste and upload buttons.
 */
export const CHAT_UNREADABLE = `I could not read this reading from its link, so I cannot answer from it yet. To give me its text, ${UNREADABLE_ACTION}, under "Text of this reading" on this tab, then ask again.`;

/** Dash's answer as it is kept: the cut line first on the first answer about a cut reading. */
export function answerWithCut(
  answer: string,
  input: { truncated: boolean; earlierDash: readonly string[] },
): string {
  const body = answer.trim();
  if (!input.truncated) return body;
  if (input.earlierDash.some((turn) => turn.includes(CHAT_CUT_LINE))) return body;
  return `${CHAT_CUT_LINE}\n\n${body}`;
}

/** The reading as the model is given it: title, why, the saved summary, then the text. */
export function readingMaterial(input: {
  title: string;
  why: string | null;
  summary: string | null;
  text: string;
  truncated: boolean;
}): string {
  const lines = [`Title: ${input.title}`];
  if (input.why?.trim()) lines.push(`Why it is on their reading list: ${input.why.trim()}`);
  if (input.summary?.trim())
    lines.push('', 'The summary you wrote of it earlier:', input.summary.trim());
  if (input.truncated) {
    lines.push(
      '',
      `The text below is only the first ${MAX_READING_TEXT.toLocaleString('en-GB')} characters of the reading; the rest was cut.`,
    );
  }
  lines.push('', '<reading>', input.text, '</reading>');
  return lines.join('\n');
}
