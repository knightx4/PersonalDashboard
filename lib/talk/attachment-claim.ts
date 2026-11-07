/**
 * A bot never says it attached something that was not sent (plan #3050.1).
 *
 * On 7 November 2026 Newt answered "Can you show me a chart of the stock
 * markets past week?" with "Here's your chart, attached as
 * stocks_week_nov6_2026.png!" and no picture came: nothing carries a file a
 * bot makes into a People thread or Ask Dash. Until bots can send files
 * (plan #3050.2 to #3050.4), every bot is told it cannot, and a reply that
 * claims one anyway gets a closing text saying nothing came through, and a
 * slip (core.dash_slips, kind claimed_attachment) so Dev Home counts it.
 *
 * Pure: nothing here reads a database or the network.
 */

/** What every bot is told, after its own rules: it cannot attach, so it never says it did. */
export const ATTACH_RULES = `YOU CANNOT SEND FILES. Your replies are text only: no image, chart picture, PDF,
spreadsheet or other file goes with them, whatever your tools make along the
way. Never write that you attached, sent or included a file, and never name one
as though it were there. When they ask for a chart, an image or a file, say in
a sentence that you cannot send one here yet, then give what you can in words:
the figures, or a link to a page that has them.`;

/** The closing text a reply that claimed an attachment gets when nothing was sent. */
export const NOTHING_ATTACHED =
  'Sorry, nothing actually came through with that: I cannot send files or pictures here yet, so there is no attachment.';

/** Ask Dash's closing sentence, where the chart it draws counts as sent. */
export const NOTHING_ATTACHED_ASK =
  'Nothing is attached to this answer: Dash can draw a chart here but cannot send a file or picture yet.';

const FILE_EXTENSIONS = 'png|jpe?g|gif|webp|svg|pdf|csv|xlsx?|docx?|pptx?|zip|json|txt|html?|md';

/** Each sentence of a text, as the claim is read one sentence at a time. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The sentence speaks of something the person or someone else sent, not the bot. */
const SOMEONE_ELSE = /\b(?:you|you've|you have|they|they've|he|she|someone|we)\s+(?:just\s+)?(?:attach|sent|send|shared|uploaded|forwarded)/i;
/** "attached to the role" is a note on a row, not a file with the reply. */
const ATTACHED_TO = /\battached\s+(?:to|on)\b/i;
/** A link is a real way to send something; a sentence that gives one is not a false claim. */
const LINK = /https?:\/\/\S+/i;

/** The bot's own word for attaching: "I've attached", "attaching", "see attached", "is attached". */
const ATTACH_WORD = /\battach(?:ed|ing)\b/i;
/** A file named as though it were there: "stocks_week.png". */
const FILE_NAME = new RegExp(`\\b[\\w-]+\\.(?:${FILE_EXTENSIONS})\\b`, 'i');
/** "Here's your chart", "the chart below". */
const HERE_IS = /\b(?:here'?s|here is|here are|i'?ve (?:made|put together|drawn)|i made)\b[^.!?\n]{0,30}\b(?:chart|graph|plot|image|picture|pdf|spreadsheet|csv|file)\b/i;
const BELOW = /\b(?:chart|graph|plot|image|picture|pdf|spreadsheet|csv|file)\b[^.!?\n]{0,20}\b(?:below|above)\b/i;

/**
 * The sentence of a reply that says a file or picture is with it, or null
 * when none does. "The PDF you sent", "the note attached to the role" and a
 * sentence that gives a link do not count.
 */
export function attachmentClaim(text: string): string | null {
  for (const sentence of sentences(text)) {
    if (SOMEONE_ELSE.test(sentence) || LINK.test(sentence)) continue;
    const attach = ATTACH_WORD.test(sentence) && !ATTACHED_TO.test(sentence);
    if (attach || HERE_IS.test(sentence) || BELOW.test(sentence) || (FILE_NAME.test(sentence) && /\b(?:here|sent|sending)\b/i.test(sentence))) {
      return sentence;
    }
  }
  return null;
}

/** The slip a false claim is kept as, naming who claimed and what they said. */
export function claimSlip(who: string, claim: string): { kind: 'claimed_attachment'; what: string } {
  const quoted = claim.length > 200 ? `${claim.slice(0, 199)}…` : claim;
  return { kind: 'claimed_attachment', what: `${who} said a file was attached when none was sent: "${quoted}"` };
}

/**
 * What to do about a reply's text: null when it is honest (no claim, or
 * something really was sent with it), else the sentence that claimed one.
 */
export function falseAttachment(text: string, sent: number): string | null {
  if (sent > 0) return null;
  return attachmentClaim(text);
}
