/**
 * A bot never says it attached something that was not sent (plan #3050.1).
 *
 * On 7 November 2026 Newt answered "Can you show me a chart of the stock
 * markets past week?" with "Here's your chart, attached as
 * stocks_week_nov6_2026.png!" and no picture came: nothing carries a file a
 * bot makes into a People thread or Ask Dash. Every bot is told it cannot
 * send files, and a reply that claims one anyway gets a closing text saying
 * nothing came through, and a slip (core.dash_slips, kind
 * claimed_attachment) so Dev Home counts it.
 *
 * A bot can draw a chart (plan #3050.2.2): show_chart draws it under the
 * text, as Ask Dash does. A reply that drew one may say so; a reply that
 * names a file, a picture or a PDF is still flagged, chart or not.
 *
 * A bot in a direct thread can send what its code makes (plan #3050.3.1).
 * A reply whose code made a file is not checked at all: what was kept shows
 * under it, and what could not be kept is said in a text of its own
 * (lib/talk/made-files.ts).
 *
 * Pure: nothing here reads a database or the network.
 */

/**
 * What a bot in a direct thread is told, after its own rules (plan
 * #3050.3.1): it can draw a chart, and it can send a file its code makes,
 * so it never says it sent one it did not make.
 */
export const ATTACH_RULES = `YOU CAN DRAW A CHART, AND YOU CAN SEND FILES YOUR CODE MAKES. When they ask
for a chart or a table of figures, call show_chart with the figures a lookup
or a search gave you, and it is drawn under your text; then say in a sentence
what it shows. When they ask for an image, a PDF or another file, make it with
code_execution: write the file in your code (a PNG with matplotlib, a PDF, a
CSV) and it is sent under your text, up to four files, each up to 20 MB, as an
image, a PDF, a Word file, text or CSV. Put the figures from a lookup or a
search into the code yourself; the code cannot reach their rows or the web.
Say in a sentence what you sent. Never write that you attached or sent a file
your code did not make, and never name one (such as markets.png) as though it
were there.`;

/** What a group's speakers are told, who cannot run code yet: a chart is drawn, no file is sent. */
export const CHART_ONLY_RULES = `YOU CAN DRAW A CHART, BUT YOU CANNOT SEND FILES. When they ask for a chart
or a table of figures, call show_chart with the figures a lookup or a search
gave you, and it is drawn under your text; then say in a sentence what it
shows. Nothing else goes with your replies: no image, picture, PDF,
spreadsheet or other file, whatever your tools make along the way. Never write
that you attached, sent or included a file, and never name one (such as
markets.png) as though it were there. When they ask for an image or a file,
say in a sentence that you cannot send one here yet, then give what you can:
a chart, the figures in words, or a link to a page that has them.`;

/** The closing text a direct reply that claimed an attachment gets when its code made none. */
export const NOTHING_ATTACHED =
  'Sorry, no file came through with that: nothing was made to send. Ask again and I will make it.';

/** The closing text a group's text that claimed an attachment gets, where only a chart can be sent. */
export const NOTHING_ATTACHED_CHART_ONLY =
  'Sorry, no file came through with that: I can draw a chart here, but I cannot send files or pictures yet.';

/**
 * Ask Dash's closing sentence when it claimed a file its code did not make
 * (plan #3050.3.2): a chart it drew counts as sent.
 */
export const NOTHING_ATTACHED_ASK = 'Nothing is attached to this answer: no file was made to send. Ask again and Dash will make it.';

/** Ask Dash's closing sentence where nothing its code makes could be kept, so a chart is the one thing sent. */
export const NOTHING_ATTACHED_ASK_CHART_ONLY =
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
/** A thing that is a file whatever the bot drew: a chart is drawn, these never are. */
const FILE_THING = /\b(?:image|picture|photo|png|jpe?g|pdf|spreadsheet|csv|file|download)s?\b/i;

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
 * The sentence of a reply that drew a chart which still claims a file: one
 * that names a file, or speaks of a picture, a PDF or a file as attached,
 * here or below. "Here's the chart" and "the chart below" are true then.
 */
export function fileClaim(text: string): string | null {
  for (const sentence of sentences(text)) {
    if (SOMEONE_ELSE.test(sentence) || LINK.test(sentence)) continue;
    if (FILE_NAME.test(sentence) && /\b(?:here|sent|sending)\b/i.test(sentence)) return sentence;
    const claims = (ATTACH_WORD.test(sentence) && !ATTACHED_TO.test(sentence)) || HERE_IS.test(sentence) || BELOW.test(sentence);
    if (claims && FILE_THING.test(sentence)) return sentence;
  }
  return null;
}

/**
 * What to do about a reply's text: null when it is honest, else the
 * sentence that claimed a file. `charts` is how many charts the reply drew:
 * with none, any claim of a chart or a file counts; with one or more, only a
 * claim of a file does. `files` is how many files its code made (plan
 * #3050.3.1): with any, nothing it says is counted as a false claim.
 */
export function falseAttachment(text: string, charts: number, files = 0): string | null {
  if (files > 0) return null;
  if (charts > 0) return fileClaim(text);
  return attachmentClaim(text);
}
